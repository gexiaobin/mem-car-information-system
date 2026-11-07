import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { load } from 'cheerio';
import type { CarModel, ManualSource } from '@autovoyage/shared';
import { AppError, ensure } from './domain.js';
import { discoverDongfengHondaManuals } from './manual-official-sources.js';
import { discoverGacToyotaManuals, isGacToyotaManualModel } from './manual-gac-toyota.js';
import { createManualDownloadBuffer } from './manual-download-buffer.js';

const MAX_BYTES = 32 * 1024 * 1024;
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
      a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  // Global unicast only; rejects loopback, mapped IPv4, link-local and local networks.
  return isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:db8:/i.test(address);
}
export function validateSourceUrl(value: string): URL {
  ensure(value.length <= 2500, 400, 'MANUAL_SOURCE_URL', '手册网址过长，请选择具体资料页面或上传图片');
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError(400, 'MANUAL_SOURCE_URL', '请输入完整的 HTTPS 手册网址'); }
  ensure(url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443'), 400, 'MANUAL_SOURCE_URL', '仅支持不含账号密码的标准 HTTPS 手册网址');
  ensure(url.hostname !== 'localhost' && !url.hostname.endsWith('.localhost') && !url.hostname.endsWith('.local') && (!isIP(url.hostname.replace(/^\[|\]$/g, '')) || isPublicAddress(url.hostname.replace(/^\[|\]$/g, ''))), 400, 'MANUAL_SOURCE_URL', '不能从本机或内网地址获取手册');
  url.hash = '';
  return url;
}
/** Larger files are allowed only for the verified public Toyota manual path. */
export function manualDownloadLimit(value: string): number {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'www.gac-toyota.com.cn' &&
      !url.username && !url.password && (!url.port || url.port === '443') &&
      /^\/pdf\/web\/usermanual\/[^/]+\.pdf$/.test(url.pathname)) return 96 * 1024 * 1024;
  } catch { /* Invalid and all other URLs retain the ordinary ceiling. */ }
  return MAX_BYTES;
}
/** Resolve and pin a public IP for every redirect; no user cookies or credentials. */
export async function publicDownload(value: string, redirects = 0, postData?: string, timeoutMs = 30000, deadline = Date.now() + timeoutMs, maxBytes = manualDownloadLimit(value)): Promise<{ bytes: Buffer; type: string; url: string; charset?: string }> {
  const url = validateSourceUrl(value);
  deadline = Math.min(deadline, Date.now() + timeoutMs);
  ensure(redirects <= 4, 400, 'MANUAL_REDIRECT_LIMIT', '手册链接重定向过多，请下载后上传');
  ensure(deadline > Date.now(), 400, 'MANUAL_SOURCE_UNAVAILABLE', '资料网站连接超时，请稍后重试或上传图片');
  let addresses;
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  try { addresses = await Promise.race([lookup(url.hostname, { all: true }), new Promise<never>((_resolve, reject) => { dnsTimer = setTimeout(() => reject(new Error('DNS timeout')), Math.max(1, deadline - Date.now())); })]); }
  catch { throw new AppError(400, 'MANUAL_SOURCE_UNAVAILABLE', '无法解析资料网站，请下载后上传'); }
  finally { clearTimeout(dnsTimer); }
  ensure(addresses.length > 0 && addresses.every(item => isPublicAddress(item.address)), 400, 'MANUAL_SOURCE_URL', '资料网址必须指向公网地址');
  const address = addresses.find(item => item.family === 4) || addresses[0];
  const result = await new Promise<{ bytes: Buffer; type: string; charset?: string; location?: string; status: number }>((resolve, reject) => {
    const req = httpsRequest(url, {
      method: postData ? 'POST' : 'GET',
      headers: { 'User-Agent': 'AutoVoyage-ManualImport/1.0', Accept: 'application/pdf,image/*,text/html;q=0.8', 'Accept-Encoding': 'identity', ...(postData ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } : {}) },
      lookup: (_hostname, options, callback) => {
        if (typeof options === 'object' && options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, response => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume(); resolve({ bytes: Buffer.alloc(0), type: '', location: response.headers.location, status }); return;
      }
      if (status !== 200) { response.resume(); reject(new AppError(400, 'MANUAL_SOURCE_UNAVAILABLE', '资料网站未提供可访问文件，可能需要登录，请下载后上传')); return; }
      const contentType = String(response.headers['content-type'] || '');
      const type = contentType.split(';')[0].trim().toLowerCase();
      const charset = contentType.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i)?.[1]?.toLowerCase();
      const limit = Math.min(type.includes('html') ? 2 * 1024 * 1024 : manualDownloadLimit(url.href), maxBytes);
      let body;
      try { body = createManualDownloadBuffer(response.headers['content-length'], limit); }
      catch (error) { response.destroy(); reject(error); return; }
      response.on('data', (chunk: Buffer) => {
        try { body.append(chunk); }
        catch (error) { response.destroy(); reject(error); }
      });
      response.on('end', () => {
        try { resolve({ bytes: body.finish(), type, status, ...(charset ? { charset } : {}) }); }
        catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('source timeout')), Math.max(1, deadline - Date.now()));
    req.once('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(postData);
  }).catch(error => { if (error instanceof AppError) throw error; throw new AppError(400, 'MANUAL_SOURCE_UNAVAILABLE', '资料网站连接失败或超时，请下载后上传'); });
  if (result.location) return publicDownload(new URL(result.location, url).href, redirects + 1, undefined, timeoutMs, deadline, maxBytes);
  ensure(result.status === 200, 400, 'MANUAL_SOURCE_UNAVAILABLE', '资料网址未返回可下载文件');
  return { bytes: result.bytes, type: result.type, url: url.href, ...(result.charset ? { charset: result.charset } : {}) };
}
function fileType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}
export function manualPdfLinks(html: string, base: string): string[] {
  const $ = load(html), found: string[] = [];
  $('a[href]').each((_i, node) => {
    const href = $(node).attr('href');
    if (!href) return;
    try {
      const url = new URL(href, base);
      if (/\.pdf$/i.test(url.pathname) && url.protocol === 'https:' && !found.includes(url.href)) found.push(url.href);
    } catch {}
  });
  return found;
}
export async function downloadManualSource(value: string): Promise<{ buffer: Buffer; name: string; mimeType: string; sourceUrl: string }> {
  validateSourceUrl(value);
  ensure(!/(^|\.)(pan\.baidu\.com|yun\.baidu\.com|lanzou[a-z]?\.com|aliyundrive\.com|alipan\.com)$/i.test(new URL(value).hostname), 400, 'MANUAL_DOWNLOAD_REQUIRED', '这是网盘分享链接，请在浏览器下载 PDF 或图片后使用“上传手册”，系统不会代登录网盘');
  let downloaded = await publicDownload(value);
  let mimeType = fileType(downloaded.bytes);
  if (!mimeType) {
    const html = downloaded.bytes.toString('utf8');
    const links = manualPdfLinks(html, downloaded.url);
    if (links.length === 1) {
      downloaded = await publicDownload(links[0]);
      mimeType = fileType(downloaded.bytes);
    } else if (/pan\.baidu\.com|百度网盘|aliyundrive|alipan\.com|lanzou/i.test(html)) {
      throw new AppError(400, 'MANUAL_DOWNLOAD_REQUIRED', '该页面通过网盘分享手册，请打开原页面下载 PDF 后上传；也可选择品牌官方 PDF 直链');
    } else {
      throw new AppError(400, 'MANUAL_DOWNLOAD_REQUIRED', links.length > 1 ? '该页面有多份手册，请打开并选择准确年款、动力版本的 PDF，再粘贴文件链接或上传文件' : '这是资料页面，未发现唯一的 PDF 直链，请下载正确手册后上传 PDF 或保养表图片');
    }
  }
  ensure(mimeType, 400, 'MANUAL_FORMAT', '下载结果不是有效的 PDF 或图片，请核实链接');
  let name: string;
  try { name = decodeURIComponent(new URL(downloaded.url).pathname.split('/').pop() || '保养手册'); } catch { name = '保养手册'; }
  return { buffer: downloaded.bytes, name, mimeType, sourceUrl: downloaded.url };
}

const brandCatalogs: Record<string, string> = {
  '大众': 'volkswagen', '比亚迪': 'byd', '丰田': 'toyota', '本田': 'honda', '宝马': 'bmw',
  '奔驰': 'mercedes-benz', '奥迪': 'audi', '吉利': 'geely', '长安': 'changan', '奇瑞': 'chery',
  '哈弗': 'haval', '红旗': 'hongqi', '日产': 'nissan', '别克': 'buick', '福特': 'ford',
  '特斯拉': 'tesla', '理想': 'li', '蔚来': 'nio', '小鹏': 'xpeng', '问界': 'aito',
  '沃尔沃': 'volvo', '马自达': 'mazda', '五菱': 'wuling', '传祺': 'gac-motor', '领克': 'lynkco',
  '起亚': 'kia', '现代': 'hyundai', '斯柯达': 'skoda', '雪佛兰': 'chevrolet', '雪铁龙': 'citroen',
};
export async function manualSources(model: CarModel): Promise<ManualSource[]> {
  const brand = Object.keys(brandCatalogs).find(name => model.brand.includes(name));
  const primary: ManualSource = { title: `CarOBook · ${brand || '多品牌'}保养手册`, url: brand ? `https://www.carobook.com/${brandCatalogs[brand]}-bysc.html` : 'https://www.carobook.com/bysc.html', kind: 'carobook', description: '备用品牌目录。查询会同时检索开放互联网，不局限此站；网盘资料可取得后上传图片。' };
  const sources = [primary];
  if (/比亚迪|BYD/i.test(model.brand)) sources.push({ title: '比亚迪官方车型手册', url: 'https://www.byd.com/cn/user-manual', kind: 'official', description: '按年款与 DM / EV 筛选；部分手册需在官方 App 认证车主后查看。优先核对中国版保养表。' });
  if (/大众/.test(model.brand)) sources.push({ title: '上汽大众官方保养手册', url: 'https://www.svw-volkswagen.com/service/maintenancemanual/', kind: 'official', description: '仅适用上汽大众车型；一汽大众迈腾、速腾等不可套用。' });
  if (/特斯拉|Tesla/i.test(model.brand)) sources.push({ title: '特斯拉中国官方保养建议', url: 'https://www.tesla.cn/support/vehicle-maintenance', kind: 'official', description: '按生产时期和配置核对条件、检查与更换要求；可将相关原文截图上传。' });
  sources.push({ title: '车主手册 · 备用资料目录', url: 'https://www.chezhushouce.com/', kind: 'other', description: '按品牌、车型与年份找 PDF，需核对原厂来源；网站注明仅供个人参考、禁止商用。' });
  return sources.map(source => ({ ...source, isDirectory: true }));
}

export interface ManualDiscoveryDiagnostic {
  provider: 'bing' | 'duckduckgo' | 'dongfeng_honda' | 'gac_toyota';
  state: 'relevant' | 'irrelevant' | 'empty' | 'blocked' | 'unavailable';
  candidateCount: number;
  query?: string;
  message: string;
}
export interface ManualDiscoveryReport {
  sources: ManualSource[];
  diagnostics: ManualDiscoveryDiagnostic[];
  status: 'available' | 'unavailable' | 'no_results';
}
const discoveryCache = new Map<string, { expires: number; report: ManualDiscoveryReport }>();
const officialDomains = ['ghac.cn', 'dongfeng-honda.com', 'honda.com.cn', 'honda.com', 'toyota.com.cn', 'toyota.com', 'ftms.com.cn', 'gtmc.com.cn', 'gac-toyota.com.cn', 'byd.com', 'svw-volkswagen.com', 'faw-vw.com', 'volkswagen.com.cn', 'volkswagen.de', 'vw.com', 'tesla.cn', 'tesla.com', 'bmw.com.cn', 'bmw.com', 'mercedes-benz.com.cn', 'audi.cn', 'geely.com', 'changan.com.cn', 'chery.cn', 'haval.com.cn', 'nissan.com.cn', 'df-nissan.com.cn', 'buick.com.cn', 'ford.com.cn', 'lixiang.com', 'nio.cn', 'xpeng.com', 'aito.auto', 'volvocars.com', 'mazda.com.cn', 'sgmw.com.cn', 'gacmotor.com', 'lynkco.com.cn', 'kia.cn', 'hyundai.com.cn', 'skoda.com.cn', 'chevrolet.com.cn'];
const officialHost = (hostname: string) => officialDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
const coreName = (model: CarModel) => model.name.replace(/[·（(].*$/u, '').replace(/\s+/g, ' ').trim().slice(0, 80);
const compact = (value: string) => value.toLowerCase().replace(/[\s··_-]+/g, '');
function powerConflict(model: CarModel, text: string): boolean {
  const hybrid = /混动|双擎|(?:e[-:\s]?)?HEV|PHEV|DM[-－]?[ip]|油电|增程/i;
  const electric = /纯电|BEV|electric vehicle|electric car/i;
  const modelPower = `${model.power} ${model.name}`;
  const fuel = /汽油|燃油|柴油|\d(?:\.\d)?\s*[TL]\b|TURBO|TFSI|TSI|GDI/i.test(modelPower) && !hybrid.test(modelPower) && !electric.test(modelPower);
  if (fuel && (hybrid.test(text) || electric.test(text))) return true;
  if (electric.test(model.power) && !hybrid.test(model.power) && (hybrid.test(text) || /汽油|燃油|柴油|gasoline|petrol/i.test(text))) return true;
  return hybrid.test(model.power) && electric.test(text) && !hybrid.test(text);
}
/** The primary queries intentionally use the car series, not an exact trim as a hard filter. */
export function modelManualQueries(model: CarModel): string[] {
  const label = `${model.brand.trim().slice(0, 60)} ${coreName(model)}`.trim();
  return [`${label} 保养手册`, `${label} 保养周期表`, `${label} ${model.year} ${model.power.trim().slice(0, 80)} 官方 用户手册 保养时间表`];
}
function searchTarget(href: string, base: string): string | null {
  try {
    let url = new URL(href, base);
    if (/(^|\.)bing\.com$/i.test(url.hostname) && url.pathname === '/ck/a') {
      const target = url.searchParams.get('u');
      if (!target?.startsWith('a1') || target.length > 8192) return null;
      url = new URL(Buffer.from(target.slice(2), 'base64url').toString('utf8'));
    }
    if (/(^|\.)duckduckgo\.com$/i.test(url.hostname) && url.pathname === '/l/') {
      const target = url.searchParams.get('uddg');
      if (!target) return null;
      url = new URL(target);
    }
    if (/(^|\.)(bing\.com|duckduckgo\.com|microsoft\.com)$/i.test(url.hostname)) return null;
    url = validateSourceUrl(url.href);
    for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|spm|msclkid|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}
/** Parses only visible organic result blocks, never arbitrary links or scripts. */
export function parseManualSearchResults(html: string, base: string, model: CarModel): ManualSource[] {
  const $ = load(html), sources: ManualSource[] = [];
  const core = compact(coreName(model));
  $('.b_algo, .result').each((_index, node) => {
    const block = $(node), anchor = block.find('h2 a[href], a.result__a[href]').first();
    const title = anchor.text().replace(/\s+/g, ' ').trim().slice(0, 500);
    const snippet = block.find('.b_caption p, p, .result__snippet').first().text().replace(/\s+/g, ' ').trim().slice(0, 850);
    const href = anchor.attr('href');
    if (!href || !title || !/保养(?:手册|周期|时间表|项目|里程|表)|维[修护](?:手册|周期|项目|计划)|用户手册|车主手册|maintenance|service\s+(?:schedule|interval)|owner.?s? manual/i.test(`${title} ${snippet}`)) return;
    const url = searchTarget(href, base);
    if (!url || sources.some(source => source.url === url)) return;
    const hostname = new URL(url).hostname;
    const official = officialHost(hostname);
    const related = !!core && compact(`${title} ${snippet}`).includes(core);
    // An official brand-wide portal remains a directory, even when a search engine returned it for a model.
    if (!related && !official) return;
    const isDirectory = !related ||
      /(?:手册|资料|保养).{0,8}(?:目录|信息查询|查询系统|下载中心)/.test(title) && !compact(title).includes(core) ||
      /报价.{0,8}图片|参数.{0,5}配置|频道|官方网站首页/.test(title) && !/保养手册|保养周期表|maintenance manual/i.test(title);
    const kind: ManualSource['kind'] = /(^|\.)carobook\.com$/i.test(hostname) ? 'carobook' : official ? 'official' : 'other';
    const conflict = powerConflict(model, `${title} ${snippet}`);
    sources.push({ title, url, kind, isDirectory, description: `${official ? '车企官方公开来源' : '开放互联网检索来源'}：${snippet || title}。${isDirectory ? '这是品牌资料入口，需选定具体手册。' : '车系通用资料候选，识别后核对年款、动力及使用条件。'}${conflict ? '候选描述的动力与当前车型可能冲突，已降低优先级，请核对。' : ''}`.slice(0, 1500) });
  });
  return sources.slice(0, 12);
}
function sourceScore(source: ManualSource, model: CarModel): number {
  const text = `${source.title} ${source.description}`;
  return (source.isDirectory ? -30 : 40) + (source.kind === 'official' ? 25 : 0) +
    (/\.pdf(?:\?|$)|\.(?:png|jpe?g|webp)(?:\?|$)/i.test(source.url) ? 12 : 0) +
    (/保养(?:时间|周期)表/.test(source.title) ? 30 : /保养手册|maintenance manual/i.test(source.title) ? 15 : /保养周期|保养表/.test(source.title) ? 10 : 0) +
    (text.includes(String(model.year)) ? 5 : 0) - (/动力与当前车型可能冲突/.test(source.description) ? 45 : 0) - (/论坛|避坑|费用|多少钱|价格|攻略|实测/.test(source.title) ? 12 : 0);
}
export interface ManualDiscoveryDependencies { download?: typeof publicDownload; cache?: boolean }
interface ProviderResult { sources: ManualSource[]; diagnostic: ManualDiscoveryDiagnostic }

async function searchManualProvider(provider: 'bing' | 'duckduckgo', query: string, model: CarModel, download: typeof publicDownload): Promise<ProviderResult> {
  const url = provider === 'bing'
    ? `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-hans`
    : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const result = await download(url, 0, undefined, provider === 'bing' ? 6500 : 3500);
    const html = result.bytes.toString('utf8'), $ = load(html);
    const visible = $('body').clone();
    visible.find('script,style,noscript').remove();
    const blocked = $('#b_captcha, #challenge-form, .anomaly-modal, .g-recaptcha, form[action*="captcha"]').length > 0 ||
      /异常流量|验证您是人类|unusual traffic|verify(?:ing)? (?:that )?you are (?:a human|not a robot)|bot challenge|complete the captcha/i.test(`${$('title').text()} ${visible.text().slice(0, 8000)}`);
    const sources = blocked ? [] : parseManualSearchResults(html, result.url, model);
    const state: ManualDiscoveryDiagnostic['state'] = blocked ? 'blocked' : sources.length ? 'relevant' : $('.b_algo, .result').length ? 'irrelevant' : 'empty';
    const messages = {
      relevant: '搜索已返回相关手册或资料目录，仍需读取原文确认适用范围。',
      irrelevant: '搜索返回了网页，但内容未匹配当前车系的手册或保养资料，无法据此判断手册不存在。',
      empty: '搜索未返回可解析的公开结果，无法确认已完整检索。',
      blocked: '搜索服务要求验证或限制自动访问，本次未取得有效搜索结果。',
    };
    return { sources, diagnostic: { provider, state, candidateCount: sources.length, query: query.slice(0, 250), message: messages[state] } };
  } catch {
    return { sources: [], diagnostic: { provider, state: 'unavailable', candidateCount: 0, query: query.slice(0, 250), message: '搜索服务连接失败或超时，本次未取得有效搜索结果。' } };
  }
}

async function officialManualProvider(provider: 'dongfeng_honda' | 'gac_toyota', work: Promise<ManualSource[]>): Promise<ProviderResult> {
  try {
    const sources = await work;
    return { sources, diagnostic: { provider, state: sources.length ? 'relevant' : 'empty', candidateCount: sources.length,
      message: sources.length ? '已从车企官方目录取得实际手册链接，适用范围以原文为准。' : '本次官方目录未返回可匹配的手册链接。' } };
  } catch {
    return { sources: [], diagnostic: { provider, state: 'unavailable', candidateCount: 0, message: '车企官方资料目录暂时无法访问，本次未取得有效目录结果。' } };
  }
}

/** Bounded, explicit open-web queries; no domain allowlist and no background crawl. */
export async function discoverManualSourcesDetailed(model: CarModel, dependencies: ManualDiscoveryDependencies = {}): Promise<ManualDiscoveryReport> {
  const core = coreName(model);
  const cacheKey = JSON.stringify([model.brand, core, model.year, model.power]);
  const old = discoveryCache.get(cacheKey);
  if (dependencies.cache !== false && old && old.expires > Date.now()) return old.report;
  const fallback = await manualSources(model);
  const download = dependencies.download || publicDownload;
  const queries = modelManualQueries(model);
  const providers: Promise<ProviderResult>[] = queries.map(query => searchManualProvider('bing', query, model, download));
  if (/本田|honda/i.test(model.brand) && !/广汽/.test(model.brand)) providers.push(officialManualProvider('dongfeng_honda', discoverDongfengHondaManuals(model, download)));
  if (isGacToyotaManualModel(model)) providers.push(officialManualProvider('gac_toyota', discoverGacToyotaManuals(model, download)));
  const results = await Promise.all(providers);
  let candidates = results.flatMap(result => result.sources);
  const diagnostics = results.map(result => result.diagnostic);
  // A second engine is a fallback for blocked/empty search responses, not a restriction on source sites.
  if (!candidates.some(source => !source.isDirectory)) {
    const result = await searchManualProvider('duckduckgo', queries[0], model, download);
    candidates.push(...result.sources);
    diagnostics.push(result.diagnostic);
  }
  const unique = new Map<string, ManualSource>();
  for (const source of candidates.sort((a, b) => sourceScore(b, model) - sourceScore(a, model))) if (!unique.has(source.url)) unique.set(source.url, source);
  const selected = [...unique.values()].slice(0, 10);
  const sources = [...selected, ...fallback.filter(source => !unique.has(source.url))].slice(0, 14);
  if (!selected.length) sources[0] = { ...sources[0], description: '开放互联网搜索暂未取得可用车型资料，以下为备用目录；可稍后重查或上传保养表图片。' };
  const status: ManualDiscoveryReport['status'] = selected.some(source => !source.isDirectory) ? 'available' :
    diagnostics.some(item => item.state === 'unavailable' || item.state === 'blocked') || !diagnostics.some(item => item.state === 'relevant') ? 'unavailable' : 'no_results';
  const report: ManualDiscoveryReport = { sources, diagnostics: diagnostics.slice(0, 8), status };
  if (dependencies.cache !== false) {
    discoveryCache.set(cacheKey, { expires: Date.now() + (status === 'unavailable' ? 30000 : 15 * 60000), report });
    if (discoveryCache.size > 100) discoveryCache.delete(discoveryCache.keys().next().value!);
  }
  return report;
}

/** Compatibility wrapper for callers that only display candidate links. */
export async function discoverManualSources(model: CarModel, dependencies: ManualDiscoveryDependencies = {}): Promise<ManualSource[]> {
  return (await discoverManualSourcesDetailed(model, dependencies)).sources;
}
