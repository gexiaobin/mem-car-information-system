import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import sharp from "sharp";
import type { RegistrationFields, RegistrationImport, Vehicle } from "@autovoyage/shared";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { hashPassword } from "../src/domain.js";
import { get, list, put } from "../src/db.js";
import { recognizeRegistration } from "../src/vision.js";

const fields: RegistrationFields = { plate: "鲁B12345", vehicleType: "小型轿车", ownerName: "合成测试车主", useNature: "非营运", brandModel: "大众牌FV7147", vin: "LFV2A21K9E4000001", engineNumber: "SYNTHETIC01", registerDate: "2024-01-02", issueDate: "2024-01-03" };
const result = () => ({ documentType: "vehicle_registration", ...fields });
const completed = (data: unknown = result()) => ({ status: "completed", output: [{ type: "message", status: "completed", content: [{ type: "output_text", text: JSON.stringify(data) }] }] });
const origin = "http://localhost:5173";
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
  temporary = await mkdtemp(join(tmpdir(), "autovoyage-registration-"));
  const base = loadConfig({
    production: false, seedDemo: false,
    sessionSecret: "registration-test-secret-at-least-32-characters",
  });
  if (process.env.AV_REGISTRATION_PG_TEST === "1") {
    const { schema: _, ...connection } = base.pg;
    assert(connection.password, "PostgreSQL test requires configured credentials");
    control = new pg.Client({ ...connection, connectionTimeoutMillis: 10000 });
    await control.connect();
    schema = `av_test_reg_${randomBytes(8).toString("hex")}`;
    assert(/^av_test_reg_[a-f0-9]{16}$/.test(schema));
    await control.query(`CREATE SCHEMA "${schema}"`);
  }
  service = await createApp({ config: loadConfig({
    production: false, driver: schema ? "postgres" : "pglite", pglitePath: ":memory:",
    pg: { ...base.pg, schema: schema || base.pg.schema }, seedDemo: true, demoMode: true,
    demoPassword: "RegistrationTest2026!", sessionSecret: "registration-test-secret-at-least-32-characters",
    uploadDir: temporary, aiBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    aiApiStyle: "responses", aiKey: "fake-registration-key", aiModel: "synthetic-registration", aiTimeoutMs: 1000, origin,
  }) });
  await put(service.db, "users", { id: "registration-other", name: "另一合成车主", email: "registration-other@autovoyage.demo", role: "owner", storeId: null, active: true, passwordHash: await hashPassword("RegistrationTest2026!") });
  for (const [key, email] of Object.entries({ owner: "owner@autovoyage.demo", other: "registration-other@autovoyage.demo", store: "store@autovoyage.demo", expert: "expert@autovoyage.demo", admin: "admin@autovoyage.demo" })) {
    const response = await service.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { origin }, payload: { email, password: "RegistrationTest2026!" } });
    assert.equal(response.statusCode, 200, response.body);
    cookies[key] = String(response.headers["set-cookie"]).split(";")[0];
  }
});
after(async () => {
  await service?.app.close();
  await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
  if (schema && control) {
    assert(/^av_test_reg_[a-f0-9]{16}$/.test(schema));
    await control.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
  await control?.end();
  if (temporary) await rm(temporary, { recursive: true, force: true });
});
const call = (who: string, method: "GET" | "POST" | "PATCH", path: string, payload?: unknown) => service.app.inject({ method, url: `/api/v1${path}`, headers: { origin, cookie: cookies[who] || "" }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
let imageNumber = 0;
async function upload(who = "owner", vehicleId?: string, consent = true, bytes?: Buffer) {
  imageNumber++;
  const image = bytes || await sharp({ create: { width: 120, height: 80, channels: 3, background: { r: imageNumber, g: 50, b: 100 } } }).png().toBuffer();
  const boundary = `registration-${imageNumber}`;
  const extra = `${consent ? `--${boundary}\r\nContent-Disposition: form-data; name="consent"\r\n\r\ntrue\r\n` : ""}${vehicleId ? `--${boundary}\r\nContent-Disposition: form-data; name="vehicleId"\r\n\r\n${vehicleId}\r\n` : ""}`;
  const payload = Buffer.concat([Buffer.from(`${extra}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic-registration.png"\r\nContent-Type: image/png\r\n\r\n`), image, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return service.app.inject({ method: "POST", url: "/api/v1/registration-imports", headers: { origin, cookie: cookies[who] || "", "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
}
async function settled(jobId: string) {
  const deadline = Date.now() + 4000;
  let job: RegistrationImport | undefined;
  do {
    job = (await call("owner", "GET", `/registration-imports/${jobId}`)).json<RegistrationImport>();
    if (!["uploaded", "processing"].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.fail(`registration did not settle: ${job?.status}`);
}
const newVehicle = { modelId: "model-sedan", name: "行驶证合成车辆", startDate: "2025-06-01", initialKm: 123 };

test("registration vision uses both configured protocols and excludes address fields", async () => {
  upstreamResponse = completed({ ...result(), address: "must not persist" });
  const recognized = await recognizeRegistration(service.config, Buffer.from("jpeg"));
  assert.deepEqual(recognized, fields);
  const request = requests.at(-1)!;
  assert.equal(request.path, "/v1/responses");
  assert.equal(request.body.store, false);
  assert.match(request.body.input[0].content[0].text, /JSON/);
  assert.match(request.body.instructions, /不提取或输出住址/);
  upstreamResponse = { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result()) } }] };
  assert.deepEqual(await recognizeRegistration({ ...service.config, aiApiStyle: "chat_completions" }, Buffer.from("jpeg")), fields);
  assert.equal(requests.at(-1)!.path, "/v1/chat/completions");
  for (const invalid of [completed({ ...result(), documentType: null }), completed({ ...result(), plate: null, brandModel: null }), { status: "incomplete", output: [] }, { status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }] }]) {
    upstreamResponse = invalid;
    await assert.rejects(recognizeRegistration(service.config, Buffer.from("jpeg")));
  }
  upstreamResponse = completed();
});

test("registration recognition requires explicit owner review and atomically creates an idempotent vehicle archive", async () => {
  const count = (await list(service.db, "vehicles")).length;
  const response = await upload();
  assert.equal(response.statusCode, 200, response.body);
  const uploaded = response.json<RegistrationImport>();
  assert.equal("fileId" in uploaded, false);
  const job = await settled(uploaded.id);
  assert.equal(job.status, "awaiting_confirmation", job.reason);
  assert.equal(job.vehicleId, null);
  assert.equal(job.confirmedFields, null);
  assert.equal((await list(service.db, "vehicles")).length, count);
  const missingSelection = await call("owner", "POST", `/registration-imports/${job.id}/confirm`, { fields });
  assert.equal(missingSelection.statusCode, 400);
  const confirmed = await call("owner", "POST", `/registration-imports/${job.id}/confirm`, { fields, vehicle: newVehicle });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  const archive = confirmed.json<RegistrationImport>();
  assert.equal(archive.status, "confirmed");
  const vehicle = await get<Vehicle>(service.db, "vehicles", archive.vehicleId!);
  assert.equal(vehicle?.startDate, "2025-06-01");
  assert.notEqual(vehicle?.startDate, fields.issueDate);
  assert.equal(vehicle?.totalKm, null);
  assert.equal(vehicle?.initialKm, 123);
  assert.equal("vin" in vehicle!, false);
  assert.equal((await call("owner", "POST", `/registration-imports/${job.id}/confirm`, { fields, vehicle: newVehicle })).statusCode, 200);
  assert.equal((await list(service.db, "vehicles")).length, count + 1);
  assert.equal((await call("owner", "POST", `/registration-imports/${job.id}/confirm`, { fields: { ...fields, engineNumber: "changed" }, vehicle: newVehicle })).statusCode, 409);
  assert.equal((await call("owner", "GET", "/registration-imports")).json<RegistrationImport[]>()[0]?.confirmedFields?.vin, fields.vin);
});

test("certificate photos and fields stay private to their owner across records, bootstrap and fault attachments", async () => {
  const job = (await call("owner", "GET", "/registration-imports")).json<RegistrationImport[]>()[0]!;
  for (const who of ["other", "store", "expert", "admin"]) {
    assert.equal((await call(who, "GET", `/registration-imports/${job.id}`)).statusCode, 403);
    assert.equal((await call(who, "POST", `/registration-imports/${job.id}/retry`)).statusCode, 403);
    assert.equal((await call(who, "POST", `/registration-imports/${job.id}/confirm`, { fields, vehicle: newVehicle })).statusCode, 403);
    assert.equal((await service.app.inject({ method: "GET", url: job.imageUrl, headers: { cookie: cookies[who] } })).statusCode, 403);
    const bootstrap = await call(who, "GET", "/bootstrap");
    assert.equal(bootstrap.body.includes(fields.vin!), false);
    assert.equal(bootstrap.body.includes(fields.ownerName!), false);
  }
  const ownerImage = await service.app.inject({ method: "GET", url: job.imageUrl, headers: { cookie: cookies.owner } });
  assert.equal(ownerImage.statusCode, 200);
  assert.equal(ownerImage.headers["cache-control"], "no-store");
  assert.equal((await call("owner", "POST", "/faults", { vehicleId: job.vehicleId, storeId: "store-coast", title: "合成测试", description: "合成测试", conditions: "", occurredAt: new Date().toISOString(), imageUrls: [job.imageUrl] })).statusCode, 400);
  await put(service.db, "faults", { id: "injected-private-reference", ownerId: "owner-demo", storeId: "store-coast", assignedExpertId: "expert-demo", imageUrls: [job.imageUrl] });
  for (const who of ["store", "expert"])
    assert.equal((await service.app.inject({ method: "GET", url: job.imageUrl, headers: { cookie: cookies[who] } })).statusCode, 403);
  const beforeFiles = (await list(service.db, "files")).length;
  assert.equal((await upload("owner", job.vehicleId!, false)).statusCode, 400);
  assert.equal((await upload("other", job.vehicleId!)).statusCode, 403);
  assert.equal((await upload("store")).statusCode, 403);
  assert.equal((await upload("owner", undefined, true, Buffer.from("not an image"))).statusCode, 400);
  assert.equal((await list(service.db, "files")).length, beforeFiles);
});

test("existing vehicle attachment enforces identity and validates VIN/date without changing vehicle history", async () => {
  const existing = (await call("owner", "GET", "/registration-imports")).json<RegistrationImport[]>()[0]!;
  const original = await get<Vehicle>(service.db, "vehicles", existing.vehicleId!);
  const uploaded = await upload("owner", existing.vehicleId!);
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const job = await settled(uploaded.json<RegistrationImport>().id);
  for (const changed of [{ plate: "鲁B99999" }, { vin: "SHORT" }, { vin: "LIO2A21K9E4000001" }, { registerDate: "2024-02-30" }, { issueDate: "2099-01-01" }, { issueDate: "2023-01-01" }]) {
    const invalid = await call("owner", "POST", `/registration-imports/${job.id}/confirm`, { fields: { ...fields, ...changed } });
    assert([400, 409].includes(invalid.statusCode), invalid.body);
  }
  assert.equal((await call("owner", "POST", `/registration-imports/${job.id}/confirm`, { fields, vehicle: newVehicle })).statusCode, 400);
  const confirmed = await call("owner", "POST", `/registration-imports/${job.id}/confirm`, { fields: { ...fields, plate: "鲁 b·12345" } });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.deepEqual(await get(service.db, "vehicles", existing.vehicleId!), original);
});

test("concurrent certificate creation and manual creation cannot duplicate normalized owner plate", async () => {
  const first = await settled((await upload()).json<RegistrationImport>().id);
  const second = await settled((await upload()).json<RegistrationImport>().id);
  const plateFields = { ...fields, plate: "鲁B66888" };
  const confirmed = await Promise.all([
    call("owner", "POST", `/registration-imports/${first.id}/confirm`, { fields: plateFields, vehicle: newVehicle }),
    call("owner", "POST", `/registration-imports/${second.id}/confirm`, { fields: { ...plateFields, plate: "鲁 b·66888" }, vehicle: newVehicle }),
    call("owner", "POST", "/vehicles", { ...newVehicle, plate: "鲁B-66888" }),
  ]);
  assert.deepEqual(confirmed.map(response => response.statusCode).sort(), [200, 409, 409]);
  assert.equal((await list<Vehicle>(service.db, "vehicles")).filter(vehicle => /66888/.test(vehicle.plate)).length, 1);
});

test("failed or unconfigured recognition cannot be confirmed into a valid certificate", async () => {
  upstreamStatus = 503;
  upstreamResponse = { error: { message: "private provider detail" } };
  const failed = await settled((await upload()).json<RegistrationImport>().id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.reason.includes("private provider detail"), false);
  assert.equal((await call("owner", "POST", `/registration-imports/${failed.id}/confirm`, { fields, vehicle: newVehicle })).statusCode, 409);
  upstreamStatus = 200;
  upstreamResponse = completed();
  assert.equal((await call("owner", "POST", `/registration-imports/${failed.id}/retry`)).statusCode, 200);
  assert.equal((await settled(failed.id)).status, "awaiting_confirmation");
  service.config.aiKey = "";
  const unconfigured = (await upload()).json<RegistrationImport>();
  assert.equal(unconfigured.status, "failed");
  assert.equal((await call("owner", "POST", `/registration-imports/${unconfigured.id}/retry`)).statusCode, 503);
  assert.equal((await call("owner", "POST", `/registration-imports/${unconfigured.id}/confirm`, { fields, vehicle: newVehicle })).statusCode, 409);
  service.config.aiKey = "fake-registration-key";
});
