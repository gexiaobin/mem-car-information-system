import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import pg from "pg";
import type { Bootstrap, CarModel, MaintenanceRule, ManualImport, ManualRuleDraft, Project, Vehicle } from "@autovoyage/shared";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { get, list, put } from "../src/db.js";
import { hashPassword, maintenanceFor } from "../src/domain.js";
import { recognizeManual } from "../src/manual-vision.js";
import { parsePageRange } from "../src/manual-files.js";
import { downloadManualSource, isPublicAddress, manualPdfLinks, validateSourceUrl } from "../src/manual-sources.js";

const origin = "http://localhost:5173";
const password = "ManualIntegrationTest2026!";
const row = (overrides: Record<string, unknown> = {}) => ({
  name: "合成空调滤清器更换", action: "replace", triggerType: "periodic",
  firstMonths: 12, firstKm: 20000, intervalMonths: 12, intervalKm: 20000,
  mileageType: "total_km", condition: "", notes: "正常使用条件；以先到者为准；合成测试数据",
  sourceText: "合成测试：每12个月或20000公里更换空调滤清器，以先到者为准。", pageNumbers: [1],
  ...overrides,
});
const candidate = (rows = [row()]) => ({ rows, warnings: [], applicability: "中国版2024款合成车型，仅用于测试" });
const completed = (data: unknown = candidate()) => ({ status: "completed", output: [{ type: "message", status: "completed", content: [{ type: "output_text", text: JSON.stringify(data) }] }] });
let service: Awaited<ReturnType<typeof createApp>>;
let temporary: string;
let control: pg.Client | undefined;
let schema: string | undefined;
let upstreamResponse: unknown = completed();
let upstreamStatus = 200;
const requests: { path: string; body: any }[] = [];
const cookies: Record<string, string> = {};
const upstream = createServer(async (request, reply) => {
  const chunks: Buffer[] = [];
  for await (const part of request) chunks.push(Buffer.from(part));
  requests.push({ path: request.url || "", body: JSON.parse(Buffer.concat(chunks).toString()) });
  reply.writeHead(upstreamStatus, { "content-type": "application/json" });
  reply.end(JSON.stringify(upstreamResponse));
});
before(async () => {
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const address = upstream.address();
  assert(address && typeof address !== "string");
  temporary = await mkdtemp(join(tmpdir(), "autovoyage-manuals-"));
  const base = loadConfig({ production: false, seedDemo: false, sessionSecret: "manual-test-secret-at-least-32-characters" });
  if (process.env.AV_MANUAL_PG_TEST === "1") {
    const { schema: _, ...connection } = base.pg;
    assert(connection.password, "PostgreSQL manual tests require configured credentials");
    control = new pg.Client({ ...connection, connectionTimeoutMillis: 10000 });
    await control.connect();
    schema = `av_test_manual_${randomBytes(8).toString("hex")}`;
    assert(/^av_test_manual_[a-f0-9]{16}$/.test(schema));
    await control.query(`CREATE SCHEMA "${schema}"`);
  }
  service = await createApp({ config: loadConfig({
    production: false, driver: schema ? "postgres" : "pglite", pglitePath: ":memory:",
    pg: { ...base.pg, schema: schema || base.pg.schema }, seedDemo: true, demoMode: true,
    demoPassword: password, sessionSecret: "manual-test-secret-at-least-32-characters",
    uploadDir: temporary, aiBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    aiApiStyle: "responses", aiKey: "fake-manual-key", aiModel: "synthetic-manual", aiTimeoutMs: 1000, origin,
  }) });
  await put(service.db, "users", { id: "manual-other-owner", name: "无车辆合成车主", email: "manual-other@autovoyage.demo", role: "owner", storeId: null, active: true, passwordHash: await hashPassword(password) });
  for (const [key, email] of Object.entries({ owner: "owner@autovoyage.demo", other: "manual-other@autovoyage.demo", store: "store@autovoyage.demo", expert: "expert@autovoyage.demo", admin: "admin@autovoyage.demo" })) {
    const response = await service.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { origin }, payload: { email, password } });
    assert.equal(response.statusCode, 200, response.body);
    cookies[key] = String(response.headers["set-cookie"]).split(";")[0];
  }
});
after(async () => {
  await service?.app.close();
  await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
  if (schema && control) {
    assert(/^av_test_manual_[a-f0-9]{16}$/.test(schema));
    await control.query(`DROP SCHEMA "${schema}" CASCADE`);
    const remaining = await control.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema]);
    assert.equal(remaining.rowCount, 0, "temporary manual test schema must be removed");
  }
  await control?.end();
  if (temporary) await rm(temporary, { recursive: true, force: true });
});
const call = (who: string, method: "GET" | "POST" | "PATCH", path: string, payload?: unknown) => service.app.inject({ method, url: `/api/v1${path}`, headers: { origin, cookie: cookies[who] || "" }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
let imageNumber = 0;
async function upload(options: { who?: string; modelId?: string; fields?: Record<string, string>; bytes?: Buffer; mime?: string; name?: string; items?: Array<{ bytes: Buffer; mime: string; name: string }> } = {}) {
  imageNumber++;
  const image = options.bytes || await sharp({ create: { width: 160, height: 100, channels: 3, background: { r: imageNumber, g: 65, b: 95 } } }).png().toBuffer();
  const boundary = `manual-${imageNumber}`;
  const fields = { modelId: options.modelId || "model-electric", sourceTitle: "合成保养手册2024版 第1页", sourceUrl: "https://example.com/synthetic-manual.pdf", edition: "合成测试2024版", applicability: "中国版2024款纯电；合成测试", consent: "true", ...options.fields };
  const extra = Object.entries(fields).map(([key, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join("");
  const items = options.items || [{ bytes: image, mime: options.mime || "image/png", name: options.name || "synthetic-manual.png" }];
  const payload = Buffer.concat([Buffer.from(extra), ...items.flatMap(item => [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${item.name}"\r\nContent-Type: ${item.mime}\r\n\r\n`), item.bytes, Buffer.from("\r\n")]), Buffer.from(`--${boundary}--\r\n`)]);
  return service.app.inject({ method: "POST", url: "/api/v1/admin/manual-imports", headers: { origin, cookie: cookies[options.who ?? "admin"] || "", "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
}
async function settled(id: string) {
  const deadline = Date.now() + 6000;
  let job: ManualImport | undefined;
  do {
    const response = await call("admin", "GET", `/admin/manual-imports/${id}`);
    assert.equal(response.statusCode, 200, response.body);
    job = response.json<ManualImport>();
    if (!["uploaded", "processing"].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.fail(`manual did not settle: ${job?.status}`);
}
async function draft(job: ManualImport, rows: ManualRuleDraft[], metadata: Partial<ManualImport> = {}) {
  const response = await call("admin", "PATCH", `/admin/manual-imports/${job.id}/draft`, {
    expectedRevision: job.revision, rows, sourceTitle: job.sourceTitle, sourceUrl: job.sourceUrl,
    edition: job.edition, applicability: job.applicability, ...metadata,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<ManualImport>();
}
function publishing(job: ManualImport) { return { expectedRevision: job.revision, verified: true, applicabilityConfirmed: true }; }
async function ready(overrides: Record<string, unknown> = {}, modelId = "model-electric") {
  upstreamStatus = 200;
  upstreamResponse = completed(candidate([row(overrides)]));
  const response = await upload({ modelId });
  assert.equal(response.statusCode, 200, response.body);
  const job = await settled(response.json<ManualImport>().id);
  assert.equal(job.status, "awaiting_confirmation", job.reason);
  return job;
}

// A valid two-page PDF generated entirely from ASCII test data; no real manual enters CI.
function syntheticPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 250] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 250] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...["Synthetic manual page one", "Synthetic maintenance table page two"].map(text => {
      const stream = `BT /F1 14 Tf 30 180 Td (${text}) Tj ET`;
      return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    }),
  ];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(content)); content += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}

test("manual vision supports both wire formats and preserves unknown fields and conditional semantics", async () => {
  const data = candidate([row({ triggerType: "condition", firstMonths: null, firstKm: null, intervalMonths: null, intervalKm: null, condition: "检测污染后按需更换" })]);
  upstreamResponse = completed(data);
  const model = "中国版2024款合成纯电动车";
  const images = [{ pageNumber: 1, buffer: Buffer.from("synthetic-jpeg") }];
  const recognized = await recognizeManual(service.config, images, model);
  assert.equal(recognized.rows[0]?.intervalMonths, null);
  assert.equal(recognized.rows[0]?.triggerType, "condition");
  assert.equal(requests.at(-1)!.path, "/v1/responses");
  assert.equal(requests.at(-1)!.body.store, false);
  assert.match(requests.at(-1)!.body.input[0].content[0].text, /json/i);
  assert.match(requests.at(-1)!.body.instructions, /命令|指令/);
  upstreamResponse = { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(data) } }] };
  assert.equal((await recognizeManual({ ...service.config, aiApiStyle: "chat_completions" }, images, model)).rows[0]?.action, "replace");
  assert.equal(requests.at(-1)!.path, "/v1/chat/completions");
  for (const invalid of [completed(candidate([row({ pageNumbers: [99] })])), completed(candidate([row({ intervalKm: -1 })])), { status: "incomplete", output: [] }, { status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }] }]) {
    upstreamResponse = invalid;
    await assert.rejects(recognizeManual(service.config, images, model));
  }
  upstreamResponse = completed();
});

test("manual import and source discovery are restricted to platform administrators", async () => {
  for (const who of ["", "owner", "store", "expert"]) {
    for (const path of ["/admin/manual-imports", "/admin/manual-sources?modelId=model-electric"])
      assert([401, 403].includes((await call(who, "GET", path)).statusCode));
    assert([401, 403].includes((await upload({ who })).statusCode));
  }
  const sources = await call("admin", "GET", "/admin/manual-sources?modelId=model-electric");
  assert.equal(sources.statusCode, 200, sources.body);
  assert.equal(sources.json()[0]?.kind, "carobook");
  const invalid = await upload({ modelId: "missing-model" });
  assert.equal(invalid.statusCode, 404);
});

test("AI drafts retain evidence without changing active rules or model scope before review", async () => {
  const model = await get<CarModel>(service.db, "models", "model-electric");
  const rules = await list<MaintenanceRule>(service.db, "rules");
  const job = await ready();
  assert(job.files.length > 0);
  assert(job.files.some(file => file.pageNumber === 1 && file.mimeType.startsWith("image/")));
  assert.equal("path" in job.files[0]!, false);
  assert.equal(job.publishedAt, null);
  assert.equal(job.publishedRuleIds.length, 0);
  assert.equal((await call("owner", "GET", `/manuals/${job.id}`)).statusCode, 404);
  assert.equal((await call("admin", "GET", `/manuals/${job.id}`)).statusCode, 404);
  assert.deepEqual(await get(service.db, "models", "model-electric"), model);
  assert.deepEqual(await list(service.db, "rules"), rules);
  for (const who of ["owner", "store", "expert"]) {
    assert.equal((await call(who, "GET", `/admin/manual-imports/${job.id}`)).statusCode, 403);
    const bootstrap = await call(who, "GET", "/bootstrap");
    assert.equal(bootstrap.body.includes(job.id), false);
    assert.equal((await service.app.inject({ method: "GET", url: job.files[0]!.url, headers: { cookie: cookies[who] } })).statusCode, 403);
  }
  const file = await service.app.inject({ method: "GET", url: job.files[0]!.url, headers: { cookie: cookies.admin } });
  assert.equal(file.statusCode, 200, file.body);
  assert.equal(file.headers["cache-control"], "no-store");
  const genericUrl = `/api/v1/files/${job.files[0]!.id}`;
  assert([400, 403].includes((await call("owner", "POST", "/faults", { vehicleId: "vehicle-electric", storeId: "store-coast", title: "合成测试", description: "合成测试", conditions: "", occurredAt: new Date().toISOString(), imageUrls: [genericUrl] })).statusCode));
  await put(service.db, "faults", { id: "injected-manual-reference", ownerId: "owner-demo", storeId: "store-coast", assignedExpertId: "expert-demo", imageUrls: [genericUrl] });
  for (const who of ["owner", "store", "expert"])
    assert.equal((await service.app.inject({ method: "GET", url: genericUrl, headers: { cookie: cookies[who] } })).statusCode, 403);
});

test("publishing requires saved evidence, explicit project mapping and applicability review", async () => {
  let job = await ready();
  assert.equal((await call("admin", "POST", `/admin/manual-imports/${job.id}/publish`, { expectedRevision: job.revision, verified: true, applicabilityConfirmed: false })).statusCode, 400);
  assert.equal((await call("admin", "POST", `/admin/manual-imports/${job.id}/publish`, publishing(job))).statusCode, 400);
  job = await draft(job, job.rows.map(item => ({ ...item, include: true, createProject: false, projectId: "project-cabin" })));
  const stale = await call("admin", "PATCH", `/admin/manual-imports/${job.id}/draft`, { expectedRevision: job.revision - 1, rows: job.rows, sourceTitle: job.sourceTitle, sourceUrl: job.sourceUrl, edition: job.edition, applicability: job.applicability });
  assert.equal(stale.statusCode, 409);
  const badPage = await call("admin", "PATCH", `/admin/manual-imports/${job.id}/draft`, { expectedRevision: job.revision, rows: job.rows.map(item => ({ ...item, pageNumbers: [999] })), sourceTitle: job.sourceTitle, sourceUrl: job.sourceUrl, edition: job.edition, applicability: job.applicability });
  assert.equal(badPage.statusCode, 400);
  const wrongSource = await call("admin", "PATCH", `/admin/manual-imports/${job.id}/draft`, { expectedRevision: job.revision, rows: job.rows, sourceTitle: job.sourceTitle, sourceUrl: "/api/v1/manual-files/unrelated-file", edition: job.edition, applicability: job.applicability });
  assert.equal(wrongSource.statusCode, 400);
  assert.equal(wrongSource.json().error.code, "SOURCE_FILE_MISMATCH");
  const missingEvidence = await call("admin", "PATCH", `/admin/manual-imports/${job.id}/draft`, { expectedRevision: job.revision, rows: job.rows.map(item => ({ ...item, sourceText: "" })), sourceTitle: job.sourceTitle, sourceUrl: job.sourceUrl, edition: job.edition, applicability: job.applicability });
  // Incomplete drafts may be retained, but they must never be published as verified rules.
  if (missingEvidence.statusCode === 200) {
    const incomplete = missingEvidence.json<ManualImport>();
    assert.equal((await call("admin", "POST", `/admin/manual-imports/${job.id}/publish`, publishing(incomplete))).statusCode, 400);
  } else assert.equal(missingEvidence.statusCode, 400);
});

test("manual publishing is atomic and idempotent, versions rules and preserves other model scope", async () => {
  const otherModel = await get<CarModel>(service.db, "models", "model-sedan");
  const modelBefore = await get<CarModel>(service.db, "models", "model-electric");
  const rulesBefore = await list<MaintenanceRule>(service.db, "rules");
  let job = await ready();
  job = await draft(job, job.rows.map(item => ({ ...item, include: true, projectId: "project-cabin", createProject: false })));
  const payload = publishing(job);
  const responses = await Promise.all([call("admin", "POST", `/admin/manual-imports/${job.id}/publish`, payload), call("admin", "POST", `/admin/manual-imports/${job.id}/publish`, payload)]);
  for (const response of responses) assert.equal(response.statusCode, 200, response.body);
  const published = responses[0]!.json<ManualImport>();
  assert.equal(published.status, "published");
  assert.equal(published.publishedRuleIds.length, 1);
  assert.deepEqual(responses[1]!.json<ManualImport>().publishedRuleIds, published.publishedRuleIds);
  const rules = await list<MaintenanceRule>(service.db, "rules");
  assert.equal(rules.length, rulesBefore.length + 1);
  const rule = await get<MaintenanceRule>(service.db, "rules", published.publishedRuleIds[0]!);
  assert.equal(rule?.manualImportId, job.id);
  assert.deepEqual(rule?.sourcePages, [1]);
  assert.equal(rule?.sourceText, job.rows[0]?.sourceText);
  assert.equal(rule?.action, "replace");
  assert.equal(rule?.verified, true);
  assert.equal(rule?.version, Math.max(0, ...rulesBefore.filter(item => item.modelId === job.modelId && item.projectId === "project-cabin").map(item => item.version)) + 1);
  assert.deepEqual(await get(service.db, "models", "model-sedan"), otherModel);
  const modelAfter = await get<CarModel>(service.db, "models", "model-electric");
  for (const projectId of modelBefore?.applicableProjectIds || []) assert(modelAfter?.applicableProjectIds?.includes(projectId));
  const ownerBootstrap = (await call("owner", "GET", "/bootstrap")).json<Bootstrap>();
  assert(ownerBootstrap.rules.some(item => item.id === rule?.id));
  const ownerFile = await service.app.inject({ method: "GET", url: published.files[0]!.url, headers: { cookie: cookies.owner } });
  assert.equal(ownerFile.statusCode, 200, ownerFile.body);
  assert.equal((await service.app.inject({ method: "GET", url: published.files[0]!.url, headers: { cookie: cookies.other } })).statusCode, 403);
  assert.equal((await service.app.inject({ method: "GET", url: published.files[0]!.url, headers: { cookie: cookies.store } })).statusCode, 403);
  const document = await call("owner", "GET", `/manuals/${job.id}`);
  assert.equal(document.statusCode, 200, document.body);
  assert.equal(document.json().id, published.id);
  assert.equal(document.json().modelId, published.modelId);
  assert.deepEqual(document.json().files, published.files);
  assert.equal("rows" in document.json(), false);
  assert.equal("createdBy" in document.json(), false);
  assert.equal((await call("admin", "GET", `/manuals/${job.id}`)).statusCode, 200);
  for (const who of ["other", "store", "expert"])
    assert.equal((await call(who, "GET", `/manuals/${job.id}`)).statusCode, 403);
  assert.equal((await call("", "GET", `/manuals/${job.id}`)).statusCode, 401);
});

test("special-use conditions cannot be published as unconditional periodic rules or replaced with guessed thresholds", async () => {
  let job = await ready({ condition: "仅在盐水道路行驶后适用" });
  job = await draft(job, job.rows.map(item => ({ ...item, include: true, createProject: false, projectId: "project-brake" })));
  const special = await call("admin", "POST", `/admin/manual-imports/${job.id}/publish`, publishing(job));
  assert.equal(special.statusCode, 400, special.body);
  let unknown = await ready({ firstMonths: null, firstKm: null, intervalMonths: null, intervalKm: null });
  unknown = await draft(unknown, unknown.rows.map(item => ({ ...item, include: true, createProject: false, projectId: "project-brake" })));
  const missing = await call("admin", "POST", `/admin/manual-imports/${unknown.id}/publish`, publishing(unknown));
  assert.equal(missing.statusCode, 400, missing.body);
  const current = (await call("admin", "GET", `/admin/manual-imports/${unknown.id}`)).json<ManualImport>();
  assert.equal(current.rows[0]?.firstMonths, null);
  assert.equal(current.rows[0]?.intervalKm, null);
});

test("conditional rules create named projects and retain their condition without inventing fixed due thresholds", async () => {
  let job = await ready({ name: "合成制动液检测", action: "inspect", triggerType: "condition", firstMonths: null, firstKm: null, intervalMonths: null, intervalKm: null, condition: "检测污染时才更换", sourceText: "合成测试：根据检测结果判断，污染时才更换。" });
  job = await draft(job, job.rows.map(item => ({ ...item, include: true, createProject: true, projectId: null })));
  const response = await call("admin", "POST", `/admin/manual-imports/${job.id}/publish`, publishing(job));
  assert.equal(response.statusCode, 200, response.body);
  const published = response.json<ManualImport>();
  const rule = await get<MaintenanceRule>(service.db, "rules", published.publishedRuleIds[0]!);
  assert(rule);
  assert.equal(rule.triggerType, "condition");
  assert.equal(rule.intervalMonths, null);
  const project = await get<Project>(service.db, "projects", rule.projectId);
  assert.equal(project?.name, job.rows[0]?.name);
  const model = await get<CarModel>(service.db, "models", job.modelId);
  assert(model?.applicableProjectIds?.includes(rule.projectId));
  const vehicle: Vehicle = { id: "synthetic-conditional-car", ownerId: "owner-demo", modelId: job.modelId, plate: "TEST", name: "合成车辆", startDate: "2020-01-01", initialKm: 0, totalKm: 500000, observedAt: new Date().toISOString(), isDemo: true };
  const result = maintenanceFor(vehicle, [project!], [rule], [], new Date("2026-11-04T00:00:00Z"), model);
  assert.equal(result[0]?.dueAt, null);
  assert.equal(result[0]?.dueKm, null);
  assert.notEqual(result[0]?.status, "due");
  assert.match(result[0]?.reason || "", /污染/);
});

test("duplicate mappings and invalid project scopes fail without partial publishing", async () => {
  upstreamResponse = completed(candidate([row(), row({ name: "合成第二项目" })]));
  let job = await settled((await upload()).json<ManualImport>().id);
  job = await draft(job, job.rows.map(item => ({ ...item, include: true, createProject: false, projectId: "project-cabin" })));
  const count = (await list(service.db, "rules")).length;
  assert.equal((await call("admin", "POST", `/admin/manual-imports/${job.id}/publish`, publishing(job))).statusCode, 400);
  assert.equal((await list(service.db, "rules")).length, count);
  job = await draft(job, job.rows.map((item, index) => ({ ...item, include: index === 0, projectId: "project-diagnosis" })));
  assert.equal((await call("admin", "POST", `/admin/manual-imports/${job.id}/publish`, publishing(job))).statusCode, 400);
  assert.equal((await list(service.db, "rules")).length, count);
});

test("different models cannot concurrently introduce duplicate standard projects from manuals", async () => {
  const name = "跨车型并发合成检测项目";
  let electric = await ready({ name });
  let sedan = await ready({ name }, "model-sedan");
  electric = await draft(electric, electric.rows.map(item => ({ ...item, include: true, createProject: true, projectId: null })));
  sedan = await draft(sedan, sedan.rows.map(item => ({ ...item, include: true, createProject: true, projectId: null })));
  const responses = await Promise.all([
    call("admin", "POST", `/admin/manual-imports/${electric.id}/publish`, publishing(electric)),
    call("admin", "POST", `/admin/manual-imports/${sedan.id}/publish`, publishing(sedan)),
  ]);
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 409]);
  const conflict = responses.find(response => response.statusCode === 409)!;
  assert.equal(conflict.json().error.code, "PROJECT_NAME_EXISTS");
  const projects = (await list<Project>(service.db, "projects")).filter(project => project.name === name);
  assert.equal(projects.length, 1);
  assert.equal((await list<MaintenanceRule>(service.db, "rules")).filter(rule => rule.projectId === projects[0]!.id).length, 1);
});

test("legacy rule edits and manual publication serialize without reviving superseded history", async () => {
  const legacy = (await list<MaintenanceRule>(service.db, "rules")).find(rule => rule.modelId === "model-electric" && rule.projectId === "project-brake" && rule.verified);
  assert(legacy);
  let job = await ready({ name: "合成制动检查", action: "inspect" });
  job = await draft(job, job.rows.map(item => ({ ...item, include: true, createProject: false, projectId: legacy.projectId })));
  const [edited, published] = await Promise.all([
    call("admin", "PATCH", `/admin/rules/${legacy.id}`, { sourceTitle: "并发人工规则编辑（合成）", isDemo: legacy.isDemo }),
    call("admin", "POST", `/admin/manual-imports/${job.id}/publish`, publishing(job)),
  ]);
  assert([200, 409].includes(edited.statusCode), edited.body);
  assert([200, 409].includes(published.statusCode), published.body);
  if (edited.statusCode === 200) {
    assert.equal(published.statusCode, 409, published.body);
    assert.equal(published.json().error.code, "RULE_VERSION_CONFLICT");
    let replacement = await ready({ name: "合成制动检查", action: "inspect" });
    replacement = await draft(replacement, replacement.rows.map(item => ({ ...item, include: true, createProject: false, projectId: legacy.projectId })));
    assert.equal((await call("admin", "POST", `/admin/manual-imports/${replacement.id}/publish`, publishing(replacement))).statusCode, 200);
  } else {
    assert.equal(edited.json().error.code, "RULE_SUPERSEDED");
    assert.equal(published.statusCode, 200, published.body);
  }
  const historical = await get<MaintenanceRule>(service.db, "rules", legacy.id);
  assert.equal(historical?.verified, false);
  assert(historical?.supersededBy);
  const revived = await call("admin", "PATCH", `/admin/rules/${legacy.id}`, { verified: true });
  assert.equal(revived.statusCode, 409, revived.body);
  assert.equal(revived.json().error.code, "RULE_SUPERSEDED");
  const active = (await list<MaintenanceRule>(service.db, "rules")).filter(rule => rule.modelId === legacy.modelId && rule.projectId === legacy.projectId && rule.verified);
  assert.equal(active.length, 1);
  assert(active[0]!.manualImportId);
  assert.equal((await call("admin", "PATCH", `/admin/rules/${active[0]!.id}`, { verified: false })).json().error.code, "MANUAL_RULE_IMMUTABLE");
});

test("a separately published version or changed model cannot be silently overwritten by an older manual task", async () => {
  let first = await ready();
  let second = await ready();
  first = await draft(first, first.rows.map(item => ({ ...item, include: true, createProject: false, projectId: "project-cabin" })));
  second = await draft(second, second.rows.map(item => ({ ...item, include: true, createProject: false, projectId: "project-cabin" })));
  const saved = await call("admin", "POST", `/admin/manual-imports/${first.id}/publish`, publishing(first));
  assert.equal(saved.statusCode, 200, saved.body);
  const before = (await list(service.db, "rules")).length;
  const conflict = await call("admin", "POST", `/admin/manual-imports/${second.id}/publish`, publishing(second));
  assert.equal(conflict.statusCode, 409, conflict.body);
  assert.equal(conflict.json().error.code, "RULE_VERSION_CONFLICT");
  assert.equal((await list(service.db, "rules")).length, before);
  let changed = await ready();
  changed = await draft(changed, changed.rows.map(item => ({ ...item, include: true, createProject: false, projectId: "project-brake" })));
  const model = await get<CarModel>(service.db, "models", changed.modelId);
  assert(model);
  await put(service.db, "models", { ...model, year: model.year + 1 });
  const mismatched = await call("admin", "POST", `/admin/manual-imports/${changed.id}/publish`, publishing(changed));
  assert.equal(mismatched.statusCode, 409, mismatched.body);
  assert.equal(mismatched.json().error.code, "MODEL_CHANGED");
  await put(service.db, "models", model);
});

test("PDF page ranges reject ambiguous and oversized selections rather than silently sending the whole manual", () => {
  assert.deepEqual(parsePageRange(undefined, 2), [1, 2]);
  assert.deepEqual(parsePageRange("2-3， 7,1", 300), [1, 2, 3, 7]);
  for (const [range, pages] of [[undefined, 13], ["1-13", 300], ["0", 300], ["4-2", 300], ["301", 300], ["1,1", 300], ["1-3,3", 300], ["1,", 300], ["", 1001]] as const)
    assert.throws(() => parsePageRange(range, pages));
});

test("source URL and link inspection reject private destinations and netdisk automation before making network requests", async () => {
  for (const address of ["127.0.0.1", "0.0.0.0", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1"])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  for (const url of ["http://example.com/manual.pdf", "https://user:password@example.com/manual.pdf", "https://example.com:444/manual.pdf", "https://localhost/manual.pdf", "https://private.local/manual.pdf", "https://127.0.0.1/manual.pdf", "https://2130706433/manual.pdf", "https://169.254.169.254/manual.pdf", "https://[::1]/manual.pdf"])
    assert.throws(() => validateSourceUrl(url), undefined, url);
  assert.equal(validateSourceUrl("https://example.com/manual.pdf#page=5").href, "https://example.com/manual.pdf");
  assert.deepEqual(manualPdfLinks('<a href="/one.pdf">一</a><a href="/one.pdf">重复</a><a href="two.PDF?version=2">二</a><a href="javascript:alert(1)">伪链</a><a href="/page.html">网页</a>', "https://example.com/catalog/index.html"), ["https://example.com/one.pdf", "https://example.com/catalog/two.PDF?version=2"]);
  await assert.rejects(downloadManualSource("https://pan.baidu.com/s/synthetic-share"), (error: any) => error.code === "MANUAL_DOWNLOAD_REQUIRED");
});

test("PDF page selection retains original and selected-page evidence while rejecting wrong file contents", async () => {
  upstreamResponse = completed(candidate([row({ pageNumbers: [2] })]));
  const uploaded = await upload({ bytes: syntheticPdf(), mime: "application/pdf", name: "synthetic-manual.pdf", fields: { pageRange: "2" } });
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const job = await settled(uploaded.json<ManualImport>().id);
  assert.equal(job.status, "awaiting_confirmation", job.reason);
  assert(job.files.some(file => file.original && file.mimeType === "application/pdf"));
  assert(job.files.some(file => !file.original && file.pageNumber === 2 && file.mimeType.startsWith("image/")));
  assert.equal(job.files.some(file => file.pageNumber === 1), false);
  const fileCount = (await list(service.db, "files")).length;
  for (const range of ["0", "3", "2-1", "1-999", "bad"]) {
    const response = await upload({ bytes: syntheticPdf(), mime: "application/pdf", name: "synthetic-manual.pdf", fields: { pageRange: range } });
    assert([400, 413, 422].includes(response.statusCode), `${range}: ${response.body}`);
  }
  for (const invalid of [
    { bytes: Buffer.from("not an image"), mime: "image/png", name: "wrong.png" },
    { bytes: Buffer.from("not a pdf"), mime: "application/pdf", name: "wrong.pdf" },
    { bytes: Buffer.from("<svg></svg>"), mime: "image/svg+xml", name: "wrong.svg" },
  ]) assert.equal((await upload(invalid)).statusCode, 400);
  assert.equal((await upload({ fields: { consent: "false" } })).statusCode, 400);
  assert.equal((await list(service.db, "files")).length, fileCount);
});

test("multiple page images keep their order while mixed and over-limit uploads leave no orphan files", async () => {
  const bytes = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#176f91" } }).png().toBuffer();
  const page = { bytes, mime: "image/png", name: "synthetic-page.png" };
  upstreamResponse = completed(candidate([row({ pageNumbers: [2] })]));
  const response = await upload({ items: [page, { ...page, name: "synthetic-second-page.png" }] });
  assert.equal(response.statusCode, 200, response.body);
  const job = await settled(response.json<ManualImport>().id);
  assert.equal(job.status, "awaiting_confirmation", job.reason);
  assert.deepEqual(job.files.map(file => file.pageNumber), [1, 2]);
  const count = (await list(service.db, "files")).length;
  const mixed = await upload({ items: [page, { bytes: syntheticPdf(), mime: "application/pdf", name: "synthetic.pdf" }] });
  assert.equal(mixed.statusCode, 400, mixed.body);
  const over = await upload({ items: Array.from({ length: 13 }, () => page) });
  assert([400, 413].includes(over.statusCode), over.body);
  const large = await upload({ bytes: Buffer.alloc(8 * 1024 * 1024 + 1), mime: "image/png" });
  assert.equal(large.statusCode, 413, large.body);
  assert.equal((await list(service.db, "files")).length, count);
});

test("manual failures remain retryable without exposing provider messages or allowing premature publication", async () => {
  upstreamStatus = 503;
  upstreamResponse = { error: { message: "must-not-expose-provider-private-detail" } };
  const job = await settled((await upload()).json<ManualImport>().id);
  assert.equal(job.status, "failed");
  assert.equal(JSON.stringify(job).includes("must-not-expose-provider-private-detail"), false);
  assert.equal((await call("admin", "POST", `/admin/manual-imports/${job.id}/publish`, publishing(job))).statusCode, 409);
  upstreamStatus = 200;
  upstreamResponse = completed();
  assert.equal((await call("owner", "POST", `/admin/manual-imports/${job.id}/retry`)).statusCode, 403);
  assert.equal((await call("admin", "POST", `/admin/manual-imports/${job.id}/retry`)).statusCode, 200);
  assert.equal((await settled(job.id)).status, "awaiting_confirmation");
  service.config.aiKey = "";
  const unconfigured = (await upload()).json<ManualImport>();
  assert.equal(unconfigured.status, "failed");
  assert.equal((await call("admin", "POST", `/admin/manual-imports/${unconfigured.id}/retry`)).statusCode, 503);
  service.config.aiKey = "fake-manual-key";
  const blocked = await call("admin", "POST", "/admin/manual-imports/from-url", { modelId: "model-electric", sourceTitle: "不应下载内部地址", sourceUrl: "http://127.0.0.1/internal.pdf", consent: true });
  assert.equal(blocked.statusCode, 400, blocked.body);
});
