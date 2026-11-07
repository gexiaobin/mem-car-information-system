import { createHash } from "node:crypto";
import type { AuditLog, CatalogProject, Project, User } from "@autovoyage/shared";
import type { Database, Sql, Table } from "./db.js";
import { list, put } from "./db.js";
import { audit } from "./domain.js";

export const simplificationSourceVersion = "2026-11-05.1";
// Include historical rows and draft/manual snapshots, not only current rules.
// Audit import text is deliberately excluded from business references.
export const projectReferenceTables = [
  "models", "rules", "offers", "offer_versions", "appointments", "changes",
  "records", "manual_imports",
] as const satisfies readonly Table[];

export type PreservationReason = "inactive" | "general" | "manual" | "other-version" |
  "unknown-template" | "modified" | "referenced" | "ambiguous-import";
export interface PreservedProject {
  id: string;
  name: string;
  reason: PreservationReason;
  referenceTables?: string[];
}
export interface ProjectSimplificationPlan {
  sourceVersion: string;
  generalCatalogIds: string[];
  candidates: Project[];
  preserved: PreservedProject[];
  total: number;
  activeBefore: number;
  activeAfter: number;
  digest: string;
}
export interface ProjectSimplificationInput {
  projects: readonly Project[];
  catalogProjects: readonly CatalogProject[];
  generalProjects: readonly CatalogProject[];
  businessRecords: Readonly<Record<string, readonly unknown[]>>;
  logs: readonly Pick<AuditLog, "entityType" | "entityId" | "action">[];
  sourceVersion?: string;
}

/** Only exact IDs/keys count; names, free text and import audit details do not. */
function containsReference(value: unknown, identities: ReadonlySet<string>): boolean {
  if (typeof value === "string") return identities.has(value);
  if (Array.isArray(value)) return value.some(item => containsReference(item, identities));
  if (value && typeof value === "object")
    return Object.entries(value).some(([key, item]) => identities.has(key) || containsReference(item, identities));
  return false;
}

export function planProjectSimplification(input: ProjectSimplificationInput): ProjectSimplificationPlan {
  const sourceVersion = input.sourceVersion || simplificationSourceVersion;
  const generalCatalogIds = input.generalProjects.map(project => project.id).sort();
  const general = new Set(generalCatalogIds);
  const references = new Map(input.catalogProjects.map(project => [project.id, project]));
  if (!generalCatalogIds.length || generalCatalogIds.some(id => !references.has(id)))
    throw new ProjectSimplificationError("通用目录不能为空，且必须全部对应现有公开模板。");
  const provenanceCounts = new Map<string, number>();
  for (const project of input.projects) {
    const catalogId = project.catalogSource?.catalogId;
    if (catalogId) provenanceCounts.set(catalogId, (provenanceCounts.get(catalogId) || 0) + 1);
  }
  const editedIds = new Set(input.logs.filter(log => log.entityType === "project" &&
    log.action !== "catalog.project.imported" && log.action !== "project.simplified").map(log => log.entityId));
  const candidates: Project[] = [];
  const preserved: PreservedProject[] = [];
  for (const project of [...input.projects].sort((a, b) => a.id.localeCompare(b.id))) {
    const keep = (reason: PreservationReason, referenceTables?: string[]) => preserved.push({
      id: project.id, name: project.name, reason, ...(referenceTables?.length ? { referenceTables } : {}),
    });
    if (!project.active) { keep("inactive"); continue; }
    const provenance = project.catalogSource;
    if (!provenance) { keep("manual"); continue; }
    if (general.has(provenance.catalogId)) { keep("general"); continue; }
    if (provenance.version !== sourceVersion) { keep("other-version"); continue; }
    const template = references.get(provenance.catalogId);
    if (!template) { keep("unknown-template"); continue; }
    if ((["code", "name", "category", "description", "unit"] as const).some(field => project[field] !== template[field]) || editedIds.has(project.id)) {
      keep("modified"); continue;
    }
    if (provenanceCounts.get(provenance.catalogId)! > 1) { keep("ambiguous-import"); continue; }
    const identities = new Set([project.id, provenance.catalogId]);
    const referenceTables = Object.entries(input.businessRecords)
      .filter(([table, rows]) => !["projects", "logs", "releases"].includes(table) && rows.some(row => containsReference(row, identities)))
      .map(([table]) => table).sort();
    if (referenceTables.length) { keep("referenced", referenceTables); continue; }
    candidates.push(structuredClone(project));
  }
  const activeBefore = input.projects.filter(project => project.active).length;
  const digest = createHash("sha256").update(JSON.stringify({ sourceVersion, generalCatalogIds, candidates })).digest("hex");
  return { sourceVersion, generalCatalogIds, candidates, preserved, total: input.projects.length, activeBefore, activeAfter: activeBefore - candidates.length, digest };
}

