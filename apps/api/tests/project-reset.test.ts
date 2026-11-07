import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import type { MaintenanceRule, ManualImport, Offer, Project, ServiceRecord } from "@autovoyage/shared";
import { loadConfig } from "../src/config.js";
import { connectDatabase, list, put, tables, type Database, type Table } from "../src/db.js";
import { catalogSources, catalogVersion, legacyGeneralCatalogProjects } from "../src/data/public-catalog.js";
import { generalProjectId, planProjectReset, runProjectReset, type ProjectResetReport, type ProjectResetSnapshot } from "../src/project-reset.js";

const settings = { generalProjects: legacyGeneralCatalogProjects, sources: catalogSources, catalogVersion };
const project = (id: string, name: string, description: string, category = "保养"): Project => ({ id, name, description, category, code: id.toUpperCase(), unit: "次", active: true });
const rule = (id: string, projectId: string, modelId: string, extra: Partial<MaintenanceRule> = {}): MaintenanceRule => ({ id, projectId, modelId,
  intervalMonths: 12, intervalKm: 10000, firstMonths: 6, firstKm: 5000, mileageType: "total_km", sourceTitle: "合成原始规则",
  sourceUrl: "https://example.com/manual", version: 1, verified: true, isDemo: false, ...extra });
const offer = (id: string, projectId: string, extra: Partial<Offer> = {}): Offer => ({ id, projectId, modelId: "model-a", storeId: "store-a", title: "合成原始服务",
  materialSpec: "原始材料规格", includes: "原始范围", excludes: "原始除外", taxIncluded: true, priceType: "fixed", materialCents: 12300,
  laborCents: 4560, otherCents: 7, totalCents: 16867, lowCents: null, highCents: null, version: 1, validFrom: "2026-01-01", validTo: "2026-12-31", active: true, isDemo: false, ...extra });
const manual = (id: string, extra: Partial<ManualImport & { baseRuleVersions: Record<string, number>; publicationHash: string }> = {}): ManualImport => ({
  id, createdBy: "admin", modelId: "model-b", sourceTitle: "合成保养手册", sourceUrl: "https://example.com/manual", edition: "2026", applicability: "合成车型",
  status: "awaiting_confirmation", files: [], rows: [], warnings: [], reason: "原始原因", revision: 3, createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z", publishedAt: null, publishedRuleIds: [], aiModel: "synthetic", ...extra,
});
function fixture(): ProjectResetSnapshot {
  const s = Object.fromEntries(tables.map(table => [table, []])) as unknown as ProjectResetSnapshot;
  s.users = [{ id: "admin", role: "platform_admin", active: true }];
  s.projects = [project("old-oil", "机油与机滤", "更换发动机机油与机油滤清器"), project("old-cabin", "空调滤清器", "更换空调滤芯并检查安装密封"),
    project("old-spark", "火花塞", "铱金材质寿命较长"), project("old-brake", "制动系统检查", "检查制动片、制动盘及相关管路"),
    project("old-diagnosis", "故障到店诊断", "到店检查故障", "diagnosis"), project("old-inspection", "检查发动机空气滤芯", "检查滤芯状态"),
    { ...project("old-paused", "专项维修", "原始停用说明"), active: false }];
  s.models = [{ id: "model-a", isDemo: true, applicableProjectIds: ["old-oil", "old-cabin", "old-brake"] }, { id: "model-b", isDemo: false, applicableProjectIds: ["old-spark"] }];
  s.rules = [rule("oil-rule", "old-oil", "model-a", { isDemo: true }), rule("spark-rule", "old-spark", "model-b", { action: "replace", manualImportId: "published" }),
    rule("brake-rule", "old-brake", "model-a", { isDemo: true })];
  const oilOffer = offer("oil-offer", "old-oil"), diagnosis = offer("diagnosis-offer", "old-diagnosis", { isDemo: true });
  s.offers = [oilOffer, diagnosis];
  s.offer_versions = [{ ...oilOffer, id: "oil-offer:1", offerId: "oil-offer" }, { ...diagnosis, id: "diagnosis-offer:1", offerId: "diagnosis-offer" }];
  s.records = [{ id: "unchanged:old-oil", vehicleId: "vehicle-a", appointmentId: "completed", projectId: "old-oil", completedAt: "2026-01-01", totalKm: 12345, source: "原始记录", totalCents: 16867 } satisfies ServiceRecord];
  s.manual_imports = [manual("published", { status: "published", publishedRuleIds: ["spark-rule"], publicationHash: "original-hash", baseRuleVersions: {} }),
    manual("draft", { rows: [{ id: "inspection-row", name: "检查发动机空气滤芯", projectId: "old-inspection", catalogProjectId: null, createProject: false,
      include: false, action: "inspect", triggerType: "periodic", firstMonths: 3, firstKm: 5000, intervalMonths: 6, intervalKm: 10000,
      mileageType: "total_km", condition: "原始条件", notes: "原始备注", sourceText: "原文 old-inspection 不是项目标识字段", pageNumbers: [2] }], baseRuleVersions: { "old-oil": 1 } })];
  return s;
}

