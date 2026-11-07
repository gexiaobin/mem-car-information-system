import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { createCanvas } from '@napi-rs/canvas';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObject, PDFRawStream, PDFStream, decodePDFRawStream } from 'pdf-lib';
import type { ManualAsset, ManualImport, ManualPageSelection, Vehicle } from '@autovoyage/shared';
import type { Context, Request } from './context.js';
import { authenticated, roles, route } from './context.js';
import { get, list, put, remove } from './db.js';
import { AppError, ensure, id, now, sha256 } from './domain.js';
import { locateMaintenancePages } from './manual-pdf-locator.js';

const MiB = 1024 * 1024;
const MAX_PAGES = 12;
// One 600 dpi A4 scan is about 35 MP. Bound decoded content before PDF.js,
// whose maxImageSize option can silently remove an over-limit image.
const MAX_PDF_IMAGE_PIXELS = 40_000_000;
const MAX_PDF_SELECTED_PIXELS = 160_000_000;
const MAX_PDF_CONTENT_BYTES = 4 * MiB;
interface StoredManualFile {
  id: string; ownerId: string; path: string; hash: string; mime: string;
  name: string; pageNumber: number | null; original: boolean;
  purpose: 'manual'; createdAt: string;
}
export interface PreparedFile { bytes: Buffer; name: string; mimeType: string; pageNumber: number | null; original: boolean }
export interface ManualFileResult { files: ManualAsset[]; cleanup: () => Promise<void>; selection?: ManualPageSelection }

/** Physical PDF page numbers, never the printed chapter page number. */
export function parsePageRange(range: string | undefined, totalPages: number): number[] {
  ensure(Number.isInteger(totalPages) && totalPages > 0 && totalPages <= 1000, 400, 'PDF_PAGE_LIMIT', 'PDF 必须为 1 至 1000 页');
  if (!range?.trim()) {
    ensure(totalPages <= MAX_PAGES, 400, 'PAGE_RANGE_REQUIRED', `这份 PDF 共 ${totalPages} 页，请指定保养表及相邻脚注的物理页码，每次最多 ${MAX_PAGES} 页`);
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  ensure(range.length <= 200, 400, 'INVALID_PAGE_RANGE', '页码范围过长');
  const pages: number[] = [];
  for (const part of range.replace(/，/g, ',').split(',')) {
    const match = /^\s*(\d{1,4})(?:\s*-\s*(\d{1,4}))?\s*$/.exec(part);
    ensure(match, 400, 'INVALID_PAGE_RANGE', '页码格式应为 1-3,5，使用 PDF 物理页码');
    const start = Number(match[1]), end = Number(match[2] || match[1]);
    ensure(start >= 1 && end >= start && end <= totalPages, 400, 'INVALID_PAGE_RANGE', `页码必须在 1 至 ${totalPages} 页内，范围不能倒置`);
    ensure(end - start + pages.length + 1 <= MAX_PAGES, 400, 'PDF_SELECTION_LIMIT', `每次最多识别 ${MAX_PAGES} 页`);
    for (let page = start; page <= end; page++) {
      ensure(!pages.includes(page), 400, 'DUPLICATE_PAGE', '页码不能重复');
      pages.push(page);
    }
  }
  return pages.sort((a, b) => a - b);
}

let pdfQueue: Promise<unknown> = Promise.resolve();
function serializedPdf<T>(work: () => Promise<T>): Promise<T> {
  const next = pdfQueue.then(work, work);
  pdfQueue = next.catch(() => {});
  return next;
}

/** Ignore strings, names and comments when looking for inline-image operators. */
function hasInlineImage(bytes: Uint8Array | Uint8ClampedArray): boolean {
  const text = Buffer.from(bytes).toString('latin1');
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (/[\s\0]/.test(c)) { i++; continue; }
    if (c === '%') { while (i < text.length && !/[\r\n]/.test(text[i])) i++; continue; }
    if (c === '(') {
      let depth = 1; i++;
      while (i < text.length && depth) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '(') depth++;
        if (text[i] === ')') depth--;
        i++;
      }
      continue;
    }
    if (c === '<' && text[i + 1] !== '<') { i++; while (i < text.length && text[i] !== '>') i++; i++; continue; }
    if (c === '/') { i++; while (i < text.length && !/[\s\0()[\]<>/%]/.test(text[i])) i++; continue; }
    if (/[()[\]<>]/.test(c)) { i++; continue; }
    const start = i;
    while (i < text.length && !/[\s\0()[\]<>/%]/.test(text[i])) i++;
    if (text.slice(start, i) === 'BI') return true;
  }
  return false;
}

