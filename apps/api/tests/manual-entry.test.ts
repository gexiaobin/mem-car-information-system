import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BookingInput, Bootstrap, MaintenanceRule, Observation, Slot } from "@autovoyage/shared";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { list } from "../src/db.js";

const origin = "http://localhost:5173";
const password = "TestPassword2026!";
let service: Awaited<ReturnType<typeof createApp>>;
let temporary: string;
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
  await service?.app.close();
  if (temporary) await rm(temporary, { recursive: true, force: true });
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
