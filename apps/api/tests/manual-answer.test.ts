import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { PDFDocument } from "pdf-lib";
import Fastify from "fastify";
import type { CarModel, ManualImport, ManualSource, Project, User } from "@autovoyage/shared";
import type { Context } from "../src/context.js";
import { loadConfig } from "../src/config.js";
import { connectDatabase, get, list, put } from "../src/db.js";
import { AppError } from "../src/domain.js";
import { readModelManualAnswer, registerManualAnswers, type ManualAiAnswerJob, type ManualAnswerDependencies } from "../src/manual-answer.js";
import type { recognizeManual } from "../src/manual-vision.js";
import { extractManualWebPage } from "../src/manual-web-source.js";

const model: CarModel = { id: "synthetic-answer-model", brand: "合成品牌", name: "证据车系", year: 2025, power: "汽油 1.5T", isDemo: true };
const source: ManualSource = { title: "合成官方保养时间表", url: "https://official.example/manual/schedule.html", kind: "official", description: "仅测试数据", isDirectory: false };
const directory: ManualSource = { ...source, url: "https://official.example/manuals/", title: "合成目录", isDirectory: true };
const html = `<!doctype html><html><head><title>合成车型保养表</title></head><body><article><h1>2025款合成车型汽油版保养说明</h1><p>本页仅用于测试。正常使用条件，每12个月或20000公里更换空调滤清器，以先到者为准。</p><table><tr><th>项目</th><th>12个月/20000km</th></tr><tr><td>空调滤清器更换</td><td>更换</td></tr></table></article></body></html>`;
const recognition: Awaited<ReturnType<typeof recognizeManual>> = {
  sourceTitle: "合成车型保养表", edition: "", applicability: "2025款合成车型汽油版", sourceExcerpt: "正常使用条件，每12个月或20000公里更换空调滤清器，以先到者为准。", warnings: [],
  rows: [{ name: "空调滤清器更换", action: "replace", triggerType: "periodic", firstMonths: null, firstKm: null, intervalMonths: 12, intervalKm: 20000, mileageType: "total_km", condition: "", notes: "以先到者为准", sourceText: "正常使用条件，每12个月或20000公里更换空调滤清器，以先到者为准。", pageNumbers: [1] }],
};
const dependencies = (overrides: ManualAnswerDependencies = {}): ManualAnswerDependencies => ({
  discover: async () => [source, directory],
  download: async (url: string) => ({ bytes: Buffer.from(html), type: "text/html", url }),
  recognize: async () => structuredClone(recognition), ...overrides,
});
async function harness(t: { after: (fn: () => Promise<void>) => void }, deps: ManualAnswerDependencies = {}, configOverrides = {}) {
  const temporary = await mkdtemp(join(tmpdir(), "autovoyage-answer-test-"));
  const base = loadConfig({ production: false, seedDemo: false, sessionSecret: "manual-answer-test-secret-at-least-32-characters" });
  let control: pg.Client | undefined, schema: string | undefined;
  if (process.env.AV_MANUAL_PG_TEST === "1") {
    const { schema: _schema, ...connection } = base.pg;
    assert(connection.password, "PostgreSQL answer tests require configured credentials");
    control = new pg.Client({ ...connection, connectionTimeoutMillis: 10000 }); await control.connect();
    schema = `av_test_answer_${randomBytes(8).toString("hex")}`;
    assert(/^av_test_answer_[a-f0-9]{16}$/.test(schema)); await control.query(`CREATE SCHEMA "${schema}"`);
  }
  const config = loadConfig({ production: false, driver: "pglite", pglitePath: ":memory:", seedDemo: false,
    sessionSecret: "manual-answer-test-secret-at-least-32-characters", uploadDir: temporary,
    aiBaseUrl: "https://provider.example/v1", aiKey: "synthetic-test-key", aiModel: "synthetic-test-model", aiTimeoutMs: 1000,
    ...(schema ? { driver: "postgres", pg: { ...base.pg, schema } } : {}), ...configOverrides });
  const db = await connectDatabase(config); await db.migrate();
  await put(db, "models", model);
  const project: Project = { id: "synthetic-filter", code: "SYNTHETIC-FILTER", name: "空调滤清器更换", category: "maintenance", description: "更换空调滤清器", unit: "次", active: true };
  await put(db, "projects", project);
  const app = Fastify();
  app.decorateRequest("user", null);
  app.addHook("onRequest", async request => {
    const role = request.headers["x-role"] as User["role"] | undefined;
    request.user = role ? { id: String(request.headers["x-user"] || "admin-a"), role, name: "合成测试", email: "synthetic@example.com", storeId: null } : null;
  });
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.status : 400).send({ code: error instanceof AppError ? error.code : "VALIDATION_ERROR" }));
  const ctx = { app, db, config } as Context;
  registerManualAnswers(ctx, dependencies(deps));
  t.after(async () => {
    await app.close(); await db.close();
    if (schema && control) {
      assert(/^av_test_answer_[a-f0-9]{16}$/.test(schema)); await control.query(`DROP SCHEMA "${schema}" CASCADE`);
      assert.equal((await control.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).rowCount, 0, "temporary answer schema must be removed");
    }
    await control?.end(); await rm(temporary, { force: true, recursive: true });
  });
  const call = (method: "GET" | "POST", suffix: string, payload?: unknown, who = "admin-a", role: User["role"] | "" = "platform_admin") => app.inject({ method, url: `/api/v1/admin/manual-imports/${suffix}`, headers: role ? { "x-role": role, "x-user": who } : {}, ...(payload ? { payload } : {}) });
  const start = async (who = "admin-a") => {
    const response = await call("POST", "ai-answer", { modelId: model.id, consent: true }, who);
    assert.equal(response.statusCode, 202, response.body); return response.json<ManualAiAnswerJob>();
  };
  const finish = async (job: ManualAiAnswerJob, who = "admin-a") => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await call("GET", `ai-answer/${job.id}`, undefined, who);
      assert.equal(response.statusCode, 200, response.body);
      const current = response.json<ManualAiAnswerJob>();
      if (["completed", "failed"].includes(current.status)) return current;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail("synthetic manual answer did not finish");
  };
  return { ctx, app, db, temporary, call, start, finish };
}

