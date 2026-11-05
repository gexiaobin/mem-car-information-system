import type { ManualRuleDraft } from './index.js';

/** Apply explicitly supplied common thresholds only where no first service is known. */
export function applyCommonFirstService(rows: ManualRuleDraft[], months: number | null, km: number | null) {
  if (months === null && km === null) throw new Error('请至少填写通用首次保养月数或公里数。');
  for (const [value, maximum] of [[months, 1200], [km, 2000000]]) {
    if (value !== null && (!Number.isInteger(value) || value < 1 || value > maximum!)) throw new Error('首次保养阈值须为有效正整数。');
  }
  let changed = 0;
  const next = rows.map(row => {
    if (!row.include || row.triggerType !== 'periodic' || row.condition.trim() || row.firstMonths !== null || row.firstKm !== null) return row;
    changed++;
    return { ...row, firstMonths: months, firstKm: km };
  });
  return { rows: next, changed };
}
