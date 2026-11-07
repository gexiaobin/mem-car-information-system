import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import type { AuditLog, CatalogProject, Project } from "@autovoyage/shared";
import { loadConfig } from "../src/config.js";
import { connectDatabase, get, list, put, type Database } from "../src/db.js";
import {
  planProjectSimplification, runProjectSimplification, simplificationSourceVersion,
  type ProjectSimplificationInput, type ProjectSimplificationReport,
} from "../src/project-simplification.js";

const template = (id: string): CatalogProject => ({
  id: `ref-${id}`, code: `CODE-${id}`, name: `测试服务${id}`, category: "保养",
  description: `模板说明${id}`, unit: "次", action: "inspect", sourceIds: ["source-test"],
});
const imported = (entry: CatalogProject, overrides: Partial<Project> = {}): Project => ({
  id: `project-${entry.id}`, code: entry.code, name: entry.name, category: entry.category,
  description: entry.description, unit: entry.unit, active: true,
  catalogSource: { catalogId: entry.id, version: simplificationSourceVersion, sources: [], importedAt: "2026-11-05T00:00:00.000Z" },
  ...overrides,
});
const general = template("general");
function input(entries: CatalogProject[], projects = entries.map(entry => imported(entry))): ProjectSimplificationInput {
  return { catalogProjects: [general, ...entries], generalProjects: [general], projects,
    businessRecords: {}, logs: [] };
}

test("plan only pauses untouched active non-general projects from the target import version", () => {
  const entries = ["candidate", "manual", "name", "code", "category", "description", "unit", "inactive", "version", "unknown", "audit", "duplicate"].map(template);
  const projects = entries.map(entry => imported(entry));
  delete projects[1].catalogSource;
  projects[2].name += " 已编辑";
  projects[3].code += "-EDIT";
  projects[4].category = "人工分类";
  projects[5].description += " 已补充";
  projects[6].unit = "件";
  projects[7].active = false;
  projects[8].catalogSource!.version = "2026-11-01.1";
  projects[9].catalogSource!.catalogId = "ref-not-in-snapshot";
  projects.push(imported(general), imported(entries[11], { id: "duplicate-claim" }));
  const source = input(entries, projects);
  source.logs = [{ entityType: "project", entityId: projects[10].id, action: "project.updated" }];
  const unchanged = JSON.stringify(source);
  const plan = planProjectSimplification(source);
  assert.deepEqual(plan.candidates.map(project => project.id), [projects[0].id]);
  assert.equal(plan.total, projects.length);
  assert.equal(plan.activeBefore, projects.length - 1);
  assert.equal(plan.activeAfter, projects.length - 2);
  assert.equal(plan.preserved.filter(project => project.reason === "modified").length, 6);
  assert.equal(plan.preserved.filter(project => project.reason === "ambiguous-import").length, 2);
  assert.equal(plan.preserved.find(project => project.id === imported(general).id)?.reason, "general");
  assert.equal(JSON.stringify(source), unchanged, "planning must not mutate any input");
  plan.candidates[0].description = "changed report copy";
  assert.equal(JSON.stringify(source), unchanged, "report snapshots must not alias project inputs");
});

