import type { ManualRuleDraft } from './index.js';
import { inferIndependentWarningThreshold } from './maintenance-timing.js';

export interface ManualCommonSummaryItem { id: string; name: string; requirements: string[]; rowIds: string[]; needsReview: boolean }
export interface ManualCommonSummary { items: ManualCommonSummaryItem[]; regularRowIds: string[]; specialRows: ManualRuleDraft[]; otherRows: ManualRuleDraft[]; totalRows: number }

interface Component { id: string; name: string; replacementOnly?: boolean; transmission?: boolean }
const compact = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const unique = <T>(values: T[]) => [...new Set(values)];
const actionNames = { inspect: '检查', replace: '更换', clean: '清洁', lubricate: '润滑', other: '处理' };
const restricted = /(?:[ab][-－]?[1-9]\s*[:：])|严苛|恶劣|多尘|脏污|肮脏|重载|拖曳|拖挂|牵引挂车|怠速|低速行驶|持续高速|长时间高速|颠簸|泥泞|融雪|积水|盐碱|极寒|极热|出租|送货|营运|特殊工况|仅限|仅在|仅适用于|如果车辆|若车辆|severe|dusty|towing|heavy.?load/i;
const reviewWords = /待核对|需核对|待确认|尚待|尚未|尚不能|不能确定|未知|无法|缺少|缺失|不完整|未完整|不一致|冲突|uncertain/i;
const normalCondition = (value: string) => /^(?:正常|常规|一般|日常)(?:使用|行驶)?(?:条件|工况)?(?:下)?[。.!！]?$/.test(compact(value));

