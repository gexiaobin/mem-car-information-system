import { createHash } from "node:crypto";
import type { CarModel, CatalogProject, CatalogSource, MaintenanceAction, MaintenanceRule, ManualImport, Offer, Project, ServiceRecord, User } from "@autovoyage/shared";
import { list, put, remove, tables, type Database, type Table } from "./db.js";
import { audit, now } from "./domain.js";
import { manualProjectSubject, standardProjectAction } from "./manual-project-mapping.js";

type Entity = { id: string };
type StoredManual = ManualImport & { baseRuleVersions?: Record<string, number>; publicationHash?: string };
type OfferVersion = Offer & { offerId: string };
export type ProjectResetSnapshot = Record<Table, unknown[]>;
export class ProjectResetError extends Error {}
export interface ProjectResetSettings {
  generalProjects: readonly CatalogProject[];
  sources: readonly CatalogSource[];
  catalogVersion: string;
  clearUnmatchedDemo?: boolean;
}
export interface ProjectResetPlan {
  digest: string;
  blockers: string[];
  mappings: { oldId: string; newId: string; catalogId: string; evidence: string }[];
  unmatched: { id: string; name: string }[];
  newProjects: Project[];
  writes: Partial<Record<Table, Entity[]>>;
  deletes: Partial<Record<Table, string[]>>;
  beforeCounts: Record<string, number>;
  afterCounts: Record<string, number>;
  changed: boolean;
}
export interface ProjectResetReport {
  format: "autovoyage-project-reset-v1";
  mode: "dry-run" | "apply";
  status: "dry-run" | "prepared" | "applied";
  actorId: string;
  startedAt: string;
  appliedAt: string | null;
  snapshot: ProjectResetSnapshot;
  plan: ProjectResetPlan;
}
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const equal = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const stableRows = (rows: unknown[]) => [...rows].sort((a, b) => String((a as Entity).id).localeCompare(String((b as Entity).id)));
const data = <T>(snapshot: ProjectResetSnapshot, table: Table) => snapshot[table] as T[];
export const generalProjectId = (catalogId: string) => `general-${catalogId}`;
function containsIdentity(value: unknown, identities: ReadonlySet<string>): boolean {
  if (typeof value === "string") return identities.has(value);
  if (Array.isArray(value)) return value.some(item => containsIdentity(item, identities));
  return !!value && typeof value === "object" && Object.entries(value).some(([key, item]) => identities.has(key) || containsIdentity(item, identities));
}

