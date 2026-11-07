import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument, PDFName, StandardFonts, type PDFRef } from 'pdf-lib';
import { locateManualPdfPages, parsePageRange, prepareManualPdf, prepareManualPdfSelection } from '../src/manual-files.js';
import { locateMaintenancePages, type PdfTextDocument } from '../src/manual-pdf-locator.js';

const blue = { r: 23, g: 111, b: 145 };
async function jpeg(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: blue } }).jpeg({ quality: 85 }).toBuffer();
}
async function scanPdf(image: Buffer, width: number, height: number, options: { pages?: number; nested?: boolean; mask?: [number, number]; copies?: number } = {}) {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const refs: PDFRef[] = [];
  for (let i = 0; i < (options.copies || 1); i++) {
    const mask = options.mask && ctx.register(ctx.stream(new Uint8Array(), {
      Type: 'XObject', Subtype: 'Image', Width: options.mask[0], Height: options.mask[1], ColorSpace: 'DeviceGray', BitsPerComponent: 8,
    }));
    refs.push(ctx.register(ctx.stream(image, {
      Type: 'XObject', Subtype: 'Image', Width: width, Height: height, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode', ...(mask ? { SMask: mask } : {}),
    })));
  }
  for (let i = 0; i < (options.pages || 1); i++) {
    const page = doc.addPage([400, 400]);
    for (const [index, ref] of refs.entries()) {
      const resource = options.nested ? ctx.register(ctx.stream('q /Inner Do Q', {
        Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1], Resources: { XObject: { Inner: ref } },
      })) : ref;
      page.node.setXObject(PDFName.of(`Im${index}`), resource);
    }
    page.node.addContentStream(ctx.register(ctx.stream(`q 400 0 0 400 0 0 cm ${refs.map((_, index) => `/Im${index} Do`).join(' ')} Q`)));
  }
  // Object streams exercise the metadata parser used by ordinary modern PDFs.
  return Buffer.from(await doc.save());
}
async function assertBluePage(pdf: Buffer) {
  const prepared = await prepareManualPdf(pdf, '合成扫描保养表.pdf');
  assert.equal(prepared.length, 2);
  assert(prepared[0].bytes.equals(pdf), 'the source PDF must remain unchanged');
  const { data, info } = await sharp(prepared[1].bytes).raw().toBuffer({ resolveWithObject: true });
  const offset = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  for (const [channel, expected] of [blue.r, blue.g, blue.b].entries()) {
    assert(Math.abs(data[offset + channel] - expected) <= 8, `image must render blue, not silently disappear: ${[...data.subarray(offset, offset + 3)]}`);
  }
  assert(Math.max(info.width, info.height) <= 2000);
}
const pixelError = (error: unknown) => (error as { code?: string }).code === 'PDF_IMAGE_PIXEL_LIMIT';

test('16.81 MP JPEG remains visible instead of silently producing a white page', async () => {
  await assertBluePage(await scanPdf(await jpeg(4100, 4100), 4100, 4100));
});

test('a common 600 dpi A4 scan is downsampled before PDF.js RGBA decoding', async () => {
  await assertBluePage(await scanPdf(await jpeg(4961, 7016), 4961, 7016));
});

test('oversized image is rejected before decode, including images inside Form XObjects', async () => {
  const small = await jpeg(20, 20);
  for (const nested of [false, true]) {
    await assert.rejects(prepareManualPdf(await scanPdf(small, 6500, 6500, { nested }), 'too-large.pdf'), pixelError);
  }
});

test('oversized soft masks cannot evade the image budget through nested Forms', async () => {
  const pdf = await scanPdf(await jpeg(20, 20), 20, 20, { nested: true, mask: [6500, 6500] });
  await assert.rejects(prepareManualPdf(pdf, 'mask.pdf'), pixelError);
});

test('combined image pixels on a page and across selected pages are bounded', async () => {
  const small = await jpeg(20, 20);
  await assert.rejects(prepareManualPdf(await scanPdf(small, 5000, 4200, { copies: 2 }), 'page-budget.pdf'), pixelError);
  await assert.rejects(prepareManualPdf(await scanPdf(small, 4100, 4100, { pages: 10 }), 'selection-budget.pdf'), pixelError);
});

