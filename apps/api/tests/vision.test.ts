import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { loadConfig, type Config } from "../src/config.js";
import { recognizeMileage } from "../src/vision.js";
import { createApp } from "../src/app.js";
import { get, put } from "../src/db.js";
import type { ImportJob, Vehicle } from "@autovoyage/shared";

const candidate = { totalKm: 12345, unit: "km", observedAt: null, engineKm: null };
const completed = (text = JSON.stringify(candidate)) => ({
  status: "completed",
  output: [{ type: "message", status: "completed", content: [{ type: "output_text", text }] }],
});

async function provider() {
  const requests: { path: string; authorization: string | undefined; body: Record<string, any> }[] = [];
  let response: unknown = completed();
  let status = 200;
  const server = createServer(async (request, reply) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ path: request.url || "", authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) });
    reply.writeHead(status, { "content-type": "application/json" });
    reply.end(JSON.stringify(response));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return {
    server, requests,
    baseUrl: `http://127.0.0.1:${address.port}/v1/`,
    respond(value: unknown, code = 200) { response = value; status = code; },
  };
}
function close(server: Server) {
  return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
function config(baseUrl: string, style: Config["aiApiStyle"] = "responses") {
  return loadConfig({
    production: false,
    driver: "pglite", pglitePath: ":memory:", seedDemo: true, demoMode: true,
    demoPassword: "VisionTestPassword!", sessionSecret: "vision-test-secret-at-least-32-characters",
    aiBaseUrl: baseUrl, aiApiStyle: style, aiKey: "fake-vision-test-key", aiModel: "synthetic-vision",
    aiTimeoutMs: 1000, origin: "http://localhost:5173",
  });
}

test("vision sends the configured wire format and parses Responses message output", async t => {
  const upstream = await provider();
  t.after(() => close(upstream.server));
  const cfg = config(upstream.baseUrl);
  assert.deepEqual(await recognizeMileage(cfg, Buffer.from("normalized-jpeg")), candidate);
  const responseRequest = upstream.requests[0]!;
  assert.equal(responseRequest.path, "/v1/responses");
  assert.equal(responseRequest.authorization, "Bearer fake-vision-test-key");
  assert.equal(responseRequest.body.store, false);
  assert.equal(responseRequest.body.temperature, undefined);
  assert.equal(responseRequest.body.reasoning.effort, "low");
  assert.equal(responseRequest.body.text.format.type, "json_object");
  assert.match(responseRequest.body.input[0].content[0].text, /json/i);
  assert.equal(responseRequest.body.input[0].content[1].type, "input_image");
  assert.match(responseRequest.body.input[0].content[1].image_url, /^data:image\/jpeg;base64,/);

  upstream.respond({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(candidate) } }] });
  assert.deepEqual(await recognizeMileage({ ...cfg, aiApiStyle: "chat_completions" }, Buffer.from("normalized-jpeg")), candidate);
  const chatRequest = upstream.requests[1]!;
  assert.equal(chatRequest.path, "/v1/chat/completions");
  assert.equal(chatRequest.body.response_format.type, "json_object");
  assert.equal(chatRequest.body.messages[1].content[1].type, "image_url");
  assert.equal(chatRequest.body.input, undefined);
});

test("vision rejects refusals, incomplete outputs, provider errors and invalid mileage fields", async t => {
  const upstream = await provider();
  t.after(() => close(upstream.server));
  const cfg = config(upstream.baseUrl);
  for (const value of [
    { ...completed(), status: "incomplete" },
    { ...completed(), status: "failed" },
    { status: "completed", output: [{ type: "message", status: "incomplete", content: [] }] },
    { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "denied" }] }] },
    { status: "completed", output: [] },
    { output_text: JSON.stringify(candidate) },
    completed("not valid JSON"),
    completed(JSON.stringify({ ...candidate, totalKm: "12345" })),
    completed(JSON.stringify({ ...candidate, totalKm: null, unit: null })),
    completed(JSON.stringify({ ...candidate, observedAt: "not-a-date" })),
  ]) {
    upstream.respond(value);
    await assert.rejects(recognizeMileage(cfg, Buffer.from("jpeg")));
  }
  upstream.respond({ error: { message: "Do not expose this upstream detail" } }, 503);
  await assert.rejects(recognizeMileage(cfg, Buffer.from("jpeg")), /识别服务暂时不可用/);
  upstream.respond({ choices: [{ finish_reason: "length", message: { content: JSON.stringify(candidate) } }] });
  await assert.rejects(recognizeMileage({ ...cfg, aiApiStyle: "chat_completions" }, Buffer.from("jpeg")), /未完成/);
});