/** Plans exact, field-specific remapping. Free text, historical IDs and audit text are never rewritten. */
export function planProjectReset(snapshot: ProjectResetSnapshot, settings: ProjectResetSettings, timestamp = now()): ProjectResetPlan {
  const templates = [...settings.generalProjects];
  if (templates.length !== 25 || new Set(templates.map(entry => entry.id)).size !== 25 || new Set(templates.map(entry => entry.code)).size !== 25)
    throw new ProjectResetError("重建目录必须恰好包含25个唯一通用模板。");
  const sourceIds = new Set(settings.sources.map(source => source.id));
  if (templates.some(entry => entry.sourceIds.some(source => !sourceIds.has(source)))) throw new ProjectResetError("通用模板缺少真实来源。");
  const projects = data<Project>(snapshot, "projects"), rules = data<MaintenanceRule>(snapshot, "rules"), manuals = data<StoredManual>(snapshot, "manual_imports");
  const blockers: string[] = [];
  const mapping = new Map<string, string>();
  const mappings: ProjectResetPlan["mappings"] = [];
  const unmatched: ProjectResetPlan["unmatched"] = [];
  const newProjects: Project[] = templates.map(entry => {
    const previous = projects.find(project => project.id === generalProjectId(entry.id));
    return { id: generalProjectId(entry.id), code: entry.code, name: entry.name, category: entry.category, description: entry.description,
      unit: entry.unit, active: true, catalogSource: { catalogId: entry.id, version: settings.catalogVersion,
        sources: settings.sources.filter(source => entry.sourceIds.includes(source.id)), importedAt: previous?.catalogSource?.importedAt || timestamp } };
  });
  const newIds = new Set(newProjects.map(project => project.id));
  for (const project of projects) {
    let action: MaintenanceAction | null = standardProjectAction(project);
    let evidence = "exact-component-and-action";
    // A published, verified rule can establish an otherwise unstated action.
    if (!action) {
      const publishedRules = rules.filter(rule => rule.projectId === project.id && rule.verified && rule.action &&
        manuals.some(job => job.status === "published" && job.id === rule.manualImportId && job.publishedRuleIds.includes(rule.id)));
      const actions = new Set(publishedRules.map(rule => rule.action!));
      if (actions.size === 1) { action = [...actions][0]!; evidence = `published-rule-action:${publishedRules.map(rule => rule.id).sort().join(",")}`; }
    }
    const candidates = templates.filter(entry => project.category !== "diagnosis" && entry.action === action &&
      manualProjectSubject(entry.name) === manualProjectSubject(project.name));
    if (candidates.length === 1) {
      const candidate = candidates[0]!;
      mapping.set(project.id, generalProjectId(candidate.id));
      mappings.push({ oldId: project.id, newId: generalProjectId(candidate.id), catalogId: candidate.id,
        evidence: project.catalogSource?.catalogId === candidate.id ? "same-catalog-component-and-action" : evidence });
    } else unmatched.push({ id: project.id, name: project.name });
  }
  const after = structuredClone(snapshot);
  after.projects = newProjects;
  const deletedRules = new Set<string>(), deletedOffers = new Set<string>();
  const clear = settings.clearUnmatchedDemo === true;
  // Existing bookings hold frozen commercial snapshots. This maintenance tool
  // deliberately refuses that case instead of changing a booked service.
  if (snapshot.appointments.length || snapshot.changes.length)
    blockers.push("存在预约或服务变更，本脚本不改写冻结快照；须另行复核后处理。");
  for (const table of ["rules", "offers", "offer_versions", "records"] as const) {
    const kept: Entity[] = [];
    for (const row of data<MaintenanceRule | OfferVersion | ServiceRecord>(snapshot, table)) {
      const target = mapping.get(row.projectId) || (newIds.has(row.projectId) ? row.projectId : undefined);
      if (target) { const updated = { ...row, projectId: target }; kept.push(updated); continue; }
      const isDemo = "isDemo" in row && row.isDemo === true;
      if (table === "records" || !isDemo) { blockers.push(`${table}/${row.id}引用无等价项目，正式资料不得清除。`); kept.push(row); continue; }
      if (!clear) { blockers.push(`${table}/${row.id}为无等价演示关联，需显式--clear-unmatched-demo。`); kept.push(row); continue; }
      if (table === "rules") deletedRules.add(row.id);
      if (table === "offers") deletedOffers.add(row.id);
    }
    after[table] = kept;
  }
  after.models = data<CarModel>(snapshot, "models").map(model => {
    if (model.applicableProjectIds === undefined) return model;
    const removed = model.applicableProjectIds.filter(id => !mapping.has(id) && !newIds.has(id));
    if (removed.length && (!clear || model.isDemo !== true))
      blockers.push(`models/${model.id}适用范围含无等价项目，不能静默缩减正式车型范围。`);
    return { ...model, applicableProjectIds: [...new Set(model.applicableProjectIds.flatMap(id => mapping.get(id) ? [mapping.get(id)!] : newIds.has(id) ? [id] : []))] };
  });
  after.manual_imports = manuals.map(job => {
    if (["uploaded", "processing"].includes(job.status)) blockers.push(`manual_imports/${job.id}仍在处理中，请等待识别结束。`);
    let cleared = 0;
    const rows = job.rows.map(row => {
      if (row.projectId) {
        const target = mapping.get(row.projectId) || (newIds.has(row.projectId) ? row.projectId : undefined);
        if (target) return { ...row, projectId: target };
        if (job.status === "published") { blockers.push(`manual_imports/${job.id}已发布行没有等价项目，不能解除关联。`); return row; }
        cleared++;
        return { ...row, projectId: null, catalogProjectId: null, createProject: false };
      }
      if (row.catalogProjectId && !templates.some(entry => entry.id === row.catalogProjectId)) {
        if (job.status === "published") { blockers.push(`manual_imports/${job.id}已发布参考映射不在通用目录。`); return row; }
        cleared++; return { ...row, catalogProjectId: null, createProject: false };
      }
      return row;
    });
    const baseRuleVersions: Record<string, number> = {};
    for (const [oldId, version] of Object.entries(job.baseRuleVersions || {})) {
      const target = mapping.get(oldId) || (newIds.has(oldId) ? oldId : undefined);
      if (!target) {
        if (job.status === "published") blockers.push(`manual_imports/${job.id}已发布规则版本基线无等价项目。`);
        else cleared++;
        continue;
      }
      if (baseRuleVersions[target] !== undefined && baseRuleVersions[target] !== version) blockers.push(`manual_imports/${job.id}规则版本基线冲突。`);
      baseRuleVersions[target] = version;
    }
    if (job.publishedRuleIds.some(id => deletedRules.has(id))) blockers.push(`manual_imports/${job.id}引用拟删除的已发布规则。`);
    const updated = { ...job, rows, ...(job.baseRuleVersions === undefined ? {} : { baseRuleVersions }) };
    if (equal(updated, job)) return job;
    const warning = "通用服务目录已重建：无法等价对应的项目关联已留空，请按原文重新核对。";
    return { ...updated, revision: job.revision + 1, updatedAt: timestamp,
      ...(cleared ? { warnings: [...new Set([...job.warnings, warning])] } : {}) };
  });
  for (const rule of data<MaintenanceRule>(after, "rules"))
    if (rule.supersededBy && deletedRules.has(rule.supersededBy)) blockers.push(`rules/${rule.id}指向拟删除规则，不能破坏版本链。`);
  for (const version of data<OfferVersion>(after, "offer_versions"))
    if (deletedOffers.has(version.offerId)) blockers.push(`offer_versions/${version.id}仍引用拟删除报价。`);
  const grouped = <T>(rows: T[], key: (row: T) => string) => {
    const groups = new Map<string, T[]>();
    for (const row of rows) { const id = key(row); groups.set(id, [...(groups.get(id) || []), row]); }
    return [...groups.values()].filter(group => group.length > 1);
  };
  const keptRules = data<MaintenanceRule>(after, "rules");
  if (grouped(keptRules, rule => `${rule.modelId}:${rule.projectId}:${rule.version}`).length ||
      grouped(keptRules.filter(rule => rule.verified), rule => `${rule.modelId}:${rule.projectId}`).length)
    blockers.push("规则归并后存在版本或已复核规则冲突，须人工处理。");
  const offers = data<Offer>(after, "offers").filter(offer => offer.active);
  if (offers.some((offer, index) => offers.slice(index + 1).some(other => other.storeId === offer.storeId && other.modelId === offer.modelId &&
    other.projectId === offer.projectId && offer.validFrom <= other.validTo && other.validFrom <= offer.validTo)))
    blockers.push("同一门店车型的报价在项目归并后存在有效期重叠，须人工处理。");
  if (grouped(data<ServiceRecord>(after, "records"), record => `${record.appointmentId}:${record.projectId}`).length)
    blockers.push("保养记录在项目归并后违反预约项目唯一性，须人工处理。");
  const retiredIds = new Set(projects.filter(project => !newIds.has(project.id)).map(project => project.id));
  const deletedIdentities = new Set([...retiredIds, ...deletedRules, ...deletedOffers]);
  for (const table of tables.filter(table => !["projects", "logs"].includes(table)))
    if (after[table].some(row => containsIdentity(row, deletedIdentities))) blockers.push(`${table}中仍有旧项目或拟删除资料引用，已阻止执行。`);
  const writes: ProjectResetPlan["writes"] = {}, deletes: ProjectResetPlan["deletes"] = {};
  const beforeCounts: Record<string, number> = {}, afterCounts: Record<string, number> = {};
  for (const table of tables) {
    const before = data<Entity>(snapshot, table), next = data<Entity>(after, table);
    beforeCounts[table] = before.length; afterCounts[table] = next.length;
    const changed = next.filter(row => !before.some(old => old.id === row.id && equal(old, row)));
    const removed = before.filter(row => !next.some(item => item.id === row.id)).map(row => row.id);
    if (changed.length) writes[table] = changed;
    if (removed.length) deletes[table] = removed;
  }
  const digest = createHash("sha256").update(JSON.stringify(canonical({
    snapshot: Object.fromEntries(tables.map(table => [table, stableRows(snapshot[table])])),
    templates, sources: settings.sources.filter(source => templates.some(entry => entry.sourceIds.includes(source.id))),
    catalogVersion: settings.catalogVersion, clearUnmatchedDemo: clear,
  }))).digest("hex");
  return { digest, blockers: [...new Set(blockers)], mappings, unmatched, newProjects, writes, deletes, beforeCounts, afterCounts,
    changed: Object.keys(writes).length > 0 || Object.keys(deletes).length > 0 };
}

