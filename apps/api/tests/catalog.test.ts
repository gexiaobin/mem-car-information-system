import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import type { CarModel, CatalogModelImportResult, CatalogModelsResponse, CatalogProject, CatalogProjectImportResult, CatalogProjectsResponse, Project } from "@autovoyage/shared";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { get, list, put } from "../src/db.js";
import { maintenanceFor } from "../src/domain.js";
import { catalogModels, catalogProjects, catalogSources, catalogVersion } from "../src/data/public-catalog.js";

const origin = "http://localhost:5173";
const password = "CatalogIntegrationTest2026!";
let service: Awaited<ReturnType<typeof createApp>>;
let control: pg.Client | undefined;
let schema: string | undefined;
let temporary: string;
let freshProjects: CatalogProject[];
const cookies: Record<string, string> = {};
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "autovoyage-catalog-"));
  const base = loadConfig({ production: false, seedDemo: false, sessionSecret: "catalog-test-secret-at-least-32-characters" });
  if (process.env.AV_CATALOG_PG_TEST === "1") {
    const { schema: _, ...connection } = base.pg;
    assert(connection.password, "PostgreSQL catalog tests require configured credentials");
    control = new pg.Client({ ...connection, connectionTimeoutMillis: 10000 });
    await control.connect();
    schema = `av_test_catalog_${randomBytes(8).toString("hex")}`;
    assert(/^av_test_catalog_[a-f0-9]{16}$/.test(schema));
    await control.query(`CREATE SCHEMA "${schema}"`);
  }
  service = await createApp({ config: loadConfig({
    production: false, driver: schema ? "postgres" : "pglite", pglitePath: ":memory:",
    pg: { ...base.pg, schema: schema || base.pg.schema }, seedDemo: true, demoMode: true,
    demoPassword: password, sessionSecret: "catalog-test-secret-at-least-32-characters",
    uploadDir: temporary, aiBaseUrl: "", aiKey: "", aiModel: "", origin,
  }) });
  const initialProjects = await list<Project>(service.db, "projects");
  freshProjects = catalogProjects.filter(entry => !initialProjects.some(project => project.code === entry.code || project.name === entry.name));
  assert(freshProjects.length >= 5, "catalog test requires five non-demo project templates");
  for (const [key, email] of Object.entries({ owner: "owner@autovoyage.demo", store: "store@autovoyage.demo", expert: "expert@autovoyage.demo", admin: "admin@autovoyage.demo" })) {
    const response = await service.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { origin }, payload: { email, password } });
    assert.equal(response.statusCode, 200, response.body);
    cookies[key] = String(response.headers["set-cookie"]).split(";")[0];
  }
});
after(async () => {
  await service?.app.close();
  if (schema && control) {
    assert(/^av_test_catalog_[a-f0-9]{16}$/.test(schema));
    await control.query(`DROP SCHEMA "${schema}" CASCADE`);
    assert.equal((await control.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).rowCount, 0);
  }
  await control?.end();
  if (temporary) await rm(temporary, { recursive: true, force: true });
});
const call = (who: string, method: "GET" | "POST" | "PATCH", path: string, payload?: unknown) => service.app.inject({ method, url: `/api/v1${path}`, headers: { origin, cookie: cookies[who] || "" }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
const modelInput = (index: number, year: number) => ({ catalogId: catalogModels[index].id, year, power: "合成测试纯电 60 kWh 配置" });

test("bundled candidates have traceable sources and do not auto-populate operational data", async () => {
  assert(catalogModels.length > 0 && catalogProjects.length > 0 && catalogSources.length > 0);
  assert.equal(new Set(catalogModels.map(model => model.id)).size, catalogModels.length);
  assert.equal(new Set(catalogProjects.map(project => project.code)).size, catalogProjects.length);
  assert(catalogSources.every(source => new URL(source.url).protocol === "https:" && source.license && source.revision && source.retrievedAt));
  assert(catalogModels.every(model => !Object.hasOwn(model, "year") && !Object.hasOwn(model, "power")));
  assert(catalogProjects.every(project => !Object.hasOwn(project, "intervalKm") && !Object.hasOwn(project, "price")));
  assert.equal((await list<CarModel>(service.db, "models")).some(model => model.catalogSource), false);
  assert.equal((await list<Project>(service.db, "projects")).some(project => project.catalogSource), false);
});

test("catalog browsing and importing require a platform administrator", async () => {
  for (const who of ["anonymous", "owner", "store", "expert"]) {
    for (const [method, path, payload] of [
      ["GET", "/admin/catalog/models", undefined],
      ["GET", "/admin/catalog/projects", undefined],
      ["POST", "/admin/catalog/models/import", modelInput(0, 2026)],
      ["POST", "/admin/catalog/projects/import", { catalogIds: [catalogProjects[0].id] }],
    ] as const) {
      const response = await call(who, method, path, payload);
      assert.equal(response.statusCode, who === "anonymous" ? 401 : 403, response.body);
    }
  }
});

test("model search, brand filtering and bounded pagination stay within the matching set", async () => {
  const first = catalogModels[0];
  const response = await call("admin", "GET", `/admin/catalog/models?brand=${encodeURIComponent(first.brand)}&q=${encodeURIComponent(first.name)}&limit=1`);
  assert.equal(response.statusCode, 200, response.body);
  const page = response.json<CatalogModelsResponse>();
  assert.equal(page.version, catalogVersion);
  assert.equal(page.items.length, 1);
  assert(page.total >= 1 && page.items[0].brand === first.brand && page.brands.includes(first.brand));
  assert(page.sources.some(source => source.id === first.sourceId));
  const joined = await call("admin", "GET", `/admin/catalog/models?q=${encodeURIComponent(`${first.brand} ${first.name}`)}`);
  assert.equal(joined.statusCode, 200, joined.body);
  assert(joined.json<CatalogModelsResponse>().items.some(model => model.id === first.id));
  const empty = await call("admin", "GET", "/admin/catalog/models?q=__不存在的合成车型__");
  assert.equal(empty.json<CatalogModelsResponse>().total, 0);
  for (const query of ["limit=101", "offset=-1", "limit=1.5", "offset=100001"]) {
    assert.equal((await call("admin", "GET", `/admin/catalog/models?${query}`)).statusCode, 400);
  }
});

test("service templates are searchable by category and retain action and source distinctions", async () => {
  const entry = catalogProjects[0];
  const response = await call("admin", "GET", `/admin/catalog/projects?category=${encodeURIComponent(entry.category)}&q=${encodeURIComponent(entry.name)}`);
  assert.equal(response.statusCode, 200, response.body);
  const result = response.json<CatalogProjectsResponse>();
  assert(result.items.some(project => project.id === entry.id));
  assert(result.items.every(project => project.category === entry.category));
  assert.equal(result.items.find(project => project.id === entry.id)?.action, entry.action);
  assert(entry.sourceIds.every(id => result.sources.some(source => source.id === id)));
});

test("model import requires explicit variant fields and refuses forged metadata", async () => {
  for (const payload of [
    { catalogId: catalogModels[0].id },
    { ...modelInput(0, 2026), power: " " },
    { ...modelInput(0, 1800) },
    { ...modelInput(0, 2026), applicableProjectIds: ["engine-oil"] },
    { ...modelInput(0, 2026), catalogSource: { url: "https://forged.example/" } },
  ]) assert.equal((await call("admin", "POST", "/admin/catalog/models/import", payload)).statusCode, 400);
  assert.equal((await call("admin", "POST", "/admin/catalog/models/import", { ...modelInput(0, 2026), catalogId: "missing-catalog-model" })).statusCode, 404);
});

test("imported models remain without maintenance scope, schedules or offers until review", async () => {
  const beforeRules = await list(service.db, "rules");
  const beforeOffers = await list(service.db, "offers");
  const response = await call("admin", "POST", "/admin/catalog/models/import", modelInput(0, 2025));
  assert.equal(response.statusCode, 200, response.body);
  const { model, created } = response.json<CatalogModelImportResult>();
  assert(created && !model.isDemo);
  assert.equal(model.applicableProjectIds, undefined);
  assert.equal(model.catalogSource?.catalogId, catalogModels[0].id);
  assert.equal(model.catalogSource?.version, catalogVersion);
  assert.equal(model.catalogSource?.sources[0].id, catalogModels[0].sourceId);
  assert.deepEqual(await list(service.db, "rules"), beforeRules);
  assert.deepEqual(await list(service.db, "offers"), beforeOffers);
  const items = maintenanceFor({ id: "catalog-test-car", ownerId: "owner-demo", modelId: model.id, plate: "合成测试", name: "测试", startDate: "2025-01-01", initialKm: 0, totalKm: 10000, observedAt: null, isDemo: false }, await list(service.db, "projects"), [], [], new Date(), model);
  assert.equal(items.length, 1);
  assert.equal(items[0].status, "missing");
  assert.equal(items[0].scope, "vehicle");
  const secondVariant = await call("admin", "POST", "/admin/catalog/models/import", { ...modelInput(0, 2025), power: "合成测试插混 1.5T 配置" });
  assert.equal(secondVariant.statusCode, 200, secondVariant.body);
  assert(secondVariant.json<CatalogModelImportResult>().created);
  assert.notEqual(secondVariant.json<CatalogModelImportResult>().model.id, model.id);
});

test("concurrent catalog model imports reuse one record and preserve later administrator edits", async () => {
  const input = modelInput(0, 2024);
  const responses = await Promise.all([call("admin", "POST", "/admin/catalog/models/import", input), call("admin", "POST", "/admin/catalog/models/import", input)]);
  responses.forEach(response => assert.equal(response.statusCode, 200, response.body));
  const results = responses.map(response => response.json<CatalogModelImportResult>());
  assert.equal(results.filter(result => result.created).length, 1);
  assert.equal(results[0].model.id, results[1].model.id);
  const model = results[0].model;
  const changed = await call("admin", "PATCH", `/admin/models/${model.id}`, { name: "管理员核对后的合成配置名称" });
  assert.equal(changed.statusCode, 200, changed.body);
  const repeated = await call("admin", "POST", "/admin/catalog/models/import", input);
  assert.equal(repeated.json<CatalogModelImportResult>().created, false);
  assert.equal(repeated.json<CatalogModelImportResult>().model.name, "管理员核对后的合成配置名称");
  assert.deepEqual(repeated.json<CatalogModelImportResult>().model.catalogSource, model.catalogSource);
});

test("catalog model import reuses matching manually entered identity without overwriting its data", async () => {
  const entry = catalogModels[1];
  const existing: CarModel = { id: "catalog-manual-existing", brand: entry.brand, name: entry.name, year: 2023, power: "  合成 燃油 1.5T  ", isDemo: false, applicableProjectIds: [] };
  await put(service.db, "models", existing);
  const response = await call("admin", "POST", "/admin/catalog/models/import", { catalogId: entry.id, year: 2023, power: "合成燃油1.5T" });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json<CatalogModelImportResult>(), { model: existing, created: false });
});

test("ordinary model creation racing a catalog import cannot duplicate normalized identity", async () => {
  const entry = catalogModels[2];
  const variant = { brand: entry.brand, name: entry.name, year: 2022, power: "合成 插混 1.5T", isDemo: false };
  const results = await Promise.all([
    call("admin", "POST", "/admin/models", variant),
    call("admin", "POST", "/admin/catalog/models/import", { catalogId: entry.id, year: variant.year, power: "合成插混1.5T" }),
  ]);
  assert.equal(results[1].statusCode, 200, results[1].body);
  assert([200, 409].includes(results[0].statusCode), results[0].body);
  const matches = (await list<CarModel>(service.db, "models")).filter(model => model.brand === entry.brand && model.name === entry.name && model.year === 2022);
  assert.equal(matches.length, 1);
});

test("concurrent project imports are atomic, idempotent, and create no model scopes or rules", async () => {
  const entries = freshProjects.slice(0, 2);
  const models = await list(service.db, "models");
  const rules = await list(service.db, "rules");
  const responses = await Promise.all([
    call("admin", "POST", "/admin/catalog/projects/import", { catalogIds: entries.map(entry => entry.id) }),
    call("admin", "POST", "/admin/catalog/projects/import", { catalogIds: entries.map(entry => entry.id) }),
  ]);
  responses.forEach(response => assert.equal(response.statusCode, 200, response.body));
  const results = responses.map(response => response.json<CatalogProjectImportResult>());
  assert.equal(results.reduce((sum, result) => sum + result.created, 0), 2);
  assert.deepEqual(results[0].projects.map(project => project.id), results[1].projects.map(project => project.id));
  assert(results[0].projects.every(project => project.catalogSource?.sources.length && project.active));
  assert.deepEqual(await list(service.db, "models"), models);
  assert.deepEqual(await list(service.db, "rules"), rules);
  const first = results[0].projects[0];
  const update = await call("admin", "PATCH", `/admin/projects/${first.id}`, { name: "管理员定制服务名称", description: "已核对的服务范围", active: false });
  assert.equal(update.statusCode, 200, update.body);
  const repeated = await call("admin", "POST", "/admin/catalog/projects/import", { catalogIds: [entries[0].id, entries[0].id] });
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.equal(repeated.json<CatalogProjectImportResult>().created, 0);
  assert.equal(repeated.json<CatalogProjectImportResult>().existing, 1);
  assert.equal(repeated.json<CatalogProjectImportResult>().projects[0].name, "管理员定制服务名称");
  assert.equal(repeated.json<CatalogProjectImportResult>().projects[0].active, false);
});

test("invalid project selection cannot partially import a batch", async () => {
  const before = await list(service.db, "projects");
  const result = await call("admin", "POST", "/admin/catalog/projects/import", { catalogIds: [freshProjects[2].id, "missing-catalog-project"] });
  assert.equal(result.statusCode, 404, result.body);
  assert.deepEqual(await list(service.db, "projects"), before);
  assert.equal((await call("admin", "POST", "/admin/catalog/projects/import", { catalogIds: [] })).statusCode, 400);
  assert.equal((await call("admin", "POST", "/admin/catalog/projects/import", { catalogIds: [freshProjects[2].id], active: false })).statusCode, 400);
});

test("matching project names reuse existing service boundaries and inactive state without invented provenance", async () => {
  const entry = freshProjects[4];
  const existing: Project = { id: "catalog-name-existing", code: "SYNTHETIC_LOCAL_CODE", name: entry.name, category: "合成自定义分类", description: "现有服务边界必须保留", unit: "套", active: false };
  await put(service.db, "projects", existing);
  const response = await call("admin", "POST", "/admin/catalog/projects/import", { catalogIds: [entry.id] });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json<CatalogProjectImportResult>(), { projects: [existing], created: 0, existing: 1 });
});

test("conflicting project code rolls back the entire import and never overwrites existing work", async () => {
  const conflict = freshProjects[3];
  const existing: Project = { id: "catalog-code-conflict", code: conflict.code, name: "合成冲突名称", category: "合成", description: "保留原配置", unit: "次", active: true };
  await put(service.db, "projects", existing);
  const before = await list(service.db, "projects");
  const result = await call("admin", "POST", "/admin/catalog/projects/import", { catalogIds: [freshProjects[2].id, conflict.id] });
  assert.equal(result.statusCode, 409, result.body);
  assert.equal(result.json().error.code, "CATALOG_CODE_CONFLICT");
  assert.deepEqual(await list(service.db, "projects"), before);
  assert.deepEqual(await get(service.db, "projects", existing.id), existing);
});