/** Exact component aliases classify presentation only; they never select a service template. */
function componentOf(name: string): Component | null {
  let key = compact(name).replace(/^(?:检查|检测|更换|替换|清洗(?!液|剂)|清洁(?!剂)|润滑(?!油|脂|剂)|定期)+/, '')
    .replace(/(?:检查|检测|更换|替换|清洗|清洁|润滑)$/, '');
  key = key.replace(/发动机机油滤清器(?:滤芯)?|发动机机油滤芯|机油滤清器(?:滤芯)?|机油滤芯/g, '机滤')
    .replace(/发动机机油/g, '机油').replace(/[、,，+&／/]|以及|及|和/g, '与');
  if (key === '机油') return { id: 'engine-oil', name: '发动机机油' };
  if (key === '机滤') return { id: 'oil-filter', name: '机油滤清器' };
  if (key === '机油与机滤' || key === '机滤与机油') return { id: 'oil-service', name: '发动机机油、机油滤清器' };
  if (/^(?:发动机)?空气(?:滤清器(?:滤芯)?|滤芯)$/.test(key)) return { id: 'engine-air-filter', name: '发动机空气滤芯' };
  if (/^(?:空调|座舱|车厢|驾驶室)(?:空气)?(?:滤清器(?:滤芯)?|滤芯|过滤器)$/.test(key)) return { id: 'cabin-filter', name: '空调滤芯' };
  if (/^(?:发动机)?火花塞$/.test(key)) return { id: 'spark-plug', name: '火花塞' };
  if (/^(?:制动液|刹车液|刹车油|制动油)(?:\((?:刹车油|制动液)\))?$/.test(key)) return { id: 'brake-fluid', name: '制动液（刹车油）' };
  if (/^(?:燃油|汽油|柴油)(?:滤清器(?:滤芯)?|滤芯|滤)$/.test(key)) return { id: 'fuel-filter', name: '燃油滤清器' };
  if (/^(?:发动机)?(?:冷却液|防冻液)$/.test(key)) return { id: key.startsWith('发动机') ? 'engine-coolant' : 'coolant', name: key.startsWith('发动机') ? '发动机冷却液' : '冷却液' };
  if (/^(?:动力电池|高压电池|电池)(?:冷却液|冷却系统冷却液)$/.test(key)) return { id: 'battery-coolant', name: '动力电池冷却液' };
  if (/^(?:驱动电机|电机|电驱动系统)(?:冷却液|冷却系统冷却液)$/.test(key)) return { id: 'motor-coolant', name: '电机冷却液' };
  if (/^(?:(?:at|自动)(?:变速器|变速箱)?(?:油|液)|自动变速(?:器|箱)(?:油|液))(?:\((?:包括|含)前差速器(?:油)?\))?$/.test(key)) return /前差速器/.test(key)
    ? { id: 'automatic-transmission-front-fluid', name: '自动变速器油（含前差速器）', transmission: true }
    : { id: 'automatic-transmission-fluid', name: '自动变速器油', transmission: true };
  if (/^(?:cvt|无级)(?:变速器|变速箱)?(?:油|液)$/.test(key)) return { id: 'cvt-fluid', name: '无级变速器油', transmission: true };
  if (/^(?:dct|双离合)(?:变速器|变速箱)?(?:油|液)$/.test(key)) return { id: 'dct-fluid', name: '双离合变速器油', transmission: true };
  if (/^(?:mt|手动)(?:变速器|变速箱)?(?:油|液)$/.test(key)) return { id: 'manual-transmission-fluid', name: '手动变速器油', transmission: true };
  if (/^变速(?:器|箱)(?:油|液)$/.test(key)) return { id: 'transmission-fluid', name: '变速器油', transmission: true };
  if (/^分动(?:器|箱)油$/.test(key)) return { id: 'transfer-fluid', name: '分动器油' };
  if (/^(?:后差速器油|后桥齿轮油)$/.test(key)) return { id: 'rear-differential-fluid', name: '后差速器油' };
  if (/^(?:前差速器油|前桥齿轮油)$/.test(key)) return { id: 'front-differential-fluid', name: '前差速器油' };
  if (/^(?:驱动电机)?减速(?:器|箱)(?:油|齿轮油)$/.test(key)) return { id: 'reduction-gear-fluid', name: '减速器油' };
  if (/^(?:正时皮带|正时齿形皮带|正时链条)$/.test(key)) return { id: 'timing-drive', name: name.trim(), replacementOnly: true };
  if (/^(?:传动皮带|附件皮带)$/.test(key)) return { id: 'drive-belt', name: name.trim(), replacementOnly: true };
  if (/^(?:制动衬块|制动摩擦片|刹车片|制动片)$/.test(key)) return { id: 'brake-pad', name: '制动片', replacementOnly: true };
  if (/^(?:制动盘|刹车盘)$/.test(key)) return { id: 'brake-disc', name: '制动盘', replacementOnly: true };
  if (/^(?:低压|12v)?(?:蓄电池|电瓶)$/.test(key)) return { id: 'low-voltage-battery', name: '低压蓄电池', replacementOnly: true };
  if (/^(?:雨刮片|雨刷片|刮水片)$/.test(key)) return { id: 'wiper-blade', name: '雨刮片', replacementOnly: true };
  if (/^(?:轮胎换位|轮胎轮换|轮胎换位与动平衡)$/.test(key)) return { id: 'tire-rotation', name: name.trim() };
  if (/^(?:动力电池|高压电池)(?:健康检查|健康检测|健康|系统)?$/.test(key)) return { id: 'traction-battery', name: '动力电池检查' };
  if (/^(?:充电接口|充电连接器|充电口)$/.test(key)) return { id: 'charge-connector', name: '充电接口检查' };
  return null;
}

function hasThreshold(row: ManualRuleDraft) { return [row.firstMonths, row.firstKm, row.intervalMonths, row.intervalKm].some(value => value !== null); }
function thresholdSupported(row: ManualRuleDraft): boolean {
  const source = compact(row.sourceText).replace(/,/g, '');
  const months = new Set<number>(); const km = new Set<number>();
  for (const match of source.matchAll(/(\d+(?:\.\d+)?)(个月|月|年|万公里|万千米|万km|千公里|千米|公里|km)/g)) {
    const value = Number(match[1]); const unit = match[2]!;
    if (/月|年/.test(unit)) months.add(unit === '年' ? value * 12 : value);
    else km.add(value * (unit.startsWith('万') ? 10000 : unit === '千公里' ? 1000 : 1));
  }
  return [row.firstMonths, row.intervalMonths].every(value => value === null || months.has(value))
    && [row.firstKm, row.intervalKm].every(value => value === null || km.has(value));
}

