import { load } from 'cheerio';
import type { CarModel, ManualSource } from '@autovoyage/shared';
import type { OfficialManualContext, OfficialManualDownload } from './manual-official-sources.js';

const directoryUrl = 'https://www.gac-toyota.com.cn/enjoy-service/usermanual';
const cataloguePath = '/2022/src/assets/json/usermanual.js';
const aliases: Record<string, string[]> = {
  '汉兰达': ['highlander'], '凯美瑞': ['camry'], '赛那': ['sienna'], '威飒': ['venza'],
  '威兰达': ['wildlander'], '雷凌': ['levin'], '锋兰达': ['frontlander'], '凌尚': ['levin gt'],
  '埃尔法': ['alphard'], '致享': ['yaris l 致享'], '铂智4X': ['bz4x', '铂智4x'],
  '铂智3X': ['铂智3x'], '铂智7': [], 'iA5': ['ia5'],
};
const compact = (value: string) => value.toLowerCase().replace(/[\s·_－-]+/g, '');
function requestedSeries(model: CarModel): string | undefined {
  const name = compact(model.name.replace(/[·（(].*$/u, '').replace(/^(?:广汽)?丰田\s*/u, ''));
  return Object.entries(aliases).flatMap(([chinese, english]) => [chinese, ...english].map(alias => ({ series: chinese, alias: compact(alias) })))
    .sort((a, b) => b.alias.length - a.alias.length).find(entry => name.startsWith(entry.alias))?.series;
}
export function isGacToyotaManualModel(model: CarModel): boolean {
  return /丰田|toyota/i.test(model.brand) && !/一汽|faw|雷克萨斯|lexus/i.test(model.brand) && !!requestedSeries(model);
}

type Literal = null | string | number | boolean | Literal[] | { [key: string]: Literal };
/** A deliberately small data reader: remote JavaScript is never evaluated. */
function readCatalogueLiteral(script: string): Literal {
  if (script.length > 2 * 1024 * 1024) throw new Error('广汽丰田手册目录数据过大');
  const assignment = /(?:^|[;\r\n])\s*_baseData\.usermanualModle\s*=\s*/g.exec(script);
  if (!assignment) throw new Error('广汽丰田官方页面未提供已知手册目录数据');
  let position = assignment.index + assignment[0].length, count = 0;
  const invalid = () => new Error('广汽丰田手册目录格式已改变');
  function space(): void {
    for (;;) {
      while (/\s/.test(script[position] || '') && position < script.length) position++;
      if (script.startsWith('//', position)) { position = script.indexOf('\n', position + 2); if (position < 0) position = script.length; }
      else if (script.startsWith('/*', position)) { const end = script.indexOf('*/', position + 2); if (end < 0) throw invalid(); position = end + 2; }
      else return;
    }
  }
  function string(): string {
    const quote = script[position++]; let result = '';
    while (position < script.length) {
      const character = script[position++];
      if (character === quote) return result;
      if (character === '\n' || character === '\r') throw invalid();
      if (character !== '\\') { result += character; continue; }
      const escape = script[position++];
      const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '/': '/' };
      if (escape in escapes) result += escapes[escape];
      else if (escape === 'u' || escape === 'x') {
        const length = escape === 'u' ? 4 : 2, hex = script.slice(position, position + length);
        if (!new RegExp(`^[0-9a-f]{${length}}$`, 'i').test(hex)) throw invalid();
        result += String.fromCharCode(parseInt(hex, 16)); position += length;
      } else throw invalid();
    }
    throw invalid();
  }
  function value(depth: number): Literal {
    if (depth > 14 || ++count > 20000) throw invalid();
    space(); const character = script[position];
    if (character === '"' || character === "'") return string();
    if (character === '[' || character === '{') {
      const array = character === '[', closing = array ? ']' : '}'; position++;
      const result: Literal[] | { [key: string]: Literal } = array ? [] : Object.create(null);
      space();
      while (script[position] !== closing) {
        if (array) (result as Literal[]).push(value(depth + 1));
        else {
          space();
          const key = script[position] === '"' || script[position] === "'" ? string() : /^[A-Za-z_$][\w$]*/.exec(script.slice(position))?.[0];
          if (!key || ['__proto__', 'constructor', 'prototype'].includes(key)) throw invalid();
          if (script[position - 1] !== '"' && script[position - 1] !== "'") position += key.length;
          space(); if (script[position++] !== ':') throw invalid();
          (result as { [key: string]: Literal })[key] = value(depth + 1);
        }
        space(); if (script[position] === closing) break;
        if (script[position++] !== ',') throw invalid();
        space();
      }
      if (script[position++] !== closing) throw invalid();
      return result;
    }
    const primitive = /^(?:true|false|null|-?\d+(?:\.\d+)?)(?![\w$.])/.exec(script.slice(position))?.[0];
    if (!primitive) throw invalid(); position += primitive.length;
    if (primitive === 'null') return null;
    if (primitive === 'true' || primitive === 'false') return primitive === 'true';
    return Number(primitive);
  }
  const result = value(0);
  space();
  // Subsequent assignments (e.g. noticeData) may follow; expressions may not.
  if (position < script.length && script[position] !== ';' && !script.startsWith('_baseData.', position)) throw invalid();
  return result;
}