test("protects current, historical, nested snapshot and object-key references, including manual catalog selections", () => {
  const cases: [string, (project: Project) => unknown][] = [
    ["models", project => ({ applicableProjectIds: [project.id] })],
    ["rules", project => ({ projectId: project.id, supersededBy: "historical-rule" })],
    ["offers", project => ({ projectId: project.id, active: false })],
    ["offer_versions", project => ({ projectId: project.id, version: 1 })],
    ["appointments", project => ({ snapshot: [{ projectId: project.id }] })],
    ["appointments", project => ({ approvedSnapshot: [{ projectId: project.id }] })],
    ["appointments", project => ({ completedProjectIds: [project.id] })],
    ["appointments", project => ({ approvedProjectIds: [project.id] })],
    ["changes", project => ({ proposedProjectIds: [project.id] })],
    ["changes", project => ({ proposedSnapshot: [{ projectId: project.id }] })],
    ["records", project => ({ projectId: project.id })],
    ["manual_imports", project => ({ rows: [{ projectId: project.id }] })],
    ["manual_imports", project => ({ rows: [{ projectId: null, catalogProjectId: project.catalogSource!.catalogId }] })],
    ["manual_imports", project => ({ baseRuleVersions: { [project.id]: 2 } })],
  ];
  const entries = cases.map((_, index) => template(String(index)));
  const projects = entries.map(entry => imported(entry));
  const source = input(entries, projects);
  const businessRecords: Record<string, unknown[]> = {};
  cases.forEach(([table, record], index) => (businessRecords[table] ||= []).push(record(projects[index])));
  source.businessRecords = businessRecords;
  const plan = planProjectSimplification(source);
  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.preserved.length, cases.length);
  assert(plan.preserved.every(project => project.reason === "referenced" && project.referenceTables?.length === 1));
});

test("import audits and substring text do not block cleanup; edited audits do", () => {
  const entry = template("free");
  const project = imported(entry);
  const source = input([entry], [project]);
  source.logs = [{ entityType: "project", entityId: project.id, action: "catalog.project.imported" }];
  source.businessRecords = {
    logs: [{ entityId: project.id }], releases: [{ projectId: project.id }], projects: [{ id: project.id }],
    manual_imports: [{ sourceText: `参考项目 ${project.id} 原文` }],
  };
  assert.equal(planProjectSimplification(source).candidates.length, 1);
  source.logs = [...source.logs, { entityType: "project", entityId: project.id, action: "project.updated" }];
  assert.equal(planProjectSimplification(source).candidates.length, 0);
});

test("plans are deterministic and a completed pause is idempotent", () => {
  const entries = [template("a"), template("b")];
  const source = input(entries);
  const plan = planProjectSimplification(source);
  assert.equal(plan.digest, planProjectSimplification({ ...source, projects: [...source.projects].reverse(), catalogProjects: [...source.catalogProjects].reverse() }).digest);
  const paused = planProjectSimplification({ ...source, projects: source.projects.map(project => ({ ...project, active: false })) });
  assert.equal(paused.candidates.length, 0);
  assert.equal(paused.activeAfter, 0);
  assert.notEqual(paused.digest, plan.digest);
  assert.throws(() => planProjectSimplification({ ...source, generalProjects: [] }), /通用目录不能为空/);
});

