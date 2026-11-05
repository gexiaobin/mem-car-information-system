import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommonFirstService, type ManualRuleDraft } from '@autovoyage/shared';

const row = (overrides: Partial<ManualRuleDraft> = {}): ManualRuleDraft => ({
  id: 'synthetic', name: '合成项目', projectId: null, createProject: false, include: true,
  action: 'inspect', triggerType: 'periodic', firstMonths: null, firstKm: null,
  intervalMonths: 12, intervalKm: 20000, mileageType: 'total_km', condition: '', notes: '', sourceText: '合成原文', pageNumbers: [1], ...overrides,
});

test('common first service fills only selected ordinary rows with completely unknown first service', () => {
  const rows = [row(), row({ firstKm: 100000 }), row({ include: false }), row({ triggerType: 'condition', condition: '严苛工况' }), row({ triggerType: 'as_needed' }), row({ condition: '特殊配置' })];
  const result = applyCommonFirstService(rows, 6, 5000);
  assert.equal(result.changed, 1);
  assert.equal(result.rows[0].firstMonths, 6);
  assert.equal(result.rows[0].firstKm, 5000);
  assert.equal(result.rows[1].firstMonths, null, 'do not impose a common month limit on a known long-cycle rule');
  assert.deepEqual(result.rows.slice(1), rows.slice(1));
  assert.equal(rows[0].firstKm, null, 'leave the source draft untouched');
  assert.equal(result.rows[0].intervalKm, 20000, 'never fill or replace later intervals');
});

test('common first service accepts one axis and rejects empty, fractional and out-of-range values', () => {
  assert.equal(applyCommonFirstService([row()], null, 5000).rows[0].firstMonths, null);
  for (const [months, km] of [[null, null], [0, null], [1.5, null], [1201, null], [null, 2000001], [null, NaN]] as [number | null, number | null][]) {
    assert.throws(() => applyCommonFirstService([row()], months, km));
  }
});