test("reset preview requires explicit demo cleanup, retains a complete snapshot and does not mutate input", () => {
  const s = fixture(), before = structuredClone(s);
  const blocked = planProjectReset(s, settings);
  assert(blocked.blockers.some(message => message.includes("--clear-unmatched-demo")));
  const plan = planProjectReset(s, { ...settings, clearUnmatchedDemo: true });
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.newProjects.length, 25);
  assert(plan.newProjects.every(project => project.active && project.catalogSource?.sources.length));
  assert.equal(plan.afterCounts.projects, 25);
  assert.deepEqual(plan.deletes.projects?.sort(), (s.projects as Project[]).map(project => project.id).sort());
  assert.deepEqual(plan.deletes.rules, ["brake-rule"]);
  assert.deepEqual(plan.deletes.offers, ["diagnosis-offer"]);
  assert.deepEqual(plan.deletes.offer_versions, ["diagnosis-offer:1"]);
  assert.deepEqual(s, before);
  assert.equal(plan.digest, planProjectReset({ ...s, projects: [...s.projects].reverse() }, { ...settings, clearUnmatchedDemo: true }).digest);
  assert.notEqual(plan.digest, blocked.digest, "cleanup policy is part of reviewed plan identity");
});

test("exact remapping preserves prices, periods, record IDs, original manual evidence and published hashes", () => {
  const s = fixture(), plan = planProjectReset(s, { ...settings, clearUnmatchedDemo: true });
  const oilTarget = generalProjectId("ref-engine-oil-filter");
  assert.deepEqual(plan.writes.offers?.find(row => row.id === "oil-offer"), { ...(s.offers[0] as Offer), projectId: oilTarget });
  assert.deepEqual(plan.writes.rules?.find(row => row.id === "oil-rule"), { ...(s.rules[0] as MaintenanceRule), projectId: oilTarget });
  assert.deepEqual(plan.writes.records?.[0], { ...(s.records[0] as ServiceRecord), projectId: oilTarget });
  const spark = plan.mappings.find(item => item.oldId === "old-spark");
  assert.equal(spark?.newId, generalProjectId("ref-spark-plug"));
  assert(spark?.evidence.startsWith("published-rule-action:"));
  const draft = plan.writes.manual_imports?.find(row => row.id === "draft") as ManualImport & { baseRuleVersions: Record<string, number> };
  const original = s.manual_imports[1] as ManualImport;
  assert.deepEqual(draft.rows[0], { ...original.rows[0], projectId: null, catalogProjectId: null, createProject: false });
  assert.equal(draft.rows[0].include, false);
  assert.equal(draft.revision, original.revision + 1);
  assert.equal(draft.warnings.length, 1);
  assert.deepEqual(draft.baseRuleVersions, { [oilTarget]: 1 });
  assert(!plan.writes.manual_imports?.some(row => row.id === "published"), "unchanged publication stays byte-equivalent");
});

test("reset blocks formal deletion, changed actions, frozen bookings, dangling references and merge collisions", () => {
  const settingsWithClear = { ...settings, clearUnmatchedDemo: true };
  const formal = fixture(); (formal.offers[1] as Offer).isDemo = false;
  assert(planProjectReset(formal, settingsWithClear).blockers.some(message => message.includes("正式资料不得清除")));
  const scope = fixture(); (scope.models[0] as { isDemo: boolean }).isDemo = false;
  assert(planProjectReset(scope, settingsWithClear).blockers.some(message => message.includes("不能静默缩减正式车型范围")));
  const unknown = fixture(); unknown.faults = [{ id: "fault", projectId: "old-inspection" }];
  assert(planProjectReset(unknown, settingsWithClear).blockers.some(message => message.includes("faults中仍有")));
  const booked = fixture(); booked.appointments = [{ id: "appointment", snapshot: [{ offerId: "diagnosis-offer", projectId: "old-diagnosis" }] }];
  assert(planProjectReset(booked, settingsWithClear).blockers.some(message => message.includes("冻结快照")));
  const record = fixture(); record.records.push({ ...(record.records[0] as ServiceRecord), id: "second", projectId: "old-spark" });
  // Two distinct old aliases collapse into the same semantic target.
  const oilAlias = project("oil-alias", "更换发动机机油及机油滤清器", "更换机油与机滤");
  record.projects.push(oilAlias);
  record.records.push({ ...(record.records[0] as ServiceRecord), id: "third", projectId: oilAlias.id });
  assert(planProjectReset(record, settingsWithClear).blockers.some(message => message.includes("记录在项目归并后")));
  const rules = fixture(); rules.projects.push(oilAlias); rules.rules.push(rule("duplicate", oilAlias.id, "model-a"));
  assert(planProjectReset(rules, settingsWithClear).blockers.some(message => message.includes("规则归并后")));
  const offers = fixture(); offers.projects.push(oilAlias); offers.offers.push(offer("overlap", oilAlias.id));
  assert(planProjectReset(offers, settingsWithClear).blockers.some(message => message.includes("有效期重叠")));
  const noAction = fixture(); (noAction.rules[1] as MaintenanceRule).action = "inspect";
  assert(planProjectReset(noAction, settingsWithClear).blockers.some(message => message.includes("正式资料不得清除")));
});

