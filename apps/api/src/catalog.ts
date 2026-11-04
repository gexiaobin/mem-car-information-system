import { z } from "zod";
import type {
  CarModel, CatalogModelImportResult, CatalogModelsResponse, CatalogProjectImportResult,
  CatalogProjectsResponse, CatalogProvenance, CatalogVariantsResponse, Project,
} from "@autovoyage/shared";
import type { Context } from "./context.js";
import { roles, route } from "./context.js";
import { list, put } from "./db.js";
import { audit, ensure, id, now } from "./domain.js";
import { catalogModels, catalogProjects, catalogSources, catalogVersion, variantsById, variantsByModel } from "./data/public-catalog.js";

export const catalogText = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
export const sameModelIdentity = (a: Pick<CarModel, "brand" | "name" | "year" | "power">, b: Pick<CarModel, "brand" | "name" | "year" | "power">) =>
  a.year === b.year && catalogText(a.brand) === catalogText(b.brand) && catalogText(a.name) === catalogText(b.name) && catalogText(a.power) === catalogText(b.power);
const matches = (query: string, ...values: string[]) => !query || catalogText(values.join(" ")).includes(catalogText(query));
const sourcesFor = (ids: string[]) => catalogSources.filter(source => ids.includes(source.id));
const provenance = (catalogId: string, sourceIds: string[]): CatalogProvenance => ({
  catalogId, version: catalogVersion, sources: sourcesFor(sourceIds), importedAt: now(),
});
const queryText = z.string().trim().max(200).default("");

