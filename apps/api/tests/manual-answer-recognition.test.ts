import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recognizeManualEvidence } from '../src/manual-answer-recognition.js';
import type { recognizeManual } from '../src/manual-vision.js';

type Recognition = Awaited<ReturnType<typeof recognizeManual>>;
type Row = Recognition['rows'][number];
const config = { aiBaseUrl: 'https://synthetic.example/v1', aiKey: 'synthetic-key', aiModel: 'synthetic-model', aiApiStyle: 'responses' as const, aiTimeoutMs: 1000 };
const images = (numbers: number[]) => numbers.map(pageNumber => ({ pageNumber, buffer: Buffer.from(`synthetic-image-${pageNumber}`) }));
const row = (pageNumbers: number[], overrides: Partial<Row> = {}): Row => ({
  name: '发动机机油更换', action: 'replace', triggerType: 'periodic', conditionThresholdsIndependent: false,
  firstMonths: null, firstKm: null, intervalMonths: 6, intervalKm: 10000,
  mileageType: 'total_km', condition: '', notes: '以先到者为准', sourceText: '每6个月或10000公里更换发动机机油，以先到者为准。', pageNumbers, ...overrides,
});
const result = (rows: Row[] = [], overrides: Partial<Recognition> = {}): Recognition => ({ rows, warnings: [], sourceTitle: '合成用户手册', edition: '2405', applicability: '原文2024款汽油版', sourceExcerpt: '合成保养表及图例原文', ...overrides });
const errorCode = (code: string) => (error: unknown) => (error as { code?: string }).code === code;

test('small image and text evidence keeps the single recognition path without a scope', async () => {
  const pages = images([1, 2, 3, 4, 5]);
  const texts = [{ pageNumber: 1001, text: '已读取的官方目录卡片原文' }];
  const expected = result([row([3])]); let calls = 0;
  const actual = await recognizeManualEvidence(config, pages, '待核对车型', texts, async (cfg, received, description, context, scope) => {
    calls++; assert.equal(cfg, config); assert.equal(received, pages); assert.equal(description, '待核对车型');
    assert.equal(context, texts); assert.equal(scope, undefined); return expected;
  });
  assert.equal(actual, expected); assert.equal(calls, 1);
});

test('long evidence targets every physical page separately, preserves the full chapter and text in each call, and bounds concurrency to two', async () => {
  const pages = images([1, 2, 293, 294, 295, 296, 297, 298, 299]);
  const texts = [{ pageNumber: 1001, text: '官方目录明确2024款汉兰达汽油版2405版' }];
  const targetGroups: number[][] = []; let active = 0, peak = 0;
  const merged = await recognizeManualEvidence(config, pages, '目标车型', texts, async (_cfg, received, _description, context, scope) => {
    active++; peak = Math.max(peak, active);
    try {
      assert.equal(received, pages, 'all images, including distant global footnotes, remain visible');
      assert.equal(context, texts, 'the actual directory applicability evidence remains visible');
      assert(scope && scope.targetPageNumbers.length === 1);
      targetGroups.push([...scope.targetPageNumbers]);
      await new Promise(resolve => setImmediate(resolve));
      return result(scope.targetPageNumbers.filter(number => number > 2).map(number => row([number, 298], { name: `部件${number}`, sourceText: `项目${number}及第298页全局脚注` })));
    } finally { active--; }
  });
  assert.deepEqual(targetGroups, [[1], [2], [293], [294], [295], [296], [297], [298], [299]]);
  assert.equal(peak, 2); assert.equal(active, 0);
  assert.equal(merged.rows.length, 7); assert.deepEqual(merged.warnings, []);
  assert.equal(merged.applicability, '原文2024款汽油版');
});