test("runner snapshots before mutation, requires reviewed digest, rolls back partial failures and is idempotent", async () => {
  const base = loadConfig({ production: false, seedDemo: false, sessionSecret: "reset-service-isolated-test-secret-32-chars" });
  let control: pg.Client | undefined, schema: string | undefined, db: Database | undefined;
  try {
    if (process.env.AV_RESET_PG_TEST === "1") {
      const { schema: _, ...connection } = base.pg;
      control = new pg.Client({ ...connection, connectionTimeoutMillis: 10000 }); await control.connect();
      schema = `av_test_reset_${randomBytes(8).toString("hex")}`;
      assert(/^av_test_reset_[a-f0-9]{16}$/.test(schema)); await control.query(`CREATE SCHEMA "${schema}"`);
    }
    db = await connectDatabase(loadConfig({ ...base, driver: schema ? "postgres" : "pglite", pglitePath: ":memory:", pg: { ...base.pg, schema: schema || base.pg.schema } }));
    await db.migrate();
    const source = fixture();
    for (const table of tables) for (const entity of source[table]) await put(db, table, entity as { id: string });
    const options = { ...settings, clearUnmatchedDemo: true };
    const preview = await runProjectReset(db, { ...options, apply: false });
    assert.equal(preview.status, "dry-run"); assert.deepEqual(preview.plan.blockers, []);
    assert.deepEqual(await list(db, "projects"), [...source.projects].sort((a, b) => (a as Project).id.localeCompare((b as Project).id)));
    assert.equal((await list(db, "logs")).length, 0);
    await assert.rejects(() => runProjectReset(db!, { ...options, apply: true }), /摘要并保存完整/);
    await assert.rejects(() => runProjectReset(db!, { ...options, apply: true, expectedDigest: "0".repeat(64), beforeApply: async () => {} }), /计划摘要已变化/);
    await assert.rejects(() => runProjectReset(db!, { ...options, apply: true, expectedDigest: preview.plan.digest, beforeApply: async () => { throw new Error("snapshot disk failure"); } }), /snapshot disk failure/);
    const failing: Database = { ...db, transaction: work => db!.transaction(sql => work({ query: async (query, params) => {
      if (query.startsWith("INSERT INTO av_logs")) throw new Error("audit failure"); return sql.query(query, params);
    } })) };
    await assert.rejects(() => runProjectReset(failing, { ...options, apply: true, expectedDigest: preview.plan.digest, beforeApply: async () => {} }), /audit failure/);
    assert.equal((await list(db, "projects")).length, source.projects.length);
    assert.equal((await list(db, "offers")).length, source.offers.length);
    let prepared: ProjectResetReport | undefined;
    const applied = await runProjectReset(db, { ...options, apply: true, expectedDigest: preview.plan.digest, beforeApply: async report => { prepared = report; } });
    assert.equal(prepared?.status, "prepared"); assert.deepEqual(prepared?.snapshot, preview.snapshot);
    assert.equal(applied.status, "applied");
    const final = await list<Project>(db, "projects"); assert.equal(final.length, 25); assert(final.every(project => project.active));
    assert.equal((await list(db, "offers")).length, 1); assert.equal((await list(db, "rules")).length, 2); assert.equal((await list(db, "records")).length, 1);
    const logs = await list<{ actorId: string; action: string }>(db, "logs"); assert.deepEqual(logs.map(log => [log.actorId, log.action]), [["admin", "projects.reset"]]);
    const repeat = await runProjectReset(db, { ...options, apply: false }); assert.equal(repeat.plan.changed, false); assert.deepEqual(repeat.plan.blockers, []);
    await runProjectReset(db, { ...options, apply: true, expectedDigest: repeat.plan.digest, beforeApply: async () => {} });
    assert.equal((await list(db, "logs")).length, 1);
    await put(db, "users", { id: "other-admin", role: "platform_admin", active: true });
    await assert.rejects(() => runProjectReset(db!, { ...options, apply: false }), /真实平台管理员/);
    assert.equal((await runProjectReset(db, { ...options, apply: false, actorId: "other-admin" })).actorId, "other-admin");
  } finally {
    await db?.close();
    if (schema && control) { assert(/^av_test_reset_[a-f0-9]{16}$/.test(schema)); await control.query(`DROP SCHEMA "${schema}" CASCADE`);
      assert.equal((await control.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).rowCount, 0); }
    await control?.end();
  }
});
