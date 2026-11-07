import { load } from 'cheerio';
import type { CarModel, ManualSource } from '@autovoyage/shared';

type Downloaded = { bytes: Buffer; type: string; url: string; charset?: string };
export type OfficialManualDownload = (url: string, redirects?: number, postData?: string, timeoutMs?: number, deadline?: number, maxBytes?: number) => Promise<Downloaded>;
export interface OfficialManualContext { title: string; url: string; text: string }
const hondaIndex = 'https://www.dongfeng-honda.com/service_handbook_crv.shtml';
const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();
const compact = (text: string) => text.toLowerCase().replace(/[\s·_－-]+/g, '');
const hybrid = /混动|双擎|(?:e[-:\s]?)?HEV|PHEV|DM[-－]?[ip]|油电|增程/i;
function powerKind(text: string): 'hybrid' | 'electric' | 'fuel' | 'unknown' {
  if (hybrid.test(text)) return 'hybrid';
  if (/纯电|BEV|(?:^|\W)EV(?:$|\W)|电动|\d\s*kWh/i.test(text)) return 'electric';
  if (/汽油|燃油|柴油|\d(?:\.\d)?\s*[TL]\b|TURBO|TFSI|TSI|GDI/i.test(text)) return 'fuel';
  return 'unknown';
}

function sameOfficialUrl(value: string, base: string): string | undefined {
  try {
    const url = new URL(value, base), original = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname !== original.hostname) return;
    url.hash = '';
    return url.href;
  } catch { return; }
}
function conflict(model: CarModel, title: string): boolean {
  const requested = powerKind(`${model.power} ${model.name}`), offered = powerKind(title);
  if (requested !== 'unknown' && offered !== 'unknown' && requested !== offered) return true;
  const modelBody = `${model.name} ${model.power}`;
  if (/两厢|掀背|hatchback/i.test(modelBody) && /三厢|四门/.test(title)) return true;
  if (/三厢|sedan/i.test(modelBody) && /两厢|五门|hatchback/i.test(title)) return true;
  return false;
}

