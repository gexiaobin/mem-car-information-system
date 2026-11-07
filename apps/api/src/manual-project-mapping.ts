import type { CatalogProject, MaintenanceAction, ManualProjectMappingDiagnostic, ManualRuleDraft, Project } from "@autovoyage/shared";
import { catalogProjects, generalCatalogProjects } from "./data/public-catalog.js";

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
  // Preserve explicit component separators before compact removes punctuation.
  // A two-part source row must not collapse into just one of its components.
  const subject = compact(value.normalize("NFKC").replace(/[，,、;；+&/]/g, "与"))
    .replace(actionPattern, "")
    .replace(/(?:发动机)?机油滤清器(?:滤芯)?|(?:发动机)?机油滤芯/g, "机滤")
    .replace(/发动机机油/g, "机油")
    .replace(/(?:空调|座舱|车厢|驾驶室)空气滤清器(?:滤芯)?|(?:空调|座舱|车厢|驾驶室)空气滤芯|空调滤清器滤芯|空调滤芯|座舱滤芯|座舱滤清器|空调过滤器/g, "空调滤清器")
    .replace(/(?:发动机)?空气滤清器(?:滤芯)?|(?:发动机)?空气滤芯/g, "发动机空气滤芯")
    .replace(/刹车液|刹车油|制动油/g, "制动液")
    .replace(/雨刷片/g, "雨刮片")
    .replace(/及|与|和|\+/g, "与");
  // The standard oil service explicitly includes BOTH engine oil and its filter.
  // This is the only compound alias here; do not infer a service from a subset.
  const parts = subject.split("与");
  return parts.length === 2 && new Set(parts).size === 2 && parts.every(part => part === "机油" || part === "机滤")
    ? "机油与机滤" : subject;
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

interface MappingProposal { key: string; projectId: string | null; catalogProjectId: string | null; targetName: string }
interface MappingDecision { diagnostic: ManualProjectMappingDiagnostic; proposal?: MappingProposal; fixed: boolean }

