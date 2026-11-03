/** Opt-in integration verification in a newly created, disposable schema. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { createApp } from "../apps/api/src/app.js";
import { loadConfig } from "../apps/api/src/config.js";
import { hashPassword, shanghaiDay } from "../apps/api/src/domain.js";
import { get, put } from "../apps/api/src/db.js";
import type {
  Appointment,
  BookingInput,
  Bootstrap,
  Offer,
  Slot,
} from "@autovoyage/shared";

const base = loadConfig();
assert(base.pg.password, "请先在 .env 填写 PostgreSQL 密码");
const schema = `av_test_${randomBytes(8).toString("hex")}`;
assert(/^av_test_[a-f0-9]{16}$/.test(schema));
const { schema: unused, ...connection } = base.pg;
const control = new pg.Client({
  ...connection,
  connectionTimeoutMillis: 10000,
});
const password = randomBytes(24).toString("base64url");
const origin = "http://localhost:5173";
const uploads = await mkdtemp(join(tmpdir(), "autovoyage-pg-test-"));
let service: Awaited<ReturnType<typeof createApp>> | undefined;
const checks: string[] = [];
try {
  await control.connect();
  await control.query(`CREATE SCHEMA "${schema}"`);
  service = await createApp({
    config: loadConfig({
      production: false,
      driver: "postgres",
      pg: { ...base.pg, schema },
      origin,
      seedDemo: true,
      demoMode: false,
      demoPassword: password,
      sessionSecret: randomBytes(48).toString("hex"),
      uploadDir: uploads,
      aiBaseUrl: "",
      aiKey: "",
      aiModel: "",
    }),
  });
  const { app, db } = service;
  await put(db, "users", {
    id: "pg-other",
    name: "并发测试车主",
    email: "pg-test@autovoyage.demo",
    role: "owner",
    storeId: null,
    active: true,
    passwordHash: await hashPassword(password),
  });
  await put(db, "vehicles", {
    id: "pg-other-car",
    ownerId: "pg-other",
    modelId: "model-sedan",
    plate: "TEST-ONLY",
    name: "独立测试车辆",
    startDate: "2025-01-01",
    initialKm: 0,
    totalKm: 1000,
    observedAt: new Date().toISOString(),
    isDemo: true,
  });
  const cookies: Record<string, string> = {};
  for (const [name, email] of Object.entries({
    owner: "owner@autovoyage.demo",
    other: "pg-test@autovoyage.demo",
    store: "store@autovoyage.demo",
  })) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin },
      payload: { email, password },
    });
    assert.equal(response.statusCode, 200, response.body);
    cookies[name] = String(response.headers["set-cookie"]).split(";")[0];
  }
  const call = (
    who: string,
    method: "GET" | "POST" | "PATCH",
    path: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { origin, cookie: cookies[who] },
      ...(payload === undefined
        ? {}
        : { payload: payload as Record<string, unknown> }),
    });
  const data = (await call("owner", "GET", "/bootstrap")).json<Bootstrap>();
  const offer = data.offers.find(
    (o) =>
      o.storeId === "store-coast" &&
      o.modelId === "model-sedan" &&
      o.projectId === "project-oil",
  )!;
  assert(offer);
  const makeSlot = async (day: number) => {
    const start = new Date(Date.now() + day * 86400000);
    start.setUTCHours(1, 0, 0, 0);
    const response = await call("store", "POST", "/admin/slots", {
      startsAt: start.toISOString(),
      endsAt: new Date(+start + 3600000).toISOString(),
      capacity: 1,
      active: true,
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json<Slot>();
  };
  const inputFor = (slot: Slot, vehicleId = "vehicle-sedan"): BookingInput => ({
    vehicleId,
    slotId: slot.id,
    offerIds: [offer.id],
    expectedVersions: { [offer.id]: offer.version },
    requestId: crypto.randomUUID(),
  });
  const last = await makeSlot(20);
  const [first, second] = await Promise.all([
    call("owner", "POST", "/appointments", inputFor(last)),
    call("other", "POST", "/appointments", inputFor(last, "pg-other-car")),
  ]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
  assert.equal(
    (first.statusCode === 409 ? first : second).json().error.code,
    "SLOT_FULL",
  );
  assert.equal((await get<Slot>(db, "slots", last.id))!.reserved, 1);
  checks.push("真实 PostgreSQL 并发争抢最后名额：仅一个成功，余量正确");
  const who = first.statusCode === 200 ? "owner" : "other";
  const winner = (
    first.statusCode === 200 ? first : second
  ).json<Appointment>();
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await call(who, "POST", `/appointments/${winner.id}/action`, {
          action: "cancel",
          reason: "临时测试结束",
        })
      ).statusCode,
      200,
    );
  assert.equal((await get<Slot>(db, "slots", last.id))!.reserved, 0);
  checks.push("取消重试：名额只释放一次");
  const slot = await makeSlot(21);
  const intent = inputFor(slot);
  const duplicates = await Promise.all([
    call("owner", "POST", "/appointments", intent),
    call("owner", "POST", "/appointments", intent),
  ]);
  assert(duplicates.every((r) => r.statusCode === 200));
  assert.equal(duplicates[0].json().id, duplicates[1].json().id);
  assert.equal((await get<Slot>(db, "slots", slot.id))!.reserved, 1);
  const booking = duplicates[0].json<Appointment>();
  checks.push("真实 PostgreSQL 并发幂等请求：同一预约、仅占一个名额");
  const scope = await call("other", "GET", `/appointments/${booking.id}`);
  assert.equal(scope.statusCode, 403);
  checks.push("跨车主预约详情：服务端拒绝越权");
  const publish = await call(
    "store",
    "POST",
    `/admin/offers/${offer.id}/version`,
    {
      ...offer,
      materialCents: offer.materialCents + 100,
      totalCents: offer.totalCents! + 100,
    },
  );
  assert.equal(publish.statusCode, 200, publish.body);
  const staleSlot = await makeSlot(22);
  const stale = await call(
    "owner",
    "POST",
    "/appointments",
    inputFor(staleSlot),
  );
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, "PRICE_CHANGED");
  assert.equal((await get<Slot>(db, "slots", staleSlot.id))!.reserved, 0);
  assert.equal(
    (await get<Appointment>(db, "appointments", booking.id))!.snapshot[0]
      .totalCents,
    offer.totalCents,
  );
  checks.push("价格版本冲突回滚名额，历史快照保持原金额");
  const multiSlot = await makeSlot(23);
  const currentQuotes = await call(
    "owner",
    "GET",
    `/offers?date=${shanghaiDay(new Date(multiSlot.startsAt))}`,
  );
  assert.equal(currentQuotes.statusCode, 200, currentQuotes.body);
  const selected = currentQuotes
    .json<Offer[]>()
    .filter(
      (o) =>
        o.storeId === "store-coast" &&
        o.modelId === "model-sedan" &&
        ["project-oil", "project-cabin"].includes(o.projectId),
    );
  assert.equal(selected.length, 2);
  const expectedTotal = selected.reduce(
    (sum, item) => sum + item.totalCents!,
    0,
  );
  const multiInput: BookingInput = {
    vehicleId: "vehicle-sedan",
    slotId: multiSlot.id,
    offerIds: selected.map((o) => o.id),
    expectedVersions: Object.fromEntries(
      selected.map((o) => [o.id, o.version]),
    ),
    requestId: crypto.randomUUID(),
  };
  const multiResponse = await call(
    "owner",
    "POST",
    "/appointments",
    multiInput,
  );
  assert.equal(multiResponse.statusCode, 200, multiResponse.body);
  const multiBooking = multiResponse.json<Appointment>();
  assert.equal(multiBooking.snapshot.length, 2);
  assert.equal(multiBooking.totalCents, expectedTotal);
  assert.equal(multiBooking.finalCents, expectedTotal);
  assert.deepEqual(
    multiBooking.snapshot.map((s) => s.offerId).sort(),
    multiInput.offerIds.slice().sort(),
  );
  checks.push("双项目预约：材料与工时报价合计正确，两个项目完整保存为原始快照");
  const accept = await call(
    "store",
    "POST",
    `/appointments/${multiBooking.id}/action`,
    { action: "confirm" },
  );
  assert.equal(accept.statusCode, 200, accept.body);
  const change = await call(
    "store",
    "POST",
    `/appointments/${multiBooking.id}/changes`,
    {
      reason: "临时测试材料调整",
      description: "原项目范围保留，材料差额500分，需车主确认",
      proposedCents: expectedTotal + 500,
    },
  );
  assert.equal(change.statusCode, 200, change.body);
  const decision = await call(
    "owner",
    "POST",
    `/changes/${change.json().id}/decision`,
    { approved: true },
  );
  assert.equal(decision.statusCode, 200, decision.body);
  const finish = await call(
    "store",
    "POST",
    `/appointments/${multiBooking.id}/action`,
    {
      action: "finish",
      completedProjectIds: selected.map((o) => o.projectId),
      serviceKm: 30000,
    },
  );
  assert.equal(finish.statusCode, 200, finish.body);
  const complete = await call(
    "owner",
    "POST",
    `/appointments/${multiBooking.id}/action`,
    { action: "complete" },
  );
  assert.equal(complete.statusCode, 200, complete.body);
  const completed = complete.json<Appointment>();
  assert.equal(completed.finalCents, expectedTotal + 500);
  assert.equal(completed.totalCents, expectedTotal);
  assert.equal(completed.snapshot.length, 2);
  assert.equal(completed.status, "completed");
  checks.push(
    "双项目完工：只有车主批准后计入费用调整，最终金额正确且原始总价不变",
  );
  console.log(
    JSON.stringify(
      {
        database: "PostgreSQL",
        checks,
        passed: checks.length,
        scope: "仅新建临时 av_test_* schema，未使用 public 业务数据",
      },
      null,
      2,
    ),
  );
} finally {
  await service?.app.close();
  try {
    await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await control.end();
  }
  await rm(uploads, { recursive: true, force: true });
}