export interface GacToyotaManualEntry { carName: string; detailCode: string; title: string; url: string }
function officialUrl(value: string, base = directoryUrl): string | undefined {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.hostname !== 'www.gac-toyota.com.cn' || url.username || url.password || url.port) return;
    url.hash = ''; return url.href;
  } catch { return; }
}
function object(value: Literal): value is { [key: string]: Literal } { return !!value && !Array.isArray(value) && typeof value === 'object'; }
/** Handles both manualData and the official nested list[].manualData layout. */
export function parseGacToyotaManualEntries(script: string): GacToyotaManualEntry[] {
  const data = readCatalogueLiteral(script);
  if (!Array.isArray(data)) throw new Error('广汽丰田手册目录格式已改变');
  const entries: GacToyotaManualEntry[] = [];
  for (const car of data) {
    if (!object(car) || typeof car.carName !== 'string' || typeof car.adtype !== 'string' || !/^[a-zA-Z0-9_-]{1,70}$/.test(car.adtype)) continue;
    const lists = [car, ...(Array.isArray(car.list) ? car.list.filter(object) : [])];
    for (const list of lists) for (const manual of Array.isArray(list.manualData) ? list.manualData : []) {
      if (!object(manual) || typeof manual.title !== 'string' || typeof manual.downloadUrl !== 'string') continue;
      const url = officialUrl(manual.downloadUrl);
      if (!url || !/^\/pdf\/web\/usermanual\/.+\.pdf$/i.test(new URL(url).pathname) || !/用户手册|保养手册/.test(manual.title) || /应急|救援|音响|导航|辅助系统/.test(manual.title)) continue;
      if (!entries.some(entry => entry.url === url)) entries.push({ carName: car.carName.slice(0, 100), detailCode: car.adtype, title: manual.title.slice(0, 500), url });
    }
  }
  return entries;
}
type Power = 'plug-in' | 'hybrid' | 'electric' | 'fuel' | 'unknown';
function power(text: string): Power {
  if (/PHEV|插电|插混/i.test(text)) return 'plug-in';
  if (/HEV|双擎|混动|电混|油电/i.test(text)) return 'hybrid';
  if (/BEV|\bEV\b|纯电|电动|铂智|bZ4X|iA5/i.test(text)) return 'electric';
  if (/汽油|燃油|柴油|\d(?:\.\d)?\s*[TL]\b|TURBO|\b(?:380|240)T\b/i.test(text)) return 'fuel';
  return 'unknown';
}
function year(title: string): number | undefined { return Number(title.match(/\b(20\d{2})\s*(?:款|年)/)?.[1]) || undefined; }
function relevantEntries(entries: GacToyotaManualEntry[], model: CarModel): GacToyotaManualEntry[] {
  const series = requestedSeries(model), requestedPower = power(`${model.power} ${model.name}`);
  return entries.filter(entry => compact(entry.carName).startsWith(compact(series || '\0')) &&
    (requestedPower === 'unknown' || power(`${entry.title} ${entry.carName}`) === 'unknown' || power(`${entry.title} ${entry.carName}`) === requestedPower));
}
interface AcquiredCatalogue { entries: GacToyotaManualEntry[]; pageTitle: string; dataUrl: string; url: string }
async function acquireCatalogue(download: OfficialManualDownload): Promise<AcquiredCatalogue> {
  const deadline = Date.now() + 10000;
  const read = (url: string) => download(url, 0, undefined, Math.min(4500, Math.max(1, deadline - Date.now())), deadline, 2 * 1024 * 1024);
  const directory = await read(directoryUrl);
  if (!officialUrl(directory.url)) throw new Error('广汽丰田手册目录跳转到了非官方来源');
  const $ = load(directory.bytes.toString('utf8'));
  const dataUrl = $('script[src]').map((_i, node) => officialUrl($(node).attr('src') || '', directory.url)).get()
    .find(url => !!url && new URL(url).pathname === cataloguePath);
  if (!dataUrl) throw new Error('广汽丰田官方目录没有公开手册数据链接');
  const data = await read(dataUrl);
  if (!officialUrl(data.url)) throw new Error('广汽丰田手册数据跳转到了非官方来源');
  return { entries: parseGacToyotaManualEntries(data.bytes.toString('utf8')), pageTitle: $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 300) || '用户手册', dataUrl: data.url, url: directory.url };
}

