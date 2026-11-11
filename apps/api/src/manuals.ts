import { z } from "zod";
import type { CarModel, MaintenanceRule, ManualAsset, ManualDocument, ManualImport, ManualMetadataOrigin, ManualPageSelection, ManualRuleDraft, Project, Vehicle } from "@autovoyage/shared";
import { hasRecurringMaintenanceThreshold, usesIndependentConditionThreshold } from "@autovoyage/shared";
import type { Context } from "./context.js";
import { authenticated, roles, route } from "./context.js";
import { get, list, put, type Sql } from "./db.js";
import { AppError, audit, ensure, id, now, sha256 } from "./domain.js";
import { readManualImages, receiveManualFiles } from "./manual-files.js";
import { discoverManualSources, manualSources } from "./manual-sources.js";
import { ingestManualSource, readManualTextEvidence } from "./manual-web-source.js";
import { manualRowSchema, recognizeManual, recognizeManualText } from "./manual-vision.js";
import { autoMapManualProjects, diagnoseManualProjectMappings, manualProjectSubject, standardProjectAction } from "./manual-project-mapping.js";
import { catalogProjects, catalogSources, catalogVersion } from "./data/public-catalog.js";

interface StoredManual extends ManualImport {
  attempts: number;
  modelIdentity: string;
  baseRuleVersions: Record<string, number>;
  publicationHash?: string;
  acquiredSourceUrl: string;
}
const sourceUrlSchema = z.string().trim().max(2500).refine(value => {
  if (!value || /^\/api\/v1\/manual-files\/[\w-]+$/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}, "请填写 HTTPS 手册来源链接，或上传原件保留来源");
const metadataSchema = z.object({
  modelId: z.string().trim().min(1).max(80),
  sourceTitle: z.string().trim().max(1000).default(""),
  sourceUrl: sourceUrlSchema.default(""),
  edition: z.string().trim().max(500).default(""),
  applicability: z.string().trim().max(3000).default(""),
  sourceExcerpt: z.string().trim().max(16000).default(""),
  pageRange: z.string().trim().max(200).optional(),
  pageMode: z.enum(["auto", "manual"]).default("auto"),
});
const draftFieldsSchema = z.object({
  rows: z.array(manualRowSchema.extend({ name: z.string().trim().max(160) })).max(120),
  sourceTitle: z.string().trim().max(1000),
  sourceUrl: sourceUrlSchema,
  edition: z.string().trim().max(500),
  applicability: z.string().trim().max(3000),
  sourceExcerpt: z.string().trim().max(16000).optional(),
}).strict();
const draftSchema = draftFieldsSchema.extend({ expectedRevision: z.number().int().positive() });
const manualEntrySchema = draftFieldsSchema
  .extend({ modelId: z.string().trim().min(1).max(80), consent: z.literal(true) })
  .extend({ rows: draftFieldsSchema.shape.rows.min(1, "请至少录入一条保养项目") });
const publishSchema = z.object({ expectedRevision: z.number().int().positive(), verified: z.literal(true), applicabilityConfirmed: z.literal(true), draft: draftFieldsSchema.optional() }).strict();
export const manualModelIdentity = (model: CarModel) => sha256(JSON.stringify([model.brand, model.name, model.year, model.power, model.isDemo]));
const identity = manualModelIdentity;
const latestVersions = (rules: MaintenanceRule[]) => Object.fromEntries([...new Set(rules.map(rule => rule.projectId))].map(projectId => [projectId, Math.max(0, ...rules.filter(rule => rule.projectId === projectId).map(rule => rule.version))]));
const normalizedName = (name: string) => name.replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
const metadataKeys = ["sourceTitle", "edition", "applicability"] as const;
// Older imports predate provenance; existing human-entered values remain owned
// by the user and must never be replaced when such a job is retried.
const originsFor = (job: Pick<ManualImport, "sourceTitle" | "edition" | "applicability" | "metadataOrigin">): ManualMetadataOrigin => ({
  sourceTitle: job.sourceTitle.trim() ? "provided" : "unknown",
  edition: job.edition.trim() ? "provided" : "unknown",
  applicability: job.applicability.trim() ? "provided" : "unknown",
  ...job.metadataOrigin,
});
const usableDocumentMetadata = (value: string) => !!value.trim() && !/^(?:未知|不详|不明|未见|未识别|未提供|未标注|无法确定|待核对|待确认|unknown|n\/?a|null|none)[。.!！]?$/i.test(value.trim());
function presentManual(job: StoredManual, projects: Project[]): ManualImport {
  const { attempts: _, modelIdentity: __, baseRuleVersions: ___, publicationHash: ____, acquiredSourceUrl: _____, ...result } = job;
  return { ...result, rows: result.rows.map(row => row.triggerType === "condition" && row.conditionThresholdsIndependent === undefined ? { ...row, conditionThresholdsIndependent: usesIndependentConditionThreshold(row) } : row), mappingDiagnostics: diagnoseManualProjectMappings(job.rows, projects) };
}
function verifySourceLink(sourceUrl: string, files: ManualAsset[]) {
  ensure(!sourceUrl.startsWith("/api/") || files.some(file => file.url === sourceUrl), 400, "SOURCE_FILE_MISMATCH", "本地来源链接必须对应本次手册原件或页面");
}
function verifyEvidence(rows: ManualRuleDraft[], files: ManualAsset[], publishing: boolean, manual = false) {
  ensure(new Set(rows.map(row => row.id)).size === rows.length, 400, "DUPLICATE_MANUAL_ROW", "手册候选行标识不能重复");
  const available = new Set(files.filter(file => !file.original || file.mimeType.startsWith("image/") || file.mimeType === "text/plain").map(file => file.pageNumber).filter(page => page !== null));
  for (const row of rows) {
    ensure(manual || row.pageNumbers.every(page => available.has(page)), 400, "SOURCE_PAGE_INVALID", "来源页码必须对应本次上传且已渲染的原文页面");
    const mappingCount = [!!row.projectId, !!row.catalogProjectId, row.createProject].filter(Boolean).length;
    ensure(mappingCount <= 1, 400, "PROJECT_MAPPING_CONFLICT", "同一规则不能同时选择已有项目、参考项目和新建项目");
    if (!publishing || !row.include) continue;
    ensure(!!row.sourceText, 400, "SOURCE_EVIDENCE_REQUIRED", "每条规则都须保留手册依据摘录");
    if (!manual) ensure(row.pageNumbers.length > 0, 400, "SOURCE_EVIDENCE_REQUIRED", "每条发布规则都须保留来源页码");
    ensure(mappingCount === 1, 400, "PROJECT_MAPPING_REQUIRED", "每条规则请选择已有项目、参考目录项目，或明确勾选新建标准项目");
    if (row.catalogProjectId) {
      const reference = catalogProjects.find(project => project.id === row.catalogProjectId);
      ensure(reference && reference.category !== "diagnosis", 400, "CATALOG_PROJECT_NOT_FOUND", "参考服务项目不存在，请重新选择");
      ensure(reference.action === row.action, 400, "PROJECT_ACTION_MISMATCH", "参考项目的操作与本行不一致，请区分检查、更换、清洁和润滑");
    }
    if (row.triggerType === "periodic") {
      ensure(!row.condition.trim(), 400, "CONDITIONAL_INTERVAL", "带特殊适用条件的周期请标为按条件处理；正常工况说明请移至备注，不能自动套用于所有车辆");
      ensure(row.firstMonths !== null || row.firstKm !== null, 400, "FIRST_INTERVAL_REQUIRED", "周期保养规则需明确首次时间或里程；原文未知时请先核对，不能猜测");
      ensure(row.intervalMonths !== null || row.intervalKm !== null, 400, "INTERVAL_REQUIRED", "周期保养规则需明确后续时间或里程间隔");
    } else ensure(!!row.condition.trim(), 400, "CONDITION_REQUIRED", "按条件或按需保养须记录原文条件");
    ensure(!row.conditionThresholdsIndependent || row.triggerType === "condition" && hasRecurringMaintenanceThreshold(row), 400, "CONDITION_INTERVAL_REQUIRED", "独立时间／里程提醒仅用于条件项目，且须保留原文明确的后续时间或公里阈值");
  }
}

interface PublicationIssue { rowId: string; rowNumber: number; field: string; message: string }

/** Reuse already-read evidence after an explicit import click; never re-run AI or publish here. */
export async function createRecognizedManualDraft(ctx: Context, userId: string, modelId: string, modelIdentity: string, input: {
  sourceTitle: string; sourceUrl: string; edition: string; applicability: string; sourceExcerpt: string;
  rows: ManualRuleDraft[]; warnings: string[]; files: ManualAsset[]; selection?: ManualPageSelection;
}): Promise<ManualImport> {
  const { files: _files, warnings: _warnings, selection: _selection, ...fields } = input;
  const metadata = draftFieldsSchema.parse(fields);
  verifySourceLink(metadata.sourceUrl, input.files);
  verifyEvidence(metadata.rows, input.files, false);
  ensure(input.files.some(file => file.original), 400, "SOURCE_REQUIRED", "未取得可保存的手册原文，请重新查询");
  return ctx.db.transaction(async sql => {
    const model = await get<CarModel>(sql, "models", modelId, true);
    ensure(model && identity(model) === modelIdentity, 409, "MODEL_CHANGED", "车型资料已变更，请重新查询对应手册");
    const rules = (await list<MaintenanceRule>(sql, "rules")).filter(rule => rule.modelId === modelId);
    const stamp = now();
    const job: StoredManual = {
      id: id(), createdBy: userId, modelId, ...metadata, sourceExcerpt: metadata.sourceExcerpt || "",
      acquiredSourceUrl: metadata.sourceUrl,
      metadataOrigin: { sourceTitle: metadata.sourceTitle ? "document" : "unknown", edition: metadata.edition ? "document" : "unknown", applicability: metadata.applicability ? "document" : "unknown" },
      ...(input.selection ? { pageSelection: input.selection } : {}),
      status: "awaiting_confirmation", files: input.files, warnings: [...new Set(input.warnings)].slice(0, 60), attempts: 1,
      reason: "已保存AI查询时读取的原文和保养项目；确认适用范围后可一次导入，无需重复识别。",
      revision: 1, createdAt: stamp, updatedAt: stamp, publishedAt: null, publishedRuleIds: [], aiModel: ctx.config.aiModel,
      modelIdentity, baseRuleVersions: latestVersions(rules),
    };
    await put(sql, "manual_imports", job);
    await audit(sql, userId, "manual.ai_answer.imported", "manual", job.id, "保存AI查询所得原文和已识别项目为待确认草稿；尚未发布保养规则");
    return presentManual(job, await list<Project>(sql, "projects"));
  });
}
/** Collect all actionable selected-row issues before any publication writes. */
function publicationIssues(job: StoredManual, projects: Project[], versions: Record<string, number>): PublicationIssue[] {
  const issues: PublicationIssue[] = [];
  const add = (row: ManualRuleDraft, index: number, field: string, message: string) => issues.push({ rowId: row.id, rowNumber: index + 1, field, message });
  const available = new Set(job.files.filter(file => !file.original || file.mimeType.startsWith("image/") || file.mimeType === "text/plain").map(file => file.pageNumber).filter(page => page !== null));
  const manual = job.entryMode === "manual";
  const rowIds = new Set<string>(), targetIds = new Set<string>(), names = new Set<string>();
  for (const [index, row] of job.rows.entries()) {
    if (!row.include) continue;
    if (rowIds.has(row.id)) add(row, index, "id", "项目行重复，请移除重复行");
    rowIds.add(row.id);
    if (!row.name.trim()) add(row, index, "name", "请填写项目名称");
    if (!row.sourceText.trim() || (!manual && !row.pageNumbers.length)) add(row, index, "sourceText", "缺少原文证据，请补充或暂不导入此项");
    if (!manual && row.pageNumbers.some(page => !available.has(page))) add(row, index, "pageNumbers", "来源页码与本次资料不一致");
    const count = [!!row.projectId, !!row.catalogProjectId, row.createProject].filter(Boolean).length;
    if (count !== 1) add(row, index, "projectId", count ? "标准项目存在多个关联，请保留一种" : "未能自动关联标准项目，请选择或暂不导入此项");
    let target = row.projectId;
    if (row.catalogProjectId) {
      const entry = catalogProjects.find(project => project.id === row.catalogProjectId);
      if (!entry || entry.category === "diagnosis") add(row, index, "projectId", "参考项目不可用，请重新选择");
      else {
        if (entry.action !== row.action) add(row, index, "action", "操作与参考项目不一致，请区分检查和更换");
        const matching = projects.filter(project => project.catalogSource?.catalogId === entry.id || normalizedName(project.code) === normalizedName(entry.code) || normalizedName(project.name) === normalizedName(entry.name) || manualProjectSubject(project.name) === manualProjectSubject(entry.name) && standardProjectAction(project) === entry.action);
        if (matching.length > 1) add(row, index, "projectId", "参考项目对应多个标准项目，请明确选择");
        else if (matching[0]) {
          target = matching[0].id;
          if (manualProjectSubject(matching[0].name) !== manualProjectSubject(entry.name) || standardProjectAction(matching[0]) !== entry.action) add(row, index, "projectId", "参考编码或来源已关联其他部件或操作，请选择准确标准项目");
        }
        else {
          target = `catalog:${entry.id}`;
          if (projects.some(project => project.category !== "diagnosis" && manualProjectSubject(project.name) === manualProjectSubject(entry.name) && (!project.active || standardProjectAction(project) === null))) add(row, index, "projectId", "同部件项目已停用或动作不明确，请选择准确标准项目");
        }
      }
    }
    if (target) {
      if (targetIds.has(target)) add(row, index, "projectId", "多行关联同一标准项目，请保留适用的一项");
      targetIds.add(target);
      if (!target.startsWith("catalog:")) {
        const project = projects.find(item => item.id === target);
        if (!project?.active || project.category === "diagnosis") add(row, index, "projectId", "关联项目已停用或不属于保养项目");
        else if (standardProjectAction(project) && standardProjectAction(project) !== row.action) add(row, index, "action", "操作与标准项目不一致，请区分检查和更换");
        if ((versions[target] || 0) !== (job.baseRuleVersions[target] || 0)) add(row, index, "projectId", "该项目规则已有新版，请刷新核对后重新导入");
      }
    }
    if (row.createProject) {
      const name = normalizedName(row.name);
      if (names.has(name) || projects.some(project => normalizedName(project.name) === name)) add(row, index, "projectId", "项目名称已存在，请关联已有项目");
      names.add(name);
    }
    if (row.triggerType === "periodic") {
      if (row.condition.trim()) add(row, index, "triggerType", "有特殊工况条件的项目请选择按条件处理");
      if (row.intervalMonths === null && row.intervalKm === null) add(row, index, "interval", "原文未给出后续周期，请补充或暂不导入此项");
    } else if (!row.condition.trim()) add(row, index, "condition", "请保留原文的触发条件");
    if (row.conditionThresholdsIndependent && (row.triggerType !== "condition" || !hasRecurringMaintenanceThreshold(row))) add(row, index, "interval", "独立时间／里程提醒仅适用于条件项目，且须有原文明确的后续阈值");
  }
  return issues;
}

export function registerManuals(ctx: Context) {
  const { app, db, config } = ctx;
  const publicManual = async (job: StoredManual, sql: Sql = db) => presentManual(job, await list<Project>(sql, "projects"));
  const queued = new Set<string>();
  let draining: Promise<void> | null = null;
  let closing = false;
  const configured = () => !!(config.aiKey && config.aiBaseUrl && config.aiModel);
  async function process(jobId: string) {
    let job: StoredManual | undefined;
    try {
      job = await db.transaction(async sql => {
        const old = await get<StoredManual>(sql, "manual_imports", jobId, true);
        if (!old || !["uploaded", "processing"].includes(old.status)) return undefined;
        if (!configured() || old.attempts >= 3) {
          await put(sql, "manual_imports", { ...old, status: "failed", revision: old.revision + 1, updatedAt: now(), reason: !configured() ? "尚未配置手册AI识别服务，请配置后重试。" : "本任务已达到识别重试上限，请重新上传。" });
          return undefined;
        }
        return put(sql, "manual_imports", { ...old, status: "processing" as const, attempts: old.attempts + 1, revision: old.revision + 1, updatedAt: now(), aiModel: config.aiModel, reason: "正在识别选定保养页面，完成后请对照原文核对。" });
      });
      if (!job) return;
      const model = await get<CarModel>(db, "models", job.modelId);
      ensure(model && identity(model) === job.modelIdentity, 409, "MODEL_CHANGED", "车型资料已变更，请核实后重新导入对应手册");
      const pages = job.files.some(file => file.mimeType === "image/jpeg" && file.pageNumber !== null) ? await readManualImages(ctx, job.files) : [];
      const textPages = await readManualTextEvidence(ctx, job.files);
      const description = `${model.brand} ${model.name} ${model.year}款 ${model.power}`;
      const result = textPages.length ? await recognizeManualText(config, textPages, description, pages) : await recognizeManual(config, pages, description);
      const rows = autoMapManualProjects(result.rows.map(row => ({ ...row, id: id(), projectId: null, catalogProjectId: null, createProject: false, include: row.triggerType === "periodic" })), await list<Project>(db, "projects"));
      verifyEvidence(rows, job.files, false);
      const warnings = [...result.warnings];
      if (!usableDocumentMetadata(result.sourceTitle)) warnings.push("识别页面未明确给出手册标题；文件名只作待核对草稿，请结合原件核对。");
      if (!usableDocumentMetadata(result.edition)) warnings.push("原文未注明手册版本；可留空，不以目标车型年款代替。");
      if (!usableDocumentMetadata(result.applicability)) warnings.push("识别页面未明确给出适用车型与版本，请结合手册封面和原车资料核对；目标车型不构成适用证据。");
      if (rows.some(row => row.triggerType === "periodic" && row.intervalMonths === null && row.intervalKm === null)) warnings.push("部分项目未明确后续周期，可暂不导入这些项目；不能凭经验补写。");
      if (rows.some(row => row.triggerType === "periodic" && row.firstMonths === null && row.firstKm === null)) warnings.push("部分项目原文未单列首次周期；无保养记录时按已注明周期起算，不表示识别出了独立首保要求。");
      if (rows.some(row => row.triggerType === "periodic" && row.firstMonths === null && row.firstKm === null && /此后|以后|之后|随后|thereafter/i.test(row.sourceText))) warnings.push("部分原文只提到后续周期、没有首次依据，请结合原件首保说明核对；可暂不导入这些项目。");
      await db.transaction(async sql => {
        const current = await get<StoredManual>(sql, "manual_imports", job!.id, true);
        if (!current || current.status !== "processing" || current.revision !== job!.revision) return;
        const metadataOrigin = originsFor(current);
        const metadata = { sourceTitle: current.sourceTitle, edition: current.edition, applicability: current.applicability };
        for (const key of metadataKeys) if (metadataOrigin[key] !== "provided" && usableDocumentMetadata(result[key])) {
          metadata[key] = result[key];
          metadataOrigin[key] = "document";
        }
        await put(sql, "manual_imports", { ...current, ...metadata, metadataOrigin, sourceExcerpt: current.sourceExcerpt || result.sourceExcerpt, rows, warnings: [...new Set(warnings)], status: "awaiting_confirmation", revision: current.revision + 1, updatedAt: now(), reason: rows.length ? "识别仅生成草稿；请核对来源、适用范围、项目映射和每条周期后发布。" : "未识别到可用保养项目，请核对选页并重新导入保养表和图例。" });
      });
    } catch (error) {
      if (!job) return;
      const reason = error instanceof AppError ? error.message : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "手册识别超时，请减少页数后重试。" : "手册识别结果无效，请检查原文清晰度、保养表和图例后重试。";
      await db.transaction(async sql => {
        const current = await get<StoredManual>(sql, "manual_imports", job!.id, true);
        if (current?.status === "processing" && current.revision === job!.revision) await put(sql, "manual_imports", { ...current, status: "failed", reason, revision: current.revision + 1, updatedAt: now() });
      }).catch(() => {});
    }
  }
  function schedule(jobId: string) {
    if (closing) return;
    queued.add(jobId);
    if (draining) return;
    draining = (async () => {
      while (queued.size && !closing) {
        const next = queued.values().next().value!;
        queued.delete(next);
        await process(next);
      }
    })().finally(() => { draining = null; });
  }
  async function createJob(userId: string, input: z.infer<typeof metadataSchema>, files: ManualAsset[], selection?: ManualPageSelection, acquiredTitle = "") {
    return db.transaction(async sql => {
      const model = await get<CarModel>(sql, "models", input.modelId, true);
      ensure(model, 404, "MODEL_NOT_FOUND", "请选择已有的准确车型、年款与动力配置");
      const rules = (await list<MaintenanceRule>(sql, "rules")).filter(rule => rule.modelId === model.id);
      const original = files.find(file => file.original) || files[0];
      ensure(original, 400, "SOURCE_REQUIRED", "请上传手册原件或页面图片");
      const filename = original.name.replace(/\.[^.]+$/, "").trim().slice(0, 960);
      const target = `${model.brand} ${model.name} ${model.year}款 ${model.power}`.trim().slice(0, 2000);
      const sourceUrl = input.sourceUrl || original.url;
      const job: StoredManual = {
        id: id(), createdBy: userId, modelId: model.id,
        sourceTitle: input.sourceTitle || acquiredTitle || `${filename || `${model.brand} ${model.name} 保养资料`}（待核对）`, sourceUrl,
        acquiredSourceUrl: sourceUrl, edition: input.edition || "未知（待核对）",
        applicability: input.applicability || `适用范围未知（待核对）；拟关联：${target}，尚未证实适用。`,
        sourceExcerpt: input.sourceExcerpt,
        metadataOrigin: { sourceTitle: input.sourceTitle ? "provided" : acquiredTitle ? "document" : filename ? "filename" : "target", edition: input.edition ? "provided" : "unknown", applicability: input.applicability ? "provided" : "target" },
        ...(selection ? { pageSelection: selection } : {}),
        status: configured() ? "uploaded" : "failed", files, rows: [], warnings: [], attempts: 0,
        reason: configured() ? "原件已保存，正在排队识别选定页面。" : "原件已保存；尚未配置手册AI识别服务，请配置后重试。",
        revision: 1, createdAt: now(), updatedAt: now(), publishedAt: null, publishedRuleIds: [], aiModel: config.aiModel,
        modelIdentity: identity(model), baseRuleVersions: latestVersions(rules),
      };
      await put(sql, "manual_imports", job);
      await audit(sql, userId, "manual.uploaded", "manual", job.id, `保存手册原件，绑定车型 ${model.brand} ${model.name} ${model.year}；尚未发布保养规则`);
      return job;
    });
  }
  app.get(route("/admin/manual-sources"), async request => {
    roles(request, ["platform_admin"]);
    const { modelId, discover } = z.object({ modelId: z.string().min(1), discover: z.enum(["true", "false"]).optional() }).parse(request.query);
    const model = await get<CarModel>(db, "models", modelId);
    ensure(model, 404, "MODEL_NOT_FOUND", "车型不存在");
    return discover === "true" ? discoverManualSources(model) : manualSources(model);
  });
  app.get(route("/admin/manual-imports"), async request => {
    roles(request, ["platform_admin"]);
    const projects = await list<Project>(db, "projects");
    return (await list<StoredManual>(db, "manual_imports")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(job => presentManual(job, projects));
  });
  app.get<{ Params: { id: string } }>(route("/manuals/:id"), async request => {
    const user = authenticated(request);
    const job = await get<StoredManual>(db, "manual_imports", request.params.id);
    ensure(job?.status === "published", 404, "NOT_FOUND", "已发布手册不存在");
    const allowed = user.role === "platform_admin" || user.role === "owner" && (await list<Vehicle>(db, "vehicles")).some(vehicle => vehicle.ownerId === user.id && vehicle.modelId === job.modelId);
    ensure(allowed, 403, "FORBIDDEN", "仅平台管理员及适用车型车主可查看已发布手册");
    const document: ManualDocument = { id: job.id, modelId: job.modelId, sourceTitle: job.sourceTitle, sourceUrl: job.sourceUrl, edition: job.edition, applicability: job.applicability, sourceExcerpt: job.sourceExcerpt, metadataOrigin: job.metadataOrigin, pageSelection: job.pageSelection, files: job.files, publishedAt: job.publishedAt };
    return document;
  });
  app.get<{ Params: { id: string } }>(route("/admin/manual-imports/:id"), async request => {
    roles(request, ["platform_admin"]);
    const job = await get<StoredManual>(db, "manual_imports", request.params.id);
    ensure(job, 404, "NOT_FOUND", "手册导入任务不存在");
    return publicManual(job);
  });
  app.post(route("/admin/manual-imports"), async request => {
    const user = roles(request, ["platform_admin"]);
    const received = await receiveManualFiles(request, ctx);
    let committed = false;
    try {
      ensure(received.fields.consent === "true", 400, "RECOGNITION_CONSENT_REQUIRED", "请确认使用已配置的AI服务识别这份保养手册");
      const input = metadataSchema.parse(received.fields);
      const job = await createJob(user.id, input, received.files, received.selection);
      committed = true;
      if (job.status === "uploaded") schedule(job.id);
      return publicManual(job);
    } finally { if (!committed) await received.cleanup(); }
  });
  app.post(route("/admin/manual-imports/from-url"), async request => {
    const user = roles(request, ["platform_admin"]);
    const input = metadataSchema.extend({ consent: z.literal(true), sourceUrl: z.string().url().max(2500) }).strict().parse(request.body);
    const received = await ingestManualSource(ctx, user.id, input.sourceUrl, input.pageRange, input.pageMode);
    let committed = false;
    try {
      const job = await createJob(user.id, { ...input, sourceUrl: received.sourceUrl }, received.files, received.selection, received.title);
      committed = true;
      if (job.status === "uploaded") schedule(job.id);
      return publicManual(job);
    } finally { if (!committed) await received.cleanup(); }
  });
  app.post<{ Params: { id: string } }>(route("/admin/manual-imports/:id/retry"), async request => {
    const user = roles(request, ["platform_admin"]);
    const job = await db.transaction(async sql => {
      const old = await get<StoredManual>(sql, "manual_imports", request.params.id, true);
      ensure(old, 404, "NOT_FOUND", "手册导入任务不存在");
      ensure(old.status === "failed", 409, "INVALID_STATE", "只有失败的手册识别任务可以重试");
      ensure(old.attempts < 3, 409, "RETRY_LIMIT", "已达到识别重试上限，请重新上传清晰的保养页面");
      ensure(configured(), 503, "AI_NOT_CONFIGURED", "尚未配置手册AI识别服务");
      const updated = await put(sql, "manual_imports", { ...old, status: "uploaded" as const, revision: old.revision + 1, updatedAt: now(), reason: "等待重新识别手册页面。" });
      await audit(sql, user.id, "manual.retried", "manual", old.id, "重新识别手册，未修改正式规则");
      return updated;
    });
    schedule(job.id);
    return publicManual(job);
  });
  app.post(route("/admin/manual-imports/manual-entry"), { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async request => {
    const user = roles(request, ["platform_admin"]);
    const input = manualEntrySchema.parse(request.body);
    return db.transaction(async sql => {
      const model = await get<CarModel>(sql, "models", input.modelId, true);
      ensure(model, 404, "MODEL_NOT_FOUND", "请选择已有车型档案");
      // Manual drafts keep no original files, so a local file link has nothing to point at.
      ensure(!input.sourceUrl.startsWith("/api/"), 400, "SOURCE_FILE_MISMATCH", "手工录入请填写手册的 HTTPS 来源链接，或留空");
      verifyEvidence(input.rows, [], false, true);
      const projects = await list<Project>(sql, "projects");
      const rows = autoMapManualProjects(input.rows, projects);
      const stamp = now();
      const job: StoredManual = {
        id: id(), createdBy: user.id, modelId: model.id,
        sourceTitle: input.sourceTitle || `${model.brand} ${model.name} 保养表格（手工录入）`,
        sourceUrl: input.sourceUrl, edition: input.edition, applicability: input.applicability,
        sourceExcerpt: input.sourceExcerpt || "",
        acquiredSourceUrl: input.sourceUrl,
        metadataOrigin: { sourceTitle: "provided", edition: input.edition ? "provided" : "unknown", applicability: input.applicability ? "provided" : "unknown" },
        status: "awaiting_confirmation", files: [], rows,
        warnings: ["本资料由平台按手册表格手工录入，未附手册原件；发布前请对照纸质或官方手册逐项核对。"], attempts: 1,
        reason: "手工录入的保养表格已保存为草稿，核对后可一次导入本车型规则。",
        revision: 1, createdAt: stamp, updatedAt: stamp, publishedAt: null, publishedRuleIds: [],
        aiModel: "手工录入", modelIdentity: identity(model), baseRuleVersions: latestVersions((await list<MaintenanceRule>(sql, "rules")).filter(rule => rule.modelId === model.id)),
        entryMode: "manual",
      };
      await put(sql, "manual_imports", job);
      await audit(sql, user.id, "manual.entry.created", "manual", job.id, `手工录入 ${input.rows.length} 条保养项目，等待核对发布`);
      return presentManual(job, projects);
    });
  });
  app.patch<{ Params: { id: string } }>(route("/admin/manual-imports/:id/draft"), async request => {
    const user = roles(request, ["platform_admin"]);
    const input = draftSchema.parse(request.body);
    return db.transaction(async sql => {
      const job = await get<StoredManual>(sql, "manual_imports", request.params.id, true);
      ensure(job, 404, "NOT_FOUND", "手册导入任务不存在");
      ensure(job.status === "awaiting_confirmation", 409, "INVALID_STATE", "请等待识别完成；已发布任务不可改写，请重新导入新版本");
      ensure(job.revision === input.expectedRevision, 409, "REVISION_CONFLICT", "手册草稿已被更新，请刷新后重新核对");
      verifySourceLink(input.sourceUrl, job.files);
      verifyEvidence(input.rows, job.files, false, job.entryMode === "manual");
      const metadataOrigin = originsFor(job);
      for (const key of metadataKeys) if (input[key] !== job[key] && (key !== "sourceTitle" || input.sourceTitle)) metadataOrigin[key] = input[key].trim() ? "provided" : "unknown";
      const updated = await put(sql, "manual_imports", { ...job, rows: input.rows, sourceTitle: input.sourceTitle || job.sourceTitle, sourceUrl: input.sourceUrl, edition: input.edition, applicability: input.applicability, sourceExcerpt: input.sourceExcerpt ?? job.sourceExcerpt, metadataOrigin, revision: job.revision + 1, updatedAt: now() });
      await audit(sql, user.id, "manual.draft.saved", "manual", job.id, `保存 ${input.rows.filter(row => row.include).length} 条候选规则，尚未发布`);
      return publicManual(updated, sql);
    });
  });
  app.post<{ Params: { id: string } }>(route("/admin/manual-imports/:id/auto-map"), async request => {
    const user = roles(request, ["platform_admin"]);
    const input = z.object({ expectedRevision: z.number().int().positive() }).strict().parse(request.body);
    return db.transaction(async sql => {
      const job = await get<StoredManual>(sql, "manual_imports", request.params.id, true);
      ensure(job, 404, "NOT_FOUND", "手册导入任务不存在");
      ensure(job.status === "awaiting_confirmation", 409, "INVALID_STATE", "仅未发布的待核对手册可以自动关联项目");
      ensure(job.revision === input.expectedRevision, 409, "REVISION_CONFLICT", "手册草稿已更新，请刷新后重新关联");
      const rows = autoMapManualProjects(job.rows, await list<Project>(sql, "projects"));
      const mapped = rows.filter((row, index) => row !== job.rows[index]).length;
      const updated = await put(sql, "manual_imports", { ...job, rows, revision: job.revision + 1, updatedAt: now() });
      await audit(sql, user.id, "manual.projects.matched", "manual", job.id, `为${mapped}条空白映射关联标准或参考项目；未确定项目保持留空，未发布规则`);
      return publicManual(updated, sql);
    });
  });
  app.post<{ Params: { id: string } }>(route("/admin/manual-imports/:id/publish"), async (request, reply) => {
    const user = roles(request, ["platform_admin"]);
    const input = publishSchema.parse(request.body);
    const observed = await get<StoredManual>(db, "manual_imports", request.params.id);
    ensure(observed, 404, "NOT_FOUND", "手册导入任务不存在");
    return db.transaction(async sql => {
      // All rule publication paths serialize on the exact model before reading versions.
      const model = await get<CarModel>(sql, "models", observed.modelId, true);
      let job = await get<StoredManual>(sql, "manual_imports", request.params.id, true);
      ensure(job && model, 404, "NOT_FOUND", "手册任务或车型不存在");
      const publicationHash = sha256(JSON.stringify(input));
      if (job.status === "published") {
        ensure(job.publicationHash === publicationHash, 409, "PUBLICATION_CONFLICT", "该任务已发布，不能用不同内容重复发布");
        return publicManual(job, sql);
      }
      ensure(job.status === "awaiting_confirmation", 409, "INVALID_STATE", "手册识别与人工核对完成后才可发布");
      ensure(job.revision === input.expectedRevision, 409, "REVISION_CONFLICT", "手册草稿已更新，请刷新并重新核对");
      ensure(identity(model) === job.modelIdentity, 409, "MODEL_CHANGED", "车型名称、年款或动力配置已变更，请重新导入适用手册");
      if (input.draft) {
        const metadataOrigin = originsFor(job);
        for (const key of metadataKeys) if (input.draft[key] !== job[key] && (key !== "sourceTitle" || input.draft.sourceTitle)) metadataOrigin[key] = input.draft[key].trim() ? "provided" : "unknown";
        job = { ...job, ...input.draft, sourceExcerpt: input.draft.sourceExcerpt ?? job.sourceExcerpt, sourceTitle: input.draft.sourceTitle || job.sourceTitle || `${model.brand} ${model.name} 保养资料`, metadataOrigin };
      } else {
        // Preserve the legacy saved-draft API while the compact flow sends its
        // final edits and a single explicit human review in this request.
        ensure(!!job.edition.trim() && !!job.applicability.trim(), 400, "APPLICABILITY_REQUIRED", "请填写手册版本及已核对的车型、市场和动力适用范围");
        const metadataOrigin = originsFor(job);
        ensure(!["unknown", "target"].includes(metadataOrigin.edition) && !["unknown", "target"].includes(metadataOrigin.applicability), 400, "APPLICABILITY_REQUIRED", "手册版本或适用范围仍未知/待核对，请对照原件填写并保存；所选目标车型不能证明手册适用");
      }
      verifySourceLink(job.sourceUrl, job.files);
      const selected = job.rows.filter(row => row.include);
      if (!input.draft) {
        ensure(selected.length > 0, 400, "MANUAL_ROWS_REQUIRED", "请至少选中一条已核对的保养规则");
        verifyEvidence(job.rows, job.files, true, job.entryMode === "manual");
      }
      const allRules = (await list<MaintenanceRule>(sql, "rules")).filter(rule => rule.modelId === model.id);
      const versions = latestVersions(allRules);
      // Different models can introduce the same standard project concurrently.
      // Serialize name lookup and creation across those model transactions.
      if (selected.some(row => row.createProject || row.catalogProjectId)) await sql.query("LOCK TABLE av_projects IN SHARE ROW EXCLUSIVE MODE");
      const projects = await list<Project>(sql, "projects");
      if (input.draft) {
        const issues = publicationIssues(job, projects, versions);
        if (!selected.length) issues.unshift({ rowId: "", rowNumber: 0, field: "rows", message: "请至少选择一个可导入项目" });
        if (issues.length) return reply.code(422).send({ error: { code: "MANUAL_REVIEW_REQUIRED", message: `请处理 ${issues.length} 处问题后导入；暂不导入的项目可取消选择，原文仍会保留。`, issues } });
      }
      const projectIds = new Set<string>();
      const newNames = new Set<string>();
      const publishedRules: MaintenanceRule[] = [];
      for (const row of selected) {
        let projectId = row.projectId;
        if (row.catalogProjectId) {
          const entry = catalogProjects.find(project => project.id === row.catalogProjectId)!;
          const sameSubject = projects.filter(project => project.category !== "diagnosis" && manualProjectSubject(project.name) === manualProjectSubject(entry.name));
          const exact = projects.filter(project => project.catalogSource?.catalogId === entry.id || normalizedName(project.code) === normalizedName(entry.code) || normalizedName(project.name) === normalizedName(entry.name) || sameSubject.includes(project) && standardProjectAction(project) === entry.action);
          ensure(exact.length <= 1, 409, "PROJECT_MAPPING_AMBIGUOUS", "参考项目对应多个已有标准项目，请在草稿中明确选择后再发布");
          if (exact[0]) {
            ensure(exact[0].active && exact[0].category !== "diagnosis", 409, "PROJECT_NOT_FOUND", "参考项目对应的标准项目已停用或属于故障诊断，请核对后选择");
            ensure(manualProjectSubject(exact[0].name) === manualProjectSubject(entry.name) && standardProjectAction(exact[0]) === entry.action, 409, "CATALOG_CODE_CONFLICT", "参考项目编码或来源已用于其他名称或操作，请核对现有标准项目");
            projectId = exact[0].id;
          } else {
            ensure(!sameSubject.some(project => !project.active || standardProjectAction(project) === null), 409, "PROJECT_MAPPING_AMBIGUOUS", "已有同名部件项目尚未明确操作或已停用，请在草稿中核对并选择已有标准项目");
            const project: Project = {
              id: id(), code: entry.code, name: entry.name, category: entry.category,
              description: entry.description, unit: entry.unit, active: true,
              catalogSource: { catalogId: entry.id, version: catalogVersion, sources: catalogSources.filter(source => entry.sourceIds.includes(source.id)), importedAt: now() },
            };
            await put(sql, "projects", project);
            await audit(sql, user.id, "catalog.project.imported", "project", project.id, `${entry.id}；目录${catalogVersion}；手册规则发布时关联参考服务名称，周期仅来自已复核手册`);
            projects.push(project);
            projectId = project.id;
          }
        }
        if (projectId) {
          const project = projects.find(project => project.id === projectId);
          ensure(project?.active && project.category !== "diagnosis", 400, "PROJECT_NOT_FOUND", "请选择有效的保养项目，不能映射到故障诊断或停用项目");
          const action = standardProjectAction(project);
          ensure(!action || action === row.action, 400, "PROJECT_ACTION_MISMATCH", "标准项目的操作与本行不一致，请区分检查、更换、清洁和润滑");
          ensure(!projectIds.has(projectId), 400, "DUPLICATE_PROJECT", "同一任务不能将多行映射到同一标准项目；请区分检查、更换和不同工况");
          ensure((versions[projectId] || 0) === (job.baseRuleVersions[projectId] || 0), 409, "RULE_VERSION_CONFLICT", "该车型项目的规则已被其他任务更新，请核对最新版本后重新导入");
        } else {
          const name = normalizedName(row.name);
          ensure(!newNames.has(name) && !projects.some(project => normalizedName(project.name) === name), 409, "PROJECT_NAME_EXISTS", "新建项目名称已存在或重复，请映射已有项目或用检查/更换及工况明确区分");
          newNames.add(name);
          projectId = id();
          const project: Project = { id: projectId, code: `MANUAL_${projectId.replace(/-/g, "").toUpperCase()}`, name: row.name, category: "maintenance", description: [row.condition, row.notes].filter(Boolean).join("；") || row.name, unit: "次", active: true };
          await put(sql, "projects", project);
          projects.push(project);
        }
        projectIds.add(projectId);
        const existing = allRules.filter(rule => rule.projectId === projectId);
        const original = job.files.find(file => file.original) || job.files[0];
        // Keyboard-entered tables keep their basis in each row's sourceText instead of an uploaded file.
        ensure(original || job.entryMode === "manual", 400, "SOURCE_REQUIRED", "手册原件不存在，不能发布规则");
        const rule: MaintenanceRule = {
          id: id(), modelId: model.id, projectId, firstMonths: row.firstMonths, firstKm: row.firstKm,
          intervalMonths: row.intervalMonths, intervalKm: row.intervalKm, mileageType: row.mileageType,
          action: row.action, triggerType: row.triggerType, conditionThresholdsIndependent: row.conditionThresholdsIndependent, condition: row.condition, notes: row.notes,
          sourceTitle: job.sourceTitle, sourceUrl: job.sourceUrl || original?.url || "",
          version: (versions[projectId] || 0) + 1, verified: true, isDemo: model.isDemo,
          manualImportId: job.id, sourcePages: row.pageNumbers, sourceText: row.sourceText, edition: job.edition, applicability: job.applicability,
        };
        for (const old of existing) if (old.verified) await put(sql, "rules", { ...old, verified: false, supersededBy: rule.id, supersededAt: now() });
        await put(sql, "rules", rule);
        publishedRules.push(rule);
      }
      const currentScope = model.applicableProjectIds ?? [...new Set(allRules.map(rule => rule.projectId))];
      await put(sql, "models", { ...model, applicableProjectIds: [...new Set([...currentScope, ...projectIds])] });
      const updated: StoredManual = { ...job, status: "published", publishedAt: now(), publishedRuleIds: publishedRules.map(rule => rule.id), publicationHash, revision: job.revision + 1, updatedAt: now(), reason: `已人工复核并发布 ${publishedRules.length} 条车型保养规则；原文和旧规则版本保留。` };
      await put(sql, "manual_imports", updated);
      await audit(sql, user.id, "manual.published", "manual", job.id, `人工复核适用范围、原文及项目映射；发布车型 ${model.brand} ${model.name} ${model.year} 的 ${publishedRules.length} 条规则：${publishedRules.map(rule => rule.id).join(",")}`);
      return publicManual(updated, sql);
    });
  });
  return {
    resume: async () => {
      for (const job of await list<StoredManual>(db, "manual_imports")) if (["uploaded", "processing"].includes(job.status)) schedule(job.id);
    },
    wait: async () => { closing = true; queued.clear(); if (draining) await draining; },
  };
}