/** Uses the current official navigation, rather than constructing a model URL. */
export function hondaModelManualDirectory(html: string, base: string, model: CarModel): string | undefined {
  const $ = load(html);
  const name = compact(model.name.replace(/[·（(].*$/u, ''));
  const aliases: Record<string, string> = { civic: '思域', inspire: '英仕派', elysion: '艾力绅', envix: '享域' };
  let match: string | undefined;
  $('a[href]').each((_i, node) => {
    const anchor = $(node), text = compact(anchor.text());
    const url = sameOfficialUrl(anchor.attr('href') || '', base);
    if (!text || !url || !/\/service_handbook_[a-z0-9]+\.shtml$/i.test(new URL(url).pathname)) return;
    if (name === text || name.startsWith(text) || Object.entries(aliases).some(([english, chinese]) => name.includes(english) && text === chinese)) match = url;
  });
  return match;
}

function cardYear(title: string): number | undefined {
  const match = title.match(/(?:^|\D)((?:20)?\d{2})\s*(?:款|年)/);
  if (!match) return;
  return Number(match[1].length === 2 ? `20${match[1]}` : match[1]);
}
function cardScore(source: ManualSource, model: CarModel): number {
  return (cardYear(source.title) === model.year ? 70 : cardYear(source.title) ? -50 : 0) +
    (/电子手册/.test(source.title) ? 35 : /三包|保养/.test(source.title) ? 25 : 0) +
    (hybrid.test(model.power) && hybrid.test(source.title) || /汽油|燃油/.test(model.power) && /汽油/.test(source.title) ? 8 : 0);
}

/** PDF links are in data-mobileurl; desktop hrefs may point at ZIP files. */
export function parseHondaManualCards(html: string, base: string, model: CarModel): ManualSource[] {
  const $ = load(html), sources: ManualSource[] = [];
  $('a[href], a[data-mobileurl]').each((_i, node) => {
    const anchor = $(node), card = anchor.closest('dl, li, .manual-card');
    const title = tidy(card.find('h5, h4, .manual-title').first().text() || anchor.attr('title') || anchor.text());
    if (!/手册/.test(title) || /应急|救援|快速|音响|导航/.test(title) || conflict(model, title)) return;
    const url = sameOfficialUrl(anchor.attr('data-mobileurl') || anchor.attr('href') || '', base);
    if (!url || !/\.pdf$|\/(?:manual|userguide)\//i.test(new URL(url).pathname) || sources.some(source => source.url === url)) return;
    const year = cardYear(title);
    sources.push({ title: `东风本田官方 · ${title}`, url, kind: 'official', isDirectory: false,
      description: `车企官方车型资料目录中的具体手册，目录原名《${title}》。${year ? `目录标注 ${year} 款${year !== model.year ? `，与当前 ${model.year} 年款不同，只能作为参考` : ''}。` : '目录未标明具体年款，适用年份以手册原文为准。'}${powerKind(`${model.power} ${model.name}`) === 'unknown' && powerKind(title) !== 'unknown' ? '车型动力未明确，不能确认该版本适用；需要先选择动力版本。' : ''}${/\.pdf$/i.test(new URL(url).pathname) ? 'PDF 文件直链，可直接读取。' : '公开电子手册，可直接阅读。'}` });
  });
  return sources.sort((a, b) => cardScore(b, model) - cardScore(a, model)).slice(0, 8);
}

/** The visible card title and its actual link are evidence, not search metadata. */
export function parseHondaManualContext(html: string, base: string, sourceUrl: string): OfficialManualContext[] {
  const requested = sameOfficialUrl(sourceUrl, base);
  if (!requested) return [];
  const source = new URL(requested), $ = load(html);
  const pageTitle = tidy($('title').first().text() || $('h1').first().text()).slice(0, 1000);
  const matches: Array<{ title: string; raw: string; attribute: string; url: string }> = [];
  $('a[href], a[data-mobileurl]').each((_i, node) => {
    const anchor = $(node), card = anchor.closest('dl, li, .manual-card');
    const title = tidy(card.find('h5, h4, .manual-title').first().text() || anchor.attr('title') || anchor.text()).slice(0, 1000);
    if (!/手册/.test(title)) return;
    for (const attribute of ['data-mobileurl', 'href']) {
      const raw = anchor.attr(attribute);
      if (!raw || raw.length > 2500) continue;
      const url = sameOfficialUrl(raw, base);
      if (!url) continue;
      const linked = new URL(url);
      // A schedule can be a chapter of the actual linked electronic book.
      // Only a same-origin HTML child of that book root qualifies; a similar
      // model name or a search description cannot establish this relation.
      const child = linked.pathname.endsWith('/') && /\/(?:manual|userguide)\//i.test(linked.pathname) &&
        source.pathname.startsWith(linked.pathname) && /\.html$/i.test(source.pathname) && !linked.search;
      if (url !== requested && !child) continue;
      if (!matches.some(match => match.title === title && match.url === url)) matches.push({ title, raw, attribute, url });
    }
  });
  // Prefer the most specific actual book link if a directory includes nested
  // roots. Return only matching cards, rather than unrelated version selectors.
  const longest = Math.max(0, ...matches.map(match => new URL(match.url).pathname.length));
  return matches.filter(match => new URL(match.url).pathname.length === longest).slice(0, 3).map(match => ({
    title: pageTitle || '东风本田用车指南', url: base,
    text: `采集页面网址：${base}\n页面标题：${pageTitle}\n\n以下为该页面中实际匹配到的手册卡片原文：\n${match.title}\n\n该卡片的页面链接属性：${match.attribute}=${JSON.stringify(match.raw)}\n链接解析网址：${match.url}\n\n已读取的资料页：${requested}\n采集说明：以上卡片标题和链接来自本页实际 HTML；没有补写排量、变速箱或配置等未出现的信息。`,
  }));
}

/** Reacquire provenance from the actual official directory for AI and storage. */
export async function acquireOfficialManualContext(model: CarModel, sourceUrl: string, download: OfficialManualDownload): Promise<OfficialManualContext[]> {
  if (!/本田|honda/i.test(model.brand) || /广汽/.test(model.brand) || !sameOfficialUrl(sourceUrl, hondaIndex)) return [];
  const deadline = Date.now() + 7500;
  const read = (url: string) => download(url, 0, undefined, Math.min(3500, Math.max(1, deadline - Date.now())), deadline, 2 * 1024 * 1024);
  try {
    const index = await read(hondaIndex);
    const directoryUrl = hondaModelManualDirectory(index.bytes.toString('utf8'), index.url, model);
    if (!directoryUrl) return [];
    const directory = directoryUrl === index.url ? index : await read(directoryUrl);
    return parseHondaManualContext(directory.bytes.toString('utf8'), directory.url, sourceUrl);
  } catch { return []; }
}

/** Reads route metadata as text. It never evaluates a remote script. */
export function hondaMaintenanceRoutes(script: string, base: string): Array<{ title: string; url: string }> {
  const routes: Array<{ title: string; url: string }> = [];
  const pattern = /title:\s*"([^"\n]{0,70}(?:保养时间表|保养周期表|定期保养)[^"\n]{0,50})"[\s\S]{0,180}?regularPath:\s*"([^"\n]{1,220})"/g;
  for (const match of script.matchAll(pattern)) {
    // VuePress regularPath is relative to its documented base, not the host root.
    if (!/^\/[a-zA-Z0-9_/-]+\.html$/.test(match[2])) continue;
    const url = sameOfficialUrl(match[2].slice(1), base);
    if (url && !routes.some(route => route.url === url)) routes.push({ title: match[1], url });
  }
  return routes.slice(0, 2);
}