export class ProjectSimplificationError extends Error {}
export interface ProjectSimplificationReport {
  format: "autovoyage-project-simplification-v1";
  mode: "dry-run" | "apply";
  status: "dry-run" | "prepared" | "applied";
  actorId: string;
  startedAt: string;
  appliedAt: string | null;
  plan: ProjectSimplificationPlan;
}
export interface ProjectSimplificationOptions {
  apply: boolean;
  catalogProjects: readonly CatalogProject[];
  generalProjects: readonly CatalogProject[];
  actorId?: string;
  sourceVersion?: string;
  expectedDigest?: string;
  beforeApply?: (report: ProjectSimplificationReport) => Promise<void>;
}

async function selectActor(sql: Sql, requestedId?: string): Promise<string> {
  const admins = (await list<User & { active?: boolean }>(sql, "users"))
    .filter(user => user.role === "platform_admin" && user.active === true);
  if (requestedId) {
    if (!admins.some(user => user.id === requestedId))
      throw new ProjectSimplificationError("--actor-id 必须对应已启用的平台管理员。");
    return requestedId;
  }
  if (admins.length !== 1)
    throw new ProjectSimplificationError("数据库须有唯一已启用的平台管理员，或通过 --actor-id 明确指定。");
  return admins[0].id;
}

/** Uses existing tables only. No migration, creation, deletion or reassignment. */
export async function runProjectSimplification(db: Database, options: ProjectSimplificationOptions): Promise<ProjectSimplificationReport> {
  if (options.apply && !options.beforeApply)
    throw new ProjectSimplificationError("应用前必须先持久保存原始项目报告。");
  return db.transaction(async sql => {
    if (options.apply) {
      await sql.query("SET LOCAL lock_timeout = '5s'");
      await sql.query("SET LOCAL statement_timeout = '30s'");
      // Prevent a new rule, snapshot, edit or manual selection racing the plan.
      // A deterministic order plus short timeout makes contention roll back.
      const lockedTables: Table[] = [...projectReferenceTables, "projects", "logs", "users"];
      await sql.query(`LOCK TABLE ${lockedTables.sort().map(table => `av_${table}`).join(", ")} IN SHARE ROW EXCLUSIVE MODE`);
    } else {
      await sql.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    }
    const actorId = await selectActor(sql, options.actorId);
    const businessRecords: Record<string, unknown[]> = {};
    for (const table of projectReferenceTables) businessRecords[table] = await list<unknown>(sql, table);
    const plan = planProjectSimplification({
      projects: await list<Project>(sql, "projects"), logs: await list<AuditLog>(sql, "logs"),
      catalogProjects: options.catalogProjects, generalProjects: options.generalProjects,
      businessRecords, sourceVersion: options.sourceVersion,
    });
    if (options.expectedDigest && plan.digest !== options.expectedDigest)
      throw new ProjectSimplificationError("当前停用计划与已复核的摘要不一致，请重新 dry-run 检查。");
    const report: ProjectSimplificationReport = {
      format: "autovoyage-project-simplification-v1", mode: options.apply ? "apply" : "dry-run",
      status: options.apply ? "prepared" : "dry-run", actorId,
      startedAt: new Date().toISOString(), appliedAt: null, plan,
    };
    if (!options.apply) return report;
    // A failed report write aborts the transaction before any project changes.
    await options.beforeApply!(structuredClone(report));
    for (const project of plan.candidates) {
      await put(sql, "projects", { ...project, active: false });
      await audit(sql, actorId, "project.simplified", "project", project.id,
        `通用服务目录精简：停用未修改且无业务引用的公开项目；来源目录${plan.sourceVersion}；${project.catalogSource!.catalogId}；仅active由true改为false，可恢复启用；计划${plan.digest}`);
    }
    return { ...report, status: "applied", appliedAt: new Date().toISOString() };
  });
}
