import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommonMaintenanceSummary, type ManualRuleDraft } from '@autovoyage/shared';

function row(id: string, name: string, values: Partial<ManualRuleDraft> = {}): ManualRuleDraft {
  return { id, name, action: 'replace', triggerType: 'periodic', include: true, projectId: null, catalogProjectId: null, createProject: false,
    firstKm: null, firstMonths: null, intervalKm: 20000, intervalMonths: 12, mileageType: 'total_km', condition: '', notes: '', sourceText: '仅用于摘要回归的来源样本', pageNumbers: [1], ...values };
}
const item = (rows: ManualRuleDraft[], id: string) => buildCommonMaintenanceSummary(rows).items.find(value => value.id === id);

test('normal maintenance summary follows the source chapter, grouping ten ordinary rules into nine consumable items', () => {
  // Values below are a fixture of the public 2405 gasoline schedule; the
  // implementation receives no model/year/brand and has no interval defaults.
  const rows = [
    row('oil', '发动机机油及机油滤清器', { triggerType: 'condition', include: false, intervalKm: 10000, intervalMonths: 12,
      condition: '显示保养提示时更换；即使未显示保养提示，上次更换后12个月或行驶超过10000公里也应更换。',
      sourceText: '上次更换机油12个月后或行驶超过10000公里时，即使未显示保养提示，也应更换发动机机油和机油滤清器。' }),
    row('air-check', '空气滤清器滤芯', { action: 'inspect', intervalKm: 40000, intervalMonths: 24 }),
    row('air', '空气滤清器滤芯', { intervalKm: 40000, intervalMonths: 48 }),
    row('cabin', '空调滤清器', { intervalMonths: null }),
    row('spark', '火花塞', { firstKm: 60000, intervalKm: 60000, intervalMonths: null }),
    row('brake-check', '制动液', { action: 'inspect', intervalKm: null, intervalMonths: 6 }),
    row('brake', '制动液', { intervalKm: 40000, intervalMonths: 24 }),
    row('fuel', '燃油滤清器', { firstKm: 80000, firstMonths: 96, intervalKm: 80000, intervalMonths: 96 }),
    row('coolant-check', '发动机冷却液', { action: 'inspect', intervalKm: 40000, intervalMonths: null }),
    row('coolant', '发动机冷却液', { firstKm: 160000, intervalKm: 80000, intervalMonths: null }),
    row('at-check', '自动变速器油（包括前差速器）', { action: 'inspect', intervalKm: 40000, intervalMonths: 24 }),
    row('transfer-check', '分动器油', { action: 'inspect', firstKm: 20000, intervalKm: 40000, intervalMonths: 12 }),
    row('transfer', '分动器油', { intervalKm: 40000, intervalMonths: 48 }),
    row('rear', '后差速器油', { intervalKm: 40000, intervalMonths: 48 }),
    row('hose', '橡胶软管', { action: 'inspect', triggerType: 'as_needed', intervalKm: null, intervalMonths: null }),
    row('bolt', '紧固传动轴螺栓', { action: 'other' }),
    row('at-severe', '自动变速器油（包括前差速器）', { triggerType: 'condition', include: false, intervalKm: 80000, intervalMonths: 48, condition: 'B-1：重载车辆（例如使用车顶行李架）。' }),
    row('dusty', '发动机机油及机油滤清器', { triggerType: 'condition', include: false, intervalKm: 5000, intervalMonths: 6, condition: '车辆主要在脏污或多尘道路上行驶。' }),
  ];
  const before = structuredClone(rows), summary = buildCommonMaintenanceSummary(rows);
  assert.equal(summary.items.length, 9);
  assert.equal(summary.regularRowIds.length, 10, 'grouped transfer/rear presentation keeps two independently importable rules');
  assert.equal(summary.totalRows, rows.length);
  assert.deepEqual(summary.specialRows.map(value => value.id), ['at-severe', 'dusty']);
  assert.deepEqual(summary.items.find(value => value.id === 'driveline-fluids')?.rowIds, ['transfer', 'rear']);
  assert(summary.items.find(value => value.id === 'oil-service')?.requirements.join('').includes('1万公里或1年'));
  assert(summary.items.find(value => value.id === 'oil-service')?.needsReview, 'include=false remains a review decision');
  const at = summary.items.find(value => value.id === 'automatic-transmission-front-fluid')!;
  assert(at.requirements.includes('本次资料未列出常规固定更换周期。'));
  assert(at.requirements[0]!.includes('检查'));
  assert(!at.requirements.join('').includes('8万'));
  assert(summary.otherRows.some(value => value.id === 'brake-check'), 'supplemental inspection remains in complete details');
  assert.deepEqual(rows, before, 'summary never edits original rows or include flags');
});

