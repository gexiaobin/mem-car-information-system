import type { MaintenanceRule, ManualRuleDraft } from './index.js';

type TimingRule = Pick<MaintenanceRule, 'triggerType' | 'condition' | 'sourceText' | 'firstMonths' | 'firstKm' | 'intervalMonths' | 'intervalKm' | 'conditionThresholdsIndependent'>;

const normalized = (value: string) => value.normalize('NFKC').replace(/\s+/g, '');
const warningDeadline = '(?:当)?(?:出现|显示)?(?:保养|维护|机油)?(?:警告|警示|提示|指示灯)(?:亮起)?(?:时)?(?:或|或者)([0-9][0-9,]*(?:\\.[0-9]+)?)(个月|月|年|公里|km)';

/** Compatibility for the narrow, unambiguous warning-or-deadline form in older manuals.
 * Restricted-use, uncertain and inspection-only conditions never become calendar rules.
 * The source quote and numeric field must independently agree; absent evidence stays conditional.
 */
export function inferIndependentWarningThreshold(rule: TimingRule): boolean {
  if (rule.triggerType !== 'condition') return false;
  const condition = normalized(rule.condition || '');
  if (/严苛|严重|恶劣|仅限|仅在|如果|若|工况|年款|动力|配置|范围|待核对|待确认|尚不能|未知|污染|检测后|检查后/.test(condition)) return false;
  const match = new RegExp(`^${warningDeadline}(?:[，,；;]*(?:以先到者?为准|以先到的为准|先到为准))?[。.!！]?$`, 'i').exec(condition);
  if (!match) return false;
  const source = normalized(rule.sourceText || '');
  const evidence = [...source.matchAll(new RegExp(warningDeadline, 'gi'))];
  const quantity = Number(match[1]!.replace(/,/g, ''));
  const unit = match[2]!.toLowerCase();
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  const months = unit === '年' ? quantity * 12 : /月/.test(unit) ? quantity : null;
  const km = /公里|km/.test(unit) ? quantity : null;
  if (!evidence.some(found => Number(found[1]!.replace(/,/g, '')) === quantity && found[2]!.toLowerCase() === unit)) return false;
  // A single deadline cannot prove another filled threshold or an unrelated first-service value.
  return [rule.firstMonths, rule.intervalMonths].every(value => value == null || value === months)
    && [rule.firstKm, rule.intervalKm].every(value => value == null || value === km)
    && (months !== null ? rule.intervalMonths === months : rule.intervalKm === km);
}

export function usesIndependentConditionThreshold(rule: TimingRule): boolean {
  if (rule.triggerType !== 'condition') return false;
  if (rule.conditionThresholdsIndependent !== undefined) return rule.conditionThresholdsIndependent;
  return inferIndependentWarningThreshold(rule);
}

/** An explicitly independent condition still needs a documented recurring threshold. */
export function hasRecurringMaintenanceThreshold(rule: Pick<ManualRuleDraft, 'intervalMonths' | 'intervalKm'>): boolean {
  return rule.intervalMonths != null || rule.intervalKm != null;
}