/** A warning reminder can be ordinary use; special-use warnings never qualify. */
function normalOilWarning(row: ManualRuleDraft, component: Component): boolean {
  if (!['engine-oil', 'oil-filter', 'oil-service'].includes(component.id) || row.action !== 'replace' || row.triggerType !== 'condition') return false;
  if (restricted.test(row.condition) || reviewWords.test(row.condition)) return false;
  if (inferIndependentWarningThreshold(row)) return true;
  const condition = compact(row.condition), source = compact(row.sourceText);
  const hasReminder = /保养提示|维护提示|保养警告|机油提示|机油寿命|仪表提示/.test(condition) && /保养提示|维护提示|保养警告|机油提示|机油寿命|仪表提示/.test(source);
  const fallback = /即使|未显示|无提示|无警告/.test(condition) && /即使|未显示|无提示|无警告/.test(source);
  return hasReminder && fallback && hasThreshold(row) && thresholdSupported(row);
}

function ordinary(row: ManualRuleDraft, component: Component): boolean {
  if (restricted.test(row.condition)) return false;
  if (/车型|年款|配置|动力|适用范围/.test(row.condition)) return false;
  if ((row.triggerType === 'periodic' && !row.condition.trim()) || normalCondition(row.condition)) return true;
  if (normalOilWarning(row, component)) return true;
  // A conservative extraction guard must remain visible as a review item, not
  // disappear or become a special driving condition merely because it is conditional.
  return reviewWords.test(row.condition) && hasThreshold(row);
}

function quantity(months: number | null, km: number | null, mileageType: ManualRuleDraft['mileageType']): string {
  const values: string[] = [];
  if (km !== null) values.push(`${mileageType === 'engine_km' ? '发动机里程' : ''}${km % 10000 === 0 ? `${km / 10000}万` : km.toLocaleString('zh-CN')}公里`);
  if (months !== null) values.push(months % 12 === 0 ? `${months / 12}年` : `${months}个月`);
  return values.join('或');
}

function requirement(row: ManualRuleDraft, component: Component): string {
  const action = actionNames[row.action];
  const first = quantity(row.firstMonths, row.firstKm, row.mileageType);
  const repeat = quantity(row.intervalMonths, row.intervalKm, row.mileageType);
  const earlier = (row.firstMonths !== null && row.firstKm !== null) || (row.intervalMonths !== null && row.intervalKm !== null) ? '（以先到者为准）' : '';
  if (normalOilWarning(row, component)) {
    if (!repeat) return `按仪表保养提示${action}；首次${first}${action}${earlier}，后续周期待核对`;
    const firstRequirement = first && first !== repeat ? `首次${first}${action}${earlier}；此后` : '';
    return `${firstRequirement}按仪表保养提示${action}；即使未提示，每${repeat}也应${action}${earlier}`;
  }
  const timing = first && first !== repeat ? `首次${first}${action}；${repeat ? `之后每${repeat}${action}` : '后续周期待核对'}`
    : repeat ? `每${repeat}${action}` : first ? `首次${first}${action}；后续周期待核对` : `原文未给出明确${action}周期，需核对`;
  return `${timing}${earlier}${row.condition.trim() ? `；${row.condition.trim()}` : ''}`;
}

function rowSignature(row: ManualRuleDraft): string {
  return JSON.stringify([row.action, row.triggerType, row.firstMonths, row.firstKm, row.intervalMonths, row.intervalKm, row.mileageType, compact(row.condition), compact(row.notes)]);
}