/** One deterministic decision source powers both mapping and its explanation. */
function decideManualProjectMappings(rows: ManualRuleDraft[], projects: Project[], references: CatalogProject[]): MappingDecision[] {
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
  const selectedKey = (row: ManualRuleDraft) => row.projectId ? projectKeys.get(row.projectId) || `project:${row.projectId}` : row.catalogProjectId ? `catalog:${row.catalogProjectId}` : row.createProject ? `new:${manualProjectSubject(row.name)}:${row.action}` : null;
  const reserved = new Set(rows.map(selectedKey).filter((key): key is string => !!key));
  const selectedCounts = new Map<string, number>(), sourceCounts = new Map<string, number>();
  for (const row of rows) {
    const key = selectedKey(row);
    if (key) selectedCounts.set(key, (selectedCounts.get(key) || 0) + 1);
    sourceCounts.set(row.id, (sourceCounts.get(row.id) || 0) + 1);
  }
  const decisions: MappingDecision[] = rows.map(row => {
    const fixed = !!(row.projectId || row.catalogProjectId || row.createProject);
    const result = (status: ManualProjectMappingDiagnostic["status"], code: string, message: string, targetName?: string, proposal?: MappingProposal): MappingDecision => ({ fixed, diagnostic: { rowId: row.id, status, code, message, ...(targetName ? { targetName } : {}) }, ...(proposal ? { proposal } : {}) });
    if (!row.name.trim()) return result("unmapped", "NAME_REQUIRED", "尚未填写项目名称，不能自动关联标准服务。");
    const subject = manualProjectSubject(row.name);
    if (!subject) return result("unmapped", "COMPONENT_REQUIRED", "名称未明确保养部件，不能确定标准服务。");
    const verbs = new Set((row.name.match(actionPattern) || []).map(word => Object.entries(actionWords).find(([, words]) => words.includes(word))?.[0]));
    if (verbs.size > 1) return result("conflict", "MULTIPLE_ACTIONS", "同一名称包含不同操作，请按原文区分检查、更换或清洁，不能合并关联。");
    const namedAction = statedAction(row.name);
    if (namedAction && namedAction !== row.action) return result("conflict", "ROW_ACTION_MISMATCH", "项目名称中的操作与识别动作不一致，请核对检查与更换，不能自动替代。");
    if ([!!row.projectId, !!row.catalogProjectId, row.createProject].filter(Boolean).length > 1) return result("conflict", "MULTIPLE_SELECTIONS", "本行同时存在多种项目关联，请保留一种；现有选择未被改写。");
    if (fixed) {
      if (row.createProject) {
        const existingName = projects.find(project => project.name.replace(/\s+/g, "").toLocaleLowerCase("zh-CN") === row.name.replace(/\s+/g, "").toLocaleLowerCase("zh-CN"));
        if (existingName) return result("conflict", "NEW_PROJECT_NAME_EXISTS", "已选择新建，但同名标准项目已经存在，请改为关联现有项目；现有选择未被改写。", existingName.name);
        return result("matched", "EXPLICIT_NEW_PROJECT", "已明确选择新增项目，确认导入时仍会校验名称与重复项。", row.name);
      }
      const project = row.projectId ? projects.find(project => project.id === row.projectId) : undefined;
      const reference = row.catalogProjectId ? references.find(reference => reference.id === row.catalogProjectId) || catalogProjects.find(reference => reference.id === row.catalogProjectId) : undefined;
      const target = project || reference;
      if (!target) return result("conflict", "TARGET_NOT_FOUND", "已有的标准项目关联不存在，请重新选择；现有选择未被改写。");
      if ((project && (!project.active || project.category === "diagnosis")) || reference?.category === "diagnosis") return result("conflict", "TARGET_UNAVAILABLE", "已关联项目已停用或属于故障诊断，不能作为保养项目导入。", target.name);
      const action = project ? standardProjectAction(project, references) : reference!.action;
      if (!action) return result("conflict", "TARGET_ACTION_UNKNOWN", "已有项目的操作不明确，不能自动确认与本行相同。", target.name);
      if (action !== row.action) return result("conflict", "TARGET_ACTION_MISMATCH", "已关联项目的操作与本行不同，请区分检查、更换和清洁。", target.name);
      if (manualProjectSubject(target.name) !== subject) return result("conflict", "TARGET_COMPONENT_MISMATCH", "已关联项目包含的部件与本行不同；单独机油或机滤不能替代机油及机滤组合。", target.name);
      return result("matched", project ? "MATCHED_EXISTING" : "MATCHED_REFERENCE", project ? "已关联同部件、同操作的现有标准服务。" : "已关联同部件、同操作的参考模板，确认导入时创建或复用标准服务。", target.name);
    }
    const sameSubject = projects.filter(project => project.category !== "diagnosis" && manualProjectSubject(project.name) === subject);
    const existing = sameSubject.filter(project => project.active && standardProjectAction(project, references) === row.action);
    if (existing.length > 1) return result("conflict", "AMBIGUOUS_PROJECT", "找到多个同部件、同操作的现有项目，无法确定唯一目标，请明确选择。");
    if (existing.length === 1) return result("matched", "MATCHED_EXISTING", "可唯一关联同部件、同操作的现有标准服务。", existing[0]!.name, { key: projectKeys.get(existing[0]!.id)!, projectId: existing[0]!.id, catalogProjectId: null, targetName: existing[0]!.name });
    const disabled = sameSubject.find(project => !project.active);
    if (disabled) return result("conflict", "PROJECT_DISABLED", "同部件项目已停用，不会绕过停用状态自动新建副本。", disabled.name);
    const unknown = sameSubject.find(project => standardProjectAction(project, references) === null);
    if (unknown) return result("conflict", "PROJECT_ACTION_UNKNOWN", "同部件现有项目的操作不明确，需要人工核对，不会复制新项目绕过冲突。", unknown.name);
    const candidates = references.filter(project => project.category !== "diagnosis" && project.action === row.action && manualProjectSubject(project.name) === subject);
    if (candidates.length > 1) return result("conflict", "AMBIGUOUS_REFERENCE", "参考目录存在多个同部件、同操作的候选，无法自动选定唯一项目。");
    if (!candidates.length) {
      if (sameSubject.length || references.some(project => project.category !== "diagnosis" && manualProjectSubject(project.name) === subject)) return result("conflict", "ACTION_NOT_AVAILABLE", "目录中同部件项目的操作不同，不能将检查自动关联为更换，请选择准确项目。");
      if (subject.includes("与")) return result("unmapped", "MULTIPLE_COMPONENTS_UNMAPPED", "本行包含多个部件，目录没有完全对应的组合项目；不能省略部件后强行关联，请按原文分别处理。");
      if (subject === "机油" || subject === "机滤") return result("unmapped", "INDEPENDENT_COMPONENT_MISSING", "当前目录缺少本行独立部件的服务，不能关联为机油及机滤组合，请补充对应独立项目。");
      return result("unmapped", "NO_COMPONENT_TEMPLATE", "目录中没有部件及操作完全对应的标准服务，或名称尚不能确定为同义；已留空，需选择准确项目。");
    }
    const reference = candidates[0]!;
    // A disabled or renamed imported entry is not silently replaced by a copy.
    const imported = projects.find(project => project.catalogSource?.catalogId === reference.id);
    if (imported) return result("conflict", "IMPORTED_REFERENCE_CONFLICT", "该参考模板已有被修改或停用的业务项目，不会自动复制新项目；请核对现有项目。", imported.name);
    return result("matched", "MATCHED_REFERENCE", "可唯一关联同部件、同操作的参考模板；确认导入时才创建或复用标准服务。", reference.name, { key: `catalog:${reference.id}`, projectId: null, catalogProjectId: reference.id, targetName: reference.name });
  });
  const counts = new Map<string, number>();
  for (const decision of decisions) if (decision.proposal) counts.set(decision.proposal.key, (counts.get(decision.proposal.key) || 0) + 1);
  return decisions.map((decision, index) => {
    const row = rows[index]!, key = selectedKey(row), proposal = decision.proposal;
    const conflict = (code: string, message: string): MappingDecision => ({ ...decision, diagnostic: { rowId: row.id, status: "conflict", code, message, ...(decision.diagnostic.targetName ? { targetName: decision.diagnostic.targetName } : {}) } });
    if ((sourceCounts.get(row.id) || 0) > 1) return conflict("DUPLICATE_SOURCE_ROW", "来源行标识重复，请先移除重复行；不能自动关联或重复导入。");
    if (decision.diagnostic.status !== "matched") return decision;
    if (key && (selectedCounts.get(key) || 0) > 1) return conflict("DUPLICATE_TARGET", "多行已关联同一标准项目，请核对工况、动作和周期，不能重复导入同一目标。");
    if (proposal && reserved.has(proposal.key)) return conflict("TARGET_ALREADY_SELECTED", "另一行已选择同一标准项目，当前行保持留空，请核对后保留适用的一行。");
    if (proposal && (counts.get(proposal.key) || 0) > 1) return conflict("DUPLICATE_SOURCE_TARGET", "多个来源行将关联同一标准项目，可能是不同工况或重复项目；请核对后明确选择，不能自动合并。");
    return decision;
  });
}

export function autoMapManualProjects(rows: ManualRuleDraft[], projects: Project[], references: CatalogProject[] = generalCatalogProjects): ManualRuleDraft[] {
  return decideManualProjectMappings(rows, projects, references).map((decision, index) => decision.proposal && decision.diagnostic.status === "matched" && !decision.fixed
    ? { ...rows[index]!, projectId: decision.proposal.projectId, catalogProjectId: decision.proposal.catalogProjectId, createProject: false }
    : rows[index]!);
}

/** Explanations are derived from the mapper and never modify user selections. */
export function diagnoseManualProjectMappings(rows: ManualRuleDraft[], projects: Project[], references: CatalogProject[] = generalCatalogProjects): ManualProjectMappingDiagnostic[] {
  return decideManualProjectMappings(rows, projects, references).map(decision => decision.diagnostic);
}