test('batch merging removes only identical rows and retains distinct conditions, thresholds, notes and quotes', async () => {
  const pages = images([1, 2, 3, 4, 5, 6]);
  const common = row([1, 3]);
  const conditional = row([1, 3], { triggerType: 'condition', condition: '仅严苛工况', intervalKm: 5000 });
  const merged = await recognizeManualEvidence(config, pages, '车型', [], async (_cfg, _received, _description, _context, scope) => {
    if (scope!.targetPageNumbers.includes(1)) return result([common, conditional]);
    if (scope!.targetPageNumbers.includes(3)) return result([
      { ...common, pageNumbers: [3, 1] },
      { ...conditional, intervalKm: 3000 },
      { ...common, notes: '另一条明确脚注' },
      { ...common, sourceText: '另一处原文摘录' },
    ]);
    return result();
  });
  assert.equal(merged.rows.length, 5);
  assert.deepEqual(merged.rows.filter(item => item.triggerType === 'condition').map(item => item.intervalKm), [5000, 3000]);
  assert(merged.rows.some(item => item.notes === '另一条明确脚注'));
  assert(merged.rows.some(item => item.sourceText === '另一处原文摘录'));
});

test('real PDF text replaces non-target images while every physical page and directory evidence remain present exactly once', async () => {
  const numbers = [1, 2, 293, 294, 295, 296, 297, 298, 299];
  const pages = images(numbers);
  const directory = { pageNumber: 1001, text: '已实际读取的官方目录卡片' };
  const alternatives = numbers.map(pageNumber => ({ pageNumber, text: `物理页${pageNumber}的真实提取原文：全局图例与脚注` }));
  const calls: number[][] = [];
  const merged = await recognizeManualEvidence(config, pages, '车型', [directory], async (_cfg, received, _model, context, scope) => {
    const targets = scope!.targetPageNumbers;
    calls.push(targets);
    assert.deepEqual(received.map(page => page.pageNumber), targets, 'every target keeps its actual original image');
    for (const page of received) assert.equal(page, pages.find(original => original.pageNumber === page.pageNumber));
    const evidenceNumbers = [...received, ...context!].map(page => page.pageNumber);
    assert.equal(new Set(evidenceNumbers).size, evidenceNumbers.length, 'no page is supplied twice as both text and image');
    assert.deepEqual(evidenceNumbers.sort((a, b) => a - b), [...numbers, 1001]);
    assert(evidenceNumbers.length <= 12);
    assert.equal(context![0], directory);
    for (const page of context!.slice(1)) {
      assert(!targets.includes(page.pageNumber));
      assert.equal(page, alternatives.find(original => original.pageNumber === page.pageNumber), 'the physical page number and actual extracted text stay paired');
    }
    return result(targets.map(pageNumber => row([pageNumber, 298], { name: `原图项目${pageNumber}` })));
  }, alternatives);
  assert.equal(calls.length, numbers.length); assert.equal(merged.rows.length, numbers.length);
});

