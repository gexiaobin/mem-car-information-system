import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import type { CarModel, CatalogModelImportResult, CatalogModelsResponse, CatalogProject, CatalogProjectImportResult, CatalogProjectsResponse, CatalogVariantsResponse, ManualRuleDraft, Project } from "@autovoyage/shared";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { get, list, put } from "../src/db.js";
import { maintenanceFor } from "../src/domain.js";
import { catalogModels, catalogProjects, catalogSources, catalogVersion, catalogVariants, variantsByModel } from "../src/data/public-catalog.js";
import { autoMapManualProjects, manualProjectSubject, standardProjectAction } from "../src/manual-project-mapping.js";

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
  freshProjects = catalogProjects.filter(entry => !initialProjects.some(project => project.code === entry.code || project.name === entry.name || project.category !== "diagnosis" && manualProjectSubject(project.name) === manualProjectSubject(entry.name) && standardProjectAction(project) === entry.action));
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

test("recent model years are selectable for the reported Sea Lion 06 and common brands", async () => {
  const seaLion = catalogModels.find(model => model.brand === "比亚迪" && model.name === "海狮06");
  assert(seaLion, "reported car series must be present");
  for (const year of [2025, 2026]) {
    const response = await call("admin", "GET", `/admin/catalog/models/${seaLion.id}/variants?year=${year}&limit=100`);
    assert.equal(response.statusCode, 200, response.body);
    const page = response.json<CatalogVariantsResponse>();
    assert(page.items.length >= 6, `Sea Lion 06 ${year} requires complete production configurations`);
    assert(page.items.some(item => item.trim.startsWith("DM-i ")));
    assert(page.items.some(item => item.trim.startsWith("EV ")));
    assert(page.items.every(item => item.year === year && item.power && item.sourceEvidence));
    assert(page.items.every(item => page.sources.some(source => source.id === item.sourceId)));
    assert(page.items.every(item => !/基本版|高配版/.test(item.trim)), "unreleased placeholder names must not be offered as actual trims");
  }
  for (const [brand, name, year] of [
    ["大众", "迈腾", 2025], ["丰田", "凯美瑞", 2025], ["特斯拉", "Model 3", 2025],
    ["理想", "L6", 2025], ["小米汽车", "SU7", 2024], ["问界", "M9", 2025],
    ["理想", "i8", 2026], ["小鹏汽车", "G7", 2025], ["极氪", "8X", 2026],
    ["蔚来", "ES9", 2026], ["小米汽车", "SU7", 2026],
  ] as const) {
    const response = await call("admin", "GET", `/admin/catalog/models?availableOnly=true&brand=${encodeURIComponent(brand)}&q=${encodeURIComponent(name)}&year=${year}`);
    assert.equal(response.statusCode, 200, response.body);
    const entry = response.json<CatalogModelsResponse>().items.find(item => item.name === name);
    assert(entry?.years?.includes(year), `${brand} ${name} must expose its verified ${year} configurations`);
    assert(variantsByModel.get(entry.id)?.some(item => item.year === year && item.power && item.trim));
  }
});

test("catalog browsing and importing require a platform administrator", async () => {
  for (const who of ["anonymous", "owner", "store", "expert"]) {
    for (const [method, path, payload] of [
      ["GET", "/admin/catalog/models", undefined],
      ["GET", "/admin/catalog/projects", undefined],
      ["GET", `/admin/catalog/models/${catalogModels[0].id}/variants`, undefined],
      ["POST", "/admin/catalog/models/import", modelInput(0, 2026)],
      ["POST", "/admin/catalog/projects/import", { catalogIds: [catalogProjects[0].id] }],
    ] as const) {
      const response = await call(who, method, path, payload);
      assert.equal(response.statusCode, who === "anonymous" ? 401 : 403, response.body);
    }
  }
});