test("both vision protocols upload real files and require owner confirmation before updating mileage", async t => {
  const upstream = await provider();
  const temporary = await mkdtemp(join(tmpdir(), "autovoyage-vision-"));
  const cfg = { ...config(upstream.baseUrl), uploadDir: temporary };
  const service = await createApp({ config: cfg });
  t.after(async () => { await service.app.close(); await close(upstream.server); await rm(temporary, { recursive: true, force: true }); });
  const origin = cfg.origin;
  const login = await service.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { origin }, payload: { email: "owner@autovoyage.demo", password: cfg.demoPassword } });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = String(login.headers["set-cookie"]).split(";")[0];
  for (const [index, style] of (["responses", "chat_completions"] as const).entries()) {
    cfg.aiApiStyle = style;
    upstream.respond(style === "responses" ? completed() : { choices: [{ message: { content: JSON.stringify(candidate) } }] });
    const vehicle: Vehicle = { id: `vision-car-${index}`, ownerId: "owner-demo", modelId: "model-sedan", plate: `VISION${index}`, name: "合成识别测试车辆", startDate: "2025-01-01", initialKm: 10000, totalKm: 10000, observedAt: new Date(Date.now() - 10 * 86400000).toISOString(), isDemo: true };
    await put(service.db, "vehicles", vehicle);
    const image = await sharp({ create: { width: 100, height: 80, channels: 3, background: index ? "blue" : "red" } }).png().toBuffer();
    const boundary = "vision-test-boundary";
    const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n`), image, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const uploaded = await service.app.inject({ method: "POST", url: `/api/v1/vehicles/${vehicle.id}/imports`, headers: { origin, cookie, "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    const id = uploaded.json<ImportJob>().id;
    let job: ImportJob | undefined;
    const deadline = Date.now() + 3000;
    do {
      job = await get<ImportJob>(service.db, "imports", id);
      if (job?.status !== "uploaded" && job?.status !== "processing") break;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    assert.equal(job?.status, "awaiting_confirmation", job?.reason);
    assert.deepEqual(job.candidate, candidate);
    assert.equal((await get<Vehicle>(service.db, "vehicles", vehicle.id))!.totalKm, 10000);
    const confirmed = await service.app.inject({ method: "POST", url: `/api/v1/imports/${id}/confirm`, headers: { origin, cookie }, payload: { totalKm: 12345, unit: "km", observedAt: new Date().toISOString() } });
    assert.equal(confirmed.statusCode, 200, confirmed.body);
    assert.equal((await get<Vehicle>(service.db, "vehicles", vehicle.id))!.totalKm, 12345);
  }
  cfg.aiApiStyle = "responses";
  upstream.respond({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "Cannot inspect this image" }] }] });
  const failedImage = await sharp({ create: { width: 100, height: 80, channels: 3, background: "green" } }).png().toBuffer();
  const boundary = "vision-failed-boundary";
  const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n`), failedImage, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const uploaded = await service.app.inject({ method: "POST", url: "/api/v1/vehicles/vision-car-0/imports", headers: { origin, cookie, "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const failedId = uploaded.json<ImportJob>().id;
  let failedJob: ImportJob | undefined;
  const deadline = Date.now() + 3000;
  do {
    failedJob = await get<ImportJob>(service.db, "imports", failedId);
    if (failedJob?.status !== "uploaded" && failedJob?.status !== "processing") break;
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.equal(failedJob?.status, "failed");
  assert.equal(failedJob.candidate.totalKm, null);
  assert.equal((await get<Vehicle>(service.db, "vehicles", "vision-car-0"))!.totalKm, 12345);
  const invalidConfirmation = await service.app.inject({ method: "POST", url: `/api/v1/imports/${failedId}/confirm`, headers: { origin, cookie }, payload: { totalKm: 12400, unit: "km", observedAt: new Date().toISOString() } });
  assert.equal(invalidConfirmation.statusCode, 409);
});

test("AI configuration rejects unsupported protocols and unreasonable timeouts", () => {
  assert.equal(config("http://127.0.0.1/v1").aiTimeoutMs, 1000);
  assert.throws(() => loadConfig({ ...config("http://127.0.0.1/v1"), aiApiStyle: "invalid" as Config["aiApiStyle"] }), /AI_API_STYLE/);
  for (const aiTimeoutMs of [0, 999, 180001, 1000.5, Number.NaN])
    assert.throws(() => loadConfig({ ...config("http://127.0.0.1/v1"), aiTimeoutMs }), /AI_TIMEOUT_MS/);
});