test("AI answer reads an actual source and imports cached evidence once, without re-running AI or publishing rules", async t => {
  let readings = 0, downloads = 0;
  const service = await harness(t, { download: async url => { downloads++; return { bytes: Buffer.from(html), type: "text/html", url }; }, recognize: async (_config, images, _model, texts) => {
    readings++; assert.equal(images.length, 0); assert.match(texts![0].text, /来源网址：https:\/\/official.example\/manual\/schedule.html/);
    assert.match(texts![0].text, /空调滤清器更换 \| 更换 \|/); return structuredClone(recognition);
  } });
  const job = await service.finish(await service.start());
  assert.equal(job.status, "completed");
  assert.equal(job.result!.evidenceMode, "document_reading");
  assert.equal(job.result!.answer.status, "ready");
  assert.equal(job.result!.answer.rows[0].projectId, "synthetic-filter");
  assert.equal(job.result!.answer.mappingDiagnostics?.[0]?.status, "matched");
  assert.equal(job.result!.answer.mappingDiagnostics?.[0]?.targetName, "空调滤清器更换");
  assert.equal(job.result!.answer.rows[0].firstKm, null, "do not invent a separate first service interval");
  assert.equal(job.result!.answer.manuals[0].url, source.url);
  for (const table of ["manual_imports", "files", "rules", "logs"] as const) assert.deepEqual(await list(service.db, table), [], `query may not write ${table}`);
  assert.deepEqual(await readdir(service.temporary), []);
  const payload = { modelId: model.id, answerId: job.id, consent: true };
  const [a, b] = await Promise.all([service.call("POST", "from-ai-answer", payload), service.call("POST", "from-ai-answer", payload)]);
  assert.equal(a.statusCode, 200, a.body); assert.equal(b.statusCode, 200, b.body);
  const draft = a.json<ManualImport>(); assert.equal(draft.id, b.json<ManualImport>().id);
  assert.equal(draft.status, "awaiting_confirmation"); assert.equal(draft.files[0].mimeType, "text/plain");
  assert.deepEqual(draft.mappingDiagnostics, job.result!.answer.mappingDiagnostics);
  assert.equal(draft.sourceUrl, source.url); assert.equal(draft.edition, ""); assert.equal(draft.metadataOrigin!.sourceTitle, "document");
  assert.equal(readings, 1); assert.equal(downloads, 1);
  assert.equal((await list(service.db, "manual_imports")).length, 1);
  assert.equal((await list(service.db, "files")).length, 1); assert.deepEqual(await list(service.db, "rules"), []);
  const stored = await get<ManualImport>(service.db, "manual_imports", draft.id);
  assert.equal(stored?.mappingDiagnostics, undefined, "matching explanations are computed for responses, not persisted as AI or human data");
  await put(service.db, "manual_imports", { ...stored!, status: "published", revision: 5 });
  const repeated = await service.call("POST", "from-ai-answer", payload);
  assert.equal(repeated.json<ManualImport>().status, "published", "repeat import returns the latest persisted state");
  assert.equal(repeated.json<ManualImport>().revision, 5);
  assert.equal(repeated.json<ManualImport>().mappingDiagnostics?.[0]?.status, "matched");
  assert.equal(repeated.json().modelIdentity, undefined, "internal concurrency fields stay private");
  await put(service.db, "models", { ...model, power: "混动 2.0L" });
  const changed = await service.call("POST", "from-ai-answer", payload);
  assert.equal(changed.statusCode, 409); assert.equal(changed.json().code, "MODEL_CHANGED");
});

