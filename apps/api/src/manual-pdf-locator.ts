import { AppError, ensure } from './domain.js';

/** Text extraction only: callers keep PDF loading, preflight and disposal serialized. */
export interface PdfTextDocument {
  numPages: number;
  getPage(number: number): Promise<{
    getTextContent(): Promise<{ items: unknown[] }>;
    cleanup(): unknown;
  }>;
}
export const PDF_TEXT_SCAN_LIMITS = {
  maxPages: 1000,
  maxPageCharacters: 60_000,
  maxTotalCharacters: 3_000_000,
  maxPageItems: 20_000,
  maxMilliseconds: 30_000,
  maxPageMilliseconds: 2500,
} as const;
export type PdfTextScanLimits = { [Key in keyof typeof PDF_TEXT_SCAN_LIMITS]: number };

const guidance = '请上传保养周期表及相邻图例、脚注的清晰截图，或切换手动选页并填写 PDF 物理页码；不会将整本手册发送给 AI';
const compact = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\s\u200b-\u200d\ufeff]+/g, '');
const components = [
  /机油|机滤|oilfilter|engineoil/,
  /空气滤|airfilter|aircleaner/,
  /空调滤|座舱滤|cabinfilter|pollenfilter/,
  /火花塞|sparkplug/,
  /制动|刹车|brake/,
  /轮胎|车轮|胎压|tire|tyre|wheel/,
  /转向|拉杆|\beps\b|steering/,
  /悬架|球销|球头|suspension|balljoint/,
  /传动轴|防尘罩|driveshaft|cvboot/,
  /冷却|防冻|coolant|coolingsystem/,
  /齿轮油|变速|gearbox|transmission/,
  /动力电池|蓄电池|battery/,
  /高压|充电|highvoltage|charging/,
  /灯具|灯光|车灯|headlamp|light/,
  /雨刮|雨刷|wiper/,
  /车门|前舱盖|铰链|door|bonnet|hinge/,
  /燃油|fuel/,
  /皮带|belt/,
];
interface PageEvidence { number: number; core: boolean; directory: boolean; intervalGuidance: boolean }

function evidence(number: number, text: string): PageEvidence {
  const normalized = text.normalize('NFKC').toLowerCase();
  const dense = compact(text);
  const leaders = (normalized.match(/\.{3,}|…{2,}|·{4,}/g) || []).length;
  const directory = leaders >= 2 || /^(?:\s*table\s+of\s+contents|\s*contents\b)/.test(normalized) || dense.includes('目录') && leaders > 0;
  const componentCount = components.filter(pattern => pattern.test(dense)).length;
  const schedule = /保养周期|保养计划|保养间隔|定期保养|定期维护|维护周期|维护计划|maintenanceschedule|scheduledmaintenance|maintenanceinterval|serviceschedule/.test(dense);
  const tableHeader = /保养项目.{0,12}保养周期|保养周期表|定期保养表|维护周期表|maintenance(?:schedule|chart)|service(?:schedule|interval)/.test(dense);
  const intervalWords = (dense.match(/首次|后续每|之后每|每隔|每行驶|每\d+(?:\.\d+)?(?:个月|月|年)|every|whichever(?:comes)?first/g) || []).length;
  const units = (dense.match(/公里|千米|km|个月|months?|years?|\d年/g) || []).length;
  const numbers = (dense.match(/\d+(?:[.,]\d+)*/g) || []).length;
  const actions = (dense.match(/检查|更换|清洁|润滑|inspect|replace|clean|lubricat|check/g) || []).length;
  const markers = (normalized.match(/(?:^|\s)[ircla](?=\s|$)|[√✓●○]/g) || []).length;
  const score = Math.min(componentCount, 8) * 2 + (schedule ? 4 : 0) + (tableHeader ? 4 : 0) +
    Math.min(intervalWords, 6) + Math.min(units, 8) + Math.min(Math.floor(numbers / 2), 6) + Math.min(actions, 6) + Math.min(markers, 6);
  // Require repeated component/interval/action evidence. A chapter heading,
  // table of contents, or prose that merely mentions maintenance is insufficient.
  const intervalTable = units >= 4 && numbers >= 6 && (intervalWords >= 3 || tableHeader);
  const markedTable = schedule && units >= 1 && numbers >= 6 && markers >= 6;
  const core = !directory && score >= 24 && componentCount >= 3 && (schedule || intervalWords >= 4) &&
    (intervalTable || markedTable) && (actions >= 3 || markers >= 6);
  const intervalGuidance = !directory && schedule && /以先.{0,5}(?:到|达到)|whichever(?:comes)?first|超过.{0,10}(?:最后|间隔)|beyond.{0,20}interval/.test(dense);
  return { number, core, directory, intervalGuidance };
}

