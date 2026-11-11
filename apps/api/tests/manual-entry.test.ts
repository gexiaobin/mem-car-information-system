import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import type { BookingInput, Bootstrap, MaintenanceRule, Observation, Slot } from "@autovoyage/shared";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { get, list, put } from "../src/db.js";

const origin = "http://localhost:5173";
const password = "TestPassword2026!";
let service: Awaited<ReturnType<typeof createApp>>;
let temporary: string;
let control: pg.Client | undefined;
let schema: string | undefined;
const testSchema = /^av_test_manual_entry_[a-f0-9]{16}$/;
const cookies: Record<string, string> = {};
let slotNumber = 0;

async function call(
  role: string,
  method: "GET" | "POST",
  path: string,
  payload?: unknown,
) {
  return service.app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { origin, cookie: cookies[role] || "" },
    payload: payload as Record<string, unknown>,
  });
}
async function data(): Promise<Bootstrap> {
  const response = await call("owner", "GET", "/bootstrap");
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}
async function slot(capacity = 2): Promise<Slot> {
  slotNumber++;
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 20 + slotNumber);
  start.setUTCHours(1, 0, 0, 0);
  const res = await call("store", "POST", "/admin/slots", {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 3600000).toISOString(),
    capacity,
    active: true,
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}
async function bookingInput(slotId: string): Promise<BookingInput> {
  const bootstrap = await data();
  const offers = bootstrap.offers.filter(
    (o) =>
      o.storeId === "store-coast" &&
      o.modelId === "model-sedan" &&
      o.projectId === "project-oil",
  );
  return {
    vehicleId: "vehicle-sedan",
    offerIds: offers.map((o) => o.id),
    slotId,
    expectedVersions: Object.fromEntries(offers.map((o) => [o.id, o.version])),
    requestId: crypto.randomUUID(),
  };
}
const stamp = (offsetMs: number) =>
  new Date(Date.now() + offsetMs).toISOString().replace("Z", "+00:00");

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "autovoyage-manual-entry-"));
  const base = loadConfig({ production: false, seedDemo: false, sessionSecret: "test-secret-at-least-32-characters-long" });
  if (process.env.AV_MANUAL_PG_TEST === "1") {
    const { schema: _schema, ...connection } = base.pg;
    assert(connection.password, "PostgreSQL manual entry tests require configured credentials");
    control = new pg.Client({ ...connection, connectionTimeoutMillis: 10000 });
    await control.connect();
    schema = `av_test_manual_entry_${crypto.randomBytes(8).toString("hex")}`;
    assert(testSchema.test(schema) && schema !== "public");
    await control.query(`CREATE SCHEMA "${schema}"`);
  }
  service = await createApp({
    config: loadConfig({
      production: false,
      driver: "pglite",
      pglitePath: ":memory:",
      seedDemo: true,
      demoMode: true,
      demoPassword: password,
      sessionSecret: "test-secret-at-least-32-characters-long",
      uploadDir: temporary,
      aiBaseUrl: "",
      aiKey: "",
      aiModel: "",
      origin,
      ...(schema ? { driver: "postgres", pg: { ...base.pg, schema } } : {}),
    }),
  });
  for (const [role, email] of Object.entries({
    owner: "owner@autovoyage.demo",
    store: "store@autovoyage.demo",
    admin: "admin@autovoyage.demo",
  })) {
    const res = await call("guest", "POST", "/auth/login", { email, password });
    assert.equal(res.statusCode, 200, res.body);
    cookies[role] = String(res.headers["set-cookie"]).split(";")[0];
  }
});