/** Uses authoritative structured data, independent of search-engine indexing. */
export async function discoverGacToyotaManuals(model: CarModel, download: OfficialManualDownload): Promise<ManualSource[]> {
  if (!isGacToyotaManualModel(model)) return [];
  const catalogue = await acquireCatalogue(download), series = requestedSeries(model)!;
  const relevant = relevantEntries(catalogue.entries, model);
  if (!relevant.length) return [];
  const exact = relevant.filter(entry => year(entry.title) === model.year);
  // Edition dates such as 2405 are not model-year evidence. Unversioned books
  // remain visible with an explicit scope warning; wrong-year books are omitted.
  const selected = exact.length ? exact : relevant.filter(entry => !year(entry.title));
  const sources: ManualSource[] = selected.slice(0, 5).map(entry => ({
    title: `广汽丰田官方 · ${entry.title}`, url: entry.url, kind: 'official', isDirectory: false,
    description: `已实际读取广汽丰田官方《${catalogue.pageTitle}》目录及其公开数据，目录车系“${entry.carName}”，手册原名《${entry.title}》。${year(entry.title) ? `目录明确标注 ${year(entry.title)} 款。` : '目录没有标注适用年款，版本日期不代表车型年款，须按手册原文核对。'}${power(`${model.power} ${model.name}`) === 'unknown' ? '车型动力未明确，不能确认该版本适用；需要先选择动力版本。' : ''}PDF 文件直链，无需网盘。目录未明确排量、变速箱及具体配置，不能推断该配置已获认证。来源目录：${catalogue.url}/detail?detailCode=${encodeURIComponent(entry.detailCode)}；公开数据：${catalogue.dataUrl}`,
  }));
  const detail = `${catalogue.url}/detail?detailCode=${encodeURIComponent(relevant[0].detailCode)}`;
  sources.push({ title: `广汽丰田官方 · ${series}用户手册目录`, url: detail, kind: 'official', isDirectory: true,
    description: `已实际读取官方《${catalogue.pageTitle}》公开目录。${exact.length ? `找到 ${model.year} 款对应动力用户手册。` : `目录没有明确匹配 ${model.year} 款对应动力的手册；不自动使用其他年款。`}本目录实际手册名称：${relevant.slice(0, 8).map(entry => `《${entry.title}》`).join('、')}。` });
  return sources;
}

/** Reacquires the actual title/link record; search descriptions are not evidence. */
export async function acquireGacToyotaManualContext(model: CarModel, sourceUrl: string, download: OfficialManualDownload): Promise<OfficialManualContext[]> {
  if (!isGacToyotaManualModel(model) || !officialUrl(sourceUrl)) return [];
  const catalogue = await acquireCatalogue(download);
  const entry = relevantEntries(catalogue.entries, model).find(item => item.url === officialUrl(sourceUrl));
  if (!entry) return [];
  return [{ title: `广汽丰田 · ${catalogue.pageTitle}`, url: catalogue.url,
    text: `采集页面网址：${catalogue.url}\n页面标题：${catalogue.pageTitle}\n该页面实际加载的手册数据网址：${catalogue.dataUrl}\n\n以下为公开数据中实际匹配的记录：\ncarName: ${entry.carName}\ntitle: ${entry.title}\ndownloadUrl: ${entry.url}\n\n采集说明：以上车系、标题与下载地址来自官方页面实际加载的结构化数据。目录未列出的排量、变速箱、具体配置和适用年款均未补写。版本日期不等于车型年款。` }];
}