test("directories, cloud-drive pages, and explicitly incompatible variants never become an AI manual answer", async t => {
  let downloads = 0, readings = 0;
  const service = await harness(t, { discover: async () => [directory, { ...source, url: "https://www.carobook.com/manual.html", kind: "carobook" }, { ...source, url: "https://pan.baidu.com/s/test" }, { ...source, description: "车型动力未明确，不能确认该版本适用" }], download: async () => { downloads++; throw new Error("must not download"); }, recognize: async () => { readings++; return recognition; } });
  const job = await service.finish(await service.start());
  assert.equal(job.result!.answer.status, "not_found"); assert.deepEqual(job.result!.answer.rows, []); assert.deepEqual(job.result!.answer.manuals, []);
  assert.equal(downloads, 0); assert.equal(readings, 0);
  const response = await service.call("POST", "from-ai-answer", { modelId: model.id, answerId: job.id, consent: true });
  assert.equal(response.statusCode, 409); assert.deepEqual(await list(service.db, "files"), []);
});

test("a readable document is still offered when AI fails or finds no maintenance rows", async t => {
  const service = await harness(t);
  for (const recognize of [async () => ({ ...recognition, rows: [] }), async () => { throw new Error("PRIVATE_PROVIDER_DETAIL"); }]) {
    const work = await readModelManualAnswer(service.ctx, model, () => {}, dependencies({ recognize }));
    assert.equal(work.result.answer.status, "not_found"); assert.equal(work.result.answer.manuals[0].url, source.url);
    assert.equal(work.result.answer.sourceUrl, source.url); assert.deepEqual(work.result.answer.rows, []); assert.equal(work.evidence, undefined);
    assert(!JSON.stringify(work.result).includes("PRIVATE_PROVIDER_DETAIL"));
  }
});

test("multiple PDF attachment indexes are skipped without selecting a file or passing the index to AI", async t => {
  const service = await harness(t);
  const index = { ...source, title: "保养时间表下载", url: "https://official.example/downloads.html" };
  const indexHtml = `<html><body><article><h1>保养时间表下载</h1><p>${"本页提供车辆保养资料附件，请依据车辆版本选择对应的手册原件。".repeat(4)}</p><a href="/fuel.pdf">汽油版保养手册</a><a href="/hybrid.pdf">混动版保养手册</a></article></body></html>`;
  for (const fallback of [false, true]) {
    const downloaded: string[] = []; let recognitions = 0;
    const work = await readModelManualAnswer(service.ctx, model, () => {}, dependencies({
      discover: async () => fallback ? [index, source] : [index],
      download: async url => { downloaded.push(url); return { bytes: Buffer.from(url === index.url ? indexHtml : html), type: "text/html", url }; },
      recognize: async (_config, _pages, _model, texts) => {
        recognitions++; assert(texts!.every(page => !page.text.includes("汽油版保养手册"))); return structuredClone(recognition);
      },
    }));
    assert.deepEqual(downloaded, fallback ? [index.url, source.url] : [index.url]);
    assert.equal(recognitions, fallback ? 1 : 0);
    assert.match(work.result.warnings.join(" "), /多份手册附件.*未自动猜选/);
    assert.equal(work.result.answer.manuals.some(manual => manual.url === index.url), false);
    assert.equal(work.result.answer.status, fallback ? "ready" : "not_found");
  }
  assert.deepEqual(await list(service.db, "files"), []);
});

