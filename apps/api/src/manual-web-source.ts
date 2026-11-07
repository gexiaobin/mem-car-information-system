import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load } from 'cheerio';
import type { ManualAsset } from '@autovoyage/shared';
import type { Context } from './context.js';
import { route } from './context.js';
import { get, put, remove } from './db.js';
import { AppError, ensure, id, now, sha256 } from './domain.js';
import { ingestManualBuffer, type ManualFileResult } from './manual-files.js';
import { manualPdfLinks, publicDownload, validateSourceUrl } from './manual-sources.js';

type Downloaded = Awaited<ReturnType<typeof publicDownload>>;
const maintenanceWords = /保养|维护|维修|maintenance|service\s+(?:schedule|interval)/i;
function binaryType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}
function fileName(url: string) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '保养资料'); } catch { return '保养资料'; }
}
/** Plain source text only: no scripts, styles, executable HTML, or cookie forwarding. */
export function extractManualWebPage(bytes: Buffer, url: string, charsetHint?: string): { title: string; text: string; images: string[]; pdfs: string[] } {
  const charset = charsetHint || bytes.subarray(0, 4000).toString('ascii').match(/charset\s*=\s*["']?\s*(gb2312|gbk|gb18030|big5)/i)?.[1] || 'utf-8';
  let html: string;
  try { html = new TextDecoder(/^gb/i.test(charset) ? 'gb18030' : charset, { fatal: true }).decode(bytes); }
  catch { throw new AppError(400, 'MANUAL_WEB_ENCODING', '网页字符编码无法读取，请打开原页上传保养表截图'); }
  const $ = load(html);
  $('script,style,noscript,iframe,svg,nav,footer,header,form,button,[hidden],[aria-hidden="true"]').remove();
  const title = ($('title').first().text() || $('h1').first().text()).replace(/\s+/g, ' ').trim().slice(0, 1000);
  const pdfs = manualPdfLinks(html, url);
  const root = $('article').first().length ? $('article').first() : $('main').first().length ? $('main').first() : $('body');
  const images: Array<{ url: string; score: number }> = [];
  root.find('img').each((_index, node) => {
    const image = $(node), raw = image.attr('data-src') || image.attr('data-original') || image.attr('src') || '';
    const label = [image.attr('alt'), image.attr('title'), raw].filter(Boolean).join(' ');
    if (/logo|banner|avatar|qrcode|二维码|广告/i.test(label)) return;
    const surrounding = image.parent().text().slice(0, 1500);
    const score = (maintenanceWords.test(label) ? 4 : 0) + (/公里|周期|保养表|维护表|保养项目|maintenance|schedule/i.test(surrounding) ? 2 : 0);
    if (!score) return;
    try {
      const link = validateSourceUrl(new URL(raw, url).href).href;
      if (!images.some(item => item.url === link)) images.push({ url: link, score });
    } catch { /* Only public HTTPS images enter the download queue. */ }
  });
  root.find('br').replaceWith('\n');
  root.find('td,th').append(' | ');
  root.find('p,div,section,h1,h2,h3,h4,tr,li,table').append('\n');
  const text = root.text().replace(/\r/g, '').replace(/[\t\u00a0 ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  ensure(text.length <= 96000, 413, 'MANUAL_WEB_TEXT_LIMIT', '网页正文过长，请选择具体保养表页面或上传截图');
  return { title, text, images: images.sort((a, b) => b.score - a.score).slice(0, 4).map(item => item.url), pdfs };
}

interface SourceResult extends ManualFileResult { sourceUrl: string; title: string }
async function ingestBinary(ctx: Context, userId: string, source: Downloaded, mime: string, pageRange?: string, pageMode: 'auto' | 'manual' = 'auto'): Promise<SourceResult> {
  return { ...await ingestManualBuffer(ctx, userId, source.bytes, fileName(source.url), mime, pageRange, pageMode), sourceUrl: source.url, title: '' };
}

/** Acquire an actual public document/page; web search result pages are not evidence. */
export async function ingestManualSource(ctx: Context, userId: string, value: string, pageRange?: string, pageMode: 'auto' | 'manual' = 'auto'): Promise<SourceResult> {
  const requested = validateSourceUrl(value);
  ensure(!/(^|\.)(pan\.baidu\.com|yun\.baidu\.com|lanzou[a-z]?\.com|aliyundrive\.com|alipan\.com)$/i.test(requested.hostname), 400, 'MANUAL_DOWNLOAD_REQUIRED', '网盘页面需要登录获取，请打开原页下载后上传保养表图片');
  const deadline = Date.now() + 35000;
  const downloaded = await publicDownload(value, 0, undefined, 15000, deadline);
  const mime = binaryType(downloaded.bytes);
  if (mime) return ingestBinary(ctx, userId, downloaded, mime, pageRange, pageMode);
  ensure(downloaded.type.includes('html') || /^\s*<!doctype html|^\s*<html/i.test(downloaded.bytes.subarray(0, 300).toString()), 400, 'MANUAL_FORMAT', '此链接未返回可读取的手册网页或图片，请改选资料或上传截图');
  const page = extractManualWebPage(downloaded.bytes, downloaded.url, downloaded.charset);
  if (page.pdfs.length === 1) {
    try {
      const document = await publicDownload(page.pdfs[0], 0, undefined, 15000, deadline);
      const type = binaryType(document.bytes);
      if (type) return await ingestBinary(ctx, userId, document, type, pageRange, pageMode);
    } catch (error) {
      // A public page can itself contain useful evidence when its attachment is
      // unavailable. Retain the actual page text rather than inventing a file.
      if (!maintenanceWords.test(page.text) || page.text.length < 120) throw error;
    }
  }
  ensure(maintenanceWords.test(`${page.title}\n${page.text}`) && (page.text.length >= 80 || page.images.length > 0), 400, 'MANUAL_WEB_NO_EVIDENCE', '该网页没有可读取的保养正文或保养表图片，请打开原页截取保养表后上传');
  const saved: Array<{ id: string; path: string }> = [];
  const cleanupJobs: Array<() => Promise<void>> = [];
  const cleanup = async () => {
    for (const job of cleanupJobs) await job();
    for (const file of saved) { await remove(ctx.db, 'files', file.id); await unlink(file.path).catch(() => {}); }
  };
  try {
    await mkdir(ctx.config.uploadDir, { recursive: true });
    const fileId = id(), path = join(ctx.config.uploadDir, `manual-${fileId}.txt`);
    const text = `网页标题：${page.title || '保养资料'}\n来源网址：${downloaded.url}\n\n${page.text}`;
    const bytes = Buffer.from(`\ufeff${text}`, 'utf8');
    await writeFile(path, bytes, { flag: 'wx' });
    saved.push({ id: fileId, path });
    const name = `${page.title || '保养网页'}.txt`.slice(0, 180);
    await put(ctx.db, 'files', { id: fileId, ownerId: userId, path, hash: sha256(bytes), mime: 'text/plain', name, pageNumber: 1, original: true, purpose: 'manual', createdAt: now() });
    const files: ManualAsset[] = [{ id: fileId, name, url: route(`/manual-files/${fileId}`), mimeType: 'text/plain', pageNumber: 1, original: true }];
    let total = bytes.length;
    for (const imageUrl of page.images) {
      if (Date.now() >= deadline) break;
      let received: ManualFileResult | undefined;
      try {
        const image = await publicDownload(imageUrl, 0, undefined, 8000, deadline, 8 * 1024 * 1024);
        const type = binaryType(image.bytes);
        if (!type?.startsWith('image/') || image.bytes.length > 8 * 1024 * 1024 || total + image.bytes.length > 32 * 1024 * 1024) continue;
        received = await ingestManualBuffer(ctx, userId, image.bytes, fileName(image.url), type);
        cleanupJobs.push(received.cleanup);
        const pageNumber = files.length + 1;
        for (const asset of received.files) {
          const record = await get<Record<string, unknown> & { id: string }>(ctx.db, 'files', asset.id);
          ensure(record, 404, 'MANUAL_FILE_NOT_FOUND', '网页保养图片未保存');
          await put(ctx.db, 'files', { ...record, pageNumber });
          files.push({ ...asset, pageNumber });
        }
        total += image.bytes.length;
      } catch {
        if (received) { await received.cleanup(); cleanupJobs.splice(cleanupJobs.indexOf(received.cleanup), 1); }
        // Readable body stays available if an optional image is blocked.
      }
    }
    return { files, cleanup, sourceUrl: downloaded.url, title: page.title, selection: { mode: 'images', pages: files.map(file => file.pageNumber!), totalPages: null, notice: '已保存网页正文及可获取的保养图片；第1页为网页正文，其余页为图片，来源链接随资料保留。' } };
  } catch (error) { await cleanup(); throw error; }
}

export async function readManualTextEvidence(ctx: Context, files: ManualAsset[]): Promise<Array<{ pageNumber: number; text: string }>> {
  const result = [];
  for (const asset of files.filter(file => file.mimeType === 'text/plain' && file.pageNumber !== null)) {
    const file = await get<{ path: string; purpose: string; mime: string; pageNumber: number }>(ctx.db, 'files', asset.id);
    ensure(file?.purpose === 'manual' && file.mime === 'text/plain' && file.pageNumber === asset.pageNumber, 404, 'MANUAL_FILE_NOT_FOUND', '网页原文证据不存在');
    const text = (await readFile(file.path, 'utf8')).replace(/^\ufeff/, '');
    ensure(text.length <= 100000, 413, 'MANUAL_WEB_TEXT_LIMIT', '网页原文超过识别长度限制');
    result.push({ pageNumber: asset.pageNumber!, text });
  }
  return result;
}