async function preflightPdf(buffer: Buffer, range?: string, pageMode: 'auto' | 'manual' = 'manual'): Promise<{ data: Uint8Array; selected: number[]; totalPages: number; automatic: boolean }> {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false, throwOnInvalidObject: true });
  const totalPages = doc.getPageCount();
  ensure(Number.isInteger(totalPages) && totalPages > 0 && totalPages <= 1000, 400, 'PDF_PAGE_LIMIT', 'PDF 必须为 1 至 1000 页');
  const automatic = pageMode === 'auto' && !range?.trim() && totalPages > MAX_PAGES;
  const selected = automatic ? Array.from({ length: totalPages }, (_, index) => index + 1) : parsePageRange(range, totalPages);
  let totalPixels = 0, totalContentBytes = 0, totalNodes = 0, changed = false;
  const checkedContent = new WeakSet<PDFObject>();
  const replacements = new Map<PDFStream, PDFRawStream>();
  const key = (name: string) => PDFName.of(name);
  const value = (dict: PDFDict, name: string) => doc.context.lookup(dict.get(key(name)));
  for (const number of selected) {
    const seen = new WeakSet<PDFObject>();
    let pagePixels = 0, nodes = 0;
    const visit = async (raw: PDFObject | undefined, depth = 0, content = false, mask = false): Promise<void> => {
      const object = doc.context.lookup(raw);
      if (!object || seen.has(object)) return;
      seen.add(object);
      ensure(!automatic || ++totalNodes <= 1_000_000, 400, 'PDF_TEXT_SCAN_LIMIT', 'PDF 自动定位的资源扫描预算已达上限，请上传保养表及脚注截图，或手动填写物理页码');
      ensure(depth <= 64 && ++nodes <= 20_000, 400, 'PDF_RESOURCE_LIMIT', 'PDF 页面资源过于复杂，请导出保养表页面后重试');
      if (object instanceof PDFArray) {
        for (const item of object.asArray()) await visit(item, depth + 1, content, mask);
        return;
      }
      const dict = object instanceof PDFStream ? object.dict : object instanceof PDFDict ? object : undefined;
      if (!dict) return;
      const subtype = value(dict, 'Subtype');
      const image = object instanceof PDFStream && (subtype === key('Image') || mask || (dict.has(key('Width')) && dict.has(key('Height'))));
      if (image) {
        const width = value(dict, 'Width') || value(dict, 'W'), height = value(dict, 'Height') || value(dict, 'H');
        ensure(width instanceof PDFNumber && height instanceof PDFNumber && Number.isSafeInteger(width.asNumber()) && Number.isSafeInteger(height.asNumber()) && width.asNumber() > 0 && height.asNumber() > 0, 400, 'INVALID_PDF', 'PDF 图像尺寸无效');
        let pixels = width.asNumber() * height.asNumber();
        ensure(Number.isSafeInteger(pixels) && pixels <= MAX_PDF_IMAGE_PIXELS, 413, 'PDF_IMAGE_PIXEL_LIMIT', 'PDF 单张图像不能超过 4000 万像素，请降低扫描分辨率或上传保养表图片');
        const filter = value(dict, 'Filter');
        const jpeg = filter === key('DCTDecode') || filter instanceof PDFArray && filter.size() === 1 && doc.context.lookup(filter.get(0)) === key('DCTDecode');
        if (!automatic && jpeg && object instanceof PDFRawStream) {
          const metadata = await sharp(object.contents, { limitInputPixels: MAX_PDF_IMAGE_PIXELS }).metadata();
          const actualPixels = (metadata.width || 0) * (metadata.height || 0);
          ensure(actualPixels > 0 && actualPixels <= MAX_PDF_IMAGE_PIXELS, 413, 'PDF_IMAGE_PIXEL_LIMIT', 'PDF 内嵌 JPEG 不能超过 4000 万像素，请降低扫描分辨率');
          pixels = Math.max(pixels, actualPixels);
          // Shrink ordinary scanned JPEGs before PDF.js expands them into RGBA.
          // The final AI page is also limited to 2000 px, so no useful detail is lost.
          const color = value(dict, 'ColorSpace');
          if (pixels > 8_000_000 && [key('DeviceRGB'), key('DeviceGray')].includes(color as PDFName) && !['SMask', 'Mask', 'Decode', 'ImageMask', 'IM'].some(name => dict.has(key(name))) && doc.context.getObjectRef(object)) {
            let replacement = replacements.get(object);
            if (!replacement) {
              const resized = await sharp(object.contents, { limitInputPixels: MAX_PDF_IMAGE_PIXELS }).resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).toColourspace('srgb').jpeg({ quality: 94 }).toBuffer({ resolveWithObject: true });
              const normalized = dict.clone();
              normalized.set(key('Width'), PDFNumber.of(resized.info.width));
              normalized.set(key('Height'), PDFNumber.of(resized.info.height));
              normalized.set(key('ColorSpace'), key('DeviceRGB'));
              normalized.set(key('BitsPerComponent'), PDFNumber.of(8));
              normalized.set(key('Filter'), key('DCTDecode'));
              normalized.delete(key('DecodeParms'));
              replacement = PDFRawStream.of(normalized, resized.data);
              replacements.set(object, replacement);
            }
          }
        }
        pagePixels += pixels; totalPixels += pixels;
        ensure(pagePixels <= MAX_PDF_IMAGE_PIXELS && (automatic || totalPixels <= MAX_PDF_SELECTED_PIXELS), 413, 'PDF_IMAGE_PIXEL_LIMIT', 'PDF 单页图像合计不能超过 4000 万像素，所选页面合计不能超过 1.6 亿像素，请减少选页或降低扫描分辨率');
      }
      const isContent = content || subtype === key('Form') || value(dict, 'PatternType') instanceof PDFNumber;
      if (!image && isContent && object instanceof PDFRawStream && !checkedContent.has(object)) {
        checkedContent.add(object);
        const bytes = decodePDFRawStream(object).getBytes(MAX_PDF_CONTENT_BYTES + 1);
        totalContentBytes += bytes.length;
        ensure(bytes.length <= MAX_PDF_CONTENT_BYTES && totalContentBytes <= (automatic ? 32 : 16) * MiB, 413, automatic ? 'PDF_TEXT_SCAN_LIMIT' : 'PDF_CONTENT_LIMIT', automatic ? 'PDF 自动定位的解码文本扫描预算已达上限，请上传保养表及脚注截图，或手动填写物理页码' : 'PDF 页面绘图内容过大，请导出保养表页面后重试');
        ensure(!hasInlineImage(bytes), 400, 'PDF_INLINE_IMAGE_UNSUPPORTED', 'PDF 含内联图像，无法安全检查扫描尺寸，请重新导出标准 PDF 或上传保养表图片');
      }
      for (const [name, entry] of dict.entries()) {
        const field = name.decodeText();
        if (field === 'Parent' || field === 'P') continue;
        await visit(entry, depth + 1, ['Contents', 'CharProcs', 'AP'].includes(field) || (content && !(object instanceof PDFStream)), field === 'SMask' || field === 'Mask');
      }
    };
    // Resources are inherited from the page tree; node traversal alone misses them.
    await visit(doc.getPage(number - 1).node.Resources());
    await visit(doc.getPage(number - 1).node);
  }
  for (const [original, replacement] of replacements) {
    doc.context.assign(doc.context.getObjectRef(original)!, replacement);
    changed = true;
  }
  return { data: changed ? await doc.save({ useObjectStreams: false }) : new Uint8Array(buffer), selected, totalPages, automatic };
}