/** Read-only, source-backed presentation. No missing part or interval is invented. */
export function buildCommonMaintenanceSummary(rows: ManualRuleDraft[]): ManualCommonSummary {
  const specialRows = rows.filter(row => restricted.test(row.condition));
  const special = new Set(specialRows);
  const buckets = new Map<string, { component: Component; rows: ManualRuleDraft[] }>();
  for (const row of rows) {
    const component = componentOf(row.name);
    if (!component || special.has(row) || !ordinary(row, component)) continue;
    if (component.replacementOnly && (row.action !== 'replace' || row.triggerType !== 'periodic')) continue;
    const bucket = buckets.get(component.id) || { component, rows: [] };
    bucket.rows.push(row); buckets.set(component.id, bucket);
  }
  const order = ['oil-service', 'engine-oil', 'oil-filter', 'engine-air-filter', 'cabin-filter', 'spark-plug', 'brake-fluid', 'fuel-filter', 'engine-coolant', 'coolant', 'battery-coolant', 'motor-coolant', 'automatic-transmission-fluid', 'automatic-transmission-front-fluid', 'cvt-fluid', 'dct-fluid', 'manual-transmission-fluid', 'transmission-fluid', 'transfer-fluid', 'rear-differential-fluid', 'front-differential-fluid', 'reduction-gear-fluid', 'timing-drive', 'drive-belt', 'brake-pad', 'brake-disc', 'low-voltage-battery', 'wiper-blade', 'tire-rotation', 'traction-battery', 'charge-connector'];
  const selectedByItem = new Map<string, ManualRuleDraft[]>();
  const items: ManualCommonSummaryItem[] = [...buckets.values()].sort((a, b) => order.indexOf(a.component.id) - order.indexOf(b.component.id)).map(({ component, rows: groupRows }) => {
    const replacements = groupRows.filter(row => row.action === 'replace');
    const selected = replacements.length ? replacements : groupRows;
    selectedByItem.set(component.id, selected);
    const signatures = new Map<ManualRuleDraft['action'], Set<string>>();
    for (const row of selected) {
      const values = signatures.get(row.action) || new Set<string>(); values.add(rowSignature(row)); signatures.set(row.action, values);
    }
    const conflict = [...signatures.values()].some(values => values.size > 1);
    const requirements = unique(selected.map(row => requirement(row, component)));
    if (component.transmission && !replacements.length) requirements.push('本次资料未列出常规固定更换周期。');
    return { id: component.id, name: component.name, requirements, rowIds: unique(selected.map(row => row.id)),
      needsReview: conflict || selected.some(row => !row.include || !hasThreshold(row) || (row.intervalMonths === null && row.intervalKm === null) || reviewWords.test(row.condition) || (row.triggerType !== 'periodic' && !normalCondition(row.condition) && !normalOilWarning(row, component))) };
  });
  function merge(leftId: string, rightId: string, id: string, name: string) {
    const left = items.find(item => item.id === leftId), right = items.find(item => item.id === rightId);
    if (!left || !right || left.needsReview !== right.needsReview) return;
    const signature = (key: string) => unique(selectedByItem.get(key)!.map(rowSignature)).sort().join('\n');
    if (signature(leftId) !== signature(rightId)) return;
    const index = items.indexOf(left);
    items[index] = { ...left, id, name, rowIds: unique([...left.rowIds, ...right.rowIds]) };
    items.splice(items.indexOf(right), 1);
  }
  if (!items.some(item => item.id === 'oil-service')) merge('engine-oil', 'oil-filter', 'oil-service', '发动机机油、机油滤清器');
  else if (items.some(item => item.id === 'engine-oil' || item.id === 'oil-filter')) for (const item of items.filter(item => ['oil-service', 'engine-oil', 'oil-filter'].includes(item.id))) item.needsReview = true;
  merge('transfer-fluid', 'rear-differential-fluid', 'driveline-fluids', '分动器油、后差速器油');
  const regularRowIds = unique(items.flatMap(item => item.rowIds));
  const regular = new Set(regularRowIds);
  return { items, regularRowIds, specialRows, otherRows: rows.filter(row => !special.has(row) && !regular.has(row.id)), totalRows: rows.length };
}