test('inline images are explicitly rejected; BI in strings/comments does not trigger it', async () => {
  for (const [content, reject] of [
    ['q BI /W 1 /H 1 /CS /RGB /BPC 8 ID abc EI Q', true],
    ['q\0BI\0/W 1 /H 1 /CS /RGB /BPC 8 ID abc EI Q', true],
    ['% BI is a comment\nq (BI) /BI <4249> Q', false],
  ] as const) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    page.node.addContentStream(doc.context.register(doc.context.stream(content)));
    const promise = prepareManualPdf(Buffer.from(await doc.save()), 'inline.pdf');
    if (reject) await assert.rejects(promise, (error: unknown) => (error as { code?: string }).code === 'PDF_INLINE_IMAGE_UNSUPPORTED');
    else assert.equal((await promise).length, 2);
  }
});

async function textPdf(count: number, text: Record<number, string> = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= count; number++) {
    const page = doc.addPage([600, 800]);
    page.drawText(text[number] || `Owner handbook - page ${number}`, { x: 30, y: 750, size: 10, lineHeight: 18, font });
  }
  return Buffer.from(await doc.save());
}
const schedule = [
  'Maintenance schedule',
  'Replace engine oil every 12 months or 20000 km',
  'Replace air filter every 24 months or 40000 km',
  'Inspect brake fluid every 12 months or 20000 km',
  'Inspect tire pressure every 6 months or 10000 km',
].join('\n');
const errorCode = (code: string) => (error: unknown) => (error as { code?: string }).code === code;

test('large official PDF option retains the upload ceiling and an absolute 96 MiB limit', async () => {
  const MiB = 1024 * 1024;
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  // A valid unreferenced binary stream makes the book large without decoding
  // a huge image or relaxing the independent page-content safety checks.
  doc.context.register(doc.context.stream(Buffer.alloc(32 * MiB, 32)));
  const pdf = Buffer.from(await doc.save({ useObjectStreams: false }));
  assert(pdf.length > 32 * MiB && pdf.length < 33 * MiB);
  await assert.rejects(prepareManualPdf(pdf, 'large-upload.pdf'), errorCode('MANUAL_TOO_LARGE'));
  await assert.rejects(locateManualPdfPages(pdf), errorCode('MANUAL_TOO_LARGE'));
  await assert.rejects(prepareManualPdfSelection(pdf, 'default-upload.pdf'), errorCode('MANUAL_TOO_LARGE'));

  const prepared = await prepareManualPdfSelection(pdf, 'large-official.pdf', undefined, 'auto', { maxBytes: 96 * MiB });
  assert.equal(prepared.files[0].bytes, pdf, 'the exact source buffer is retained without an extra original-file copy');
  assert.equal(prepared.files[0].original, true);
  assert.deepEqual(prepared.selection.pages, [1]);
  assert.equal(prepared.files[1].mimeType, 'image/jpeg');

  await assert.rejects(prepareManualPdfSelection(Buffer.alloc(96 * MiB + 1), 'above-absolute-cap.pdf', undefined, 'auto', { maxBytes: 128 * MiB }), errorCode('MANUAL_TOO_LARGE'));
});

test('larger official byte allowance preserves decoded content and image pixel budgets', async () => {
  const options = { maxBytes: 96 * 1024 * 1024 };
  const small = await jpeg(20, 20);
  await assert.rejects(prepareManualPdfSelection(await scanPdf(small, 6500, 6500), 'official-image-budget.pdf', undefined, 'auto', options), pixelError);
  await assert.rejects(prepareManualPdfSelection(await scanPdf(small, 4100, 4100, { pages: 10 }), 'official-selection-budget.pdf', undefined, 'auto', options), pixelError);
  const doc = await PDFDocument.create();
  const page = doc.addPage([100, 100]);
  page.node.addContentStream(doc.context.register(doc.context.flateStream(' '.repeat(4 * 1024 * 1024 + 1))));
  await assert.rejects(prepareManualPdfSelection(Buffer.from(await doc.save()), 'official-content-budget.pdf', undefined, 'auto', options), errorCode('PDF_CONTENT_LIMIT'));
});

