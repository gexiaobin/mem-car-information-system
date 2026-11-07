import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MaintenanceRule, Project, ServiceRecord, Vehicle } from '@autovoyage/shared';
import { inferIndependentWarningThreshold, usesIndependentConditionThreshold } from '@autovoyage/shared';
import { maintenanceFor } from '../src/domain.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { get, put } from '../src/db.js';

const project: Project = { id: 'time-project', code: 'TIME_ONLY', name: '更换发动机机油', category: 'maintenance', description: '', active: true, unit: '次' };
const vehicle: Vehicle = { id: 'time-car', ownerId: 'owner-demo', modelId: 'time-model', name: '合成时间保养车辆', plate: 'TEST', initialKm: 0, startDate: '2026-01-31', totalKm: null, observedAt: null, isDemo: true };
const periodic: MaintenanceRule = { id: 'time-rule', modelId: vehicle.modelId, projectId: project.id, intervalMonths: 6, intervalKm: null, firstMonths: null, firstKm: null, mileageType: 'total_km', sourceTitle: '合成时间规则', sourceUrl: 'https://example.com/time', version: 1, verified: true, isDemo: true, action: 'replace', triggerType: 'periodic', condition: '', notes: '' };
const warning = (overrides: Partial<MaintenanceRule> = {}): MaintenanceRule => ({ ...periodic, triggerType: 'condition', condition: '当出现警告时或 6 个月，以先到者为准。', sourceText: '更换发动机机油\n当出现警告时或 6 个月\n低于0℃经常驾驶时，极端条件可能需要更频繁保养。', ...overrides });
const result = (rule: MaintenanceRule, at = '2026-07-31T00:00:00Z', car = vehicle, records: ServiceRecord[] = []) => maintenanceFor(car, [project], [rule], records, new Date(at))[0]!;

test('time-only rules calculate calendar due dates without any mileage observation', () => {
  const due = result(periodic);
  assert.equal(due.status, 'due'); assert.equal(due.dueAt, '2026-07-31'); assert.equal(due.dueKm, null);
  assert.equal(result(periodic, '2026-07-02T00:00:00Z').status, 'soon');
  assert.equal(result(periodic, '2026-05-01T00:00:00Z').status, 'ok');
  const leap = result({ ...periodic, intervalMonths: 1 }, '2024-02-29T00:00:00Z', { ...vehicle, startDate: '2024-01-31' });
  assert.equal(leap.dueAt, '2024-02-29'); assert.equal(leap.status, 'due');
});

test('distance-only and combined thresholds independently use the first threshold reached', () => {
  const car = { ...vehicle, totalKm: 5000, observedAt: '2026-02-01T00:00:00Z' };
  const km = result({ ...periodic, intervalMonths: null, intervalKm: 5000 }, '2026-02-01T00:00:00Z', car);
  assert.equal(km.status, 'due'); assert.equal(km.dueAt, null); assert.equal(km.dueKm, 5000);
  const combined = { ...periodic, intervalKm: 10000 };
  assert.equal(result(combined, undefined, { ...car, totalKm: 100 }).status, 'due');
  assert.equal(result(combined, '2026-02-01T00:00:00Z', { ...car, totalKm: 10000 }).status, 'due');
});

test('near calendar deadlines remain soon when mileage is missing, stale or uses engine mileage', () => {
  const combined = { ...periodic, intervalKm: 10000 };
  const missing = result(combined, '2026-07-14T00:00:00Z');
  assert.equal(missing.status, 'soon'); assert.equal(missing.dueAt, '2026-07-31'); assert.match(missing.reason, /里程.*更新/);
  const stale = result(combined, '2026-07-14T00:00:00Z', { ...vehicle, totalKm: 1000, observedAt: '2026-05-01T00:00:00Z' });
  assert.equal(stale.status, 'soon'); assert.match(stale.reason, /里程.*更新/);
  const engine = result({ ...combined, mileageType: 'engine_km' }, '2026-07-14T00:00:00Z');
  assert.equal(engine.status, 'soon'); assert.match(engine.reason, /发动机累计里程/);
  assert.equal(result(combined, '2026-04-01T00:00:00Z').status, 'missing');
});

test('latest confirmed service resets the calendar in Shanghai and clamps month-end', () => {
  const records: ServiceRecord[] = [{ id: 'old', vehicleId: vehicle.id, appointmentId: 'a', projectId: project.id, completedAt: '2026-02-28T18:00:00Z', totalKm: 4000, source: '车主确认', totalCents: 0 }];
  const dated = result({ ...periodic, intervalMonths: 1 }, '2026-04-01T00:00:00Z', vehicle, records);
  assert.equal(dated.dueAt, '2026-04-01'); assert.equal(dated.status, 'due');
  const first = result({ ...periodic, firstMonths: 1 }, '2026-02-28T00:00:00Z');
  assert.equal(first.dueAt, '2026-02-28');
});

