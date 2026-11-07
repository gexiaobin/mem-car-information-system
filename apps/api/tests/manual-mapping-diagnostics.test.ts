import { test } from "node:test";
import assert from "node:assert/strict";
import type { CatalogProject, ManualRuleDraft, Project } from "@autovoyage/shared";
import { autoMapManualProjects, diagnoseManualProjectMappings } from "../src/manual-project-mapping.js";
import { generalCatalogProjects, legacyGeneralCatalogProjects } from "../src/data/public-catalog.js";

const row = (id: string, name: string, extra: Partial<ManualRuleDraft> = {}): ManualRuleDraft => ({
  id, name, action: "replace", include: false, projectId: null, catalogProjectId: null, createProject: false,
  triggerType: "condition", firstMonths: null, firstKm: null, intervalMonths: 6, intervalKm: null,
  mileageType: "total_km", condition: "当出现警告时或6个月，以先到者为准", notes: "合成回归，不作为实车依据",
  sourceText: "合成原文：更换发动机机油，当出现警告时或6个月", pageNumbers: [1], ...extra,
});
const project = (id: string, name = "更换发动机机油", extra: Partial<Project> = {}): Project => ({ id, name, code: id, category: "发动机", description: name, active: true, unit: "次", ...extra });

test("six-month oil and twelve-month oil-filter rules map separately without modifying their cycles or selection", () => {
  const rows = [row("oil", "发动机机油"), row("filter", "发动机机油滤清器", { intervalMonths: 12, condition: "当出现警告时或1年，以先到者为准" }), row("both", "发动机机油及机油滤清器")];
  const before = structuredClone(rows);
  const diagnostics = diagnoseManualProjectMappings(rows, []);
  assert.deepEqual(rows, before, "diagnostics never mutate the submitted rows");
  assert(diagnostics.every(item => item.status === "matched" && item.targetName));
  const mapped = autoMapManualProjects(rows, []);
  assert.deepEqual(mapped.map(item => item.catalogProjectId), ["ref-engine-oil-only", "ref-engine-oil-filter-only", "ref-engine-oil-filter"]);
  assert.deepEqual(mapped.map(item => [item.intervalMonths, item.triggerType, item.condition, item.include]), rows.map(item => [item.intervalMonths, item.triggerType, item.condition, item.include]));
  assert.deepEqual(autoMapManualProjects(mapped, []), mapped, "repeated mapping is idempotent");
  assert.deepEqual(diagnoseManualProjectMappings(mapped, []).map(item => item.targetName), diagnostics.map(item => item.targetName));
});

test("existing and explicit project selections are preserved and their validity is explained", () => {
  const existing = project("existing-oil");
  const rows = [row("auto", "发动机机油")];
  const mapped = autoMapManualProjects(rows, [existing]);
  assert.equal(mapped[0]!.projectId, existing.id); assert.equal(mapped[0]!.catalogProjectId, null);
  assert.equal(diagnoseManualProjectMappings(mapped, [existing])[0]!.code, "MATCHED_EXISTING");
  const selected = row("chosen", "发动机机油", { projectId: "missing-user-choice" });
  assert.deepEqual(autoMapManualProjects([selected], [existing])[0], selected);
  assert.equal(diagnoseManualProjectMappings([selected], [existing])[0]!.code, "TARGET_NOT_FOUND");
  const combo = project("combined", "更换发动机机油及机油滤清器");
  const wrong = row("wrong", "发动机机油", { projectId: combo.id });
  assert.deepEqual(autoMapManualProjects([wrong], [combo])[0], wrong);
  assert.equal(diagnoseManualProjectMappings([wrong], [combo])[0]!.code, "TARGET_COMPONENT_MISMATCH");
  const created = row("new", "明确新增的合成服务", { createProject: true });
  assert.deepEqual(autoMapManualProjects([created], [])[0], created);
  assert.equal(diagnoseManualProjectMappings([created], [])[0]!.code, "EXPLICIT_NEW_PROJECT");
  const duplicate = row("new-existing", existing.name, { createProject: true });
  assert.deepEqual(autoMapManualProjects([duplicate], [existing])[0], duplicate);
  assert.equal(diagnoseManualProjectMappings([duplicate], [existing])[0]!.code, "NEW_PROJECT_NAME_EXISTS");
});