test('missing or blank alternative text retains the original context image instead of dropping evidence', async () => {
  const pages = images([1, 2, 3, 4, 5, 6]);
  const alternatives = [{ pageNumber: 3, text: '第3页真实原文' }, { pageNumber: 4, text: '  \n' }];
  await recognizeManualEvidence(config, pages, '车型', [], async (_cfg, received, _model, context, scope) => {
    const target = new Set(scope!.targetPageNumbers);
    const expectedImages = pages.filter(page => page.pageNumber !== 3 || target.has(3));
    assert.deepEqual(received, expectedImages);
    assert.equal(received.find(page => page.pageNumber === 4), pages[3], 'a blank extraction cannot replace a readable image');
    assert.deepEqual(context, target.has(3) ? [] : [alternatives[0]]);
    assert.deepEqual([...received, ...context!].map(page => page.pageNumber).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
    return result();
  }, alternatives);
});

test('alternative text cannot introduce an unrelated page or two versions of the same physical page', async () => {
  const pages = images([1, 2, 3, 4, 5, 6]); let calls = 0;
  const recognize = async () => { calls++; return result(); };
  await assert.rejects(recognizeManualEvidence(config, pages, '车型', [], recognize, [{ pageNumber: 999, text: '不属于所选原文' }]), errorCode('AI_PAGE_INVALID'));
  await assert.rejects(recognizeManualEvidence(config, pages, '车型', [], recognize, [{ pageNumber: 3, text: '版本一' }, { pageNumber: 3, text: '版本二' }]), errorCode('AI_PAGE_INVALID'));
  assert.equal(calls, 0);
});

test('context-only extra rows are excluded from each scope and retained in their actual target batch', async () => {
  const merged = await recognizeManualEvidence(config, images([1, 2, 3, 4, 5, 6]), '车型', [], async () => result([row([6])]));
  assert.equal(merged.rows.length, 1); assert.deepEqual(merged.rows[0].pageNumbers, [6]);
  assert.equal(merged.warnings.length, 1); assert.match(merged.warnings[0], /未引用本段目标页/);
});

test('metadata conflicts retain source scopes and explicitly warn instead of choosing the last edition', async () => {
  const merged = await recognizeManualEvidence(config, images([1, 2, 3, 4, 5, 6]), '车型', [], async (_cfg, _pages, _model, _texts, scope) =>
    result([], scope!.targetPageNumbers.includes(1) ? {} : { sourceTitle: '另一种原文标题', edition: '2406', applicability: '原文另一生产日期范围', sourceExcerpt: '另一页关键脚注' }));
  assert.equal(merged.edition, ''); assert.equal(merged.sourceTitle, '合成用户手册');
  assert.equal(merged.applicability, '原文2024款汽油版\n原文另一生产日期范围');
  assert.match(merged.warnings.join(' '), /无法确定各段手册版本/);
  assert.match(merged.warnings.join(' '), /无法确定各段适用范围/);
  assert.equal(merged.sourceExcerpt, '合成保养表及图例原文\n\n另一页关键脚注');
});

test('one batch failure waits for in-flight work, starts no further batches, and never returns a partial chapter', async () => {
  const calls: number[] = []; let active = 0;
  const failure = new Error('synthetic batch failure');
  await assert.rejects(recognizeManualEvidence(config, images([1, 2, 3, 4, 5, 6, 7, 8]), '车型', [], async (_cfg, _pages, _model, _texts, scope) => {
    const first = scope!.targetPageNumbers[0]; calls.push(first); active++;
    try {
      if (first === 1) throw failure;
      await new Promise(resolve => setImmediate(resolve));
      return result([row([first])]);
    } finally { active--; }
  }), error => error === failure);
  assert.deepEqual(calls, [1, 2]); assert.equal(active, 0);
});

test('unavailable evidence references, excess merged rows and oversize metadata fail without silent truncation', async () => {
  const pages = images([1, 2, 3, 4, 5, 6]);
  await assert.rejects(recognizeManualEvidence(config, pages, '车型', [], async () => result([row([999])])), errorCode('AI_PAGE_INVALID'));
  await assert.rejects(recognizeManualEvidence(config, pages, '车型', [], async (_cfg, _pages, _model, _texts, scope) => result(
    Array.from({ length: scope!.targetPageNumbers.includes(1) ? 21 : 20 }, (_, index) => row(scope!.targetPageNumbers, { name: `批次${scope!.targetPageNumbers[0]}项目${index}` })),
  )), errorCode('AI_BATCH_LIMIT'));
  await assert.rejects(recognizeManualEvidence(config, pages, '车型', [], async (_cfg, _pages, _model, _texts, scope) => result([], { sourceExcerpt: `${scope!.targetPageNumbers[0]}${'字'.repeat(6000)}` })), errorCode('AI_BATCH_LIMIT'));
  await assert.rejects(recognizeManualEvidence(config, images([1, 2, 3, 4, 5, 6]), '车型', [{ pageNumber: 1, text: '重复页码' }], async () => result()), errorCode('AI_PAGE_INVALID'));
  await assert.rejects(recognizeManualEvidence(config, images(Array.from({ length: 13 }, (_, index) => index + 1)), '车型', [], async () => result()), errorCode('MANUAL_PAGE_LIMIT'));
});

test('complete chapter aggregation accepts 61 distinct rows while each recognition batch remains below 60', async () => {
  const merged = await recognizeManualEvidence(config, images([1, 2, 3, 4, 5, 6]), '车型', [], async (_cfg, _pages, _model, _texts, scope) => result(
    Array.from({ length: scope!.targetPageNumbers.includes(1) ? 11 : 10 }, (_, index) => row(scope!.targetPageNumbers, { name: `批次${scope!.targetPageNumbers[0]}项目${index}` })),
  ));
  assert.equal(merged.rows.length, 61);
});
