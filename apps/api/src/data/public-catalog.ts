import { z } from "zod";
import type { CatalogModel, CatalogProject, CatalogSource } from "@autovoyage/shared";
import modelData from "./catalog-models.json" with { type: "json" };
import projectData from "./catalog-projects.json" with { type: "json" };
import sourceData from "./catalog-sources.json" with { type: "json" };

// Versioned, bundled snapshots: browsing the catalog never depends on a third-party request.
export const catalogVersion = "2026-11-04.1";
const label = z.string().trim().min(1);
export const catalogSources: CatalogSource[] = z.array(z.object({
  id: label, title: label, url: z.url(), license: label, revision: label,
  retrievedAt: label, description: label,
})).parse(sourceData);
export const catalogModels: CatalogModel[] = z.array(z.object({
  id: label, brand: label.max(100), name: label.max(200), sourceId: label,
})).parse(modelData);
export const catalogProjects: CatalogProject[] = z.array(z.object({
  id: label, code: label.max(60), name: label.max(120), category: label.max(100),
  description: label.max(4000), unit: label.max(20),
  action: z.enum(["inspect", "replace", "clean", "lubricate", "other"]),
  sourceIds: z.array(label).min(1),
})).parse(projectData);
const unique = (values: string[]) => new Set(values).size === values.length;
const sourceIds = new Set(catalogSources.map(source => source.id));
if (!unique(catalogSources.map(source => source.id)) ||
    !unique(catalogModels.map(model => model.id)) ||
    !unique(catalogProjects.map(project => project.id)) ||
    !unique(catalogProjects.map(project => project.code)) ||
    catalogModels.some(model => !sourceIds.has(model.sourceId)) ||
    catalogProjects.some(project => project.sourceIds.some(id => !sourceIds.has(id)))) {
  throw new Error("Public catalog snapshot contains duplicate identifiers or missing sources");
}
