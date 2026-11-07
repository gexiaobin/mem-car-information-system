import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { CarModel, ManualSource, User } from "@autovoyage/shared";
import type { Context } from "../src/context.js";
import type { Database } from "../src/db.js";
import { AppError } from "../src/domain.js";
import { loadConfig } from "../src/config.js";
import { lookupModelManuals, registerManualAiSearch } from "../src/manual-ai-search.js";

const model: CarModel = { id: "synthetic-search-model", brand: "丰田", name: "凯美瑞", year: 2018, power: "汽油 2.0L 6AT", isDemo: true };
const concrete: ManualSource = { title: "2018凯美瑞保养手册", url: "https://www.carobook.com/synthetic-camry-maintenance.html", kind: "carobook", description: "已检索到的合成候选，需核对动力", isDirectory: false };
const directory: ManualSource = { title: "品牌官方资料目录", url: "https://www.example.com/manuals/", kind: "official", description: "仅目录，不能据此确定适用版本", isDirectory: true };
const completed = (value: unknown) => ({ status: "completed", output: [{ type: "message", status: "completed", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
const config = (overrides = {}) => loadConfig({
  production: false, driver: "pglite", pglitePath: ":memory:",
  seedDemo: false, sessionSecret: "manual-ai-search-test-secret-at-least-32-characters",
  aiBaseUrl: "https://provider.example/v1/", aiKey: "fake-search-key", aiModel: "synthetic-search-model",
  aiApiStyle: "responses", aiTimeoutMs: 1000, ...overrides,
});
function provider(value: unknown = completed({ sourceIds: [1, 0] }), status = 200) {
  const requests: Array<{ url: string; body: any }> = [];
  const fakeFetch = (async (input: string | URL | Request, options?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(options?.body)) });
    return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { requests, fakeFetch };
}

test("manual AI search uses both configured protocols and only orders retrieved immutable source IDs", async () => {
  const upstream = provider();
  const cfg = config();
  const result = await lookupModelManuals(cfg, model, { discover: async () => [concrete, directory], fetch: upstream.fakeFetch });
  assert.equal(result.aiStatus, "completed");
  assert.deepEqual(result.sources, [directory, concrete]);
  assert.match(result.summary, /1份车系通用保养资料/);
  assert.match(result.summary, /尚未确认/);
  const queries = result.query.split(' / ');
  assert.deepEqual(queries.slice(0, 2), ['丰田 凯美瑞 保养手册', '丰田 凯美瑞 保养周期表']);
  assert.doesNotMatch(queries.slice(0, 2).join(' / '), /2018|2.0L|6AT/, 'broad series searches must remain available alongside the specific edition query');
  assert.equal(queries[2], '丰田 凯美瑞 2018 汽油 2.0L 6AT 官方 用户手册 保养时间表');
  assert.equal(upstream.requests[0].url, "https://provider.example/v1/responses");
  const body = upstream.requests[0].body;
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, "json_object");
  assert.equal(body.input[0].content[0].type, "input_text");
  assert.match(body.input[0].content[0].text, /json/i, "Responses gateways require JSON in the user input, not only instructions");
  assert.equal(body.tools, undefined, "do not pretend the custom model has web search tools");
  const prompt = JSON.parse(body.input[0].content[0].text);
  assert.equal(prompt.responseFormat, "json_object");
  assert.deepEqual(prompt.model, { brand: model.brand, name: model.name, year: model.year, power: model.power });
  assert.equal(prompt.model.id, undefined);
  assert.equal(prompt.candidates[0].url, undefined);

  const chat = provider({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ sourceIds: [0, 1] }) } }] });
  const chatResult = await lookupModelManuals(config({ aiApiStyle: "chat_completions" }), model, { discover: async () => [concrete, directory], fetch: chat.fakeFetch });
  assert.equal(chatResult.aiStatus, "completed");
  assert.equal(chat.requests[0].url, "https://provider.example/v1/chat/completions");
  assert.equal(chat.requests[0].body.response_format.type, "json_object");
  assert.equal(chat.requests[0].body.input, undefined);
});

