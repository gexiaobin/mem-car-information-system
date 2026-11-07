import { z } from "zod";
import type { CarModel, ManualImport, ManualPageSelection, ManualProjectMappingDiagnostic, ManualRuleDraft, ManualSource, Project } from "@autovoyage/shared";
import type { Context } from "./context.js";
import { roles, route } from "./context.js";
import { get, list } from "./db.js";
import { AppError, ensure, id, now } from "./domain.js";
import { discoverManualSources, modelManualQueries, publicDownload, validateSourceUrl } from "./manual-sources.js";
import { prepareManualImage, prepareManualPdfSelection, persistPreparedManualFiles, type PreparedFile } from "./manual-files.js";
import { extractManualWebPage } from "./manual-web-source.js";
import { recognizeManual } from "./manual-vision.js";
import { autoMapManualProjects, diagnoseManualProjectMappings } from "./manual-project-mapping.js";
import { createRecognizedManualDraft, manualModelIdentity } from "./manuals.js";
import { acquireOfficialManualContext } from "./manual-official-sources.js";

export interface ManualAiAnswerResult {
  query: string; sources: ManualSource[]; summary: string; warnings: string[];
  aiStatus: "completed" | "unavailable" | "not_configured";
  searchedAt: string; evidenceMode: "document_reading";
  answer: {
    status: "ready" | "partial" | "not_found";
    title: string; summary: string; applicability: string; edition: string;
    sourceTitle: string; sourceUrl: string; manuals: ManualSource[];
    rows: ManualRuleDraft[]; mappingDiagnostics?: ManualProjectMappingDiagnostic[]; warnings: string[];
  };
}
export interface ManualAiAnswerJob {
  id: string; modelId: string;
  status: "searching" | "reading" | "organizing" | "completed" | "failed";
  message: string; result?: ManualAiAnswerResult; createdAt: string; updatedAt: string;
}
type Progress = (status: ManualAiAnswerJob["status"], message: string) => void;
interface PreparedEvidence {
  files: PreparedFile[]; sourceUrl: string; title: string; manuals: ManualSource[];
  selection: ManualPageSelection;
}
interface CachedEvidence extends PreparedEvidence { sourceExcerpt: string }
export interface ManualAnswerDependencies {
  discover?: typeof discoverManualSources;
  download?: typeof publicDownload;
  recognize?: typeof recognizeManual;
  clock?: () => number;
  ttlMs?: number;
  maxCacheBytes?: number;
}
interface AnswerWork { result: ManualAiAnswerResult; evidence?: CachedEvidence }
interface StoredAnswer {
  job: ManualAiAnswerJob; userId: string; modelIdentity: string; model: CarModel;
  expires: number; evidence?: CachedEvidence; imported?: ManualImport; importing?: Promise<ManualImport>;
}
const MiB = 1024 * 1024;
const maintenanceWords = /保养|维护|维修|maintenance|service\s+(?:schedule|interval)/i;
const blockedHost = /(^|\.)(?:pan\.baidu\.com|yun\.baidu\.com|lanzou[a-z]?\.com|aliyundrive\.com|alipan\.com)$/i;
const done = (job: ManualAiAnswerJob) => ["completed", "failed"].includes(job.status);
const bodySchema = z.object({ modelId: z.string().trim().min(1).max(80), consent: z.literal(true) }).strict();

function binaryType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}
function filename(url: string) {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || "保养资料").replace(/[\x00-\x1f\x7f\\/]/g, "").slice(0, 160); }
  catch { return "保养资料"; }
}
function bytesUsed(evidence?: CachedEvidence) { return evidence?.files.reduce((total, file) => total + file.bytes.length, 0) || 0; }
function sourceOrder(source: ManualSource) {
  return (source.kind === "official" ? 100 : 0) + (/保养(?:时间表|周期表|表)|维护计划|maintenance|schedule|by_page/i.test(source.title + source.url) ? 30 : 0) - (/carobook\.com/i.test(new URL(source.url).hostname) ? 50 : 0);
}
function safeSources(sources: ManualSource[]) {
  const seen = new Set<string>();
  return sources.filter(source => {
    try {
      const url = validateSourceUrl(source.url);
      if (blockedHost.test(url.hostname) || seen.has(url.href)) return false;
      seen.add(url.href); return true;
    } catch { return false; }
  }).slice(0, 20).map(source => ({ ...source, title: source.title.slice(0, 1000), description: source.description.slice(0, 3000), isDirectory: source.isDirectory !== false }));
}