test('explicit service aliases and leading/trailing actions retain the exact component scope', () => {
  for (const name of ['空调滤清器更换', '更换空调滤芯', '座舱空气滤清器', '驾驶室空气滤芯']) assert(item([row(name, name)], 'cabin-filter'), name);
  for (const name of ['检查制动油', '刹车油检查', '刹车液']) assert(item([row(name, name, { action: 'inspect' })], 'brake-fluid'), name);
  for (const name of ['发动机机油更换', '更换发动机机油', '机油']) assert(item([row(name, name)], 'engine-oil'), name);
  for (const name of ['机油滤清器', '发动机机油滤芯', '更换机油滤芯']) assert(item([row(name, name)], 'oil-filter'), name);
  const unknown = [row('mixed', '机油与未知滤清器'), row('chemical', '空气滤清器清洁剂'), row('lubricant', '润滑油'), row('compound', '刹车油和变速器油')];
  assert.equal(buildCommonMaintenanceSummary(unknown).items.length, 0, 'unrecognized chemicals and combined scopes are not narrowed to a known component');
  assert.equal(buildCommonMaintenanceSummary(unknown).otherRows.length, 4);
});

test('equivalent independent oil/filter schedules group for reading while different cycles or conditions stay separate', () => {
  const oil = row('oil', '机油'), filter = row('filter', '机油滤清器');
  const merged = buildCommonMaintenanceSummary([oil, filter]);
  assert.equal(merged.items.length, 1); assert.deepEqual(merged.items[0]!.rowIds, ['oil', 'filter']);
  const different = buildCommonMaintenanceSummary([oil, { ...filter, intervalKm: 40000 }]);
  assert.equal(different.items.length, 2); assert(different.items[1]!.requirements[0]!.includes('4万'));
  const differentNotes = buildCommonMaintenanceSummary([oil, { ...filter, notes: '原文要求同时检测' }]);
  assert.equal(differentNotes.items.length, 2, 'a distinct original requirement is not erased by matching numeric intervals');
  const overlap = buildCommonMaintenanceSummary([oil, row('combined', '机油及机油滤清器')]);
  assert.equal(overlap.items.length, 2); assert(overlap.items.every(value => value.needsReview));
});

test('driveline oils merge only with identical complete operation/timing/unit/condition signatures', () => {
  const transfer = row('transfer', '分动器油'), rear = row('rear', '后桥齿轮油');
  assert(item([transfer, rear], 'driveline-fluids'));
  for (const changed of [{ intervalMonths: 24 }, { mileageType: 'engine_km' as const }, { action: 'inspect' as const }, { notes: '原文有额外检查要求' }]) {
    assert.equal(buildCommonMaintenanceSummary([transfer, { ...rear, ...changed }]).items.length, 2, JSON.stringify(changed));
  }
  const front = row('front', '前差速器油');
  assert.equal(buildCommonMaintenanceSummary([transfer, rear, front]).items.length, 2, 'front differential is not silently included in a rear/transfer grouping');
  assert.equal(buildCommonMaintenanceSummary([row('at', '自动变速器油'), row('at-front', '自动变速器油（含前差速器）')]).items.length, 2, 'a compound original scope does not collapse into a subset');
});

test('severe-use and model-specific requirements cannot become ordinary rules, even if mislabelled periodic or independently triggered', () => {
  const conditions = ['A-2：多尘道路', 'B-2：长时间怠速和长距离低速行驶', '仅在极寒地区使用', '重载时', '适用2026年款2.0T车型', '具体配置适用范围待核对'];
  for (const condition of conditions) {
    const summary = buildCommonMaintenanceSummary([row(condition, '自动变速器油', { condition, conditionThresholdsIndependent: true })]);
    assert.equal(summary.items.length, 0, condition);
    assert.equal(summary.regularRowIds.length, 0, condition);
    assert.equal(summary.specialRows.length + summary.otherRows.length, 1, condition);
  }
  for (const condition of ['常规使用条件', '正常工况', '一般使用条件下']) {
    const summary = buildCommonMaintenanceSummary([row(condition, '空调滤清器更换', { triggerType: 'condition', condition })]);
    assert.equal(summary.items.length, 1, condition);
    assert(summary.items[0]!.requirements[0]!.includes(condition));
    assert.equal(summary.items[0]!.needsReview, false);
  }
});

test('oil warning fallbacks need both source evidence and matching structured values; special-use oil remains supplemental', () => {
  const warning = row('warning', '发动机机油', { triggerType: 'condition', condition: '显示保养提示时更换；即使未显示保养提示，上次更换后9个月或15000公里也应更换。', intervalMonths: 9, intervalKm: 15000,
    sourceText: '即使未显示保养提示，上次更换后9个月或15000公里也应更换。' });
  const valid = buildCommonMaintenanceSummary([warning]);
  assert(valid.items[0]!.requirements[0]!.includes('15,000公里或9个月'), 'no Toyota-specific threshold defaults');
  assert.equal(buildCommonMaintenanceSummary([{ ...warning, intervalMonths: 12 }]).items.length, 0, 'the source did not support the altered number');
  assert.equal(buildCommonMaintenanceSummary([{ ...warning, sourceText: '显示保养提示时更换。' }]).items.length, 0);
  const restricted = buildCommonMaintenanceSummary([{ ...warning, condition: `多尘道路；${warning.condition}` }]);
  assert.equal(restricted.items.length, 0); assert.equal(restricted.specialRows.length, 1);
});