function boundedLimits(overrides: Partial<PdfTextScanLimits>): PdfTextScanLimits {
  return Object.fromEntries(Object.entries(PDF_TEXT_SCAN_LIMITS).map(([key, maximum]) => {
    const requested = overrides[key as keyof PdfTextScanLimits];
    return [key, requested === undefined ? maximum : Math.max(1, Math.min(maximum, requested))];
  })) as PdfTextScanLimits;
}

/** Locate an entire supported schedule plus adjacent explanations, never random sample pages. */
export async function locateMaintenancePages(doc: PdfTextDocument, overrides: Partial<PdfTextScanLimits> = {}): Promise<number[]> {
  const limits = boundedLimits(overrides);
  ensure(Number.isInteger(doc.numPages) && doc.numPages > 0 && doc.numPages <= limits.maxPages, 400, 'PDF_PAGE_LIMIT', 'PDF 必须为 1 至 1000 页');
  const started = performance.now();
  const pages: PageEvidence[] = [];
  let characters = 0;
  const scanLimit = () => new AppError(400, 'PDF_TEXT_SCAN_LIMIT', `PDF 自动定位的文本或扫描预算已达上限。${guidance}`);
  for (let number = 1; number <= doc.numPages; number++) {
    if (performance.now() - started > limits.maxMilliseconds) throw scanLimit();
    const pageStarted = performance.now();
    let page: Awaited<ReturnType<PdfTextDocument['getPage']>> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    try {
      const content = await Promise.race([
        (async () => {
          const candidate = await doc.getPage(number);
          if (finished) { candidate.cleanup(); throw scanLimit(); }
          page = candidate;
          return page.getTextContent();
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(scanLimit()), Math.max(1, Math.min(limits.maxPageMilliseconds, limits.maxMilliseconds - (performance.now() - started)))); }),
      ]);
      if (performance.now() - started > limits.maxMilliseconds || performance.now() - pageStarted > limits.maxPageMilliseconds) throw scanLimit();
      if (content.items.length > limits.maxPageItems) throw scanLimit();
      const strings: string[] = [];
      let pageCharacters = 0;
      for (const item of content.items) {
        if (!item || typeof item !== 'object' || !('str' in item) || typeof item.str !== 'string') continue;
        pageCharacters += item.str.length + 1;
        if (pageCharacters > limits.maxPageCharacters || characters + pageCharacters > limits.maxTotalCharacters) throw scanLimit();
        strings.push(item.str);
      }
      characters += pageCharacters;
      pages.push(evidence(number, strings.join(' ')));
    } finally {
      finished = true;
      if (timer) clearTimeout(timer);
      page?.cleanup();
    }
  }
  const core = pages.filter(page => page.core);
  ensure(core.length > 0, 400, 'PDF_AUTO_SELECTION_REQUIRED', `${characters < 100 ? '这份长 PDF 缺少可检索文字，可能是扫描件，无法自动定位保养周期表' : '未找到有足够项目与周期数值依据的保养周期表；目录或维修提及不能代替周期表'}。${guidance}`);
  const selected = new Set<number>([1, 2].filter(number => number <= doc.numPages));
  for (const page of core) {
    selected.add(page.number);
    // A short chapter introduction can explain whichever comes first and how
    // intervals continue beyond the final table column, without being a table.
    for (let offset = 2; offset <= 3; offset++) {
      const introduction = pages[page.number - 1 - offset];
      if (introduction?.intervalGuidance) selected.add(introduction.number);
    }
    // Unlabelled legends and footnotes can carry essential qualifications.
    // Keep both immediate neighbors conservatively; never silently drop them
    // merely because their wording lacks a known keyword.
    for (const neighbor of [pages[page.number - 2], pages[page.number]]) {
      if (neighbor && !neighbor.directory) selected.add(neighbor.number);
    }
  }
  ensure(selected.size <= 12, 400, 'PDF_AUTO_SELECTION_REQUIRED', `保养表与必要说明分布超过 12 页，无法自动完整选入。${guidance}`);
  return [...selected].sort((a, b) => a - b);
}