test("an attachment page can follow its unique actual PDF and retain the rendered source evidence", async t => {
  const service = await harness(t);
  const document = await PDFDocument.create();
  document.addPage([360, 180]).drawText("Synthetic maintenance schedule: replace filter every 20000 km.", { x: 12, y: 100, size: 8 });
  const pdf = Buffer.from(await document.save());
  const index = { ...source, title: "保养资料下载", url: "https://official.example/one-manual.html" };
  const pdfUrl = "https://official.example/single-manual.pdf";
  const indexHtml = `<html><body><article><h1>保养资料下载</h1><p>${"此页提供对应车辆版本的手册原件下载，请阅读原件后了解具体保养要求。".repeat(4)}</p><a href="/single-manual.pdf">车主手册</a></article></body></html>`;
  const downloaded: string[] = []; let recognitions = 0;
  const work = await readModelManualAnswer(service.ctx, model, () => {}, dependencies({
    discover: async () => [index],
    download: async url => { downloaded.push(url); return { bytes: url === pdfUrl ? pdf : Buffer.from(indexHtml), type: url === pdfUrl ? "application/pdf" : "text/html", url }; },
    recognize: async (_config, pages, _model, texts) => {
      recognitions++; assert.equal(pages.length, 1); assert.equal(pages[0].pageNumber, 1); assert.equal(texts!.length, 0); return structuredClone(recognition);
    },
  }));
  assert.deepEqual(downloaded, [index.url, pdfUrl]); assert.equal(recognitions, 1);
  assert.equal(work.result.answer.sourceUrl, pdfUrl); assert.equal(work.result.answer.manuals[0].url, pdfUrl);
  assert(work.evidence!.files.some(file => file.original && file.mimeType === "application/pdf"));
  assert.deepEqual(work.evidence!.selection.pages, [1]); assert.equal(work.evidence!.selection.totalPages, 1);
  assert.deepEqual(await list(service.db, "files"), []); assert.deepEqual(await readdir(service.temporary), []);
});

test("readable maintenance text stays usable when it also links several PDF manuals", async t => {
  const service = await harness(t); const downloaded: string[] = [];
  const work = await readModelManualAnswer(service.ctx, model, () => {}, dependencies({
    discover: async () => [source],
    download: async url => { downloaded.push(url); return { bytes: Buffer.from(html.replace("</article>", '<a href="/a.pdf">原件A</a><a href="/b.pdf">原件B</a></article>')), type: "text/html", url }; },
  }));
  assert.deepEqual(downloaded, [source.url]); assert.equal(work.result.answer.status, "ready");
  assert.equal(work.result.answer.sourceUrl, source.url); assert.equal(work.result.answer.rows.length, 1);
});

test("unlocated text quotes and fabricated structured thresholds cannot be offered as grounded periodic rules", async t => {
  const service = await harness(t);
  for (const row of [
    { ...recognition.rows[0], sourceText: "不存在的原文：每99999公里更换空调滤清器。", intervalKm: 99999 },
    { ...recognition.rows[0], intervalKm: 99999 },
  ]) {
    const work = await readModelManualAnswer(service.ctx, model, () => {}, dependencies({ recognize: async () => ({ ...recognition, rows: [row] }) }));
    assert.equal(work.result.answer.status, "partial");
    assert.equal(work.result.answer.rows[0].include, false);
    assert.equal(work.result.answer.rows[0].triggerType, "condition");
    assert.match(work.result.answer.warnings.join(" "), /未能.*核对/);
  }
  for (const [phrase, intervalMonths] of [["每个月至少检查一次轮胎充气和状况", 1], ["每年检查一次轮胎充气和状况", 12]] as const) {
    const work = await readModelManualAnswer(service.ctx, model, () => {}, dependencies({
      download: async url => ({ bytes: Buffer.from(html.replace("</article>", `<p>${phrase}</p></article>`)), type: "text/html", url }),
      recognize: async () => ({ ...recognition, rows: [{ ...recognition.rows[0], name: "轮胎充气和状况", action: "inspect", sourceText: phrase, intervalMonths, intervalKm: null }] }),
    }));
    assert.equal(work.result.answer.rows[0].include, true, phrase);
    assert.equal(work.result.answer.rows[0].triggerType, "periodic", phrase);
  }
});