test('EV source rows produce relevant consumables and EV checks without inventing combustion maintenance', () => {
  const summary = buildCommonMaintenanceSummary([
    row('cabin', '空调滤芯'), row('brake', '制动液'), row('coolant', '动力电池冷却液'), row('motor', '驱动电机冷却液'), row('gear', '减速器油'),
    row('battery', '动力电池健康检查', { action: 'inspect' }), row('charge', '充电接口', { action: 'inspect' }), row('hose', '制动系统橡胶软管', { action: 'inspect' }),
  ]);
  assert.equal(summary.items.length, 7);
  assert(!summary.items.some(value => /发动机|火花塞|燃油|机油/.test(value.name)));
  assert(summary.items.some(value => value.id === 'traction-battery'));
  assert(summary.items.some(value => value.id === 'reduction-gear-fluid'));
  assert.deepEqual(summary.otherRows.map(value => value.id), ['hose']);
});

test('ordinary oil warning summaries retain different first-service and recurring thresholds without inventing recurrence', () => {
  const oil = row('oil', '机油', { triggerType: 'condition', firstKm: 5000, firstMonths: 3, intervalKm: 10000, intervalMonths: 12,
    condition: '首次3个月或5000公里更换；此后显示保养提示时更换，即使未显示保养提示，12个月或10000公里也应更换。',
    sourceText: '首次3个月或5000公里更换；此后显示保养提示时更换，即使未显示保养提示，12个月或10000公里也应更换。' });
  const firstAndRepeat = buildCommonMaintenanceSummary([oil]).items[0]!;
  assert(firstAndRepeat.requirements[0]!.includes('首次5,000公里或3个月更换'));
  assert(firstAndRepeat.requirements[0]!.includes('每1万公里或1年'));
  const firstOnly = buildCommonMaintenanceSummary([{ ...oil, intervalKm: null, intervalMonths: null }]).items[0]!;
  assert(firstOnly.requirements[0]!.includes('首次5,000公里或3个月'));
  assert(firstOnly.requirements[0]!.includes('后续周期待核对'));
  assert(!firstOnly.requirements[0]!.includes('每'));
  assert(firstOnly.needsReview);
});

test('unknown or incomplete schedules remain visible for review without fabricated defaults or extrapolated repetitions', () => {
  const summary = buildCommonMaintenanceSummary([
    row('missing', '燃油滤清器', { intervalKm: null, intervalMonths: null }),
    row('first', '火花塞', { triggerType: 'condition', include: false, firstKm: 45000, intervalKm: null, intervalMonths: null, condition: '后续周期尚待核对' }),
    row('grounding', '空调滤芯', { triggerType: 'condition', include: false, condition: 'AI摘录与周期需核对，尚不能作为已验证规则' }),
    row('unknown', '检查私有总成'), row('as-needed', '雨刮片', { triggerType: 'as_needed', intervalKm: null, intervalMonths: null }),
  ]);
  assert.equal(summary.items.length, 3);
  assert(summary.items.every(value => value.needsReview));
  assert(item([row('x', '火花塞', { triggerType: 'condition', firstKm: 45000, intervalKm: null, intervalMonths: null, condition: '后续周期尚待核对' })], 'spark-plug')?.requirements[0]!.includes('后续周期待核对'));
  assert(!summary.items.flatMap(value => value.requirements).join('').includes('每4.5万'));
  assert.deepEqual(summary.otherRows.map(value => value.id), ['unknown', 'as-needed']);
});

test('conflicting same-component requirements preserve all candidates and signal review instead of choosing a cycle', () => {
  const summary = buildCommonMaintenanceSummary([row('a', '空调滤芯'), row('b', '空调滤清器', { intervalKm: 30000, intervalMonths: 18 })]);
  assert.equal(summary.items.length, 1); assert.equal(summary.items[0]!.needsReview, true);
  assert.equal(summary.items[0]!.requirements.length, 2); assert.deepEqual(summary.items[0]!.rowIds, ['a', 'b']);
  assert(summary.items[0]!.requirements[0]!.includes('2万')); assert(summary.items[0]!.requirements[1]!.includes('3万'));
});

test('engine distance and odometer distance are displayed separately and cannot silently collapse', () => {
  const summary = buildCommonMaintenanceSummary([row('total', '机油'), row('engine', '机油', { mileageType: 'engine_km' })]);
  assert.equal(summary.items[0]!.requirements.length, 2);
  assert(summary.items[0]!.requirements.some(value => value.includes('发动机里程2万公里')));
  assert.equal(summary.items[0]!.needsReview, true);
  assert.deepEqual(buildCommonMaintenanceSummary([]), { items: [], regularRowIds: [], specialRows: [], otherRows: [], totalRows: 0 });
});
