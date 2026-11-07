import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type {
  Appointment,
  BookingInput,
  Bootstrap,
  ImportJob,
  Offer,
  Slot,
  Vehicle,
} from "@autovoyage/shared";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { get, put } from "../src/db.js";
import {
  addMonthsClamped,
  hashPassword,
  maintenanceFor,
  shanghaiDay,
} from "../src/domain.js";
let service: Awaited<ReturnType<typeof createApp>>;
let temporary: string;
const cookies: Record<string, string> = {};
const origin = "http://localhost:5173";
let slotNumber = 0;
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "autovoyage-api-"));
  service = await createApp({
    config: loadConfig({
      production: false,
      driver: "pglite",
      pglitePath: ":memory:",
      seedDemo: true,
      demoMode: true,
      demoPassword: "TestPassword2026!",
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
    expert: "expert@autovoyage.demo",
    admin: "admin@autovoyage.demo",
  })) {
    const res = await service.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin },
      payload: { email, password: "TestPassword2026!" },
    });
    assert.equal(res.statusCode, 200, res.body);
    cookies[role] = String(res.headers["set-cookie"]).split(";")[0];
  }
  await put(service.db, "users", {
    id: "owner-other",
    name: "其他车主",
    email: "other@autovoyage.demo",
    role: "owner",
    storeId: null,
    active: true,
    passwordHash: await hashPassword("TestPassword2026!"),
  });
  await put(service.db, "vehicles", {
    id: "vehicle-other",
    ownerId: "owner-other",
    modelId: "model-sedan",
    plate: "鲁B-OTHER",
    name: "其他车辆",
    startDate: "2025-01-01",
    initialKm: 0,
    totalKm: 1000,
    observedAt: new Date(Date.now() - 86400000).toISOString(),
    isDemo: true,
  });
  const res = await service.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin },
    payload: { email: "other@autovoyage.demo", password: "TestPassword2026!" },
  });
  cookies.other = String(res.headers["set-cookie"]).split(";")[0];
});
after(async () => {
  await service?.app.close();
  await rm(temporary, { recursive: true, force: true });
});
async function call(
  role: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
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
async function data(role = "owner"): Promise<Bootstrap> {
  const response = await call(role, "GET", "/bootstrap");
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}
async function slot(capacity = 2): Promise<Slot> {
  slotNumber++;
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 15 + slotNumber);
  start.setUTCHours(1, 0, 0, 0);
  const end = new Date(start.getTime() + 3600000);
  const res = await call("store", "POST", "/admin/slots", {
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    capacity,
    active: true,
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}
async function bookingInput(
  slotId: string,
  vehicleId = "vehicle-sedan",
  multi = false,
): Promise<BookingInput> {
  const bootstrap = await data();
  const offers = bootstrap.offers.filter(
    (o) =>
      o.storeId === "store-coast" &&
      o.modelId === "model-sedan" &&
      (multi
        ? ["project-oil", "project-cabin"].includes(o.projectId)
        : o.projectId === "project-oil"),
  );
  return {
    vehicleId,
    offerIds: offers.map((o) => o.id),
    slotId,
    expectedVersions: Object.fromEntries(offers.map((o) => [o.id, o.version])),
    requestId: crypto.randomUUID(),
  };
}
test("authentication, CSRF origin and ownership are enforced", async () => {
  assert.equal(
    (await service.app.inject({ method: "GET", url: "/api/v1/bootstrap" }))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await service.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { origin: "https://attacker.invalid" },
        payload: {
          email: "owner@autovoyage.demo",
          password: "TestPassword2026!",
        },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call("owner", "PATCH", "/vehicles/vehicle-other", {
        name: "越权修改",
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await call("owner", "POST", "/admin/slots", { startsAt: "x" })).statusCode,
    403,
  );
  assert.equal(
    (await call("expert", "POST", "/admin/offers", {})).statusCode,
    403,
  );
  const owner = await data();
  assert(owner.vehicles.every((v) => v.ownerId === owner.user.id));
  assert.equal(owner.users.length, 0);
  assert.equal(owner.logs.length, 0);
});
test("stale offer versions cannot be booked and snapshots stay immutable", async () => {
  const targetSlot = await slot();
  const input = await bookingInput(targetSlot.id);
  const offer = (await data("store")).offers.find(
    (o) => o.id === input.offerIds[0],
  )!;
  const version = await call(
    "store",
    "POST",
    `/admin/offers/${offer.id}/version`,
    {
      ...offer,
      materialCents: offer.materialCents + 100,
      totalCents: offer.totalCents! + 100,
    },
  );
  assert.equal(version.statusCode, 200, version.body);
  const stale = await call("owner", "POST", "/appointments", input);
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, "PRICE_CHANGED");
  input.expectedVersions[offer.id] = offer.version + 1;
  const res = await call("owner", "POST", "/appointments", input);
  assert.equal(res.statusCode, 200, res.body);
  const a = res.json<Appointment>();
  await call("store", "POST", `/admin/offers/${offer.id}/version`, {
    ...version.json<Offer>(),
    materialCents: offer.materialCents + 200,
    totalCents: offer.totalCents! + 200,
  });
  assert.equal(
    (await get<Appointment>(service.db, "appointments", a.id))!.snapshot[0]
      .totalCents,
    a.totalCents,
  );
  assert.equal(
    (await get<Slot>(service.db, "slots", targetSlot.id))!.reserved,
    1,
  );
  await call("owner", "POST", `/appointments/${a.id}/action`, {
    action: "cancel",
    reason: "测试结束",
  });
});
test("last slot is atomic across concurrent owners and cancellation releases once", async () => {
  const targetSlot = await slot(1);
  const first = await bookingInput(targetSlot.id);
  const second = {
    ...first,
    vehicleId: "vehicle-other",
    requestId: crypto.randomUUID(),
  };
  const [a, b] = await Promise.all([
    call("owner", "POST", "/appointments", first),
    call("other", "POST", "/appointments", second),
  ]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
  const winner = a.statusCode === 200 ? "owner" : "other";
  const booking = (a.statusCode === 200 ? a : b).json<Appointment>();
  assert.equal(
    (await get<Slot>(service.db, "slots", targetSlot.id))!.reserved,
    1,
  );
  const cancel = await call(
    winner,
    "POST",
    `/appointments/${booking.id}/action`,
    { action: "cancel", reason: "时间调整" },
  );
  assert.equal(cancel.statusCode, 200, cancel.body);
  assert.equal(
    (
      await call(winner, "POST", `/appointments/${booking.id}/action`, {
        action: "cancel",
        reason: "重试",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await get<Slot>(service.db, "slots", targetSlot.id))!.reserved,
    0,
  );
});
test("equivalent timezone offsets cannot create overlapping slots or bypass vehicle conflicts", async () => {
  const original = await slot(2);
  const local = (value: string) =>
    new Date(Date.parse(value) + 8 * 3600000)
      .toISOString()
      .replace("Z", "+08:00");
  const overlap = await call("store", "POST", "/admin/slots", {
    startsAt: local(original.startsAt),
    endsAt: local(original.endsAt),
    capacity: 2,
  });
  assert.equal(overlap.statusCode, 409, overlap.body);
  assert.equal(overlap.json().error.code, "OVERLAPPING_SLOT");
  const legacy = {
    ...original,
    id: "legacy-offset-slot",
    startsAt: local(original.startsAt),
    endsAt: local(original.endsAt),
  };
  await put(service.db, "slots", legacy);
  const input = await bookingInput(original.id);
  const first = await call("owner", "POST", "/appointments", input);
  assert.equal(first.statusCode, 200, first.body);
  const second = await call("owner", "POST", "/appointments", {
    ...input,
    slotId: legacy.id,
    requestId: crypto.randomUUID(),
  });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, "VEHICLE_TIME_CONFLICT");
  await call("owner", "POST", `/appointments/${first.json().id}/action`, {
    action: "cancel",
    reason: "测试结束",
  });
});
test("idempotency returns one booking and rejects request-key reuse with changed payload", async () => {
  const targetSlot = await slot();
  const input = await bookingInput(targetSlot.id);
  const [a, b] = await Promise.all([
    call("owner", "POST", "/appointments", input),
    call("owner", "POST", "/appointments", input),
  ]);
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(b.statusCode, 200, b.body);
  assert.equal(a.json().id, b.json().id);
  assert.equal(
    (await get<Slot>(service.db, "slots", targetSlot.id))!.reserved,
    1,
  );
  const other = await slot();
  const changed = await call("owner", "POST", "/appointments", {
    ...input,
    slotId: other.id,
  });
  assert.equal(changed.statusCode, 409);
  assert.equal(changed.json().error.code, "IDEMPOTENCY_CONFLICT");
  await call("owner", "POST", `/appointments/${a.json().id}/action`, {
    action: "cancel",
    reason: "测试结束",
  });
});
test("service changes require approval; completion only resets completed projects", async () => {
  const targetSlot = await slot();
  const input = await bookingInput(targetSlot.id, "vehicle-sedan", true);
  const quotedOffers = (await data()).offers.filter((o) =>
    input.offerIds.includes(o.id),
  );
  assert.equal(quotedOffers.length, 2);
  const quotedTotal = quotedOffers.reduce((sum, o) => sum + o.totalCents!, 0);
  const a = (
    await call("owner", "POST", "/appointments", input)
  ).json<Appointment>();
  assert(a.id);
  assert.equal(a.snapshot.length, 2);
  assert.deepEqual(
    a.snapshot.map((s) => s.offerId).sort(),
    input.offerIds.slice().sort(),
  );
  assert.equal(a.totalCents, quotedTotal);
  assert.equal(a.finalCents, quotedTotal);
  assert.equal(
    (
      await call("store", "POST", `/appointments/${a.id}/action`, {
        action: "confirm",
      })
    ).statusCode,
    200,
  );
  const change = await call("store", "POST", `/appointments/${a.id}/changes`, {
    reason: "材料升级",
    description: "车主可核对后选择接受或拒绝",
    proposedCents: a.totalCents + 1000,
  });
  assert.equal(change.statusCode, 200, change.body);
  const pending = await call("store", "POST", `/appointments/${a.id}/action`, {
    action: "finish",
    completedProjectIds: ["project-oil"],
    serviceKm: 29000,
  });
  assert.equal(pending.statusCode, 409);
  assert.equal(pending.json().error.code, "CHANGE_PENDING");
  assert.equal(
    (
      await call("owner", "POST", `/changes/${change.json().id}/decision`, {
        approved: true,
      })
    ).statusCode,
    200,
  );
  const approved = await get<Appointment>(service.db, "appointments", a.id);
  assert.equal(approved!.totalCents, quotedTotal);
  assert.equal(approved!.finalCents, quotedTotal + 1000);
  const finish = await call("store", "POST", `/appointments/${a.id}/action`, {
    action: "finish",
    completedProjectIds: ["project-oil"],
    serviceKm: 29000,
  });
  assert.equal(finish.statusCode, 200, finish.body);
  let bootstrap = await data();
  assert.equal(
    bootstrap.serviceRecords.filter((r) => r.appointmentId === a.id).length,
    0,
  );
  assert.equal(
    (
      await call("owner", "POST", `/appointments/${a.id}/action`, {
        action: "complete",
      })
    ).statusCode,
    200,
  );
  bootstrap = await data();
  assert.equal(
    bootstrap.appointments.find((item) => item.id === a.id)!.finalCents,
    quotedTotal + 1000,
  );
  assert.deepEqual(
    bootstrap.serviceRecords
      .filter((r) => r.appointmentId === a.id)
      .map((r) => r.projectId),
    ["project-oil"],
  );
  assert.equal(
    bootstrap.maintenance.find(
      (m) => m.vehicleId === "vehicle-sedan" && m.projectId === "project-oil",
    )!.dueKm,
    34000,
  );
  assert.equal(
    bootstrap.maintenance.find(
      (m) => m.vehicleId === "vehicle-sedan" && m.projectId === "project-cabin",
    )!.dueKm,
    5000,
  );
  assert.equal(
    (
      await call("owner", "POST", `/appointments/${a.id}/action`, {
        action: "complete",
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await data()).serviceRecords.filter((r) => r.appointmentId === a.id)
      .length,
    1,
  );
});
test("message read operations are scoped to the recipient and reminders are deduplicated", async () => {
  const a = await data();
  const count = a.messages.length;
  const b = await data();
  assert.equal(b.messages.length, count);
  const message = a.messages[0];
  assert(message);
  assert.equal(
    (await call("other", "POST", `/messages/${message.id}/read`)).statusCode,
    403,
  );
  assert.equal(
    (await call("owner", "POST", `/messages/${message.id}/read`)).statusCode,
    200,
  );
  assert((await data()).messages.find((m) => m.id === message.id)!.readAt);
});
test("fault bookings require diagnostic scope and cancellation/expiry allow rebooking", async () => {
  const confirmed = await call("owner", "POST", "/faults/fault-demo/confirm");
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  const target = await slot();
  const oil = await bookingInput(target.id);
  const wrong = await call("owner", "POST", "/appointments", {
    ...oil,
    faultId: "fault-demo",
  });
  assert.equal(wrong.statusCode, 409);
  assert.equal(wrong.json().error.code, "DIAGNOSIS_SCOPE_REQUIRED");
  const diagnostic = (await data()).offers.find(
    (o) =>
      o.storeId === "store-coast" &&
      o.modelId === "model-sedan" &&
      o.projectId === "project-diagnosis",
  )!;
  assert(diagnostic);
  const input = {
    ...oil,
    offerIds: [diagnostic.id],
    expectedVersions: { [diagnostic.id]: diagnostic.version },
    faultId: "fault-demo",
  };
  const booked = await call("owner", "POST", "/appointments", input);
  assert.equal(booked.statusCode, 200, booked.body);
  assert.equal(
    (await data()).faults.find((f) => f.id === "fault-demo")!.status,
    "booked",
  );
  await call("owner", "POST", `/appointments/${booked.json().id}/action`, {
    action: "cancel",
    reason: "更换时间",
  });
  assert.equal(
    (await data()).faults.find((f) => f.id === "fault-demo")!.status,
    "replied",
  );
  const retry = await call("owner", "POST", "/appointments", {
    ...input,
    requestId: crypto.randomUUID(),
  });
  assert.equal(retry.statusCode, 200, retry.body);
  const stored = await get<Appointment>(
    service.db,
    "appointments",
    retry.json().id,
  );
  await put(service.db, "appointments", {
    ...stored!,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.equal(
    (await data()).faults.find((f) => f.id === "fault-demo")!.status,
    "replied",
  );
  assert.equal((await get<Slot>(service.db, "slots", target.id))!.reserved, 0);
});
test("approved added projects are tracked separately without rewriting the original snapshot", async () => {
  const target = await slot();
  const input = await bookingInput(target.id);
  const response = await call("owner", "POST", "/appointments", input);
  assert.equal(response.statusCode, 200, response.body);
  const a = response.json<Appointment>();
  await call("store", "POST", `/appointments/${a.id}/action`, {
    action: "confirm",
  });
  const change = await call("store", "POST", `/appointments/${a.id}/changes`, {
    reason: "追加制动检查",
    description: "增加制动系统检查，所选范围与材料明细请车主核对",
    proposedCents: a.totalCents + 8000,
    proposedProjectIds: ["project-oil", "project-brake"],
  });
  assert.equal(change.statusCode, 200, change.body);
  assert.equal(change.json().proposedSnapshot.length, 2);
  await call("owner", "POST", `/changes/${change.json().id}/decision`, {
    approved: true,
  });
  const updated = await get<Appointment>(service.db, "appointments", a.id);
  assert.equal(updated!.snapshot.length, 1);
  assert.equal(updated!.approvedSnapshot!.length, 2);
  const finish = await call("store", "POST", `/appointments/${a.id}/action`, {
    action: "finish",
    completedProjectIds: ["project-brake"],
    serviceKm: 29000,
  });
  assert.equal(finish.statusCode, 200, finish.body);
  assert.equal(
    (
      await call("owner", "POST", `/appointments/${a.id}/action`, {
        action: "complete",
      })
    ).statusCode,
    200,
  );
  const records = (await data()).serviceRecords.filter(
    (r) => r.appointmentId === a.id,
  );
  assert.deepEqual(
    records.map((r) => r.projectId),
    ["project-brake"],
  );
});
test("calendar months clamp to month-end; time threshold works when mileage is missing", () => {
  assert.equal(addMonthsClamped("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsClamped("2024-01-31", 1), "2024-02-29");
  const v: Vehicle = {
    id: "v",
    ownerId: "u",
    modelId: "m",
    plate: "x",
    name: "x",
    startDate: "2026-01-31",
    initialKm: 0,
    totalKm: null,
    observedAt: null,
    isDemo: false,
  };
  const [result] = maintenanceFor(
    v,
    [
      {
        id: "p",
        code: "P",
        name: "测试",
        category: "测试",
        description: "",
        unit: "次",
        active: true,
      },
    ],
    [
      {
        id: "r",
        modelId: "m",
        projectId: "p",
        intervalMonths: 1,
        intervalKm: 1000,
        firstMonths: 1,
        firstKm: 1000,
        mileageType: "total_km",
        sourceTitle: "手册",
        sourceUrl: "https://example.com/manual",
        version: 1,
        verified: true,
        isDemo: false,
      },
    ],
    [],
    new Date("2026-02-28T01:00:00Z"),
  );
  assert.equal(result.status, "due");
  assert.equal(result.dueAt, "2026-02-28");
  const [serviceBaseline] = maintenanceFor(
    { ...v, totalKm: 500, observedAt: "2026-03-01T00:00:00Z" },
    [
      {
        id: "p",
        code: "P",
        name: "测试",
        category: "测试",
        description: "",
        unit: "次",
        active: true,
      },
    ],
    [
      {
        id: "r",
        modelId: "m",
        projectId: "p",
        intervalMonths: 1,
        intervalKm: 1000,
        firstMonths: 1,
        firstKm: 1000,
        mileageType: "total_km",
        sourceTitle: "手册",
        sourceUrl: "https://example.com/manual",
        version: 1,
        verified: true,
        isDemo: false,
      },
    ],
    [
      {
        id: "record",
        vehicleId: "v",
        appointmentId: "a",
        projectId: "p",
        completedAt: "2026-02-28T18:00:00Z",
        totalKm: 600,
        source: "车主确认",
        totalCents: 0,
      },
    ],
    new Date("2026-03-02T00:00:00Z"),
  );
  assert.equal(serviceBaseline.dueAt, "2026-04-01");
  assert.equal(serviceBaseline.status, "soon");
  assert.match(serviceBaseline.reason, /图片里程早于已确认的服务里程/);
});
async function upload(color = "red"): Promise<ImportJob> {
  const image = await sharp({
    create: { width: 160, height: 100, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  const boundary = "avtestboundary";
  const bytes = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="imageType"\r\n\r\ndashboard\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="dashboard.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    image,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await service.app.inject({
    method: "POST",
    url: "/api/v1/vehicles/vehicle-other/imports",
    headers: {
      origin,
      cookie: cookies.other,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload: bytes,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}
test("images are private; unconfigured AI never claims success; mileage rollback and old images are rejected", async () => {
  const job = await upload();
  assert.equal(job.status, "failed");
  assert.equal(
    (
      await call("other", "POST", `/imports/${job.id}/confirm`, {
        totalKm: 1100,
        unit: "km",
        observedAt: new Date().toISOString(),
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await call("owner", "GET", job.imageUrl.replace("/api/v1", "")))
      .statusCode,
    403,
  );
  const stored = await get<ImportJob>(service.db, "imports", job.id);
  await put(service.db, "imports", {
    ...stored!,
    status: "awaiting_confirmation",
    candidate: { totalKm: 1100, unit: "km", observedAt: null },
  });
  const observedAt = new Date().toISOString();
  const rollback = await call("other", "POST", `/imports/${job.id}/confirm`, {
    totalKm: 999,
    unit: "km",
    observedAt,
  });
  assert.equal(rollback.statusCode, 409);
  assert.equal(rollback.json().error.code, "MILEAGE_ROLLBACK");
  const good = await call("other", "POST", `/imports/${job.id}/confirm`, {
    totalKm: 1100,
    unit: "km",
    observedAt,
  });
  assert.equal(good.statusCode, 200, good.body);
  assert.equal(good.json().status, "confirmed");
  assert.equal(
    (await get<Vehicle>(service.db, "vehicles", "vehicle-other"))!.totalKm,
    1100,
  );
  const retry = await call("other", "POST", `/imports/${job.id}/confirm`, {
    totalKm: 1100,
    unit: "km",
    observedAt,
  });
  assert.equal(retry.statusCode, 200);
  const old = await upload("blue");
  const oldStored = await get<ImportJob>(service.db, "imports", old.id);
  await put(service.db, "imports", {
    ...oldStored!,
    status: "awaiting_confirmation",
  });
  const response = await call("other", "POST", `/imports/${old.id}/confirm`, {
    totalKm: 1200,
    unit: "km",
    observedAt: new Date(Date.now() - 3600000).toISOString(),
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, "OLD_IMAGE");
  assert.equal(
    (await get<Vehicle>(service.db, "vehicles", "vehicle-other"))!.totalKm,
    1100,
  );
});
test("simultaneous identical images create one import task", async () => {
  const [a, b] = await Promise.all([upload("green"), upload("green")]);
  assert.equal(a.id, b.id);
});
test("4S approval requires evidence and store staff cannot self-approve", async () => {
  assert.equal(
    (
      await call("store", "PATCH", "/admin/stores/store-coast", {
        approved: true,
      })
    ).statusCode,
    403,
  );
  const missing = await call("admin", "PATCH", "/admin/stores/store-coast", {
    type: "4s",
    approved: true,
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error.code, "EVIDENCE_REQUIRED");
});
test("logout revokes the session on the server", async () => {
  const login = await service.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { origin },
    payload: { email: "owner@autovoyage.demo", password: "TestPassword2026!" },
  });
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  assert.equal(
    (
      await service.app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        headers: { origin, cookie },
        payload: {},
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await service.app.inject({
        method: "GET",
        url: "/api/v1/bootstrap",
        headers: { cookie },
      })
    ).statusCode,
    401,
  );
});
test("persistent PostgreSQL preview cold-start creates missing parent directories and survives reopen", async () => {
  const path = join(temporary, "fresh-parent", "postgres");
  const config = loadConfig({
    production: false,
    driver: "pglite",
    pglitePath: path,
    seedDemo: false,
    demoMode: false,
    sessionSecret: "test-secret-at-least-32-characters-long",
    uploadDir: temporary,
  });
  const first = await createApp({ config });
  await put(first.db, "projects", {
    id: "persisted",
    code: "PERSIST",
    name: "持久化验证",
    category: "测试",
    description: "冷启动与重启",
    unit: "次",
    active: true,
  });
  await first.app.close();
  const second = await createApp({ config });
  assert(await get(second.db, "projects", "persisted"));
  await second.app.close();
});
test("future price versions preserve today's price and booking resolves the service-day version", async () => {
  const current = (await data("store")).offers.find(
    (o) =>
      o.storeId === "store-coast" &&
      o.modelId === "model-sedan" &&
      o.projectId === "project-oil",
  )!;
  const futureDate = shanghaiDay(new Date(Date.now() + 3 * 86400000));
  const published = await call(
    "store",
    "POST",
    `/admin/offers/${current.id}/version`,
    {
      ...current,
      validFrom: futureDate,
      materialCents: current.materialCents + 2000,
      totalCents: current.totalCents! + 2000,
    },
  );
  assert.equal(published.statusCode, 200, published.body);
  const today = await call("owner", "GET", `/offers?date=${shanghaiDay()}`);
  assert.equal(today.statusCode, 200, today.body);
  assert.equal(
    today.json<Offer[]>().find((o) => o.id === current.id)!.version,
    current.version,
  );
  const target = await slot();
  const serviceDate = shanghaiDay(new Date(target.startsAt));
  const future = await call("owner", "GET", `/offers?date=${serviceDate}`);
  const selected = future.json<Offer[]>().find((o) => o.id === current.id)!;
  assert.equal(selected.version, current.version + 1);
  const input = await bookingInput(target.id);
  assert.equal(input.expectedVersions[current.id], current.version);
  const stale = await call("owner", "POST", "/appointments", input);
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, "PRICE_CHANGED");
  input.expectedVersions[current.id] = selected.version;
  const booked = await call("owner", "POST", "/appointments", input);
  assert.equal(booked.statusCode, 200, booked.body);
  assert.equal(
    booked.json<Appointment>().snapshot[0].totalCents,
    selected.totalCents,
  );
  await call("owner", "POST", `/appointments/${booked.json().id}/action`, {
    action: "cancel",
    reason: "测试结束",
  });
  const duplicate = await call("store", "POST", "/admin/offers", {
    ...published.json<Offer>(),
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, "OVERLAPPING_SERVICE");
  await call("store", "PATCH", `/admin/offers/${current.id}`, {
    active: false,
  });
  const removed = await call("owner", "GET", `/offers?date=${serviceDate}`);
  assert(!removed.json<Offer[]>().some((o) => o.id === current.id));
  await call("store", "PATCH", `/admin/offers/${current.id}`, { active: true });
});
test("maintenance uses the explicit model scope and unknown real models show one vehicle-level notice", async () => {
  const bootstrap = await data();
  const electric = bootstrap.maintenance.filter(
    (m) => m.vehicleId === "vehicle-electric",
  );
  assert.deepEqual(electric.map((m) => m.projectId).sort(), [
    "project-brake",
    "project-cabin",
  ]);
  assert(electric.every((m) => m.scope === "project"));
  assert(!electric.some((m) => m.name.includes("机油")));
  const created = await call("admin", "POST", "/admin/models", {
    brand: "测试品牌",
    name: "未核验适用范围的真实车型",
    year: 2026,
    power: "未核验",
    isDemo: false,
  });
  assert.equal(created.statusCode, 200, created.body);
  const vehicle = await call("owner", "POST", "/vehicles", {
    modelId: created.json().id,
    plate: "测试车辆",
    name: "待核验车辆",
    startDate: shanghaiDay(),
    initialKm: 0,
  });
  assert.equal(vehicle.statusCode, 200, vehicle.body);
  const unknown = (await data()).maintenance.filter(
    (m) => m.vehicleId === vehicle.json().id,
  );
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].scope, "vehicle");
  assert.equal(unknown[0].projectId, "__vehicle_rules__");
  assert.equal(unknown[0].status, "missing");
  const bad = await call(
    "admin",
    "PATCH",
    `/admin/models/${created.json().id}`,
    { applicableProjectIds: ["project-diagnosis"] },
  );
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.code, "INVALID_MAINTENANCE_SCOPE");
  const assigned = await call(
    "admin",
    "PATCH",
    `/admin/models/${created.json().id}`,
    { applicableProjectIds: ["project-cabin"] },
  );
  assert.equal(assigned.statusCode, 200, assigned.body);
  const known = (await data()).maintenance.filter(
    (m) => m.vehicleId === vehicle.json().id,
  );
  assert.equal(known.length, 1);
  assert.equal(known[0].projectId, "project-cabin");
  assert.equal(known[0].scope, "project");
  assert.equal(known[0].status, "missing");
  assert(
    !(await data()).messages.some((m) => m.id.includes("__vehicle_rules__")),
  );
});