export function registerCatalog({ app, db }: Context) {
  app.get(route("/admin/catalog/models"), async request => {
    roles(request, ["platform_admin"]);
    const query = z.object({
      q: queryText, brand: queryText,
      offset: z.coerce.number().int().min(0).max(100000).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(40),
    }).parse(request.query);
    const filtered = catalogModels.filter(model => (!query.brand || model.brand === query.brand) && matches(query.q, model.brand, model.name));
    const response: CatalogModelsResponse = {
      items: filtered.slice(query.offset, query.offset + query.limit).map(model => ({ ...model, variantCount: variantsByModel.get(model.id)?.length || 0 })), total: filtered.length,
      offset: query.offset, limit: query.limit,
      brands: [...new Set(catalogModels.map(model => model.brand))].sort((a, b) => a.localeCompare(b, "zh-CN")),
      sources: sourcesFor([...new Set(catalogModels.map(model => model.sourceId))]), version: catalogVersion,
    };
    return response;
  });

  app.get<{ Params: { id: string } }>(route("/admin/catalog/models/:id/variants"), async request => {
    roles(request, ["platform_admin"]);
    ensure(catalogModels.some(model => model.id === request.params.id), 404, "CATALOG_ENTRY_NOT_FOUND", "公开车型条目不存在，请刷新目录");
    const query = z.object({
      q: queryText, power: queryText, year: z.coerce.number().int().min(1950).max(2100).optional(),
      offset: z.coerce.number().int().min(0).max(100000).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(40),
    }).parse(request.query);
    const all = variantsByModel.get(request.params.id) || [];
    const byYear = all.filter(variant => !query.year || variant.year === query.year);
    const filtered = byYear.filter(variant => (!query.power || variant.power === query.power) && matches(query.q, variant.trim, variant.power, variant.manufacturer || ""));
    return {
      items: filtered.slice(query.offset, query.offset + query.limit), total: filtered.length,
      years: [...new Set(all.map(variant => variant.year))].sort((a, b) => b - a),
      powers: [...new Set(byYear.map(variant => variant.power))].sort((a, b) => a.localeCompare(b, "zh-CN")),
      sources: sourcesFor([...new Set(all.map(variant => variant.sourceId))]), version: catalogVersion,
      offset: query.offset, limit: query.limit,
    } satisfies CatalogVariantsResponse;
  });

  app.get(route("/admin/catalog/projects"), async request => {
    roles(request, ["platform_admin"]);
    const query = z.object({ q: queryText, category: queryText }).parse(request.query);
    const items = catalogProjects.filter(project => (!query.category || project.category === query.category) && matches(query.q, project.code, project.name, project.category, project.description));
    const response: CatalogProjectsResponse = {
      items, total: items.length, categories: [...new Set(catalogProjects.map(project => project.category))].sort(),
      sources: sourcesFor([...new Set(catalogProjects.flatMap(project => project.sourceIds))]), version: catalogVersion,
    };
    return response;
  });

  app.post(route("/admin/catalog/models/import"), async request => {
    const user = roles(request, ["platform_admin"]);
    const input = z.union([z.object({
      catalogId: z.string().trim().min(1).max(200),
      variantId: z.string().trim().min(1).max(200),
    }).strict(), z.object({
      catalogId: z.string().trim().min(1).max(200),
      year: z.number().int().min(1950).max(2100),
      power: z.string().trim().min(1).max(200),
    }).strict()]).parse(request.body);
    const entry = catalogModels.find(model => model.id === input.catalogId);
    ensure(entry, 404, "CATALOG_ENTRY_NOT_FOUND", "公开车型条目不存在，请刷新目录");
    const selected = "variantId" in input ? variantsById.get(input.variantId) : undefined;
    if ("variantId" in input) ensure(selected && selected.modelCatalogId === entry.id, 400, "CATALOG_VARIANT_MISMATCH", "配置不属于所选车系，请重新选择年款和配置");
    const fields = selected ? { year: selected.year, power: `${selected.power} · ${selected.trim}` } : input as { year: number; power: string };
    return db.transaction(async sql => {
      await sql.query("LOCK TABLE av_models IN SHARE ROW EXCLUSIVE MODE");
      const models = await list<CarModel>(sql, "models");
      const variant = { brand: entry.brand, name: entry.name, year: fields.year, power: fields.power };
      const existing = models.find(model => (model.catalogSource?.catalogId === entry.id && model.year === fields.year && catalogText(model.power) === catalogText(fields.power)) || sameModelIdentity(model, variant));
      if (existing) return { model: existing, created: false } satisfies CatalogModelImportResult;
      const model: CarModel = {
        ...variant, id: id(), isDemo: false,
        catalogSource: {
          ...provenance(entry.id, selected ? [...new Set([entry.sourceId, selected.sourceId])] : [entry.sourceId]),
          ...(selected ? { variantId: selected.id, sourceEvidence: selected.sourceEvidence, ...(selected.manufacturer ? { manufacturer: selected.manufacturer } : {}) } : {}),
        },
      };
      await put(sql, "models", model);
      await audit(sql, user.id, "catalog.model.imported", "model", model.id, `${entry.id}；目录${catalogVersion}；${selected ? `公开配置${selected.id}` : "年款及动力由管理员补充"}；保养适用范围待核对`);
      return { model, created: true } satisfies CatalogModelImportResult;
    });
  });

  app.post(route("/admin/catalog/projects/import"), async request => {
    const user = roles(request, ["platform_admin"]);
    const input = z.object({ catalogIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100) }).strict().parse(request.body);
    const entries = [...new Set(input.catalogIds)].map(catalogId => {
      const entry = catalogProjects.find(project => project.id === catalogId);
      ensure(entry, 404, "CATALOG_ENTRY_NOT_FOUND", "参考服务项目不存在，请刷新目录");
      return entry;
    });
    return db.transaction(async sql => {
      // Shares the lock used by ordinary project edits and manual publication.
      await sql.query("LOCK TABLE av_projects IN SHARE ROW EXCLUSIVE MODE");
      const existingProjects = await list<Project>(sql, "projects");
      const projects: Project[] = [];
      let created = 0;
      for (const entry of entries) {
        const alreadyImported = existingProjects.find(project => project.catalogSource?.catalogId === entry.id);
        if (alreadyImported) { projects.push(alreadyImported); continue; }
        const sameCode = existingProjects.find(project => catalogText(project.code) === catalogText(entry.code));
        ensure(!sameCode || catalogText(sameCode.name) === catalogText(entry.name), 409, "CATALOG_CODE_CONFLICT", `项目编码 ${entry.code} 已用于其他名称，请先核对现有项目`);
        const existing = sameCode || existingProjects.find(project => catalogText(project.name) === catalogText(entry.name));
        if (existing) { projects.push(existing); continue; }
        const project: Project = {
          id: id(), code: entry.code, name: entry.name, category: entry.category,
          description: entry.description, unit: entry.unit, active: true,
          catalogSource: provenance(entry.id, entry.sourceIds),
        };
        await put(sql, "projects", project);
        await audit(sql, user.id, "catalog.project.imported", "project", project.id, `${entry.id}；目录${catalogVersion}；服务名称模板，不含车型适用性、保养周期或价格`);
        existingProjects.push(project); projects.push(project); created++;
      }
      return { projects, created, existing: projects.length - created } satisfies CatalogProjectImportResult;
    });
  });
}