/** Bounded official connector; other brands continue through open web search. */
export async function discoverDongfengHondaManuals(model: CarModel, download: OfficialManualDownload): Promise<ManualSource[]> {
  if (!/本田|honda/i.test(model.brand) || /广汽/.test(model.brand)) return [];
  const deadline = Date.now() + 10500;
  const read = (url: string) => download(url, 0, undefined, Math.min(3500, Math.max(1, deadline - Date.now())), deadline, 2 * 1024 * 1024);
  try {
    const index = await read(hondaIndex);
    const directoryUrl = hondaModelManualDirectory(index.bytes.toString('utf8'), index.url, model);
    if (!directoryUrl) return [];
    const directory = directoryUrl === index.url ? index : await read(directoryUrl);
    const cards = parseHondaManualCards(directory.bytes.toString('utf8'), directory.url, model);
    const electronic = cards.find(card => !/\.pdf$/i.test(new URL(card.url).pathname) && !card.description.includes('不能确认该版本适用') && (cardYear(card.title) === model.year || cardYear(card.title) === undefined));
    if (!electronic) return cards;
    try {
      const landing = await read(electronic.url), html = landing.bytes.toString('utf8'), $ = load(html);
      const content = tidy(($('.theme-default-content, main').first().text() || $('body').text()).slice(0, 30000));
      const applicability = content.match(/本手册[^。！？]{0,150}(?:20\d{2}|\d{2}\s*年)[^。！？]{0,150}[。！？]/)?.[0];
      const scope = applicability ? `已读取电子手册首页适用范围原文：“${applicability}”` : '电子手册首页没有明确标注适用年款，请以原文为准。';
      electronic.description += scope;
      const actualYear = applicability?.match(/\b(20\d{2})\s*年(?:上市|款|型)?/)?.[1];
      if (actualYear && Number(actualYear) !== model.year) {
        electronic.description += `首页明确标注 ${actualYear} 年上市，与当前 ${model.year} 年款不同，只能作为参考，不能自动套用该保养表。`;
        return cards;
      }
      const routes: Array<{ title: string; url: string }> = [];
      $('a[href]').each((_i, node) => {
        const title = tidy($(node).text());
        if (!/^(保养时间表|保养周期表|定期保养)$/.test(title)) return;
        const url = sameOfficialUrl($(node).attr('href') || '', landing.url);
        if (url && !routes.some(route => route.url === url)) routes.push({ title, url });
      });
      if (!routes.length) {
        const scriptUrl = $('script[src]').map((_i, node) => $(node).attr('src')).get()
          .filter((src): src is string => !!src && /\/app\.[a-z0-9]+\.js$/i.test(src))
          .map(src => sameOfficialUrl(src, landing.url)).find((url): url is string => !!url);
        if (scriptUrl) {
          const bundle = await read(scriptUrl);
          routes.push(...hondaMaintenanceRoutes(bundle.bytes.toString('utf8'), landing.url));
        }
      }
      const route = routes[0];
      if (!route) return cards;
      const schedule = await read(route.url), scheduleHtml = schedule.bytes.toString('utf8'), schedule$ = load(scheduleHtml);
      const main = schedule$('.theme-default-content, main').first();
      if (!main.find('table').length || !/保养时间表|保养周期表|定期保养/.test(main.text())) return cards;
      const source: ManualSource = {
        title: `${electronic.title} · ${route.title}`, url: schedule.url, kind: 'official', isDirectory: false,
        description: `已实际读取官方${route.title}正文及保养项目表格，直接页面无需网盘下载。对应官方目录手册《${electronic.title.replace(/^东风本田官方 · /, '')}》。${scope}电子手册原文：${landing.url}。具体公里、月份、工况及机油监测条件须按该表原文提取。`,
      };
      return [source, ...cards];
    } catch { return cards; }
  } catch { return []; }
}