const quoteForm = (value: string) => value.normalize("NFKC").replace(/[\s|｜]/g, "");
/** Pure text quotes can be checked against acquired bytes; image OCR still needs visual review. */
function groundTextRows(rows: ManualRuleDraft[], files: PreparedFile[]) {
  const texts = new Map(files.filter(file => file.mimeType === "text/plain" && file.pageNumber !== null).map(file => [file.pageNumber!, file.bytes.toString("utf8").replace(/^\ufeff/, "")]));
  const warnings: string[] = [];
  const grounded = rows.map(row => {
    if (row.pageNumbers.some(page => !texts.has(page))) return row;
    const cited = row.pageNumbers.map(page => quoteForm(texts.get(page)!));
    const quotes = row.sourceText.split(/\n+/).map(line => quoteForm(line)).filter(Boolean);
    const located = quotes.length > 0 && quotes.every(quote => cited.some(page => page.includes(quote)));
    const numbers = [...row.sourceText.normalize("NFKC").matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(match => Number(match[0].replace(/,/g, ""))).filter(Number.isFinite);
    const kmEvidence = new Set(numbers.flatMap(value => [value, value * 1000, value * 10000]));
    // Equal spaced cumulative kilometre nodes can explicitly support a gap.
    // Ignore footnote counts and small unitless numbers when computing gaps.
    for (const left of numbers.filter(value => value >= 1000)) for (const right of numbers.filter(value => value >= 1000)) if (left > right) kmEvidence.add(left - right);
    const monthEvidence = new Set(numbers.flatMap(value => [value, value * 12]));
    // These source phrases state one month/year without an Arabic numeral.
    if (/每\s*(?:个)?月/.test(row.sourceText)) monthEvidence.add(1);
    if (/每\s*年/.test(row.sourceText)) monthEvidence.add(12);
    const supported = [row.firstKm, row.intervalKm].every(value => value === null || kmEvidence.has(value)) && [row.firstMonths, row.intervalMonths].every(value => value === null || monthEvidence.has(value));
    if (located && supported) return row;
    const reason = !located ? "AI摘录未能逐字定位到引用原文" : "AI结构化周期数字未能在引用原文中核实";
    warnings.push(`“${row.name}”${reason}，已取消默认导入，请对照原文核对。`);
    return { ...row, include: false, triggerType: "condition" as const, condition: ["AI摘录与周期需核对，尚不能作为已验证规则", row.condition].filter(Boolean).join("；").slice(0, 3000) };
  });
  return { rows: grounded, warnings };
}

/** Read public bytes into bounded memory. No file, business row, or draft is written by a query. */
async function prepareEvidence(source: ManualSource, model: CarModel, dependencies: ManualAnswerDependencies): Promise<PreparedEvidence> {
  const download = dependencies.download || publicDownload;
  const deadline = Date.now() + 45000;
  const downloaded = await download(source.url, 0, undefined, 15000, deadline);
  const type = binaryType(downloaded.bytes);
  const concrete = { ...source, url: downloaded.url, isDirectory: false };
  if (type) {
    if (type === "application/pdf") {
      const prepared = await prepareManualPdfSelection(downloaded.bytes, filename(downloaded.url), undefined, "auto");
      return { ...prepared, sourceUrl: downloaded.url, title: source.title, manuals: [concrete] };
    }
    const files = [await prepareManualImage(downloaded.bytes, filename(downloaded.url), type, 1)];
    return {
      files, sourceUrl: downloaded.url, title: source.title, manuals: [concrete],
      selection: { mode: "images", pages: [1], totalPages: null, notice: "已自动读取实际公开保养资料，无需重新下载或指定页码。" },
    };
  }
  ensure(downloaded.type.includes("html") || /^\s*(?:<!doctype html|<html)/i.test(downloaded.bytes.subarray(0, 300).toString()), 400, "MANUAL_FORMAT", "来源未返回可读手册");
  const page = extractManualWebPage(downloaded.bytes, downloaded.url, downloaded.charset);
  ensure(maintenanceWords.test(`${page.title}\n${page.text}`) && (page.text.length >= 80 || page.images.length), 400, "MANUAL_WEB_NO_EVIDENCE", "未取得保养正文");
  // Prefer a readable maintenance page to an unrelated whole-book download.
  // An attachment index is not evidence. Follow only one unambiguous PDF;
  // never pick the first variant from a page containing several manuals.
  const hasBodyEvidence = page.images.length > 0 || (
    /更换|检查|清洁|润滑|换位|轮换|replace|inspect|check|clean|lubricat|rotat/i.test(page.text)
    && /\d[\d,.]*\s*(?:万|千)?\s*(?:km|公里|千米|个月|月|年)|每(?:个月|月|年)|当.{0,80}(?:警告|提示)|按需|必要时|when\b|as needed/i.test(page.text)
  );
  if (page.pdfs.length && !hasBodyEvidence) {
    ensure(page.pdfs.length === 1, 400, "MANUAL_MULTIPLE_ATTACHMENTS", "该页面有多份手册附件且没有可读保养正文，不能自动猜选车型版本");
    const pdf = await download(page.pdfs[0], 0, undefined, 15000, deadline);
    ensure(binaryType(pdf.bytes) === "application/pdf", 400, "MANUAL_FORMAT", "手册附件未返回有效 PDF，不能将下载索引页作为保养正文");
    const prepared = await prepareManualPdfSelection(pdf.bytes, filename(pdf.url), undefined, "auto");
    return { ...prepared, sourceUrl: pdf.url, title: page.title || source.title, manuals: [{ ...concrete, url: pdf.url }] };
  }
  const files: PreparedFile[] = [];
  const manuals = [concrete];
  function appendText(title: string, text: string, url: string) {
    const original = `网页标题：${title || "保养资料"}\n来源网址：${url}\n\n${text}`;
    files.push({ bytes: Buffer.from(`\ufeff${original}`, "utf8"), name: `${title || "保养网页"}.txt`.slice(0, 180), mimeType: "text/plain", pageNumber: files.length + 1, original: true });
  }
  appendText(page.title, page.text, downloaded.url);
  // The official electronic schedule identifies its book through the same
  // directory. Read the book's actual foreword as separate evidence, rather
  // than inferring an edition from a search snippet or target model.
  const url = new URL(downloaded.url);
  if (/^(?:www\.)?dongfeng-honda\.com$/i.test(url.hostname) && /^\/html\/userguide\/[^/]+\/[^/]+\.html$/.test(url.pathname)) {
    try {
      const scope = await download(new URL("./", url).href, 0, undefined, 8000, deadline, 2 * MiB);
      const scopePage = extractManualWebPage(scope.bytes, scope.url, scope.charset);
      if (/本手册|适用|上市|车型/.test(scopePage.text) && scopePage.text.length > 60) {
        appendText(scopePage.title, scopePage.text, scope.url);
        manuals.push({ title: scopePage.title || "同册官方电子手册", url: scope.url, kind: "official", description: "已读取同册首页原文，用于核对实际适用范围", isDirectory: false });
      }
    } catch { /* Schedule remains readable; missing scope stays an explicit unknown. */ }
    try {
      const contexts = await acquireOfficialManualContext(model, downloaded.url, download);
      for (const context of contexts) appendText(context.title, context.text, context.url);
      // Directory cards support scope only; they are never exposed as a found
      // readable manual in answer.manuals.
    } catch { /* A catalogue mismatch cannot replace actual schedule evidence. */ }
  }
  let total = files.reduce((sum, file) => sum + file.bytes.length, 0);
  for (const imageUrl of page.images.slice(0, 3)) {
    if (Date.now() >= deadline) break;
    try {
      const image = await download(imageUrl, 0, undefined, 8000, deadline, 8 * MiB);
      const imageType = binaryType(image.bytes);
      if (!imageType?.startsWith("image/") || total + image.bytes.length > 32 * MiB) continue;
      const file = await prepareManualImage(image.bytes, filename(image.url), imageType, files.length + 1);
      total += file.bytes.length; files.push(file);
    } catch { /* Optional pictures cannot erase an already readable schedule. */ }
  }
  return { files, sourceUrl: downloaded.url, title: page.title || source.title, manuals,
    selection: { mode: "images", pages: files.map(file => file.pageNumber!), totalPages: null, notice: "已保存可读网页原文及保养表图片，编号仅用于对照证据；无需选择 PDF 页码。" } };
}

export async function readModelManualAnswer(ctx: Context, model: CarModel, progress: Progress, dependencies: ManualAnswerDependencies = {}): Promise<AnswerWork> {
  const warnings: string[] = [];
  const result: ManualAiAnswerResult = {
    query: modelManualQueries(model).join(" / "), sources: [], summary: "", warnings,
    aiStatus: "not_configured", searchedAt: now(), evidenceMode: "document_reading",
    answer: { status: "not_found", title: `${model.brand} ${model.name} 保养资料`, summary: "", applicability: "", edition: "", sourceTitle: "", sourceUrl: "", manuals: [], rows: [], warnings: [] },
  };
  progress("searching", "正在查找公开可直接阅读的保养手册与保养周期表…");
  try { result.sources = safeSources(await (dependencies.discover || discoverManualSources)(model)); }
  catch { warnings.push("公开检索暂时不可用，本次未取得可读手册原文，请稍后重试或上传保养表图片。"); }
  const candidates = result.sources.filter(source => !source.isDirectory && !/(^|\.)carobook\.com$/i.test(new URL(source.url).hostname) && !/车型动力未明确|动力与当前车型可能冲突|与当前\s*\d+\s*年款不同/.test(source.description)).sort((a, b) => sourceOrder(b) - sourceOrder(a));
  if (!ctx.config.aiBaseUrl || !ctx.config.aiKey || !ctx.config.aiModel) {
    result.summary = "尚未配置 AI 识别服务，不能直接整理保养手册内容。";
    result.answer.summary = result.summary; result.answer.warnings = [...warnings]; return { result };
  }
  if (!candidates.length) {
    result.aiStatus = "completed";
    result.summary = "未找到可直接读取的保养手册或保养表，未生成保养周期。";
    warnings.push("网盘下载页、搜索目录和网页摘要不能作为保养规则原文；可直接上传保养表截图识别。");
    result.answer.summary = result.summary; result.answer.warnings = [...warnings]; return { result };
  }
  for (const source of candidates.slice(0, 2)) {
    let evidence: PreparedEvidence;
    try {
      progress("reading", `正在读取${source.kind === "official" ? "官方" : "公开"}手册与保养表原文…`);
      evidence = await prepareEvidence(source, model, dependencies);
      // A readable book remains useful even if no periodic rows are extracted.
      result.answer.manuals = [...result.answer.manuals, ...evidence.manuals].filter((manual, index, all) => all.findIndex(item => item.url === manual.url) === index);
      if (!result.answer.sourceUrl) {
        result.answer.sourceUrl = evidence.sourceUrl; result.answer.sourceTitle = evidence.title; result.answer.title = evidence.title;
      }
    } catch (error) {
      warnings.push(error instanceof AppError && error.code === "MANUAL_MULTIPLE_ATTACHMENTS"
        ? `“${source.title}”包含多份手册附件且没有可读保养正文，未自动猜选版本，已跳过。`
        : `“${source.title}”未取得可用原文，已跳过。`);
      continue;
    }
    try {
      progress("organizing", "已取得手册原文，AI正在逐项整理保养周期、条件与出处…");
      const pages = evidence.files.filter(file => file.mimeType === "image/jpeg" && file.pageNumber !== null).map(file => ({ pageNumber: file.pageNumber!, buffer: file.bytes }));
      const texts = evidence.files.filter(file => file.mimeType === "text/plain" && file.pageNumber !== null).map(file => ({ pageNumber: file.pageNumber!, text: file.bytes.toString("utf8").replace(/^\ufeff/, "") }));
      const read = await (dependencies.recognize || recognizeManual)(ctx.config, pages, `${model.brand} ${model.name} ${model.year}款 ${model.power}`, texts);
      const available = new Set([...pages, ...texts].map(page => page.pageNumber));
      ensure(read.rows.every(row => row.sourceText.trim() && row.pageNumbers.length && row.pageNumbers.every(page => available.has(page))), 422, "AI_EVIDENCE_INVALID", "识别结果缺少实际原文依据");
      if (!read.rows.length) { warnings.push(`已读取“${source.title}”，但没有提取到有原文依据的保养项目。`); continue; }
      const grounded = groundTextRows(read.rows.map(row => ({ ...row, id: id(), projectId: null, catalogProjectId: null, createProject: false, include: row.triggerType === "periodic" })), evidence.files);
      const projects = await list<Project>(ctx.db, "projects");
      const rows = autoMapManualProjects(grounded.rows, projects);
      const answerWarnings = [...warnings, ...read.warnings, ...grounded.warnings];
      if (!read.applicability.trim()) answerWarnings.push("已读取资料尚未明确适用车型范围，导入前请对照原文核对年款与动力。");
      if (!read.edition.trim()) answerWarnings.push("原文未注明版本，可留空。");
      const partial = !read.applicability.trim() || rows.some(row => row.triggerType !== "periodic") || answerWarnings.some(warning => /不匹配|尚不能证明|年款冲突|无法确定/.test(warning));
      result.aiStatus = "completed";
      result.summary = `已读取${evidence.manuals.length}份实际资料，整理出${rows.length}项保养项目，可直接转为导入草稿。`;
      result.answer = {
        status: partial ? "partial" : "ready", title: read.sourceTitle || evidence.title,
        summary: result.summary, applicability: read.applicability, edition: read.edition,
        sourceTitle: read.sourceTitle || evidence.title, sourceUrl: evidence.sourceUrl,
        manuals: evidence.manuals, rows, mappingDiagnostics: diagnoseManualProjectMappings(rows, projects), warnings: [...new Set(answerWarnings)],
      };
      result.warnings = result.answer.warnings;
      return { result, evidence: { ...evidence, sourceExcerpt: read.sourceExcerpt } };
    } catch {
      result.aiStatus = "unavailable";
      warnings.push("已取得资料，但 AI 本次未能完成有效的原文识别，未使用经验值生成保养周期。请重试或上传保养表截图。");
      break;
    }
  }
  if (result.aiStatus !== "unavailable") result.aiStatus = "completed";
  result.summary = "本次没有得到可导入的保养项目；未生成缺少原文依据的保养周期。";
  result.answer.summary = result.summary; result.answer.warnings = [...new Set(warnings)];
  return { result };
}

/** A queued job avoids the reverse proxy timeout while documents and AI are read. */
export function registerManualAnswers(ctx: Context, dependencies: ManualAnswerDependencies = {}) {
  const entries = new Map<string, StoredAnswer>();
  const queue: StoredAnswer[] = [];
  const clock = dependencies.clock || Date.now;
  const ttl = dependencies.ttlMs ?? 30 * 60000;
  const maxCache = dependencies.maxCacheBytes ?? 96 * MiB;
  let draining: Promise<void> | undefined;
  let closing = false;
  const snapshot = (entry: StoredAnswer) => structuredClone(entry.job);
  function prune() {
    for (const [key, entry] of entries) if (done(entry.job) && !entry.importing && entry.expires <= clock()) entries.delete(key);
  }
  function evict(required: number, protectedEntry: StoredAnswer) {
    prune();
    let used = [...entries.values()].reduce((sum, entry) => sum + bytesUsed(entry.evidence), 0);
    for (const [key, entry] of entries) {
      if (used + required <= maxCache) break;
      if (entry === protectedEntry || entry.importing || !done(entry.job)) continue;
      used -= bytesUsed(entry.evidence); entries.delete(key);
    }
    ensure(used + required <= maxCache, 503, "AI_ANSWER_MEMORY_BUSY", "手册资料缓存繁忙，请稍后重试");
  }
  function schedule() {
    if (draining || closing) return;
    draining = (async () => {
      while (queue.length && !closing) {
        const entry = queue.shift()!;
        try {
          const work = await readModelManualAnswer(ctx, entry.model, (status, message) => {
            entry.job.status = status; entry.job.message = message; entry.job.updatedAt = now();
          }, dependencies);
          if (closing) break;
          if (work.evidence) { evict(bytesUsed(work.evidence), entry); entry.evidence = work.evidence; }
          entry.job.result = work.result; entry.job.status = "completed"; entry.job.message = work.result.summary;
        } catch {
          entry.evidence = undefined; entry.job.status = "failed";
          entry.job.message = "本次查询未完成，请稍后重试或上传保养表图片。";
        }
        entry.job.updatedAt = now(); entry.expires = clock() + (entry.evidence ? ttl : Math.min(ttl, 30000));
      }
    })().finally(() => { draining = undefined; });
  }
  ctx.app.addHook("onClose", async () => { closing = true; queue.length = 0; entries.clear(); });
  ctx.app.post(route("/admin/manual-imports/ai-answer"), { config: { rateLimit: { max: 4, timeWindow: "1 minute" } } }, async (request, reply) => {
    const user = roles(request, ["platform_admin"]);
    const input = bodySchema.parse(request.body);
    const model = await get<CarModel>(ctx.db, "models", input.modelId);
    ensure(model, 404, "MODEL_NOT_FOUND", "请选择已有车型档案");
    prune();
    const modelIdentity = manualModelIdentity(model);
    const existing = [...entries.values()].find(entry => entry.userId === user.id && entry.job.modelId === model.id && entry.modelIdentity === modelIdentity && (!done(entry.job) || (entry.expires > clock() && (entry.evidence || entry.imported))));
    if (existing) return snapshot(existing);
    ensure([...entries.values()].filter(entry => !done(entry.job)).length < 3, 429, "AI_ANSWER_BUSY", "手册查询正在处理中，请稍后重试");
    while (entries.size >= 30) {
      const oldest = [...entries.entries()].find(([_key, entry]) => done(entry.job) && !entry.importing);
      ensure(oldest, 429, "AI_ANSWER_BUSY", "手册查询繁忙，请稍后重试"); entries.delete(oldest[0]);
    }
    const stamp = now();
    const entry: StoredAnswer = { userId: user.id, modelIdentity, model, expires: clock() + ttl,
      job: { id: id(), modelId: model.id, status: "searching", message: "正在排队查找可直接阅读的保养资料…", createdAt: stamp, updatedAt: stamp } };
    entries.set(entry.job.id, entry); queue.push(entry);
    const initial = snapshot(entry); schedule(); reply.code(202); return initial;
  });
  ctx.app.get(route("/admin/manual-imports/ai-answer/:id"), async request => {
    const user = roles(request, ["platform_admin"]);
    const input = z.object({ id: z.string().min(1).max(80) }).parse(request.params);
    prune();
    const entry = entries.get(input.id);
    ensure(entry && entry.userId === user.id, 404, "AI_ANSWER_NOT_FOUND", "查询已过期，请重新查询");
    return snapshot(entry);
  });
  ctx.app.post(route("/admin/manual-imports/from-ai-answer"), async request => {
    const user = roles(request, ["platform_admin"]);
    const input = bodySchema.extend({ answerId: z.string().min(1).max(80) }).parse(request.body);
    prune();
    const entry = entries.get(input.answerId);
    ensure(entry && entry.userId === user.id && entry.job.modelId === input.modelId, 404, "AI_ANSWER_NOT_FOUND", "查询已过期或与当前车型不符，请重新查询");
    const model = await get<CarModel>(ctx.db, "models", input.modelId);
    ensure(model && manualModelIdentity(model) === entry.modelIdentity, 409, "MODEL_CHANGED", "车型资料已变更，请重新查询对应手册");
    if (entry.imported) {
      const current = await get<ManualImport>(ctx.db, "manual_imports", entry.imported.id);
      ensure(current, 404, "AI_ANSWER_NOT_FOUND", "导入草稿已不存在，请重新查询");
      // Stored documents also contain server-only concurrency fields. Reuse the
      // public shape saved on first import while refreshing its current fields.
      const result = Object.fromEntries(Object.keys(entry.imported).filter(key => key !== "mappingDiagnostics").map(key => [key, current[key as keyof ManualImport]])) as unknown as ManualImport;
      return { ...result, mappingDiagnostics: diagnoseManualProjectMappings(current.rows, await list<Project>(ctx.db, "projects")) };
    }
    if (entry.importing) return entry.importing;
    const answer = entry.job.result?.answer;
    ensure(entry.job.status === "completed" && answer?.rows.length && entry.evidence, 409, "AI_ANSWER_NOT_READY", "尚未取得有原文依据的保养项目，请先完成查询");
    const evidence = entry.evidence;
    entry.importing = (async () => {
      const saved = await persistPreparedManualFiles(ctx, user.id, evidence.files);
      try {
        const draft = await createRecognizedManualDraft(ctx, user.id, model.id, entry.modelIdentity, {
          sourceTitle: answer.sourceTitle, sourceUrl: answer.sourceUrl, edition: answer.edition,
          applicability: answer.applicability, sourceExcerpt: evidence.sourceExcerpt, rows: answer.rows,
          warnings: answer.warnings, files: saved.files, selection: evidence.selection,
        });
        entry.imported = draft; entry.evidence = undefined; entry.expires = clock() + ttl;
        return draft;
      } catch (error) { await saved.cleanup(); throw error; }
    })().finally(() => { entry.importing = undefined; });
    return entry.importing;
  });
}
