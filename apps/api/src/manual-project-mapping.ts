import type { CatalogProject, MaintenanceAction, ManualRuleDraft, Project } from "@autovoyage/shared";
import { catalogProjects } from "./data/public-catalog.js";

const actionWords: Record<MaintenanceAction, string[]> = {
  inspect: ["检查", "检测", "检验"], replace: ["更换", "替换"],
  clean: ["清洁", "清洗"], lubricate: ["润滑"], other: [],
};
// Fluid/chemical names describe the component, not the service operation.
// For example, topping up washer fluid is not a cleaning operation.
const actionPattern = /检查|检测|检验|更换|替换|清洁(?!剂)|清洗(?!液|剂)|润滑(?!油|脂|剂)/g;
const compact = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s，,、。.;；:：()（）\-_/]/g, "");

/** Exact normalized component names only; never use substring/fuzzy similarity. */
export function manualProjectSubject(value: string): string {
  return compact(value)
    .replace(actionPattern, "")
    .replace(/发动机机油/g, "机油")
    .replace(/机油滤清器|机油滤芯/g, "机滤")
    .replace(/空调滤芯|座舱滤芯|空调过滤器/g, "空调滤清器")
    .replace(/(?:发动机)?空气滤清器|(?:发动机)?空气滤芯/g, "发动机空气滤芯")
    .replace(/刹车液/g, "制动液")
    .replace(/雨刷片/g, "雨刮片")
    .replace(/及|与|和|\+/g, "与");
}

function statedAction(name: string, description = ""): MaintenanceAction | null {
  const fromName = [...new Set((name.match(actionPattern) || []).map(word => Object.entries(actionWords).find(([, words]) => words.includes(word))?.[0]))];
  if (fromName.length) return fromName.length === 1 ? fromName[0] as MaintenanceAction : null;
  // Only a leading description verb is authoritative; later text often says
  // "检查……；更换零件另行确认", which must not become a replacement project.
  const leading = description.trim().match(/^(检查|检测|检验|更换|替换|清洁(?!剂)|清洗(?!液|剂)|润滑(?!油|脂|剂))/)?.[1];
  return leading ? Object.entries(actionWords).find(([, words]) => words.includes(leading))?.[0] as MaintenanceAction : null;
}

export function standardProjectAction(project: Project, references: CatalogProject[] = catalogProjects): MaintenanceAction | null {
  const action = statedAction(project.name, project.description);
  if (action) return action;
  const explicit = references.filter(reference => project.catalogSource?.catalogId === reference.id || (reference.action === "other" && compact(project.name) === compact(reference.name)));
  const actions = new Set(explicit.map(reference => reference.action));
  return actions.size === 1 ? [...actions][0]! : null;
}

export function autoMapManualProjects(rows: ManualRuleDraft[], projects: Project[], references: CatalogProject[] = catalogProjects): ManualRuleDraft[] {
  // Existing imported projects and reference-only choices can point to the same
  // eventual project. Reserve/count that semantic target once, regardless of
  // which kind of ID a row currently holds.
  const projectKeys = new Map(projects.map(project => {
    const reference = project.catalogSource?.catalogId || (() => {
      const candidates = references.filter(entry => entry.action === standardProjectAction(project, references) && manualProjectSubject(entry.name) === manualProjectSubject(project.name));
      return candidates.length === 1 ? candidates[0]!.id : null;
    })();
    return [project.id, reference ? `catalog:${reference}` : `project:${project.id}`];
  }));
  const reserved = new Set(rows.flatMap(row => row.projectId ? [projectKeys.get(row.projectId) || `project:${row.projectId}`] : row.catalogProjectId ? [`catalog:${row.catalogProjectId}`] : []));
  const proposals = rows.map(row => {
    if (row.projectId || row.catalogProjectId || row.createProject) return null;
    const subject = manualProjectSubject(row.name);
    if (!subject) return null;
    const namedAction = statedAction(row.name);
    if (namedAction && namedAction !== row.action) return null;
    // Mixed operation names cannot safely be reduced to one standard action.
    const verbs = new Set((row.name.match(actionPattern) || []).map(word => Object.entries(actionWords).find(([, words]) => words.includes(word))?.[0]));
    if (verbs.size > 1) return null;
    const sameSubject = projects.filter(project => project.category !== "diagnosis" && manualProjectSubject(project.name) === subject);
    const existing = sameSubject.filter(project => project.active && standardProjectAction(project, references) === row.action);
    if (existing.length > 1) return null;
    if (existing.length === 1) return { key: projectKeys.get(existing[0]!.id)!, projectId: existing[0]!.id, catalogProjectId: null };
    if (sameSubject.some(project => !project.active || standardProjectAction(project, references) === null)) return null;
    const candidates = references.filter(project => project.category !== "diagnosis" && project.action === row.action && manualProjectSubject(project.name) === subject);
    if (candidates.length !== 1) return null;
    const reference = candidates[0]!;
    // A disabled or renamed imported entry is not silently replaced by a copy.
    if (projects.some(project => project.catalogSource?.catalogId === reference.id)) return null;
    return { key: `catalog:${reference.id}`, projectId: null, catalogProjectId: reference.id };
  });
  const counts = new Map<string, number>();
  for (const proposal of proposals) if (proposal) counts.set(proposal.key, (counts.get(proposal.key) || 0) + 1);
  return rows.map((row, index) => {
    const proposal = proposals[index];
    return proposal && !reserved.has(proposal.key) && counts.get(proposal.key) === 1
      ? { ...row, projectId: proposal.projectId, catalogProjectId: proposal.catalogProjectId, createProject: false }
      : row;
  });
}
