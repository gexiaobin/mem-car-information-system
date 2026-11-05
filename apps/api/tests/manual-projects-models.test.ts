import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import type { CarModel, ManualImport, ManualRuleDraft, Project } from "@autovoyage/shared";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { get, list, put, remove } from "../src/db.js";
import { sha256 } from "../src/domain.js";
import { autoMapManualProjects } from "../src/manual-project-mapping.js";
import { catalogProjects } from "../src/data/public-catalog.js";

const row = (overrides: Partial<ManualRuleDraft> = {}): ManualRuleDraft => ({
  id: "row-1", name: "火花塞", projectId: null, catalogProjectId: null,
  createProject: false, include: true, action: "replace", triggerType: "periodic",
  firstMonths: null, firstKm: 100000, intervalMonths: null, intervalKm: 100000,
  mileageType: "total_km", condition: "", notes: "合成测试，不用于实车",
  sourceText: "合成测试：每100000公里更换火花塞。", pageNumbers: [1], ...overrides,
});
const project = (overrides: Partial<Project> = {}): Project => ({ id: "existing", code: "TEST", name: "更换火花塞", category: "maintenance", description: "仅用于合成测试", unit: "次", active: true, ...overrides });

test("automatic mapping uses exact component aliases and matching actions, then bundled references", () => {
  assert.equal(autoMapManualProjects([row()], [project()])[0]?.projectId, "existing");
  assert.equal(autoMapManualProjects([row({ name: "空调滤芯" })], [project({ name: "空调滤清器", description: "更换空调滤芯并检查安装密封" })])[0]?.projectId, "existing");
  assert.equal(autoMapManualProjects([row({ name: "发动机机油及机油滤芯" })], [project({ name: "机油与机滤", description: "更换发动机机油与机油滤清器" })])[0]?.projectId, "existing");
  const reference = autoMapManualProjects([row()], [])[0]!;
  assert.equal(reference.projectId, null);
  assert.equal(reference.catalogProjectId, "ref-spark-plug");
  assert.equal(reference.createProject, false);
  const inspection = autoMapManualProjects([row({ name: "刹车液", action: "inspect" })], [])[0]!;
  assert.equal(inspection.catalogProjectId, "ref-brake-fluid-inspection");
  assert.equal(autoMapManualProjects([row({ name: "轮胎换位", action: "other" })], [])[0]?.catalogProjectId, "ref-tire-rotation");
});

test("uncertain, disabled, mixed-action, duplicate and substring matches remain empty", () => {
  for (const [input, candidates] of [
    [row(), [project(), project({ id: "second" })]],
    [row(), [project({ active: false })]],
    [row(), [project({ name: "火花塞", description: "适用范围待核对" })]],
    [row({ name: "检查并更换火花塞" }), []],
    [row({ name: "检查火花塞", action: "replace" }), []],
    [row({ name: "火花塞和点火线圈" }), []],
    [row({ name: "未知部件" }), []],
  ] as Array<[ManualRuleDraft, Project[]]>) {
    const result = autoMapManualProjects([input], candidates)[0]!;
    assert.equal(result.projectId, null, input.name);
    assert.equal(result.catalogProjectId, null, input.name);
    assert.equal(result.createProject, false);
  }
  const repeated = autoMapManualProjects([row(), row({ id: "row-2" })], []);
  assert(repeated.every(item => !item.catalogProjectId));
  const manual = row({ projectId: "human-choice" });
  const explicitNew = row({ id: "new", createProject: true });
  assert.deepEqual(autoMapManualProjects([manual, explicitNew], []), [manual, explicitNew]);
});

test("automatic mapping reserves the same eventual target across existing and reference IDs", () => {
  const imported = project({ catalogSource: { catalogId: "ref-spark-plug", version: "test", sources: [], importedAt: "2026-01-01T00:00:00.000Z" } });
  const catalogFirst = autoMapManualProjects([row({ catalogProjectId: "ref-spark-plug" }), row({ id: "empty" })], [imported]);
  assert.equal(catalogFirst[0]?.catalogProjectId, "ref-spark-plug");
  assert.equal(catalogFirst[1]?.projectId, null);
  assert.equal(catalogFirst[1]?.catalogProjectId, null);
  const existingFirst = autoMapManualProjects([row({ projectId: imported.id }), row({ id: "empty" })], [imported]);
  assert.equal(existingFirst[1]?.projectId, null);
  assert.equal(existingFirst[1]?.catalogProjectId, null);
  const manualAlias = project({ name: "火花塞更换" });
  const aliasReserved = autoMapManualProjects([row({ catalogProjectId: "ref-spark-plug" }), row({ id: "empty" })], [manualAlias]);
  assert.equal(aliasReserved[1]?.projectId, null);
  assert.equal(aliasReserved[1]?.catalogProjectId, null);
});

