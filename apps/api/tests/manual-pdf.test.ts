import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument, PDFName, type PDFRef } from 'pdf-lib';
import { prepareManualPdf } from '../src/manual-files.js';

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