test("exact configurations retain year, power and trim from one source record with bounded filters", async () => {
  assert(catalogVariants.length > 0);
  assert.equal(new Set(catalogVariants.map(variant => variant.id)).size, catalogVariants.length);
  const entry = catalogVariants[0];
  const all = variantsByModel.get(entry.modelCatalogId)!;
  const response = await call("admin", "GET", `/admin/catalog/models/${entry.modelCatalogId}/variants?year=${entry.year}&power=${encodeURIComponent(entry.power)}&limit=1`);
  assert.equal(response.statusCode, 200, response.body);
  const page = response.json<CatalogVariantsResponse>();
  assert(page.total > 0 && page.items.length === 1);
  assert(page.items.every(item => item.year === entry.year && item.power === entry.power && item.modelCatalogId === entry.modelCatalogId));
  assert.deepEqual(page.years, [...new Set(all.map(item => item.year))].sort((a, b) => b - a));
  assert(page.sources.some(source => source.id === entry.sourceId));
  assert(page.items[0].sourceEvidence && page.items[0].trim);
  const missingYear = Array.from({ length: 151 }, (_, index) => 1950 + index).find(year => !page.years.includes(year))!;
  assert.equal((await call("admin", "GET", `/admin/catalog/models/${entry.modelCatalogId}/variants?year=${missingYear}`)).json<CatalogVariantsResponse>().total, 0);
  for (const query of ["year=1900", "limit=101", "offset=-1"]) assert.equal((await call("admin", "GET", `/admin/catalog/models/${entry.modelCatalogId}/variants?${query}`)).statusCode, 400);
});

test("configuration import derives all variant fields server-side, preserves evidence and remains idempotent", async () => {
  const entry = catalogVariants[0];
  const rules = await list(service.db, "rules");
  const offers = await list(service.db, "offers");
  const payload = { catalogId: entry.modelCatalogId, variantId: entry.id };
  const responses = await Promise.all([call("admin", "POST", "/admin/catalog/models/import", payload), call("admin", "POST", "/admin/catalog/models/import", payload)]);
  responses.forEach(response => assert.equal(response.statusCode, 200, response.body));
  const results = responses.map(response => response.json<CatalogModelImportResult>());
  assert.equal(results.filter(result => result.created).length, 1);
  assert.equal(results[0].model.id, results[1].model.id);
  const model = results[0].model;
  assert.equal(model.year, entry.year);
  assert.equal(model.power, `${entry.power} · ${entry.trim}`);
  assert.equal(model.catalogSource?.variantId, entry.id);
  assert.equal(model.catalogSource?.sourceEvidence, entry.sourceEvidence);
  assert(model.catalogSource?.sources.some(source => source.id === entry.sourceId));
  assert.equal(model.applicableProjectIds, undefined);
  assert.equal(model.isDemo, false);
  assert.deepEqual(await list(service.db, "rules"), rules);
  assert.deepEqual(await list(service.db, "offers"), offers);
});