test("answer jobs require platform access and consent, isolate users, deduplicate, expire, and reject changed models", async t => {
  let moment = 1000;
  const service = await harness(t, { clock: () => moment, ttlMs: 50 });
  const payload = { modelId: model.id, consent: true };
  assert.equal((await service.call("POST", "ai-answer", payload, "anonymous", "")).statusCode, 401);
  assert.equal((await service.call("POST", "ai-answer", payload, "owner", "owner")).statusCode, 403);
  assert.equal((await service.call("POST", "ai-answer", { ...payload, consent: false })).statusCode, 400);
  const first = await service.start();
  const duplicate = await service.call("POST", "ai-answer", payload);
  assert.equal(duplicate.json<ManualAiAnswerJob>().id, first.id);
  const otherRead = await service.call("GET", `ai-answer/${first.id}`, undefined, "admin-b");
  assert.equal(otherRead.statusCode, 404);
  const otherImport = await service.call("POST", "from-ai-answer", { ...payload, answerId: first.id }, "admin-b");
  assert.equal(otherImport.statusCode, 404);
  await service.finish(first);
  await put(service.db, "models", { ...model, year: 2024 });
  const changed = await service.call("POST", "from-ai-answer", { ...payload, answerId: first.id });
  assert.equal(changed.statusCode, 409); assert.equal(changed.json().code, "MODEL_CHANGED");
  moment += 51;
  assert.equal((await service.call("GET", `ai-answer/${first.id}`)).statusCode, 404);
  assert.deepEqual(await list(service.db, "manual_imports"), []); assert.deepEqual(await list(service.db, "files"), []);
});

test("answer cache enforces byte limits without persisting partial evidence", async t => {
  const service = await harness(t, { maxCacheBytes: 1 });
  const job = await service.finish(await service.start());
  assert.equal(job.status, "failed");
  assert.deepEqual(await list(service.db, "files"), []); assert.deepEqual(await readdir(service.temporary), []);
});

test("the total evidence cache evicts old completed answers before exceeding its byte budget", async t => {
  const page = extractManualWebPage(Buffer.from(html), source.url);
  const evidenceBytes = Buffer.byteLength(`\ufeff网页标题：${page.title}\n来源网址：${source.url}\n\n${page.text}`);
  const service = await harness(t, { maxCacheBytes: evidenceBytes + 10 });
  const a = await service.finish(await service.start("admin-a"), "admin-a");
  const b = await service.finish(await service.start("admin-b"), "admin-b");
  assert.equal(a.status, "completed"); assert.equal(b.status, "completed");
  assert.equal((await service.call("GET", `ai-answer/${a.id}`, undefined, "admin-a")).statusCode, 404);
  assert.equal((await service.call("GET", `ai-answer/${b.id}`, undefined, "admin-b")).statusCode, 200);
  assert.deepEqual(await list(service.db, "files"), []);
});

test("failed draft transactions clean persisted evidence and allow the same answer to be retried", async t => {
  let recognitions = 0;
  const service = await harness(t, { recognize: async () => { recognitions++; return structuredClone(recognition); } });
  const job = await service.finish(await service.start());
  const payload = { modelId: model.id, answerId: job.id, consent: true };
  const transaction = service.db.transaction.bind(service.db);
  service.db.transaction = async () => { throw new Error("synthetic transaction failure"); };
  const failed = await service.call("POST", "from-ai-answer", payload);
  assert.equal(failed.statusCode, 400);
  assert.deepEqual(await list(service.db, "files"), []); assert.deepEqual(await list(service.db, "manual_imports"), []);
  assert.deepEqual(await readdir(service.temporary), []);
  service.db.transaction = transaction;
  const retried = await service.call("POST", "from-ai-answer", payload);
  assert.equal(retried.statusCode, 200, retried.body); assert.equal(retried.json<ManualImport>().status, "awaiting_confirmation");
  assert.equal(recognitions, 1, "retry reuses cached recognition rather than making another AI call");
});

test("answer queue bounds concurrent work and does not share jobs between administrators", async t => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  const service = await harness(t, { discover: async () => { reads++; await gate; return [source]; } });
  const a = await service.start("admin-a"), b = await service.start("admin-b"), c = await service.start("admin-c");
  const rejected = await service.call("POST", "ai-answer", { modelId: model.id, consent: true }, "admin-d");
  assert.equal(rejected.statusCode, 429); assert.equal(reads, 1, "only one reading worker runs at a time");
  assert.notEqual(a.id, b.id); release();
  await service.finish(a, "admin-a"); await service.finish(b, "admin-b"); await service.finish(c, "admin-c");
  assert.equal(reads, 3);
});