test('legacy warning-or-month rules use evidence-backed dates and retain explicit opt-out', () => {
  assert.equal(usesIndependentConditionThreshold(warning()), true);
  const oil = result(warning()); assert.equal(oil.status, 'due'); assert.equal(oil.dueAt, '2026-07-31'); assert.equal(oil.conditionThresholdsIndependent, true); assert.match(oil.reason, /警告/);
  const filter = warning({ intervalMonths: 12, condition: '当出现警告时或 1 年，以先到者为准', sourceText: '更换发动机机油滤清器\n当出现警告时或 1 年' });
  assert.equal(inferIndependentWarningThreshold(filter), true); assert.equal(result(filter).dueAt, '2027-01-31');
  assert.equal(result(warning({ conditionThresholdsIndependent: false })).status, 'conditional');
  assert.equal(result(warning({ conditionThresholdsIndependent: false })).dueAt, null);
});

test('conditional evidence never promotes severe-use, ambiguous, unquoted or mismatched intervals', () => {
  for (const invalid of [
    warning({ condition: '严重工况每90000公里', intervalMonths: null, intervalKm: 90000 }),
    warning({ condition: '仅限2025款：当出现警告时或6个月，以先到者为准' }),
    warning({ condition: '当出现警告时或6个月，以先到者为准，范围待核对' }),
    warning({ sourceText: '每12个月更换' }), warning({ intervalMonths: 12 }),
    warning({ firstKm: 5000 }), warning({ triggerType: 'as_needed', conditionThresholdsIndependent: true }),
  ]) {
    assert.equal(inferIndependentWarningThreshold(invalid), false);
    assert.equal(result(invalid).status, 'conditional'); assert.equal(result(invalid).dueAt, null);
  }
  const manual = warning({ condition: '人工核对的警告或时间阈值', conditionThresholdsIndependent: true });
  assert.equal(result(manual).dueAt, '2026-07-31');
  assert.equal(result({ ...manual, intervalMonths: null }).status, 'conditional');
});

let service: Awaited<ReturnType<typeof createApp>>;
let temporary = '';
let cookie = '';
const origin = 'http://localhost:5173';
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'av-time-rules-'));
  service = await createApp({ config: loadConfig({ production: false, driver: 'pglite', pglitePath: ':memory:', seedDemo: true, demoMode: true, demoPassword: 'SyntheticTime2026!', sessionSecret: 'synthetic-time-test-secret-at-least32', uploadDir: temporary, origin, aiKey: '' }) });
  await put(service.db, 'projects', project);
  await put(service.db, 'models', { id: vehicle.modelId, brand: '合成', name: '时间规则', year: 2026, power: '合成汽油', isDemo: true, applicableProjectIds: [project.id] });
  const login = await service.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { email: 'admin@autovoyage.demo', password: 'SyntheticTime2026!' } });
  assert.equal(login.statusCode, 200, login.body); cookie = String(login.headers['set-cookie']).split(';')[0]!;
});
after(async () => { await service?.app.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); });
const call = (method: 'POST' | 'PATCH', path: string, payload: unknown) => service.app.inject({ method, url: `/api/v1${path}`, headers: { origin, cookie }, payload });

test('admin API supports time-only, km-only and full conditional semantics with merged patch validation', async () => {
  const { id: _id, version: _version, ...input } = periodic;
  const created = await call('POST', '/admin/rules', input);
  assert.equal(created.statusCode, 200, created.body); const id = created.json().id;
  assert.equal(created.json().firstMonths, null); assert.equal(created.json().intervalKm, null);
  const kmOnly = await call('PATCH', `/admin/rules/${id}`, { intervalMonths: null, intervalKm: 10000 });
  assert.equal(kmOnly.statusCode, 200, kmOnly.body); assert.equal(kmOnly.json().intervalMonths, null);
  const invalid = await call('PATCH', `/admin/rules/${id}`, { intervalKm: null });
  assert.equal(invalid.statusCode, 400); assert.equal((await get<MaintenanceRule>(service.db, 'rules', id))?.intervalKm, 10000);
  const timedCondition = await call('PATCH', `/admin/rules/${id}`, { triggerType: 'condition', condition: warning().condition, sourceText: warning().sourceText, notes: '保留原文警告', conditionThresholdsIndependent: true, intervalMonths: 6, intervalKm: null });
  assert.equal(timedCondition.statusCode, 200, timedCondition.body); assert.equal(timedCondition.json().conditionThresholdsIndependent, true);
  const harmless = await call('PATCH', `/admin/rules/${id}`, { sourceTitle: '合成修订名称' });
  assert.equal(harmless.statusCode, 200, harmless.body); assert.equal(harmless.json().triggerType, 'condition'); assert.equal(harmless.json().condition, warning().condition); assert.equal(harmless.json().action, 'replace'); assert.equal(harmless.json().sourceText, warning().sourceText);
  assert.equal((await call('PATCH', `/admin/rules/${id}`, { intervalMonths: null })).statusCode, 400);
  assert.equal((await call('PATCH', `/admin/rules/${id}`, { triggerType: 'periodic' })).statusCode, 400);
  const limited = await call('PATCH', `/admin/rules/${id}`, { conditionThresholdsIndependent: false, intervalMonths: null, condition: '检测后才处理' });
  assert.equal(limited.statusCode, 200, limited.body); assert.equal(result(limited.json()).status, 'conditional');
});
