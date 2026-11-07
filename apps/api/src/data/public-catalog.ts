import { z } from "zod";
import type { CatalogModel, CatalogProject, CatalogSource, CatalogVariant } from "@autovoyage/shared";
import modelData from "./catalog-models.json" with { type: "json" };
import recentModelData from "./catalog-models-recent.json" with { type: "json" };
import modernModelData from "./catalog-models-modern.json" with { type: "json" };
import projectData from "./catalog-projects.json" with { type: "json" };
import sourceData from "./catalog-sources.json" with { type: "json" };
import modernSourceData from "./catalog-sources-modern.json" with { type: "json" };
import bydSourceData from "./catalog-sources-byd-recent.json" with { type: "json" };
import latestSourceData from "./catalog-sources-latest.json" with { type: "json" };
import variantData from "./catalog-variants.json" with { type: "json" };
import modernVariantData from "./catalog-variants-modern.json" with { type: "json" };
import bydVariantData from "./catalog-variants-byd-recent.json" with { type: "json" };
import latestVariantData from "./catalog-variants-latest.json" with { type: "json" };

// Versioned, bundled snapshots: browsing the catalog never depends on a third-party request.
export const catalogVersion = "2026-11-07.2";
const label = z.string().trim().min(1);
export const catalogSources: CatalogSource[] = z.array(z.object({
  id: label, title: label, url: z.url(), license: label, revision: label,
  retrievedAt: label, description: label,
})).parse([...sourceData, ...modernSourceData, ...bydSourceData, ...latestSourceData]);
export const catalogModels: CatalogModel[] = z.array(z.object({
  id: label, brand: label.max(100), name: label.max(200), sourceId: label,
})).parse([...modelData, ...recentModelData, ...modernModelData]);
export const catalogProjects: CatalogProject[] = z.array(z.object({
  id: label, code: label.max(60), name: label.max(120), category: label.max(100),
  description: label.max(4000), unit: label.max(20),
  action: z.enum(["inspect", "replace", "clean", "lubricate", "other"]),
  sourceIds: z.array(label).min(1),
})).parse(projectData);
// Keep older IDs available for saved drafts and existing provenance, while the
// selectable directory stays focused on everyday maintenance services.
const generalProjectIds = [
  "ref-engine-oil-filter", "ref-engine-air-filter", "ref-spark-plug", "ref-fuel-filter", "ref-cabin-filter",
  "ref-brake-fluid-replace", "ref-brake-pad-disc", "ref-brake-pad-replace",
  "ref-tire-pressure", "ref-tire-rotation", "ref-wheel-balance", "ref-wheel-alignment", "ref-tire-replace", "ref-suspension",
  "ref-coolant-level", "ref-engine-coolant-replace", "ref-automatic-transmission-fluid", "ref-cvt-fluid", "ref-dct-fluid",
  "ref-low-voltage-battery", "ref-low-voltage-battery-replace", "ref-wiper-replace", "ref-ac-system-clean",
  "ref-charge-connector", "ref-traction-battery-health",
];
// Freeze the original approved 25-item set for historical reset tooling.
// Expanding the reference directory must never broaden a destructive reset.
export const legacyGeneralCatalogProjects: CatalogProject[] = generalProjectIds.map(id => {
  const entry = catalogProjects.find(project => project.id === id);
  if (!entry) throw new Error(`Missing general service template: ${id}`);
  return entry;
});
export const generalCatalogProjects: CatalogProject[] = [
  ...legacyGeneralCatalogProjects,
  ...["ref-engine-oil-only", "ref-engine-oil-filter-only"].map(id => {
    const entry = catalogProjects.find(project => project.id === id);
    if (!entry) throw new Error(`Missing independent oil service template: ${id}`);
    return entry;
  }),
];
export const catalogVariants: CatalogVariant[] = z.array(z.object({
  id: label.max(200), modelCatalogId: label, year: z.number().int().min(1950).max(2100),
  power: label.max(200), trim: label.max(200), sourceId: label,
  sourceEvidence: label.max(1000), manufacturer: label.max(200).optional(),
}).refine(variant => `${variant.power} · ${variant.trim}`.length <= 200, "Variant display exceeds model field limit")).parse([...variantData, ...modernVariantData, ...bydVariantData, ...latestVariantData]);
const unique = (values: string[]) => new Set(values).size === values.length;
const sourceIds = new Set(catalogSources.map(source => source.id));
const modelIds = new Set(catalogModels.map(model => model.id));
if (!unique(catalogSources.map(source => source.id)) ||
    !unique(catalogModels.map(model => model.id)) ||
    !unique(catalogProjects.map(project => project.id)) ||
    !unique(catalogProjects.map(project => project.code)) ||
    catalogModels.some(model => !sourceIds.has(model.sourceId)) ||
    catalogProjects.some(project => project.sourceIds.some(id => !sourceIds.has(id))) ||
    !unique(catalogVariants.map(variant => variant.id)) ||
    catalogVariants.some(variant => !sourceIds.has(variant.sourceId) || !modelIds.has(variant.modelCatalogId))) {
  throw new Error("Public catalog snapshot contains duplicate identifiers or missing sources");
}
// Index once: catalogs can contain thousands of historical trim configurations.
export const variantsByModel = new Map<string, CatalogVariant[]>();
export const variantsById = new Map<string, CatalogVariant>();
for (const variant of catalogVariants) {
  const entries = variantsByModel.get(variant.modelCatalogId) || [];
  entries.push(variant);
  variantsByModel.set(variant.modelCatalogId, entries);
  variantsById.set(variant.id, variant);
}
for (const variants of variantsByModel.values()) variants.sort((a, b) => b.year - a.year || a.trim.localeCompare(b.trim, "zh-CN") || a.id.localeCompare(b.id));
export const yearsByModel = new Map([...variantsByModel].map(([modelId, variants]) => [modelId, [...new Set(variants.map(variant => variant.year))].sort((a, b) => b - a)]));
export const catalogYears = [...new Set(catalogVariants.map(variant => variant.year))].sort((a, b) => b - a);