test('long PDF auto selection finds actual schedules, surrounding notes and front matter, excluding contents and repair prose', async () => {
  const pdf = await textPdf(24, {
    1: 'Example model owner handbook 2025 edition',
    2: 'Foreword. Verify model applicability before use.',
    4: 'Table of contents\nMaintenance schedule ............ 18\nEngine oil .................... 20\nAir filter ................... 21\nBrake fluid ................... 22',
    12: 'Repair instructions mention maintenance\nReplace the engine oil cap. Tighten 20 Nm.\nInspect the air filter cover. Use 4 screws.\nInspect brake fluid reservoir. Capacity 0.5 L.',
    17: 'Maintenance notes: intervals apply to normal conditions.',
    18: schedule,
    19: schedule.replace('Maintenance schedule', 'Maintenance schedule continued'),
    20: 'Legend: I means inspect; R means replace. Severe conditions require review. Notes: keep the maintenance record.',
  });
  const selected = await locateManualPdfPages(pdf);
  assert.deepEqual(selected.pages, [1, 2, 17, 18, 19, 20]);
  assert.equal(selected.mode, 'auto');
  assert.equal(selected.totalPages, 24);
  const prepared = await prepareManualPdf(pdf, 'synthetic-handbook.pdf');
  assert(prepared[0].bytes.equals(pdf));
  assert.deepEqual(prepared.slice(1).map(file => file.pageNumber), selected.pages);
  assert(prepared.length <= 13, 'only at most twelve selected page images plus the original PDF are returned');
});

test('a long scanned PDF fails clearly instead of sampling arbitrary pages; an explicit range still works', async () => {
  const pdf = await scanPdf(await jpeg(20, 20), 20, 20, { pages: 13 });
  await assert.rejects(locateManualPdfPages(pdf), (error: unknown) => {
    assert(errorCode('PDF_AUTO_SELECTION_REQUIRED')(error));
    assert.match((error as Error).message, /截图.*物理页码/);
    return true;
  });
  const selection = await locateManualPdfPages(pdf, '10,12', 'auto');
  assert.deepEqual(selection.pages, [10, 12]);
  assert.equal(selection.mode, 'manual', 'an explicit page range takes precedence over automatic mode');
  const prepared = await prepareManualPdf(pdf, 'manual-scan.pdf', '10,12');
  assert.deepEqual(prepared.slice(1).map(file => file.pageNumber), [10, 12]);
  await assert.rejects(locateManualPdfPages(pdf, undefined, 'manual'), errorCode('PAGE_RANGE_REQUIRED'));
});

test('short documents select every physical page and retain original page-range validation', async () => {
  const pdf = await textPdf(3);
  assert.deepEqual(await locateManualPdfPages(pdf), {
    mode: 'all', pages: [1, 2, 3], totalPages: 3,
    notice: '这份 PDF 共 3 页，已选择全部页面。请继续核对车型、版次及适用范围。',
  });
  assert.deepEqual((await prepareManualPdf(pdf, 'short.pdf')).slice(1).map(file => file.pageNumber), [1, 2, 3]);
  assert.deepEqual(parsePageRange('3,1-2', 3), [1, 2, 3]);
  assert.throws(() => parsePageRange(undefined, 13), errorCode('PAGE_RANGE_REQUIRED'));
  assert.throws(() => parsePageRange('1,1', 3), errorCode('DUPLICATE_PAGE'));
  assert.throws(() => parsePageRange('1-13', 13), errorCode('PDF_SELECTION_LIMIT'));
});

test('long contents or repair-only text is insufficient evidence for automatic selection', async () => {
  const pdf = await textPdf(13, {
    3: 'Table of contents\nMaintenance schedule ............ 9\nReplace engine oil ............ 10\nReplace air filter ............ 11\nInspect brake fluid ............ 12',
    9: 'Maintenance information\nReplace engine oil. Use 5 L. Torque 20 Nm.\nReplace air filter. Use 4 screws.\nInspect brake fluid. Capacity 0.5 L.',
  });
  await assert.rejects(locateManualPdfPages(pdf), errorCode('PDF_AUTO_SELECTION_REQUIRED'));
});