test("forged configuration combinations and cross-series candidates cannot be imported", async () => {
  const entry = catalogVariants[0];
  const other = catalogModels.find(model => model.id !== entry.modelCatalogId)!;
  const before = await list(service.db, "models");
  for (const payload of [
    { catalogId: entry.modelCatalogId, variantId: entry.id, year: 2026 },
    { catalogId: entry.modelCatalogId, variantId: entry.id, power: "伪造动力" },
    { catalogId: other.id, variantId: entry.id },
    { catalogId: entry.modelCatalogId, variantId: "unknown-variant" },
  ]) assert.equal((await call("admin", "POST", "/admin/catalog/models/import", payload)).statusCode, 400);
  assert.deepEqual(await list(service.db, "models"), before);
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

test("catalog year and availability filters disclose actual coverage without inventing model years", async () => {
  const year = catalogVariants.reduce((latest, variant) => Math.max(latest, variant.year), 0);
  const response = await call("admin", "GET", `/admin/catalog/models?year=${year}&availableOnly=true&limit=100`);
  assert.equal(response.statusCode, 200, response.body);
  const page = response.json<CatalogModelsResponse>();
  assert(page.items.length > 0);
  assert(page.years);
  assert.deepEqual(page.years, [...new Set(catalogVariants.map(variant => variant.year))].sort((a, b) => b - a));
  for (const model of page.items) {
    const variants = variantsByModel.get(model.id)!;
    assert(variants.some(variant => variant.year === year));
    assert.equal(model.variantCount, variants.length);
    assert.deepEqual(model.years, [...new Set(variants.map(variant => variant.year))].sort((a, b) => b - a));
  }
  const available = (await call("admin", "GET", "/admin/catalog/models?availableOnly=true&limit=1")).json<CatalogModelsResponse>();
  assert.equal(available.total, variantsByModel.size);
  assert.equal(available.items[0].years?.[0], year);
  assert.equal((await call("admin", "GET", "/admin/catalog/models?availableOnly=false&limit=1")).json<CatalogModelsResponse>().total, catalogModels.length);
  const missingYear = Array.from({ length: 151 }, (_, index) => 1950 + index).find(value => !page.years.includes(value))!;
  assert.equal((await call("admin", "GET", `/admin/catalog/models?year=${missingYear}`)).json<CatalogModelsResponse>().total, 0);
  for (const query of ["year=1900", "year=2025.5", "availableOnly=yes", "availableOnly=1"]) {
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

test("common service import reuses unique component and action aliases without changing existing project data", async () => {
  const before = await list<Project>(service.db, "projects");
  const existing = before.find(project => project.id === "project-cabin")!;
  const response = await call("admin", "POST", "/admin/catalog/projects/import", { catalogIds: ["ref-cabin-filter"], skipConflicts: true });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json<CatalogProjectImportResult>(), { projects: [existing], created: 0, existing: 1, skipped: [] });
  assert.deepEqual(await list<Project>(service.db, "projects"), before);
});

test("safe common service completion skips unknown actions and code conflicts while concurrent retries remain idempotent", async () => {
  const unknown: Project = { id: "catalog-unknown-wiper", code: "SYNTHETIC_UNKNOWN_WIPER", name: "雨刷片", category: "自定义", description: "保留人工服务说明，操作尚未填写", unit: "副", active: true };
  const conflictEntry = catalogProjects.find(project => project.id === "ref-low-voltage-battery-replace")!;
  const conflict: Project = { id: "catalog-battery-code-conflict", code: conflictEntry.code, name: "合成编码冲突项目", category: "自定义", description: "保持不变", unit: "次", active: true };
  await put(service.db, "projects", unknown);
  await put(service.db, "projects", conflict);
  const before = await list<Project>(service.db, "projects");
  const models = await list(service.db, "models");
  const rules = await list(service.db, "rules");
  const offers = await list(service.db, "offers");
  const payload = { catalogIds: ["ref-wiper-replace", "ref-tire-rotation", conflictEntry.id], skipConflicts: true };
  const responses = await Promise.all([call("admin", "POST", "/admin/catalog/projects/import", payload), call("admin", "POST", "/admin/catalog/projects/import", payload)]);
  responses.forEach(response => assert.equal(response.statusCode, 200, response.body));
  const results = responses.map(response => response.json<CatalogProjectImportResult>());
  assert.equal(results.reduce((sum, result) => sum + result.created, 0), 1);
  assert.equal(results[0].projects[0].id, results[1].projects[0].id);
  for (const result of results) {
    assert.deepEqual(result.skipped?.map(entry => entry.catalogId), ["ref-wiper-replace", conflictEntry.id]);
    assert(result.skipped?.every(entry => entry.name && entry.reason));
  }
  assert.equal((await list<Project>(service.db, "projects")).length, before.length + 1);
  assert.deepEqual(await get(service.db, "projects", unknown.id), unknown);
  assert.deepEqual(await get(service.db, "projects", conflict.id), conflict);
  assert.deepEqual(await list(service.db, "models"), models);
  assert.deepEqual(await list(service.db, "rules"), rules);
  assert.deepEqual(await list(service.db, "offers"), offers);
  const strict = await call("admin", "POST", "/admin/catalog/projects/import", { catalogIds: ["ref-wiper-replace"] });
  assert.equal(strict.statusCode, 409, strict.body);
  assert.equal(strict.json().error.code, "PROJECT_ACTION_UNKNOWN");
  assert.equal((await call("admin", "POST", "/admin/catalog/projects/import", { ...payload, skipConflicts: "true" })).statusCode, 400);
});

test("common service matching keeps opposite actions distinct and excludes diagnosis projects", async () => {
  const inspect: Project = { id: "catalog-brake-fluid-inspect", code: "SYNTHETIC_BRAKE_FLUID_INSPECT", name: "检测刹车液", category: "制动系统", description: "检测液体状态；更换另行报价", unit: "次", active: false };
  const diagnosis: Project = { id: "catalog-diagnosis-motor-coolant", code: "SYNTHETIC_DIAGNOSIS_MOTOR_COOLANT", name: "更换驱动电机冷却液", category: "diagnosis", description: "合成故障检查项目", unit: "次", active: true };
  await put(service.db, "projects", inspect);
  await put(service.db, "projects", diagnosis);
  const response = await call("admin", "POST", "/admin/catalog/projects/import", { catalogIds: ["ref-brake-fluid-inspection", "ref-brake-fluid-replace", "ref-motor-coolant"], skipConflicts: true });
  assert.equal(response.statusCode, 200, response.body);
  const result = response.json<CatalogProjectImportResult>();
  assert.equal(result.created, 2);
  assert.equal(result.existing, 1);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.projects[0], inspect);
  assert.notEqual(result.projects[1].id, inspect.id);
  assert.notEqual(result.projects[2].id, diagnosis.id);
  assert.deepEqual(await get(service.db, "projects", inspect.id), inspect);
  assert.deepEqual(await get(service.db, "projects", diagnosis.id), diagnosis);
  const codeEntry = catalogProjects.find(entry => entry.id === "ref-exterior-bulb")!;
  const diagnosisWithCode: Project = { ...diagnosis, id: "catalog-diagnosis-code-conflict", code: codeEntry.code, name: codeEntry.name };
  await put(service.db, "projects", diagnosisWithCode);
  const conflict = await call("admin", "POST", "/admin/catalog/projects/import", { catalogIds: [codeEntry.id], skipConflicts: true });
  assert.equal(conflict.statusCode, 200, conflict.body);
  assert.equal(conflict.json<CatalogProjectImportResult>().skipped?.[0].catalogId, codeEntry.id);
  assert.equal(conflict.json<CatalogProjectImportResult>().created, 0);
  assert.deepEqual(await get(service.db, "projects", diagnosisWithCode.id), diagnosisWithCode);
});

test("safe completion reports ambiguous component matches and still imports independent services", async () => {
  for (const [index, name] of ["检测高压线束和接插件", "检验高压线束和接插件"].entries()) {
    await put(service.db, "projects", { id: `catalog-harness-ambiguous-${index}`, code: `SYNTHETIC_HARNESS_${index}`, name, category: "新能源", description: "合成已有项目", unit: "次", active: true });
  }
  const response = await call("admin", "POST", "/admin/catalog/projects/import", { catalogIds: ["ref-hv-harness", "ref-wheel-balance"], skipConflicts: true });
  assert.equal(response.statusCode, 200, response.body);
  const result = response.json<CatalogProjectImportResult>();
  assert.equal(result.created, 1);
  assert.equal(result.skipped?.length, 1);
  assert.equal(result.skipped?.[0].catalogId, "ref-hv-harness");
  assert.match(result.skipped?.[0].reason || "", /多个同部件/);
});

test("fluid and chemical nouns do not masquerade as cleaning or lubrication operations", () => {
  const entry = catalogProjects.find(project => project.name === "补充风挡玻璃清洗液")!;
  assert(entry, "common service catalog includes washer fluid top-up");
  const imported: Project = { ...entry, active: true, catalogSource: { catalogId: entry.id, version: "test", sources: [], importedAt: "2026-01-01T00:00:00.000Z" } };
  assert.equal(standardProjectAction(imported), "other");
  const base: ManualRuleDraft = { id: "chemical-noun", name: entry.name, action: "other", projectId: null, catalogProjectId: null, createProject: false, include: true, triggerType: "as_needed", firstMonths: null, firstKm: null, intervalMonths: null, intervalKm: null, mileageType: "total_km", condition: "合成检查结果，需要时处理", notes: "合成测试", sourceText: "合成测试", pageNumbers: [1] };
  assert.equal(autoMapManualProjects([base], [])[0]?.catalogProjectId, entry.id);
  for (const component of ["清洗液", "润滑油", "润滑脂", "清洁剂"]) {
    assert.equal(manualProjectSubject(`检查${component}`), component);
    const project: Project = { id: `chemical-${component}`, code: `SYNTHETIC_${component}`, name: `检查${component}`, category: "合成检查", description: "合成检查项目", unit: "次", active: true };
    assert.equal(standardProjectAction(project), "inspect");
    assert.equal(autoMapManualProjects([{ ...base, name: `检查${component}`, action: "inspect" }], [project])[0]?.projectId, project.id);
    assert.equal(standardProjectAction({ ...project, name: "待明确的合成项目", description: `${component}的适用型号需确认` }), null);
  }
});