let service: Awaited<ReturnType<typeof createApp>>;
let temporary: string;
let control: pg.Client | undefined;
let schema: string | undefined;
let schemaCreated = false;
const origin = "http://localhost:5173";
const cookies: Record<string, string> = {};
let number = 0;
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "autovoyage-project-model-"));
  const base = loadConfig({ production: false, seedDemo: false, sessionSecret: "model-mapping-test-secret-at-least-32-characters" });
  if (process.env.AV_MANUAL_PG_TEST === "1") {
    const { schema: _, ...connection } = base.pg;
    assert(connection.password, "PostgreSQL model/project tests require configured credentials");
    control = new pg.Client({ ...connection, connectionTimeoutMillis: 10000 });
    await control.connect();
    schema = `av_test_model_${randomBytes(8).toString("hex")}`;
    assert(/^av_test_model_[a-f0-9]{16}$/.test(schema));
    await control.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
  }
  service = await createApp({ config: loadConfig({ production: false, driver: schema ? "postgres" : "pglite", pglitePath: ":memory:", pg: { ...base.pg, schema: schema || base.pg.schema }, seedDemo: true, demoMode: true, demoPassword: "ModelMappingTest2026!", sessionSecret: "model-mapping-test-secret-at-least-32-characters", uploadDir: temporary, origin, aiBaseUrl: "", aiKey: "", aiModel: "" }) });
  if (schema) assert.equal((await service.db.query<{ schema: string }>("SELECT current_schema() AS schema"))[0]?.schema, schema, "all app writes must resolve to the temporary test schema");
  for (const [role, email] of Object.entries({ admin: "admin@autovoyage.demo", owner: "owner@autovoyage.demo", store: "store@autovoyage.demo" })) {
    const reply = await service.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { origin }, payload: { email, password: "ModelMappingTest2026!" } });
    assert.equal(reply.statusCode, 200, reply.body);
    cookies[role] = String(reply.headers["set-cookie"]).split(";")[0]!;
  }
});
after(async () => {
  try {
    await service?.app.close();
  } finally {
    try {
      if (schemaCreated && schema && control) {
        assert(/^av_test_model_[a-f0-9]{16}$/.test(schema));
        await control.query(`DROP SCHEMA "${schema}" CASCADE`);
        assert.equal((await control.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).rowCount, 0, "temporary model/project schema must be removed");
        console.log(JSON.stringify({ postgresTemporarySchema: schema, removed: true }));
      }
    } finally {
      await control?.end();
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  }
});
const call = (role: string, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, payload?: unknown) => service.app.inject({ method, url: `/api/v1${path}`, headers: { origin, cookie: cookies[role] || "" }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
async function model() {
  const reply = await call("admin", "POST", "/admin/models", { brand: "合成测试品牌", name: `独立测试车型${++number}`, year: 2024, power: "合成动力", isDemo: false });
  assert.equal(reply.statusCode, 200, reply.body);
  return reply.json<CarModel>();
}
async function job(model: CarModel, rows: ManualRuleDraft[]) {
  const value = {
    id: `manual-mapping-${++number}`, createdBy: "admin-demo", modelId: model.id,
    sourceTitle: "合成保养手册", sourceUrl: "https://example.com/synthetic-manual.pdf", acquiredSourceUrl: "https://example.com/synthetic-manual.pdf",
    edition: "2024合成测试版", applicability: "仅适用于合成测试车型", metadataOrigin: { sourceTitle: "document", edition: "document", applicability: "document" },
    status: "awaiting_confirmation", files: [{ id: `file-${number}`, name: "synthetic.png", url: `/api/v1/manual-files/file-${number}`, mimeType: "image/png", pageNumber: 1, original: true }],
    rows, warnings: [], reason: "合成测试", revision: 1, attempts: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), publishedAt: null, publishedRuleIds: [], aiModel: "synthetic",
    modelIdentity: sha256(JSON.stringify([model.brand, model.name, model.year, model.power, model.isDemo])), baseRuleVersions: {},
  };
  await put(service.db, "manual_imports", value);
  return value;
}

test("existing draft automatic mapping is revision-checked, role-protected, preserves choices and creates no projects", async () => {
  const target = await model();
  const original = await job(target, [row(), row({ id: "manual-choice", name: "人工选择的项目", projectId: "project-cabin" })]);
  const beforeCount = (await list<Project>(service.db, "projects")).length;
  assert.equal((await call("owner", "POST", `/admin/manual-imports/${original.id}/auto-map`, { expectedRevision: 1 })).statusCode, 403);
  assert.equal((await call("admin", "POST", `/admin/manual-imports/${original.id}/auto-map`, { expectedRevision: 2 })).statusCode, 409);
  const reply = await call("admin", "POST", `/admin/manual-imports/${original.id}/auto-map`, { expectedRevision: 1 });
  assert.equal(reply.statusCode, 200, reply.body);
  const mapped = reply.json<ManualImport>();
  assert.equal(mapped.revision, 2);
  assert.equal(mapped.rows[0]?.catalogProjectId, "ref-spark-plug");
  assert.equal(mapped.rows[1]?.projectId, "project-cabin");
  assert.equal((await list<Project>(service.db, "projects")).length, beforeCount);
  assert.equal((await call("admin", "POST", `/admin/manual-imports/${original.id}/auto-map`, { expectedRevision: 1 })).statusCode, 409);
});

test("concurrent reference publication creates one canonical project and later jobs reuse it", async () => {
  const originals = [];
  for (let index = 0; index < 2; index++) {
    const target = await model();
    originals.push(await job(target, [row({ catalogProjectId: "ref-spark-plug" })]));
  }
  const replies = await Promise.all(originals.map(original => call("admin", "POST", `/admin/manual-imports/${original.id}/publish`, { expectedRevision: 1, verified: true, applicabilityConfirmed: true })));
  let actualProjectId = "";
  for (const reply of replies) {
    assert.equal(reply.statusCode, 200, reply.body);
    const published = reply.json<ManualImport>();
    const rules = await list<{ id: string; projectId: string }>(service.db, "rules");
    const rule = rules.find(item => published.publishedRuleIds.includes(item.id))!;
    assert(rule, "each concurrently published import must produce a rule");
    if (actualProjectId) assert.equal(rule.projectId, actualProjectId);
    actualProjectId = rule.projectId;
  }
  const later = await job(await model(), [row({ catalogProjectId: "ref-spark-plug" })]);
  const laterReply = await call("admin", "POST", `/admin/manual-imports/${later.id}/publish`, { expectedRevision: 1, verified: true, applicabilityConfirmed: true });
  assert.equal(laterReply.statusCode, 200, laterReply.body);
  const laterPublished = laterReply.json<ManualImport>();
  const laterRule = (await list<{ id: string; projectId: string }>(service.db, "rules")).find(item => laterPublished.publishedRuleIds.includes(item.id));
  assert.equal(laterRule?.projectId, actualProjectId);
  const actual = await get<Project>(service.db, "projects", actualProjectId);
  assert.equal(actual?.name, "更换火花塞");
  assert.equal(actual?.catalogSource?.catalogId, "ref-spark-plug");
  assert.equal((await list<Project>(service.db, "projects")).filter(item => item.catalogSource?.catalogId === "ref-spark-plug").length, 1);
  assert(catalogProjects.some(item => item.id === actual?.catalogSource?.catalogId));
});

test("reference publication reuses an equivalent human-created alias rather than duplicating it", async () => {
  const alias = project({ id: "human-brake-fluid", code: "HUMAN-BRAKE-FLUID", name: "刹车液检查", description: "检查制动液状态" });
  await put(service.db, "projects", alias);
  const target = await model();
  const original = await job(target, [row({ name: "制动液", action: "inspect", catalogProjectId: "ref-brake-fluid-inspection" })]);
  const reply = await call("admin", "POST", `/admin/manual-imports/${original.id}/publish`, { expectedRevision: 1, verified: true, applicabilityConfirmed: true });
  assert.equal(reply.statusCode, 200, reply.body);
  const published = reply.json<ManualImport>();
  const rule = (await list<{ id: string; projectId: string }>(service.db, "rules")).find(item => published.publishedRuleIds.includes(item.id));
  assert.equal(rule?.projectId, alias.id);
  assert.equal((await list<Project>(service.db, "projects")).filter(item => item.catalogSource?.catalogId === "ref-brake-fluid-inspection").length, 0);
});

test("reference publication rejects action conflicts and duplicate mappings without partial writes", async () => {
  const target = await model();
  const invalid = await job(target, [row({ catalogProjectId: "ref-brake-fluid-replace", action: "inspect", name: "检查制动液" })]);
  const before = (await list<Project>(service.db, "projects")).length;
  const reply = await call("admin", "POST", `/admin/manual-imports/${invalid.id}/publish`, { expectedRevision: 1, verified: true, applicabilityConfirmed: true });
  assert.equal(reply.statusCode, 400);
  assert.equal(reply.json().error.code, "PROJECT_ACTION_MISMATCH");
  const duplicate = await job(target, [row({ catalogProjectId: "ref-brake-fluid-replace", name: "制动液" }), row({ id: "duplicate", catalogProjectId: "ref-brake-fluid-replace", name: "制动液" })]);
  assert.equal((await call("admin", "POST", `/admin/manual-imports/${duplicate.id}/publish`, { expectedRevision: 1, verified: true, applicabilityConfirmed: true })).statusCode, 400);
  assert.equal((await list<Project>(service.db, "projects")).length, before);
  assert.equal((await get<ManualImport>(service.db, "manual_imports", duplicate.id))?.status, "awaiting_confirmation");
  const mixed = await job(target, [row()]);
  const response = await call("admin", "PATCH", `/admin/manual-imports/${mixed.id}/draft`, { expectedRevision: 1, rows: [row({ projectId: "project-cabin", catalogProjectId: "ref-cabin-filter", createProject: true })], sourceTitle: mixed.sourceTitle, sourceUrl: mixed.sourceUrl, edition: mixed.edition, applicability: mixed.applicability });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "PROJECT_MAPPING_CONFLICT");
  assert.equal((await get<ManualImport>(service.db, "manual_imports", mixed.id))?.revision, 1);
  const conflicting = await job(target, [row({ name: "检查空调滤清器", projectId: "project-cabin", action: "inspect" })]);
  const actionConflict = await call("admin", "POST", `/admin/manual-imports/${conflicting.id}/publish`, { expectedRevision: 1, verified: true, applicabilityConfirmed: true });
  assert.equal(actionConflict.statusCode, 400);
  assert.equal(actionConflict.json().error.code, "PROJECT_ACTION_MISMATCH");
});

test("model deletion is admin-only, audited and restricted to unused models", async () => {
  const unused = await model();
  assert.equal((await call("owner", "DELETE", `/admin/models/${unused.id}`)).statusCode, 403);
  const removed = await call("admin", "DELETE", `/admin/models/${unused.id}`);
  assert.equal(removed.statusCode, 200, removed.body);
  assert.deepEqual(removed.json(), { deleted: true, id: unused.id });
  assert.equal(await get(service.db, "models", unused.id), undefined);
  assert((await list<{ action: string; targetId: string }>(service.db, "logs")).some(log => log.action === "model.deleted"));
  assert.equal((await call("admin", "DELETE", `/admin/models/${unused.id}`)).statusCode, 404);
  for (const table of ["vehicles", "offers", "offer_versions", "rules", "manual_imports"] as const) {
    const used = await model();
    const refId = `reference-${++number}`;
    await put(service.db, table, { id: refId, modelId: used.id });
    const response = await call("admin", "DELETE", `/admin/models/${used.id}`);
    assert.equal(response.statusCode, 409, table);
    assert.equal(response.json().error.code, "MODEL_IN_USE", table);
    assert(await get(service.db, "models", used.id));
    assert(await get(service.db, table, refId));
    await remove(service.db, table, refId);
  }
  const racing = await model();
  const [creation, deletion] = await Promise.all([
    call("owner", "POST", "/vehicles", { modelId: racing.id, plate: "合成并发删除测试", name: "合成车辆", startDate: "2024-01-01", initialKm: 0 }),
    call("admin", "DELETE", `/admin/models/${racing.id}`),
  ]);
  assert([200, 400].includes(creation.statusCode), creation.body);
  assert([200, 409].includes(deletion.statusCode), deletion.body);
  if (creation.statusCode === 200) {
    assert.equal(deletion.statusCode, 409);
    assert(await get(service.db, "models", racing.id));
  } else {
    assert.equal(deletion.statusCode, 200);
    assert.equal((await list<{ modelId: string }>(service.db, "vehicles")).filter(item => item.modelId === racing.id).length, 0);
  }
});