async function openPdf(data: Uint8Array) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('pdfjs-dist/package.json'));
  return getDocument({
    data, stopAtErrors: true, maxImageSize: -1,
    useSystemFonts: true, cMapUrl: join(root, 'cmaps') + '/', cMapPacked: true,
    standardFontDataUrl: join(root, 'standard_fonts') + '/',
  });
}

async function selectPdfPages(buffer: Buffer, range: string | undefined, pageMode: 'auto' | 'manual') {
  const checked = await preflightPdf(buffer, range, pageMode);
  if (!checked.automatic) {
    const manual = !!range?.trim();
    return { checked, selection: {
      mode: manual ? 'manual' : 'all', pages: checked.selected, totalPages: checked.totalPages,
      notice: manual ? `按指定 PDF 物理页码识别：${checked.selected.join('、')} 页。请核对表格、图例与脚注是否完整。` : `这份 PDF 共 ${checked.totalPages} 页，已选择全部页面。请继续核对车型、版次及适用范围。`,
    } satisfies ManualPageSelection };
  }
  const loading = await openPdf(checked.data);
  try {
    const doc = await loading.promise;
    const pages = await locateMaintenancePages(doc);
    return { checked, selection: {
      mode: 'auto', pages, totalPages: checked.totalPages,
      notice: `已自动定位保养周期表、相邻说明及封面／前言，共 ${pages.length} 页（PDF 物理页码：${pages.join('、')}）。仅识别这些页面，请核对车型、版次与适用范围。`,
    } satisfies ManualPageSelection };
  } finally { await loading.destroy().catch(() => {}); }
}