test("transactional runner is read-only by default, preserves references, audits a real admin and rolls back failures", async () => {
  const base = loadConfig({ production: false, seedDemo: false, sessionSecret: "simplification-isolated-test-secret-32-chars" });
  let control: pg.Client | undefined;
  let schema: string | undefined;
  let db: Database | undefined;
  try {
    if (process.env.AV_SIMPLIFICATION_PG_TEST === "1") {
      const { schema: _, ...connection } = base.pg;
      assert(connection.password, "isolated PostgreSQL test requires configured credentials");
      control = new pg.Client({ ...connection, connectionTimeoutMillis: 10000 });
      await control.connect();
      schema = `av_test_simplify_${randomBytes(8).toString("hex")}`;
      assert(/^av_test_simplify_[a-f0-9]{16}$/.test(schema));
      await control.query(`CREATE SCHEMA "${schema}"`);
    }
    db = await connectDatabase(loadConfig({ ...base, driver: schema ? "postgres" : "pglite", pglitePath: ":memory:",
      pg: { ...base.pg, schema: schema || base.pg.schema } }));
    await db.migrate();
    await put(db, "users", { id: "admin-test", role: "platform_admin", active: true });
    const free = template("free");
    const linked = template("linked");
    const freeProject = imported(free);
    const linkedProject = imported(linked);
    await put(db, "projects", freeProject);
    await put(db, "projects", linkedProject);
    await put(db, "rules", { id: "old-rule", projectId: linkedProject.id, supersededBy: "new-rule" });
    const settings = { catalogProjects: [general, free, linked], generalProjects: [general] };
    const preview = await runProjectSimplification(db, { ...settings, apply: false });
    assert.equal(preview.status, "dry-run");
    assert.deepEqual(preview.plan.candidates, [freeProject]);
    assert.equal((await get<Project>(db, "projects", freeProject.id))?.active, true);
    assert.equal((await list(db, "logs")).length, 0);
    let prepared: ProjectSimplificationReport | undefined;
    const applied = await runProjectSimplification(db, { ...settings, apply: true, expectedDigest: preview.plan.digest,
      beforeApply: async report => { prepared = report; } });
    assert.equal(prepared?.status, "prepared");
    assert.deepEqual(prepared?.plan.candidates, [freeProject]);
    assert.equal(applied.status, "applied");
    assert.deepEqual(await get(db, "projects", freeProject.id), { ...freeProject, active: false });
    assert.deepEqual(await get(db, "projects", linkedProject.id), linkedProject);
    const logs = await list<AuditLog>(db, "logs");
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actorId, "admin-test");
    assert.equal(logs[0].action, "project.simplified");
    const repeat = await runProjectSimplification(db, { ...settings, apply: true, beforeApply: async () => {} });
    assert.equal(repeat.plan.candidates.length, 0);
    assert.equal((await list(db, "logs")).length, 1, "idempotence includes audit writes");

    await put(db, "projects", freeProject);
    await assert.rejects(() => runProjectSimplification(db!, { ...settings, apply: true }), /持久保存/);
    await assert.rejects(() => runProjectSimplification(db!, { ...settings, apply: true, expectedDigest: "0".repeat(64), beforeApply: async () => {} }), /摘要不一致/);
    await assert.rejects(() => runProjectSimplification(db!, { ...settings, apply: true, beforeApply: async () => { throw new Error("local disk failed"); } }), /local disk failed/);
    assert.deepEqual(await get(db, "projects", freeProject.id), freeProject);
    assert.equal((await list(db, "logs")).length, 1);

    const another = template("another");
    const anotherProject = imported(another);
    await put(db, "projects", anotherProject);
    let auditWrites = 0;
    const failingDb: Database = { ...db, transaction: work => db!.transaction(sql => work({ query: async (query, params) => {
      if (query.startsWith("INSERT INTO av_logs") && ++auditWrites === 2) throw new Error("synthetic audit write failure");
      return sql.query(query, params);
    } })) };
    await assert.rejects(() => runProjectSimplification(failingDb, { ...settings, catalogProjects: [...settings.catalogProjects, another], apply: true,
      beforeApply: async () => {} }), /synthetic audit write failure/);
    assert.deepEqual(await get(db, "projects", freeProject.id), freeProject);
    assert.deepEqual(await get(db, "projects", anotherProject.id), anotherProject);
    assert.equal((await list(db, "logs")).length, 1, "a partial project/audit batch must roll back");

    await put(db, "users", { id: "disabled-admin", role: "platform_admin", active: false });
    assert.equal((await runProjectSimplification(db, { ...settings, apply: false })).actorId, "admin-test");
    await put(db, "users", { id: "other-admin", role: "platform_admin", active: true });
    await assert.rejects(() => runProjectSimplification(db!, { ...settings, apply: false }), /唯一已启用/);
    await assert.rejects(() => runProjectSimplification(db!, { ...settings, apply: false, actorId: "disabled-admin" }), /已启用的平台管理员/);
    assert.equal((await runProjectSimplification(db, { ...settings, apply: false, actorId: "other-admin" })).actorId, "other-admin");
  } finally {
    await db?.close();
    if (schema && control) {
      assert(/^av_test_simplify_[a-f0-9]{16}$/.test(schema));
      await control.query(`DROP SCHEMA "${schema}" CASCADE`);
      assert.equal((await control.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).rowCount, 0);
    }
    await control?.end();
  }
});