test('unlabelled neighboring legends and interval footnotes are retained even without recognized note headings', async () => {
  const pdf = await textPdf(15, {
    8: schedule,
    9: 'R = Replace; I = Inspect; C = Clean. * After 100000 km change brake fluid every 24 months.',
  });
  assert.deepEqual((await locateManualPdfPages(pdf)).pages, [1, 2, 7, 8, 9]);
});

test('chapter interval guidance a few pages before a table is retained', async () => {
  const pdf = await textPdf(15, {
    5: 'Maintenance schedule notes: whichever comes first. Continue beyond the final interval.',
    8: schedule,
  });
  assert.deepEqual((await locateManualPdfPages(pdf)).pages, [1, 2, 5, 7, 8, 9]);
});

test('an oversized detected schedule is not silently truncated to twelve pages', async () => {
  const text: Record<number, string> = {};
  for (let page = 3; page <= 13; page++) text[page] = schedule;
  await assert.rejects(locateManualPdfPages(await textPdf(15, text)), errorCode('PDF_AUTO_SELECTION_REQUIRED'));
});

function fakeTextDocument(items: unknown[], count = 13, cleanup = () => {}) : PdfTextDocument {
  return { numPages: count, async getPage() { return { async getTextContent() { return { items }; }, cleanup }; } };
}

test('automatic text extraction enforces page, item, character and elapsed-time budgets', async () => {
  let cleanups = 0;
  await assert.rejects(locateMaintenancePages(fakeTextDocument([{ str: 'x'.repeat(101) }], 13, () => cleanups++), { maxPageCharacters: 100 }), errorCode('PDF_TEXT_SCAN_LIMIT'));
  assert.equal(cleanups, 1);
  await assert.rejects(locateMaintenancePages(fakeTextDocument([{ str: 'x'.repeat(10) }]), { maxTotalCharacters: 20 }), errorCode('PDF_TEXT_SCAN_LIMIT'));
  await assert.rejects(locateMaintenancePages(fakeTextDocument([{ str: 'a' }, { str: 'b' }]), { maxPageItems: 1 }), errorCode('PDF_TEXT_SCAN_LIMIT'));
  await assert.rejects(locateMaintenancePages(fakeTextDocument([], 1001)), errorCode('PDF_PAGE_LIMIT'));
  const stalled: PdfTextDocument = { numPages: 13, async getPage() { return { getTextContent: () => new Promise(() => {}), cleanup() { cleanups++; } }; } };
  await assert.rejects(locateMaintenancePages(stalled, { maxPageMilliseconds: 5 }), errorCode('PDF_TEXT_SCAN_LIMIT'));
  assert.equal(cleanups, 2);
  const stalledPage: PdfTextDocument = { numPages: 13, getPage: () => new Promise(() => {}) };
  await assert.rejects(locateMaintenancePages(stalledPage, { maxMilliseconds: 10, maxPageMilliseconds: 5 }), errorCode('PDF_TEXT_SCAN_LIMIT'));
});

test('auto mode retains original selected-page image safety checks before rendering', async () => {
  const doc = await PDFDocument.load(await textPdf(13, { 8: schedule }));
  const page = doc.getPage(7);
  const image = doc.context.register(doc.context.stream(await jpeg(20, 20), {
    Type: 'XObject', Subtype: 'Image', Width: 6500, Height: 6500, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode',
  }));
  page.node.setXObject(PDFName.of('Im'), image);
  page.node.addContentStream(doc.context.register(doc.context.stream('q 100 0 0 100 0 0 cm /Im Do Q')));
  await assert.rejects(prepareManualPdf(Buffer.from(await doc.save()), 'unsafe-schedule.pdf'), pixelError);
  const scans = await PDFDocument.load(await scanPdf(await jpeg(20, 20), 5000, 4200, { pages: 13 }));
  const font = await scans.embedFont(StandardFonts.Helvetica);
  for (let pageNumber = 4; pageNumber <= 7; pageNumber++) scans.getPage(pageNumber - 1).drawText(schedule, { x: 20, y: 370, size: 8, lineHeight: 12, font });
  // Extraction may inspect all thirteen pages without decoding images, but the
  // eight selected pages must still respect the original 160 MP render budget.
  await assert.rejects(prepareManualPdf(Buffer.from(await scans.save()), 'auto-selection-budget.pdf'), pixelError);
});