/** Read-only selection helper: performs bounded extraction; never renders or calls AI. */
export async function locateManualPdfPages(buffer: Buffer, range?: string, pageMode: 'auto' | 'manual' = 'auto'): Promise<ManualPageSelection> {
  ensure(buffer.length <= 32 * MiB, 413, 'MANUAL_TOO_LARGE', 'PDF 不能超过 32 MiB');
  return serializedPdf(async () => {
    try { return (await selectPdfPages(buffer, range, pageMode)).selection; }
    catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, 'INVALID_PDF', 'PDF 无法读取：请提供未加密且有效的 PDF，或上传保养表及脚注的清晰图片');
    }
  });
}

export async function prepareManualPdfSelection(buffer: Buffer, name: string, range?: string, pageMode: 'auto' | 'manual' = 'auto'): Promise<{ files: PreparedFile[]; selection: ManualPageSelection }> {
  ensure(buffer.length <= 32 * MiB, 413, 'MANUAL_TOO_LARGE', 'PDF 不能超过 32 MiB');
  return serializedPdf(async () => {
    let loading: ReturnType<typeof import('pdfjs-dist/legacy/build/pdf.mjs')['getDocument']> | undefined;
    try {
      const chosen = await selectPdfPages(buffer, range, pageMode);
      // Auto scanning does not decode images. Reapply the original selected-page
      // pixel budget and JPEG normalization before any page is rendered.
      const checked = chosen.checked.automatic ? await preflightPdf(buffer, chosen.selection.pages.join(',')) : chosen.checked;
      loading = await openPdf(checked.data);
      const doc = await loading.promise;
      const selected = checked.selected;
      const prepared: PreparedFile[] = [{ bytes: buffer, name, mimeType: 'application/pdf', pageNumber: null, original: true }];
      for (const number of selected) {
        const page = await doc.getPage(number);
        const initial = page.getViewport({ scale: 1 });
        ensure(initial.width > 0 && initial.height > 0 && Number.isFinite(initial.width * initial.height), 400, 'INVALID_PDF', 'PDF 页面尺寸无效');
        const viewport = page.getViewport({ scale: Math.min(2.5, 2000 / Math.max(initial.width, initial.height)) });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        try {
          await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport, background: '#ffffff' }).promise;
          prepared.push({ bytes: await canvas.encode('jpeg', 90), name: `${name} · 第 ${number} 页.jpg`, mimeType: 'image/jpeg', pageNumber: number, original: false });
        } finally { canvas.width = 1; canvas.height = 1; page.cleanup(); await doc.cleanup(); }
      }
      return { files: prepared, selection: chosen.selection };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(400, 'INVALID_PDF', 'PDF 无法读取：请提供未加密且有效的 PDF，或上传保养表及脚注的清晰图片');
    } finally { await loading?.destroy().catch(() => {}); }
  });
}
export async function prepareManualPdf(buffer: Buffer, name: string, range?: string, pageMode: 'auto' | 'manual' = 'auto'): Promise<PreparedFile[]> {
  return (await prepareManualPdfSelection(buffer, name, range, pageMode)).files;
}
export async function prepareManualImage(buffer: Buffer, name: string, mimeType: string, page: number): Promise<PreparedFile> {
  ensure(buffer.length <= 8 * MiB, 413, 'MANUAL_IMAGE_TOO_LARGE', '每张手册图片不能超过 8 MiB');
  try {
    const image = sharp(buffer, { limitInputPixels: 40_000_000, animated: false });
    const meta = await image.metadata();
    const expected: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
    ensure(expected[mimeType] === meta.format, 400, 'MANUAL_FORMAT', '图片格式与内容不一致，仅支持 JPEG、PNG、WebP');
    const bytes = await image.rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
    return { bytes, name, mimeType: 'image/jpeg', pageNumber: page, original: true };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'MANUAL_IMAGE_DECODE', '手册图片无法读取，请上传有效的 JPEG、PNG 或 WebP');
  }
}
export async function persistPreparedManualFiles(ctx: Context, userId: string, prepared: PreparedFile[]): Promise<ManualFileResult> {
  const saved: StoredManualFile[] = [];
  const cleanup = async () => {
    for (const file of saved) { await remove(ctx.db, 'files', file.id); await unlink(file.path).catch(() => {}); }
  };
  try {
    await mkdir(ctx.config.uploadDir, { recursive: true });
    for (const item of prepared) {
      const fileId = id(), path = join(ctx.config.uploadDir, `manual-${fileId}.${item.mimeType === 'application/pdf' ? 'pdf' : item.mimeType === 'text/plain' ? 'txt' : 'jpg'}`);
      const file: StoredManualFile = { id: fileId, ownerId: userId, path, hash: sha256(item.bytes), mime: item.mimeType, name: item.name, pageNumber: item.pageNumber, original: item.original, purpose: 'manual', createdAt: now() };
      await writeFile(path, item.bytes, { flag: 'wx' });
      saved.push(file);
      await put(ctx.db, 'files', file);
    }
    return { files: saved.map(file => ({ id: file.id, name: file.name, url: route(`/manual-files/${file.id}`), mimeType: file.mime, pageNumber: file.pageNumber, original: file.original })), cleanup };
  } catch (error) { await cleanup(); throw error; }
}
export async function ingestManualBuffer(ctx: Context, userId: string, buffer: Buffer, rawName: string, mimeType: string, pageRange?: string, pageMode: 'auto' | 'manual' = 'auto'): Promise<ManualFileResult> {
  const name = basename(rawName.replace(/\\/g, '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || '保养手册';
  ensure(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mimeType), 400, 'MANUAL_FORMAT', '仅支持 PDF、JPEG、PNG 和 WebP');
  const pdf = buffer.subarray(0, 5).toString() === '%PDF-';
  ensure((mimeType === 'application/pdf') === pdf, 400, 'MANUAL_FORMAT', '文件格式与内容不一致');
  ensure(pageMode === 'auto' || pageMode === 'manual', 400, 'INVALID_PAGE_MODE', '页码模式必须为 auto 或 manual');
  if (pdf) {
    const prepared = await prepareManualPdfSelection(buffer, name, pageRange, pageMode);
    return { ...await persistPreparedManualFiles(ctx, userId, prepared.files), selection: prepared.selection };
  }
  return { ...await persistPreparedManualFiles(ctx, userId, [await prepareManualImage(buffer, name, mimeType, 1)]), selection: { mode: 'images', pages: [1], totalPages: null, notice: '图片按上传顺序编号，无需填写 PDF 页码；请包含完整表格、图例与脚注。' } };
}
export async function receiveManualFiles(request: Request, ctx: Context): Promise<ManualFileResult & { fields: Record<string, string> }> {
  const user = roles(request, ['platform_admin']);
  const fields: Record<string, string> = {};
  const inputs: { bytes: Buffer; name: string; mimeType: string }[] = [];
  let total = 0;
  try {
    for await (const part of request.parts({ limits: { fileSize: 32 * MiB, files: MAX_PAGES, fields: 12, parts: MAX_PAGES + 12 } })) {
      if (part.type === 'file') {
        const bytes = await part.toBuffer(); total += bytes.length;
        ensure(total <= 32 * MiB, 413, 'MANUAL_TOTAL_LIMIT', '每次上传总量不能超过 32 MiB');
        ensure(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(part.mimetype), 400, 'MANUAL_FORMAT', '仅支持 PDF、JPEG、PNG 和 WebP');
        inputs.push({ bytes, name: basename(part.filename.replace(/\\/g, '/')).slice(0, 180), mimeType: part.mimetype });
      } else fields[part.fieldname] = String(part.value);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'MANUAL_UPLOAD_LIMIT', '上传失败：每次限 1 份 PDF（32 MiB）或 12 张图片（每张 8 MiB），总量不超过 32 MiB');
  }
  ensure(inputs.length > 0, 400, 'MANUAL_REQUIRED', '请选择保养手册 PDF 或图片');
  ensure(!inputs.some(item => item.mimeType === 'application/pdf') || inputs.length === 1, 400, 'ONE_MANUAL_PDF', '每次上传 1 份 PDF，或多张图片，不能混合');
  if (inputs[0].mimeType === 'application/pdf') {
    const pageMode = fields.pageMode || 'auto';
    ensure(pageMode === 'auto' || pageMode === 'manual', 400, 'INVALID_PAGE_MODE', '页码模式必须为 auto 或 manual');
    const result = await ingestManualBuffer(ctx, user.id, inputs[0].bytes, inputs[0].name, inputs[0].mimeType, fields.pageRange, pageMode);
    return { ...result, fields };
  }
  const prepared: PreparedFile[] = [];
  for (const [index, item] of inputs.entries()) prepared.push(await prepareManualImage(item.bytes, item.name, item.mimeType, index + 1));
  return { ...await persistPreparedManualFiles(ctx, user.id, prepared), fields, selection: { mode: 'images', pages: prepared.map(file => file.pageNumber!), totalPages: null, notice: '图片按上传顺序编号，无需填写 PDF 页码；请包含完整表格、图例与脚注。' } };
}
export async function readManualImages(ctx: Context, files: ManualAsset[]): Promise<Array<{ pageNumber: number; buffer: Buffer }>> {
  const images = files.filter(file => file.mimeType === 'image/jpeg' && file.pageNumber !== null);
  ensure(images.length > 0 && images.length <= MAX_PAGES, 400, 'MANUAL_PAGES_REQUIRED', '没有可识别的手册页面');
  const result = [];
  for (const image of images) {
    const file = await get<StoredManualFile>(ctx.db, 'files', image.id);
    ensure(file?.purpose === 'manual' && file.mime === 'image/jpeg' && file.pageNumber === image.pageNumber, 404, 'MANUAL_FILE_NOT_FOUND', '手册页面不存在');
    result.push({ pageNumber: image.pageNumber!, buffer: await readFile(file.path) });
  }
  return result;
}
export function registerManualFiles({ app, db }: Context) {
  app.get<{ Params: { id: string } }>(route('/manual-files/:id'), async (request, reply) => {
    const user = authenticated(request);
    const file = await get<StoredManualFile>(db, 'files', request.params.id);
    ensure(file?.purpose === 'manual', 404, 'MANUAL_FILE_NOT_FOUND', '手册文件不存在');
    let allowed = user.role === 'platform_admin';
    if (user.role === 'owner') {
      const models = new Set((await list<Vehicle>(db, 'vehicles')).filter(v => v.ownerId === user.id).map(v => v.modelId));
      allowed = (await list<ManualImport>(db, 'manual_imports')).some(job => job.status === 'published' && models.has(job.modelId) && job.files.some(asset => asset.id === file.id));
    }
    ensure(allowed, 403, 'FORBIDDEN', '仅平台管理员及适用车型车主可访问已发布手册');
    reply.header('Content-Type', file.mime).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'no-store');
    reply.header('Content-Disposition', `${file.mime === 'application/pdf' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return readFile(file.path);
  });
}