test("manual AI search cannot add invented URLs, duplicate IDs, incomplete output, or upstream failure details", async () => {
  for (const value of [
    completed({ sourceIds: [0, 1], url: "https://invented.example/false.pdf" }),
    completed({ sourceIds: [0, 4] }),
    completed({ sourceIds: [0, 0] }),
    completed({ sourceIds: [1] }),
    { ...completed({ sourceIds: [0, 1] }), status: "incomplete" },
    { choices: [{ finish_reason: "stop", message: { content: "not json" } }] },
  ]) {
    const upstream = provider(value);
    const result = await lookupModelManuals(config(), model, { discover: async () => [concrete, directory], fetch: upstream.fakeFetch });
    assert.equal(result.aiStatus, "unavailable");
    assert.deepEqual(result.sources, [concrete, directory]);
    assert.doesNotMatch(JSON.stringify(result), /invented\.example/);
  }
  const upstream = provider({ error: { message: "PRIVATE_UPSTREAM_DEBUG_DETAIL" } }, 503);
  const failed = await lookupModelManuals(config(), model, { discover: async () => [concrete], fetch: upstream.fakeFetch });
  assert.equal(failed.aiStatus, "unavailable");
  assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_UPSTREAM_DEBUG_DETAIL/);
});

test("only directory results are clearly distinguished and missing AI still returns public discovery", async () => {
  const upstream = provider();
  const result = await lookupModelManuals(config({ aiKey: "" }), model, { discover: async () => [directory], fetch: upstream.fakeFetch });
  assert.equal(result.aiStatus, "not_configured");
  assert.match(result.summary, /未定位.*仅为.*目录/);
  assert.equal(result.sources[0].isDirectory, true);
  assert.equal(upstream.requests.length, 0);
  assert.match(result.warnings.join(" "), /不独立联网/);
});

test("failed public discovery falls back to curated directories and unsafe candidate URLs are removed", async () => {
  const unavailable = await lookupModelManuals(config({ aiKey: "" }), model, { discover: async () => { throw new Error("search unavailable"); } });
  assert(unavailable.sources.length > 0);
  assert(unavailable.sources.every(source => source.isDirectory));
  assert.match(unavailable.warnings.join(" "), /公开资料搜索暂不可用/);
  const sources = [concrete, { ...concrete }, { ...directory, url: "https://127.0.0.1/secret" }, { ...directory, url: "http://public.example/insecure" }, { ...directory, url: "https://user:pass@public.example/" }];
  const sanitized = await lookupModelManuals(config({ aiKey: "" }), model, { discover: async () => sources });
  assert.deepEqual(sanitized.sources, [concrete]);
});

test("manual AI route requires platform role and consent, deduplicates queries, and never writes business data", async t => {
  const app = Fastify();
  const cfg = config({ aiKey: "" });
  let discoveries = 0;
  let reads = 0;
  let releaseDiscovery: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { releaseDiscovery = resolve; });
  app.decorateRequest("user", null);
  app.addHook("onRequest", async request => {
    const role = request.headers["x-test-role"] as User["role"] | undefined;
    request.user = role ? { id: "test-user", role, name: "测试", email: "test@example.com", storeId: null } : null;
  });
  app.setErrorHandler((error, _request, reply) => {
    reply.code(error instanceof AppError ? error.status : 400).send({ code: error instanceof AppError ? error.code : "VALIDATION_ERROR" });
  });
  const db = { query: async (sql: string, params: unknown[]) => {
    assert.equal(sql, "SELECT data FROM av_models WHERE id=$1");
    reads += 1;
    return params[0] === model.id ? [{ data: model }] : [];
  } } as unknown as Database;
  registerManualAiSearch({ app, db, config: cfg } as Context, { discover: async () => { discoveries += 1; await gate; return [directory]; } });
  t.after(() => app.close());
  const call = (role: string | undefined, payload: unknown) => app.inject({ method: "POST", url: "/api/v1/admin/manual-imports/ai-search", headers: role ? { "x-test-role": role } : {}, payload });
  assert.equal((await call(undefined, { modelId: model.id, consent: true })).statusCode, 401);
  assert.equal((await call("owner", { modelId: model.id, consent: true })).statusCode, 403);
  assert.equal((await call("platform_admin", { modelId: model.id, consent: false })).statusCode, 400);
  assert.equal(reads, 0);
  assert.equal((await call("platform_admin", { modelId: "missing", consent: true })).statusCode, 404);
  const first = call("platform_admin", { modelId: model.id, consent: true });
  const second = call("platform_admin", { modelId: model.id, consent: true });
  // Let both injected handlers reach their shared promise before resolving it.
  await new Promise(resolve => setImmediate(resolve));
  releaseDiscovery!();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(b.statusCode, 200, b.body);
  assert.equal(discoveries, 1);
  assert.equal(a.body, b.body);
  const cached = await call("platform_admin", { modelId: model.id, consent: true });
  assert.equal(cached.statusCode, 200);
  assert.equal(discoveries, 1);
});