after(async () => {
  try {
    await service?.app.close();
  } finally {
    try {
      if (schema && control) {
        assert(testSchema.test(schema) && schema !== "public");
        await control.query(`DROP SCHEMA "${schema}" CASCADE`);
        assert.equal((await control.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).rowCount, 0, "temporary manual entry schema must be removed");
      }
    } finally {
      await control?.end();
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  }
});

test("manual mileage keeps the image guardrails and recalculates maintenance", async () => {
  const rollback = await call("owner", "POST", "/vehicles/vehicle-sedan/mileage", {
    totalKm: 20000,
    observedAt: stamp(1000),
  });
  assert.equal(rollback.statusCode, 409, rollback.body);
  assert.equal(rollback.json().error.code, "MILEAGE_ROLLBACK");

  const future = await call("owner", "POST", "/vehicles/vehicle-sedan/mileage", {
    totalKm: 28700,
    observedAt: stamp(3600000),
  });
  assert.equal(future.statusCode, 400);
  assert.equal(future.json().error.code, "FUTURE_DATE");

  const stale = await call("owner", "POST", "/vehicles/vehicle-sedan/mileage", {
    totalKm: 28700,
    observedAt: new Date(Date.now() - 86400000).toISOString().replace("Z", "+00:00"),
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, "OLD_IMAGE");
  assert.match(stale.json().error.message, /手工|时间/);

  const saved = await call("owner", "POST", "/vehicles/vehicle-sedan/mileage", {
    totalKm: 28700,
    observedAt: stamp(2000),
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const vehicle = (await data()).vehicles.find((v) => v.id === "vehicle-sedan")!;
  assert.equal(vehicle.totalKm, 28700);
  const observations = await list<Observation>(service.db, "observations");
  const manual = observations.filter(o => o.vehicleId === "vehicle-sedan").at(-1)!;
  assert.equal(manual.totalKm, 28700);
  assert.match(manual.source, /\u624b\u5de5/);
  assert.equal((await call("store", "POST", "/vehicles/vehicle-sedan/mileage", { totalKm: 28800, observedAt: stamp(3000) })).statusCode, 403);
});

test("owners can backfill service records with standard or free-text items", async () => {
  const missing = await call("owner", "POST", "/vehicles/vehicle-sedan/service-records", {
    completedAt: stamp(4000),
    totalKm: 28700,
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error.code, "PROJECT_REQUIRED");

  const lower = await call("owner", "POST", "/vehicles/vehicle-sedan/service-records", {
    projectId: "project-cabin",
    completedAt: stamp(4000),
    totalKm: 100,
  });
  assert.equal(lower.statusCode, 409);
  assert.equal(lower.json().error.code, "MILEAGE_ROLLBACK");

  const standard = await call("owner", "POST", "/vehicles/vehicle-sedan/service-records", {
    projectId: "project-cabin",
    completedAt: stamp(4000),
    totalKm: 29000,
    totalCents: 25000,
    note: "路边店更换空调滤芯",
  });
  assert.equal(standard.statusCode, 200, standard.body);

  const freeText = await call("owner", "POST", "/vehicles/vehicle-sedan/service-records", {
    customItemName: "加装倒车雷达",
    completedAt: stamp(4000),
    totalKm: 29000,
  });
  assert.equal(freeText.statusCode, 200, freeText.body);
  assert.equal(freeText.json().projectId, "");

  const bootstrap = await data();
  const records = bootstrap.serviceRecords.filter((r) => r.vehicleId === "vehicle-sedan");
  const backed = records.find((r) => r.id === standard.json().id)!;
  assert.equal(backed.unverified, true);
  assert.equal(backed.source, "车主自行记录（未经门店确认）");
  assert.equal(bootstrap.vehicles.find((v) => v.id === "vehicle-sedan")!.totalKm, 29000);
  assert.equal(records.find((r) => r.id === freeText.json().id)!.customItemName, "加装倒车雷达");

  const future = await call("owner", "POST", "/vehicles/vehicle-sedan/service-records", {
    customItemName: "未来的保养",
    completedAt: stamp(3600000),
    totalKm: 29000,
  });
  assert.equal(future.statusCode, 400);
  assert.equal(future.json().error.code, "FUTURE_DATE");

  const tooLong = await call("owner", "POST", "/vehicles/vehicle-sedan/service-records", {
    customItemName: "x".repeat(61),
    completedAt: stamp(4000),
    totalKm: 29000,
  });
  assert.equal(tooLong.statusCode, 400);
  assert.equal(tooLong.json().error.code, "VALIDATION_ERROR");

  const invalidProject = await call("owner", "POST", "/vehicles/vehicle-sedan/service-records", {
    projectId: "project-missing",
    completedAt: stamp(4000),
    totalKm: 29000,
  });
  assert.equal(invalidProject.statusCode, 400);
  assert.equal(invalidProject.json().error.code, "INVALID_PROJECT");
});

test("historical service mileage stays between observations and never rewrites current mileage", async () => {
  const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
  const created = await call("owner", "POST", "/vehicles", {
    modelId: "model-sedan", plate: "鲁B·BACKFILL", name: "历史补录时间线",
    startDate: ago(60).slice(0, 10), initialKm: 1000,
  });
  assert.equal(created.statusCode, 200, created.body);
  const vehicleId = created.json().id;
  const oldAt = ago(30), currentAt = ago(1);
  for (const [totalKm, observedAt] of [[5000, oldAt], [20000, currentAt]] as const) {
    const mileage = await call("owner", "POST", `/vehicles/${vehicleId}/mileage`, { totalKm, observedAt });
    assert.equal(mileage.statusCode, 200, mileage.body);
  }
  const before = (await data()).vehicles.find(vehicle => vehicle.id === vehicleId)!;
  const historicAt = ago(7);
  const historic = await call("owner", "POST", `/vehicles/${vehicleId}/service-records`, {
    projectId: "project-cabin", completedAt: historicAt, totalKm: 10000,
    note: "历史保养凭个人记录补入",
  });
  assert.equal(historic.statusCode, 200, historic.body);
  assert.equal(historic.json().unverified, true);
  assert.equal(historic.json().note, "历史保养凭个人记录补入");
  assert.deepEqual((await data()).vehicles.find(vehicle => vehicle.id === vehicleId), before);

  for (const [completedAt, totalKm, code] of [
    [historicAt, 4000, "MILEAGE_ROLLBACK"],
    [historicAt, 21000, "MILEAGE_TIMELINE_CONFLICT"],
    [ago(31), 6000, "MILEAGE_TIMELINE_CONFLICT"],
  ] as const) {
    const invalid = await call("owner", "POST", `/vehicles/${vehicleId}/service-records`, {
      customItemName: "时间线冲突", completedAt, totalKm,
    });
    assert.equal(invalid.statusCode, 409, invalid.body);
    assert.equal(invalid.json().error.code, code);
  }
  const recordAt = stamp(1000);
  const current = await call("owner", "POST", `/vehicles/${vehicleId}/service-records`, {
    projectId: "project-cabin", completedAt: recordAt, totalKm: 21000,
  });
  assert.equal(current.statusCode, 200, current.body);
  const advanced = (await data()).vehicles.find(vehicle => vehicle.id === vehicleId)!;
  assert.equal(advanced.totalKm, 21000);
  assert.equal(advanced.observedAt, recordAt);
  const history = await call("owner", "GET", `/vehicles/${vehicleId}/history`);
  assert.ok(history.json().observations.some((point: Observation) => point.totalKm === 21000 && point.observedAt === recordAt));
  const abnormal = await call("owner", "POST", `/vehicles/${vehicleId}/service-records`, {
    customItemName: "异常里程", completedAt: stamp(2000), totalKm: 40000,
  });
  assert.equal(abnormal.statusCode, 409, abnormal.body);
  assert.equal(abnormal.json().error.code, "MILEAGE_ABNORMAL");
  assert.deepEqual((await data()).vehicles.find(vehicle => vehicle.id === vehicleId), advanced);
});

test("appointments store owner-supplied extra items without touching pricing", async () => {
  const targetSlot = await slot();
  const input = await bookingInput(targetSlot.id);
  const withExtras = { ...input, customItems: ["加装行车记录仪", "检查胎压"] };
  const created = await call("owner", "POST", "/appointments", withExtras);
  assert.equal(created.statusCode, 200, created.body);
  const appointment = created.json();
  assert.deepEqual(appointment.customItems, ["加装行车记录仪", "检查胎压"]);
  assert.equal(appointment.snapshot.length, 1, "custom items never become priced snapshot rows");

  const repeated = await call("owner", "POST", "/appointments", withExtras);
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.equal(repeated.json().id, appointment.id);

  const changed = await call("owner", "POST", "/appointments", {
    ...withExtras,
    customItems: ["加装行车记录仪"],
  });
  assert.equal(changed.statusCode, 409);
  assert.equal(changed.json().error.code, "IDEMPOTENCY_CONFLICT");

  const duplicated = await call("owner", "POST", "/appointments", {
    ...input,
    requestId: crypto.randomUUID(),
    customItems: ["重复项目", "重复项目"],
  });
  assert.equal(duplicated.statusCode, 400);
  assert.equal(duplicated.json().error.code, "DUPLICATE_CUSTOM_ITEM");

  const oversized = await call("owner", "POST", "/appointments", {
    ...input,
    requestId: crypto.randomUUID(),
    customItems: ["y".repeat(61)],
  });
  assert.equal(oversized.statusCode, 400);
  assert.equal(oversized.json().error.code, "VALIDATION_ERROR");

  await call("owner", "POST", `/appointments/${appointment.id}/action`, {
    action: "cancel",
    reason: "测试结束",
  });
});

test("retries of pre-upgrade bookings keep the legacy request identity without extras", async () => {
  const targetSlot = await slot();
  const input = await bookingInput(targetSlot.id);
  const created = await call("owner", "POST", "/appointments", input);
  assert.equal(created.statusCode, 200, created.body);
  const appointment = created.json();
  const legacyHash = JSON.stringify({
    vehicleId: input.vehicleId, slotId: input.slotId,
    offerIds: [...input.offerIds].sort(),
    expectedVersions: Object.fromEntries(Object.entries(input.expectedVersions).sort()),
    faultId: input.faultId || null,
  });
  const stored = await get<{ id: string; requestHash: string }>(service.db, "appointments", appointment.id);
  assert.equal(stored?.requestHash, legacyHash, "new requests with empty extras preserve the historical shape");
  // Model the row an earlier release stored, without migrating or rewriting old rows at startup.
  await put(service.db, "appointments", { ...appointment, requestHash: legacyHash });
  for (const request of [input, { ...input, customItems: [] }]) {
    const repeated = await call("owner", "POST", "/appointments", request);
    assert.equal(repeated.statusCode, 200, repeated.body);
    assert.equal(repeated.json().id, appointment.id);
  }
  const changed = await call("owner", "POST", "/appointments", { ...input, customItems: ["追加项目"] });
  assert.equal(changed.statusCode, 409, changed.body);
  assert.equal(changed.json().error.code, "IDEMPOTENCY_CONFLICT");
  await call("owner", "POST", `/appointments/${appointment.id}/action`, { action: "cancel", reason: "测试结束" });
});

test("platform staff can type a printed maintenance table into a reviewable draft", async () => {
  const row = {
    id: "manual-row-1", name: "发动机机油及机油滤清器", projectId: "project-oil", createProject: false, include: true,
    action: "replace", triggerType: "periodic", firstMonths: null, firstKm: 5000, intervalMonths: null, intervalKm: 10000,
    mileageType: "total_km", condition: "", notes: "", sourceText: "手册保养表：每 10,000 km 或 12 个月更换，首保 5,000 km", pageNumbers: [],
  };
  const empty = await call("admin", "POST", "/admin/manual-imports/manual-entry", {
    modelId: "model-sedan", consent: true, sourceTitle: "", sourceUrl: "", edition: "", applicability: "", sourceExcerpt: "", rows: [],
  });
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.json().error.code, "VALIDATION_ERROR");

  const withoutEvidence = await call("admin", "POST", "/admin/manual-imports/manual-entry", {
    modelId: "model-sedan", consent: true, sourceTitle: "缺少依据的草稿", sourceUrl: "", edition: "", applicability: "", sourceExcerpt: "",
    rows: [{ ...row, id: "manual-row-no-evidence", sourceText: "" }],
  });
  assert.equal(withoutEvidence.statusCode, 200, withoutEvidence.body);
  const draftWithoutEvidence = withoutEvidence.json();
  const blocked = await call("admin", "POST", `/admin/manual-imports/${draftWithoutEvidence.id}/publish`, {
    expectedRevision: draftWithoutEvidence.revision, verified: true, applicabilityConfirmed: true,
    draft: { rows: draftWithoutEvidence.rows, sourceTitle: draftWithoutEvidence.sourceTitle, sourceUrl: "", edition: "", applicability: "", sourceExcerpt: "" },
  });
  assert.equal(blocked.statusCode, 422, blocked.body);
  assert.equal(blocked.json().error.code, "MANUAL_REVIEW_REQUIRED");
  assert.ok(blocked.json().error.issues.some((issue: { field: string }) => issue.field === "sourceText"),
    "manual rows still need a written basis, just not a page number");

  const created = await call("admin", "POST", "/admin/manual-imports/manual-entry", {
    modelId: "model-sedan", consent: true, sourceTitle: "合成车型保养表（纸质）", sourceUrl: "", edition: "2026 修订", applicability: "2024-2026 款 1.4T",
    sourceExcerpt: "", rows: [row],
  });
  assert.equal(created.statusCode, 200, created.body);
  const draft = created.json();
  assert.equal(draft.entryMode, "manual");
  assert.equal(draft.aiModel, "手工录入");
  assert.equal(draft.status, "awaiting_confirmation");
  assert.deepEqual(draft.files, []);
  assert.equal(draft.rows.length, 1);
  assert.equal(draft.warnings.length, 1);

  const forbidden = await call("store", "POST", "/admin/manual-imports/manual-entry", {
    modelId: "model-sedan", consent: true, sourceTitle: "", sourceUrl: "", edition: "", applicability: "", sourceExcerpt: "", rows: [row],
  });
  assert.equal(forbidden.statusCode, 403);

  const published = await call("admin", "POST", `/admin/manual-imports/${draft.id}/publish`, {
    expectedRevision: draft.revision, verified: true, applicabilityConfirmed: true,
    draft: { rows: draft.rows, sourceTitle: draft.sourceTitle, sourceUrl: "", edition: draft.edition, applicability: draft.applicability, sourceExcerpt: "" },
  });
  assert.equal(published.statusCode, 200, published.body);
  const job = published.json();
  assert.equal(job.status, "published");
  assert.equal(job.publishedRuleIds.length, 1, "manual rows publish the same way as recognised ones");
  const rules = await list<MaintenanceRule>(service.db, "rules");
  const rule = rules.find(item => item.id === job.publishedRuleIds[0])!;
  assert.equal(rule.modelId, "model-sedan");
  assert.equal(rule.intervalKm, 10000);
  assert.equal(rule.sourceTitle, "合成车型保养表（纸质）");
});

test("typed manual tables map exact standard services and leave unknown items for review", async () => {
  const beforeProjects = await list(service.db, "projects");
  const beforeRules = await list(service.db, "rules");
  const base = {
    projectId: null, catalogProjectId: null, createProject: false, include: true,
    action: "replace", triggerType: "periodic", firstMonths: null, firstKm: null,
    intervalMonths: 12, intervalKm: 10000, mileageType: "total_km", condition: "", notes: "",
    sourceText: "纸质手册保养表，每10000公里或12个月更换", pageNumbers: [],
  };
  const response = await call("admin", "POST", "/admin/manual-imports/manual-entry", {
    modelId: "model-sedan", consent: true, sourceTitle: "手工表格自动关联验证", sourceUrl: "",
    edition: "", applicability: "", sourceExcerpt: "", rows: [
      { ...base, id: "typed-oil", name: "发动机机油及机油滤清器" },
      { ...base, id: "typed-air", name: "发动机空气滤清器", include: false },
      { ...base, id: "typed-unknown", name: "手册未明确的特殊总成" },
      { ...base, id: "typed-cabin", name: "空调滤清器", projectId: "project-cabin" },
    ],
  });
  assert.equal(response.statusCode, 200, response.body);
  const rows = response.json().rows;
  assert.equal(rows[0].projectId, "project-oil");
  assert.ok(rows[1].catalogProjectId, "unambiguous reference service is proposed without creating it");
  assert.equal(rows[1].include, false, "auto-mapping never changes import selection");
  assert.equal(rows[2].projectId, null);
  assert.equal(rows[2].catalogProjectId, null);
  assert.equal(rows[2].createProject, false);
  assert.equal(rows[3].projectId, "project-cabin", "explicit user mappings remain owned by the user");
  assert.deepEqual(await list(service.db, "projects"), beforeProjects);
  assert.deepEqual(await list(service.db, "rules"), beforeRules);
});
