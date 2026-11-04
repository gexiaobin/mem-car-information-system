import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import type { SystemReleasesResponse } from '@autovoyage/shared';
import { createReleaseManifest, type BuildReleaseManifest } from '../../../scripts/release-manifest.mjs';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { connectDatabase, type Database } from '../src/db.js';
import { recordRelease, runningRelease } from '../src/releases.js';

const origin = 'http://localhost:5173';
const password = 'ReleaseIntegrationTest2026!';
const secret = 'release-test-secret-at-least-32-characters';
let service: Awaited<ReturnType<typeof createApp>>;
let control: pg.Client | undefined;
let schema: string | undefined;
let temporary: string;
const cookies: Record<string, string> = {};
const baseConfig = () => loadConfig({ production: false, seedDemo: false, sessionSecret: secret });
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'autovoyage-releases-'));
  const base = baseConfig();
  if (process.env.AV_RELEASE_PG_TEST === '1') {
    const { schema: _, ...connection } = base.pg;
    assert(connection.password, 'PostgreSQL release tests require configured credentials');
    control = new pg.Client({ ...connection, connectionTimeoutMillis: 10000 });
    await control.connect();
    schema = `av_test_release_${randomBytes(8).toString('hex')}`;
    assert(/^av_test_release_[a-f0-9]{16}$/.test(schema));
    await control.query(`CREATE SCHEMA "${schema}"`);
  }
  service = await createApp({ config: loadConfig({
    production: false, driver: schema ? 'postgres' : 'pglite', pglitePath: ':memory:',
    pg: { ...base.pg, schema: schema || base.pg.schema }, seedDemo: true, demoMode: true,
    demoPassword: password, sessionSecret: secret, uploadDir: temporary,
    aiBaseUrl: '', aiKey: '', aiModel: '', origin,
  }) });
  for (const [key, email] of Object.entries({ owner: 'owner@autovoyage.demo', store: 'store@autovoyage.demo', expert: 'expert@autovoyage.demo', admin: 'admin@autovoyage.demo' })) {
    const response = await service.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { email, password } });
    assert.equal(response.statusCode, 200, response.body);
    cookies[key] = String(response.headers['set-cookie']).split(';')[0];
  }
});
after(async () => {
  await service?.app.close();
  if (schema && control) {
    assert(/^av_test_release_[a-f0-9]{16}$/.test(schema));
    await control.query(`DROP SCHEMA "${schema}" CASCADE`);
    assert.equal((await control.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount, 0);
  }
  await control?.end();
  if (temporary) await rm(temporary, { recursive: true, force: true });
});
const request = (who: string, query = '') => service.app.inject({ method: 'GET', url: `/api/v1/releases${query}`, headers: { cookie: cookies[who] || '' } });
const fixture = (suffix: string, overrides: Partial<BuildReleaseManifest> = {}): BuildReleaseManifest => ({
  id: `release-test-${suffix}`, version: `0.8.0+test${suffix}`, title: '版本测试', changes: ['人工整理的发布说明。'],
  revision: null, sourceDigest: suffix, moduleHashes: { api: `api-${suffix}`, web: 'web-1' }, notesHash: 'notes-1', ...overrides,
});

test('source archive identity is deterministic across line endings and excludes private and generated files', async () => {
  const root = join(temporary, 'source-fixture');
  await mkdir(join(root, 'apps/api/src'), { recursive: true });
  await mkdir(join(root, 'apps/web/public'), { recursive: true });
  await mkdir(join(root, 'docs'), { recursive: true });
  await mkdir(join(root, 'apps/api/src/uploads'), { recursive: true });
  await writeFile(join(root, 'release.config.json'), JSON.stringify({ version: '0.8.0', title: '测试更新', changes: ['添加功能'] }));
  const source = join(root, 'apps/api/src/example.ts');
  await writeFile(source, 'export const example = 1;\r\n// comment\r\n');
  const first = createReleaseManifest({ root, git: false });
  assert.equal(first.revision, null);
  assert.match(first.version, /^0\.8\.0\+[a-f0-9]{10}$/);
  await writeFile(source, 'export const example = 1;\n// comment\n');
  assert.equal(createReleaseManifest({ root, git: false }).id, first.id);
  await writeFile(join(root, '.env'), 'PGPASSWORD=synthetic-fixture-value');
  await writeFile(join(root, 'apps/api/src/.env.private'), 'PRIVATE=synthetic-fixture-value');
  await writeFile(join(root, 'apps/api/src/uploads/private.txt'), 'synthetic-upload');
  await writeFile(join(root, 'docs/private.md'), 'synthetic-doc');
  assert.equal(createReleaseManifest({ root, git: false }).id, first.id);
  const revision = 'a'.repeat(40);
  assert.equal(createReleaseManifest({ root, revision }).id, first.id);
  assert.equal(createReleaseManifest({ root, revision }).revision, revision);
  await writeFile(source, 'export const example = 2;\n// comment\n');
  const second = createReleaseManifest({ root, git: false });
  assert.notEqual(second.id, first.id);
  assert.equal(second.notesHash, first.notesHash);
  await writeFile(join(root, 'apps/web/index.html'), '<html><head><title>Cloud journey</title></head></html>\n');
  const entry = createReleaseManifest({ root, git: false });
  assert.notEqual(entry.id, second.id);
  await writeFile(join(root, 'apps/web/index.html'), '<html><head><title>Updated cloud journey</title></head></html>\n');
  assert.notEqual(createReleaseManifest({ root, git: false }).id, entry.id);
  await writeFile(join(root, 'apps/web/public/example.png'), Buffer.from([0, 13, 10, 255]));
  const binary = createReleaseManifest({ root, git: false });
  await writeFile(join(root, 'apps/web/public/example.png'), Buffer.from([0, 10, 255]));
  assert.notEqual(createReleaseManifest({ root, git: false }).id, binary.id);
});

test('read requests require authentication and do not invent initial deployment history', async () => {
  assert.equal((await request('anonymous')).statusCode, 401);
  for (const who of Object.keys(cookies)) {
    const response = await request(who);
    assert.equal(response.statusCode, 200, response.body);
    const page = response.json<SystemReleasesResponse>();
    assert.equal(page.currentVersion, runningRelease.version);
    assert.equal(page.currentReleaseId, runningRelease.id);
    assert.deepEqual(page.items, []);
    assert.equal(page.total, 0);
  }
  assert.equal((await service.db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM av_releases'))[0].count, '0');
});

test('concurrent first deployments are insert-only and source-only changes derive fresh notes', async () => {
  const first = fixture('1');
  const date = '2026-11-01T01:00:00.000Z';
  const rows = await Promise.all([recordRelease(service.db, first, date), recordRelease(service.db, first, '2026-11-02T01:00:00.000Z')]);
  assert.deepEqual(rows[0], rows[1]);
  assert.equal(rows[0].deployedAt, date);
  const second = fixture('2', { moduleHashes: { api: 'api-2' } });
  const saved = await recordRelease(service.db, second, '2026-11-02T01:00:00.000Z');
  assert.deepEqual(saved.changes, ['业务服务与数据校验更新。', '页面展示与交互体验优化。']);
  assert.equal(saved.title, '云程功能与体验更新');
  const third = fixture('3', { notesHash: 'notes-2', changes: ['新的人工发布说明。'], title: '第三次发布' });
  assert.deepEqual((await recordRelease(service.db, third, '2026-11-03T01:00:00.000Z')).changes, third.changes);
  assert.deepEqual(await recordRelease(service.db, first, '2026-11-04T01:00:00.000Z'), rows[0]);
  assert.equal((await service.db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM av_releases'))[0].count, '3');
});

test('history is paginated newest first, omits internal build metadata, and reflects the running version separately', async () => {
  const before = await service.db.query('SELECT id,data FROM av_releases ORDER BY id');
  for (const who of Object.keys(cookies)) {
    const response = await request(who, '?offset=1&limit=1');
    assert.equal(response.statusCode, 200, response.body);
    const page = response.json<SystemReleasesResponse>();
    assert.equal(page.total, 3);
    assert.equal(page.offset, 1);
    assert.equal(page.limit, 1);
    assert.equal(page.items[0].id, 'release-test-2');
    assert.equal(page.currentReleaseId, runningRelease.id);
    assert.equal(page.currentVersion, runningRelease.version);
    assert.deepEqual(Object.keys(page.items[0]).sort(), ['id', 'version', 'title', 'changes', 'deployedAt', 'revision'].sort());
  }
  for (const query of ['limit=0', 'limit=51', 'limit=1.5', 'offset=-1', 'offset=100001']) assert.equal((await request('owner', `?${query}`)).statusCode, 400);
  assert.equal((await request('owner', '?offset=100')).json<SystemReleasesResponse>().items.length, 0);
  assert.deepEqual(await service.db.query('SELECT id,data FROM av_releases ORDER BY id'), before);
});

test('successful listening automatically records one real deployment time and config uses the same manifest', async () => {
  const start = Date.now();
  await service.app.listen({ port: 0, host: '127.0.0.1' });
  const recorded = await service.recordDeployment();
  assert.equal(recorded.id, runningRelease.id);
  assert(Date.parse(recorded.deployedAt) >= start && Date.parse(recorded.deployedAt) <= Date.now());
  assert.deepEqual(await service.recordDeployment(), recorded);
  const page = (await request('owner')).json<SystemReleasesResponse>();
  assert.equal(page.total, 4);
  assert.equal(page.items[0].id, runningRelease.id);
  assert.equal((await service.app.inject({ url: '/api/v1/config' })).json().version, page.currentVersion);
  assert.equal((await service.app.inject({ url: '/api/v1/health' })).json().version, page.currentVersion);
});

test('persisted releases retain the first successful timestamp across database reopen', async () => {
  const config = loadConfig({ production: false, seedDemo: false, driver: 'pglite', pglitePath: join(temporary, 'restart-db'), sessionSecret: secret });
  const first = await connectDatabase(config);
  await first.migrate();
  const recorded = await recordRelease(first, fixture('persistent'), '2026-10-31T03:30:00.000Z');
  await first.close();
  const reopened = await connectDatabase(config);
  try {
    await reopened.migrate();
    assert.deepEqual(await recordRelease(reopened, fixture('persistent'), '2026-11-04T03:30:00.000Z'), recorded);
  } finally { await reopened.close(); }
});

test('failed deployment recording is visible to startup and health checks', async () => {
  const config = loadConfig({ production: false, seedDemo: false, driver: 'pglite', pglitePath: ':memory:', sessionSecret: secret, uploadDir: join(temporary, 'failed'), aiBaseUrl: '', aiKey: '', aiModel: '' });
  const underlying = await connectDatabase(config);
  const db: Database = { ...underlying, transaction: work => underlying.transaction(sql => work({ query: (text, values) => {
    if (text.startsWith('LOCK TABLE av_releases')) throw new Error('synthetic release write failure');
    return sql.query(text, values);
  } })) };
  const failed = await createApp({ config, db });
  try {
    await assert.rejects(failed.recordDeployment(), /synthetic release write failure/);
    const health = await failed.app.inject({ url: '/api/v1/health' });
    assert.equal(health.statusCode, 503);
    assert.equal(health.json().error.code, 'RELEASE_RECORD_FAILED');
    assert.equal((await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM av_releases'))[0].count, '0');
  } finally { await failed.app.close(); }
});