test("duplicate targets, source identifiers and reserved existing choices remain unresolved with specific reasons", () => {
  const duplicate = [row("normal", "机油"), row("severe", "发动机机油", { condition: "仅严重工况" })];
  assert(autoMapManualProjects(duplicate, []).every(item => !item.projectId && !item.catalogProjectId));
  assert(diagnoseManualProjectMappings(duplicate, []).every(item => item.code === "DUPLICATE_SOURCE_TARGET"));
  const reserved = [row("chosen", "机油", { catalogProjectId: "ref-engine-oil-only" }), row("blank", "发动机机油")];
  assert.equal(autoMapManualProjects(reserved, [])[1]!.catalogProjectId, null);
  assert.equal(diagnoseManualProjectMappings(reserved, [])[1]!.code, "TARGET_ALREADY_SELECTED");
  const source = [row("same-source", "机油"), row("same-source", "机油滤清器")];
  assert(diagnoseManualProjectMappings(source, []).every(item => item.code === "DUPLICATE_SOURCE_ROW"));
  assert(autoMapManualProjects(source, []).every(item => !item.catalogProjectId));
  const repeated = reserved.map(item => ({ ...item, catalogProjectId: "ref-engine-oil-only" }));
  assert(diagnoseManualProjectMappings(repeated, []).every(item => item.code === "DUPLICATE_TARGET"));
});

test("different actions and mixed-action names cannot silently select replacement services", () => {
  const mismatched = row("action", "检查发动机机油");
  assert.equal(diagnoseManualProjectMappings([mismatched], [])[0]!.code, "ROW_ACTION_MISMATCH");
  const mixed = row("mixed", "检查并更换发动机机油");
  assert.equal(diagnoseManualProjectMappings([mixed], [])[0]!.code, "MULTIPLE_ACTIONS");
  const inspection = row("inspect", "发动机机油", { action: "inspect" });
  assert.equal(diagnoseManualProjectMappings([inspection], [])[0]!.code, "ACTION_NOT_AVAILABLE");
  assert.equal(autoMapManualProjects([inspection], [])[0]!.catalogProjectId, null);
});

test("disabled, ambiguous and renamed imported projects cannot be bypassed by creating reference copies", () => {
  const source = row("oil", "发动机机油");
  const disabled = project("disabled", "更换发动机机油", { active: false });
  assert.equal(diagnoseManualProjectMappings([source], [disabled])[0]!.code, "PROJECT_DISABLED");
  assert.equal(autoMapManualProjects([source], [disabled])[0]!.catalogProjectId, null);
  const ambiguous = [project("one"), project("two")];
  assert.equal(diagnoseManualProjectMappings([source], ambiguous)[0]!.code, "AMBIGUOUS_PROJECT");
  assert.equal(autoMapManualProjects([source], ambiguous)[0]!.projectId, null);
  const renamed = project("renamed", "更换其它部件", { catalogSource: { catalogId: "ref-engine-oil-only", version: "synthetic", sources: [], importedAt: "2026-01-01T00:00:00Z" } });
  assert.equal(diagnoseManualProjectMappings([source], [renamed])[0]!.code, "IMPORTED_REFERENCE_CONFLICT");
  assert.equal(autoMapManualProjects([source], [renamed])[0]!.catalogProjectId, null);
  const unknown = project("unknown", "发动机机油", { description: "原文没有写明操作" });
  assert.equal(diagnoseManualProjectMappings([source], [unknown])[0]!.code, "PROJECT_ACTION_UNKNOWN");
});

test("missing independent templates, unsupported compounds and ambiguous references are explained without fuzzy merging", () => {
  for (const name of ["发动机机油", "发动机机油滤清器"]) {
    assert.equal(diagnoseManualProjectMappings([row(name, name)], [], legacyGeneralCatalogProjects)[0]!.code, "INDEPENDENT_COMPONENT_MISSING");
    assert.equal(autoMapManualProjects([row(name, name)], [], legacyGeneralCatalogProjects)[0]!.catalogProjectId, null);
  }
  const multiple = row("parts", "机油、机油滤清器、空气滤清器");
  assert.equal(diagnoseManualProjectMappings([multiple], [])[0]!.code, "MULTIPLE_COMPONENTS_UNMAPPED");
  assert.equal(autoMapManualProjects([multiple], [])[0]!.catalogProjectId, null);
  const reference = generalCatalogProjects.find(item => item.id === "ref-engine-oil-only")!;
  const candidates: CatalogProject[] = [reference, { ...reference, id: "synthetic-second-oil" }];
  assert.equal(diagnoseManualProjectMappings([row("oil", "机油")], [], candidates)[0]!.code, "AMBIGUOUS_REFERENCE");
  const unknown = row("dust", "粉尘滤清器");
  assert.equal(diagnoseManualProjectMappings([unknown], [])[0]!.code, "NO_COMPONENT_TEMPLATE");
});