export interface ProjectResetOptions extends ProjectResetSettings {
  apply: boolean;
  expectedDigest?: string;
  actorId?: string;
  beforeApply?: (report: ProjectResetReport) => Promise<void>;
}
export async function runProjectReset(db: Database, options: ProjectResetOptions): Promise<ProjectResetReport> {
  if (options.apply && (!options.expectedDigest || !/^[a-f0-9]{64}$/.test(options.expectedDigest) || !options.beforeApply))
    throw new ProjectResetError("执行前必须提供已复核的--expect-plan摘要并保存完整原始快照。");
  return db.transaction(async sql => {
    if (options.apply) {
      await sql.query("SET LOCAL lock_timeout = '5s'");
      await sql.query("SET LOCAL statement_timeout = '30s'");
      await sql.query(`LOCK TABLE ${[...tables].sort().map(table => `av_${table}`).join(", ")} IN SHARE ROW EXCLUSIVE MODE`);
    } else await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = {} as ProjectResetSnapshot;
    for (const table of tables) snapshot[table] = await list(sql, table);
    const admins = data<User & { active?: boolean }>(snapshot, "users").filter(user => user.role === "platform_admin" && user.active === true);
    const actor = options.actorId ? admins.find(user => user.id === options.actorId) : admins.length === 1 ? admins[0] : undefined;
    if (!actor) throw new ProjectResetError("须选择已启用的真实平台管理员；多个管理员时使用--actor-id。");
    const plan = planProjectReset(snapshot, options);
    if (options.expectedDigest && options.expectedDigest !== plan.digest) throw new ProjectResetError("计划摘要已变化，请重新预览复核。");
    const report: ProjectResetReport = { format: "autovoyage-project-reset-v1", mode: options.apply ? "apply" : "dry-run", status: "dry-run",
      actorId: actor.id, startedAt: now(), appliedAt: null, snapshot, plan };
    if (!options.apply) return report;
    if (plan.blockers.length) throw new ProjectResetError(`存在${plan.blockers.length}项阻碍，未执行；请先查看dry-run报告。`);
    await options.beforeApply!({ ...structuredClone(report), status: "prepared" });
    for (const table of tables) for (const id of plan.deletes[table] || []) await remove(sql, table, id);
    for (const table of tables) for (const row of plan.writes[table] || []) await put(sql, table, row);
    if (plan.changed) await audit(sql, actor.id, "projects.reset", "project_catalog", "general-service-catalog",
      `清空重建通用目录：${plan.beforeCounts.projects}→25项目，全部启用、无旧停用项；保留严格等价关联、价格、周期与历史保养记录；无等价演示关联清理=${options.clearUnmatchedDemo === true}；计划${plan.digest}`);
    const finalProjects = await list<Project>(sql, "projects");
    if (finalProjects.length !== 25 || finalProjects.some(project => !project.active) ||
      !equal(finalProjects.map(project => project.id).sort(), plan.newProjects.map(project => project.id).sort()))
      throw new ProjectResetError("重建目录结果不一致，事务回滚。");
    return { ...report, status: "applied", appliedAt: now() };
  });
}
