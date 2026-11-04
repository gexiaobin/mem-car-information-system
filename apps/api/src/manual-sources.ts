import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { load } from 'cheerio';
import type { CarModel, ManualSource } from '@autovoyage/shared';
import { AppError, ensure } from './domain.js';

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
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError(400, 'MANUAL_SOURCE_URL', '请输入完整的 HTTPS 手册网址'); }
  ensure(url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443'), 400, 'MANUAL_SOURCE_URL', '仅支持不含账号密码的标准 HTTPS 手册网址');
  ensure(url.hostname !== 'localhost' && !url.hostname.endsWith('.localhost') && !url.hostname.endsWith('.local') && (!isIP(url.hostname.replace(/^\[|\]$/g, '')) || isPublicAddress(url.hostname.replace(/^\[|\]$/g, ''))), 400, 'MANUAL_SOURCE_URL', '不能从本机或内网地址获取手册');
  url.hash = '';
  return url;
}
/** Resolve and pin a public IP for every redirect; no user cookies or credentials. */
async function publicDownload(value: string, redirects = 0, postData?: string, timeoutMs = 30000): Promise<{ bytes: Buffer; type: string; url: string }> {
  const url = validateSourceUrl(value);
  ensure(redirects <= 4, 400, 'MANUAL_REDIRECT_LIMIT', '手册链接重定向过多，请下载后上传');
  let addresses;
  try { addresses = await lookup(url.hostname, { all: true }); } catch { throw new AppError(400, 'MANUAL_SOURCE_UNAVAILABLE', '无法解析资料网站，请下载后上传'); }
  ensure(addresses.length > 0 && addresses.every(item => isPublicAddress(item.address)), 400, 'MANUAL_SOURCE_URL', '资料网址必须指向公网地址');
  const address = addresses.find(item => item.family === 4) || addresses[0];
  const result = await new Promise<{ bytes: Buffer; type: string; location?: string; status: number }>((resolve, reject) => {
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
      const type = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const limit = type.includes('html') ? 2 * 1024 * 1024 : MAX_BYTES;
      if (Number(response.headers['content-length'] || 0) > limit) { response.destroy(); reject(new AppError(413, 'MANUAL_TOO_LARGE', '资料文件超过下载限制，PDF 最大 32 MiB')); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) { response.destroy(); reject(new AppError(413, 'MANUAL_TOO_LARGE', '资料文件超过下载限制，PDF 最大 32 MiB')); }
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({ bytes: Buffer.concat(chunks), type, status }));
      response.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('source timeout')), timeoutMs);
    req.once('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(postData);
  }).catch(error => { if (error instanceof AppError) throw error; throw new AppError(400, 'MANUAL_SOURCE_UNAVAILABLE', '资料网站连接失败或超时，请下载后上传'); });
  if (result.location) return publicDownload(new URL(result.location, url).href, redirects + 1, undefined, timeoutMs);
  ensure(result.status === 200, 400, 'MANUAL_SOURCE_UNAVAILABLE', '资料网址未返回可下载文件');
  return { bytes: result.bytes, type: result.type, url: url.href };
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
  const primary: ManualSource = { title: `CarOBook · ${brand || '多品牌'}保养手册`, url: brand ? `https://www.carobook.com/${brandCatalogs[brand]}-bysc.html` : 'https://www.carobook.com/bysc.html', kind: 'carobook', description: '优先按品牌查找准确车型。网盘分享需在浏览器下载后上传，PDF 直链可自动获取。' };
  const sources = [primary];
  if (/比亚迪|BYD/i.test(model.brand)) sources.push({ title: '比亚迪官方车型手册', url: 'https://www.byd.com/cn/user-manual', kind: 'official', description: '按年款与 DM / EV 筛选；部分手册需在官方 App 认证车主后查看。优先核对中国版保养表。' });
  if (/大众/.test(model.brand)) sources.push({ title: '上汽大众官方保养手册', url: 'https://www.svw-volkswagen.com/service/maintenancemanual/', kind: 'official', description: '仅适用上汽大众车型；一汽大众迈腾、速腾等不可套用。' });
  if (/特斯拉|Tesla/i.test(model.brand)) sources.push({ title: '特斯拉中国官方保养建议', url: 'https://www.tesla.cn/support/vehicle-maintenance', kind: 'official', description: '按生产时期和配置核对条件、检查与更换要求；可将相关原文截图上传。' });
  sources.push({ title: '车主手册 · 备用资料目录', url: 'https://www.chezhushouce.com/', kind: 'other', description: '按品牌、车型与年份找 PDF，需核对原厂来源；网站注明仅供个人参考、禁止商用。' });
  return sources.map(source => ({ ...source, isDirectory: true }));
}

const discoveryCache = new Map<string, { expires: number; sources: ManualSource[] }>();
/** Explicit on-demand search of the site's public search form, never a background crawl. */
export async function discoverManualSources(model: CarModel): Promise<ManualSource[]> {
  const core = model.name.split(/[\s·（(]/)[0].trim();
  const query = core;
  const cacheKey = JSON.stringify([model.brand, core, model.year, model.power]);
  const old = discoveryCache.get(cacheKey);
  if (old && old.expires > Date.now()) return old.sources;
  const fallback = await manualSources(model);
  try {
    const result = await publicDownload('https://www.carobook.com/zb_system/cmd.php?act=search', 0, new URLSearchParams({ q: query }).toString(), 8000);
    const $ = load(result.bytes.toString('utf8')), candidates: ManualSource[] = [];
    $('h2 a[href], h3 a[href]').each((_index, node) => {
      const title = $(node).text().trim();
      if (!core || !title.includes(core) || !title.includes('保养手册')) return;
      let url: URL;
      try { url = new URL($(node).attr('href') || '', result.url); } catch { return; }
      if (url.hostname !== 'www.carobook.com' && url.hostname !== 'carobook.com') return;
      if (candidates.some(item => item.url === url.href) || candidates.length >= 6) return;
      candidates.push({ title, url: url.href, kind: 'carobook', isDirectory: false, description: title.includes(String(model.year)) ? '标题包含本车型年款，仍须核对中国版、动力与配置；有唯一 PDF 直链时可获取，网盘分享需下载后上传。' : '车系名称相符，但年款或动力尚未确认；仅作候选，核对适用范围后才可导入。' });
    });
    candidates.sort((a, b) => Number(b.title.includes(String(model.year))) - Number(a.title.includes(String(model.year))));
    const sources = [...candidates, ...fallback];
    if (!candidates.length) sources[0] = { ...sources[0], description: '本次未在 CarOBook 搜索结果找到可确认的车型保养手册；可继续查看品牌目录，或使用下方官方及备用来源。' };
    discoveryCache.set(cacheKey, { expires: Date.now() + 15 * 60000, sources });
    if (discoveryCache.size > 100) discoveryCache.delete(discoveryCache.keys().next().value!);
    return sources;
  } catch {
    return fallback.map((source, i) => i ? source : { ...source, description: 'CarOBook 在线搜索暂不可用，保留品牌目录入口；可从官方及其他渠道获取 PDF 或图片后上传。' });
  }
}
