import { z } from "zod";
import type {
  CarModel,
  Fault,
  MaintenanceRule,
  Offer,
  Project,
  Slot,
  Store,
  User,
} from "@autovoyage/shared";
import type { Context } from "./context.js";
import { roles, route, sameStore } from "./context.js";
import { get, list, put } from "./db.js";
import type { Sql } from "./db.js";
import { audit, ensure, id, now, shanghaiDay } from "./domain.js";
import { sameModelIdentity } from "./catalog.js";
const money = z.number().int().min(0).max(100000000);
async function validateScope(sql: Sql, ids?: string[]) {
  if (ids === undefined) return;
  ensure(
    new Set(ids).size === ids.length,
    400,
    "DUPLICATE_PROJECT",
    "适用项目不能重复",
  );
  const projects = await list<Project>(sql, "projects");
  ensure(
    ids.every((id) =>
      projects.some(
        (p) => p.id === id && p.active && p.category !== "diagnosis",
      ),
    ),
    400,
    "INVALID_MAINTENANCE_SCOPE",
    "请选择有效的周期保养项目；故障诊断不属于周期保养范围",
  );
}
const offerSchema = z.object({
  storeId: z.string().optional(),
  modelId: z.string(),
  projectId: z.string(),
  title: z.string().trim().min(1).max(120),
  materialSpec: z.string().trim().min(1).max(2000),
  includes: z.string().trim().min(1).max(4000),
  excludes: z.string().max(4000).default(""),
  taxIncluded: z.boolean().default(true),
  priceType: z.enum(["fixed", "estimate", "inquiry"]),
  materialCents: money,
  laborCents: money,
  otherCents: money.default(0),
  totalCents: money.nullable().optional(),
  lowCents: money.nullable().default(null),
  highCents: money.nullable().default(null),
  validFrom: z.string().date(),
  validTo: z.string().date(),
  active: z.boolean().default(true),
});
const projectSchema = z.object({
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(100),
  description: z.string().max(4000),
  unit: z.string().min(1).max(20),
  active: z.boolean().default(true),
});
const ruleSchema = z.object({
  modelId: z.string(),
  projectId: z.string(),
  intervalMonths: z.number().int().min(1).max(120),
  intervalKm: z.number().int().positive().nullable(),
  firstMonths: z.number().int().min(1).max(120),
  firstKm: z.number().int().positive().nullable(),
  mileageType: z.enum(["total_km", "engine_km"]),
  sourceTitle: z.string().trim().min(1).max(1000),
  sourceUrl: z.union([z.string().url(), z.literal("")]),
  verified: z.boolean(),
  isDemo: z.boolean().default(false),
});
const storeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(["independent", "chain", "4s"]),
  address: z.string().trim().min(1).max(500),
  phone: z.string().trim().min(1).max(40),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  coordinateSystem: z.enum(["WGS84", "GCJ02"]),
  hours: z.string().min(1).max(200),
  approved: z.boolean().default(false),
  isDemo: z.boolean().default(false),
  description: z.string().max(4000),
  verificationEvidence: z.string().max(4000).optional(),
});
export function registerAdmin({ app, db }: Context) {
  const modelSchema = z.object({
    brand: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(200),
    year: z.number().int().min(1950).max(2100),
    power: z.string().trim().min(1).max(200),
    isDemo: z.boolean().default(false),
    applicableProjectIds: z.array(z.string()).max(100).optional(),
  });
  app.post(route("/admin/models"), async (request) => {
    const user = roles(request, ["platform_admin"]);
    const input = modelSchema.parse(request.body);
    return db.transaction(async (sql) => {
      await sql.query("LOCK TABLE av_models IN SHARE ROW EXCLUSIVE MODE");
      ensure(!(await list<CarModel>(sql, "models")).some(model => sameModelIdentity(model, input)), 409, "DUPLICATE_MODEL", "相同品牌、车型、年款及动力配置的档案已存在");
      await validateScope(sql, input.applicableProjectIds);
      const model: CarModel = { ...input, id: id() };
      await put(sql, "models", model);
      await audit(
        sql,
        user.id,
        "model.created",
        "model",
        model.id,
        `${model.brand} ${model.name} ${model.year}`,
      );
      return model;
    });
  });
  app.patch<{ Params: { id: string } }>(
    route("/admin/models/:id"),
    async (request) => {
      const user = roles(request, ["platform_admin"]);
      const input = modelSchema.partial().parse(request.body);
      return db.transaction(async (sql) => {
        // Manual publication also locks the existing model row before writing it.
        // Take that row first so a publication never waits on our table lock while
        // we are waiting on its row lock.
        const old = await get<CarModel>(sql, "models", request.params.id, true);
        ensure(old, 404, "NOT_FOUND", "车型不存在");
        await sql.query("LOCK TABLE av_models IN SHARE ROW EXCLUSIVE MODE");
        ensure(!(await list<CarModel>(sql, "models")).some(model => model.id !== old.id && sameModelIdentity(model, { ...old, ...input })), 409, "DUPLICATE_MODEL", "相同品牌、车型、年款及动力配置的档案已存在");
        await validateScope(sql, input.applicableProjectIds);
        ensure(
          input.isDemo === undefined || input.isDemo === old.isDemo,
          400,
          "DEMO_IMMUTABLE",
          "已有车型不能去掉或追加演示标记，请新建车型",
        );
        const model = { ...old, ...input };
        await put(sql, "models", model);
        await audit(
          sql,
          user.id,
          "model.updated",
          "model",
          model.id,
          `${model.brand} ${model.name}`,
        );
        return model;
      });
    },
  );
  app.post(route("/admin/offers"), async (request) => {
    const user = roles(request, ["store_admin"]);
    const input = offerSchema.parse(request.body);
    const storeId = input.storeId || user.storeId!;
    sameStore(user, storeId);
    return db.transaction(async (sql) => {
      ensure(
        await get(sql, "stores", storeId, true),
        404,
        "NOT_FOUND",
        "门店不存在",
      );
      const duplicate = (await list<Offer>(sql, "offers")).some(
        (o) =>
          o.storeId === storeId &&
          o.active &&
          o.modelId === input.modelId &&
          o.projectId === input.projectId &&
          o.materialSpec === input.materialSpec &&
          o.includes === input.includes &&
          o.excludes === input.excludes &&
          o.taxIncluded === input.taxIncluded &&
          o.validFrom <= input.validTo &&
          o.validTo >= input.validFrom,
      );
      ensure(
        !duplicate,
        409,
        "OVERLAPPING_SERVICE",
        "同一车型、项目、材料与服务范围已有重叠有效报价，请为原服务发布新版本",
      );
      ensure(
        await get(sql, "models", input.modelId),
        400,
        "MODEL_NOT_FOUND",
        "车型不存在",
      );
      const project = await get<Project>(sql, "projects", input.projectId);
      ensure(
        project?.active,
        400,
        "PROJECT_NOT_FOUND",
        "标准项目不存在或已停用",
      );
      ensure(
        input.validFrom <= input.validTo,
        400,
        "INVALID_DATES",
        "价格有效开始日期不得晚于结束日期",
      );
      const sum = input.materialCents + input.laborCents + input.otherCents;
      if (input.priceType === "fixed")
        ensure(
          input.totalCents == null || input.totalCents === sum,
          400,
          "PRICE_MISMATCH",
          "固定总价须等于材料、工时及其他必要费用之和",
        );
      if (input.priceType === "estimate")
        ensure(
          input.lowCents !== null &&
            input.highCents !== null &&
            input.highCents >= input.lowCents,
          400,
          "INVALID_ESTIMATE",
          "请填写有效的预估价格区间",
        );
      const store = await get<Store>(sql, "stores", storeId);
      const offer: Offer = {
        ...input,
        id: id(),
        storeId,
        totalCents: input.priceType === "fixed" ? sum : null,
        lowCents: input.priceType === "estimate" ? input.lowCents : null,
        highCents: input.priceType === "estimate" ? input.highCents : null,
        version: 1,
        isDemo: !!store?.isDemo,
      };
      await put(sql, "offers", offer);
      await put(sql, "offer_versions", {
        ...offer,
        id: `${offer.id}:1`,
        offerId: offer.id,
      });
      await audit(
        sql,
        user.id,
        "offer.published",
        "offer",
        offer.id,
        `发布版本1，${offer.priceType}`,
      );
      return offer;
    });
  });
  app.post<{ Params: { id: string } }>(
    route("/admin/offers/:id/version"),
    async (request) => {
      const user = roles(request, ["store_admin"]);
      const input = offerSchema.parse(request.body);
      return db.transaction(async (sql) => {
        const old = await get<Offer>(sql, "offers", request.params.id, true);
        ensure(old, 404, "NOT_FOUND", "服务不存在");
        sameStore(user, old.storeId);
        ensure(
          !input.storeId || input.storeId === old.storeId,
          403,
          "FORBIDDEN",
          "不能更换服务所属门店",
        );
        ensure(
          input.modelId === old.modelId && input.projectId === old.projectId,
          400,
          "IMMUTABLE_SCOPE",
          "价格版本不能更换车型或标准项目，请新建服务",
        );
        ensure(
          input.validFrom <= input.validTo,
          400,
          "INVALID_DATES",
          "价格有效期无效",
        );
        const sum = input.materialCents + input.laborCents + input.otherCents;
        if (input.priceType === "fixed")
          ensure(
            input.totalCents == null || input.totalCents === sum,
            400,
            "PRICE_MISMATCH",
            "价格明细之和与总价不一致",
          );
        if (input.priceType === "estimate")
          ensure(
            input.lowCents !== null &&
              input.highCents !== null &&
              input.highCents >= input.lowCents,
            400,
            "INVALID_ESTIMATE",
            "预估价格区间无效",
          );
        const offer: Offer = {
          ...old,
          ...input,
          id: old.id,
          storeId: old.storeId,
          version: old.version + 1,
          totalCents: input.priceType === "fixed" ? sum : null,
          lowCents: input.priceType === "estimate" ? input.lowCents : null,
          highCents: input.priceType === "estimate" ? input.highCents : null,
        };
        await put(sql, "offers", offer);
        await put(sql, "offer_versions", {
          ...offer,
          id: `${offer.id}:${offer.version}`,
          offerId: offer.id,
        });
        await audit(
          sql,
          user.id,
          "offer.version.published",
          "offer",
          old.id,
          `版本${old.version}→${offer.version}；已有预约快照不变`,
        );
        return offer;
      });
    },
  );
  app.patch<{ Params: { id: string } }>(
    route("/admin/offers/:id"),
    async (request) => {
      const user = roles(request, ["store_admin"]);
      const input = z.object({ active: z.boolean() }).parse(request.body);
      return db.transaction(async (sql) => {
        const old = await get<Offer>(sql, "offers", request.params.id, true);
        ensure(old, 404, "NOT_FOUND", "服务不存在");
        sameStore(user, old.storeId);
        const updated = { ...old, active: input.active };
        await put(sql, "offers", updated);
        await audit(
          sql,
          user.id,
          input.active ? "offer.enabled" : "offer.disabled",
          "offer",
          old.id,
          "不改写历史预约快照",
        );
        return updated;
      });
    },
  );
  app.post(route("/admin/slots"), async (request) => {
    const user = roles(request, ["store_admin"]);
    const raw = z
      .object({
        storeId: z.string().optional(),
        startsAt: z.string().datetime({ offset: true }),
        endsAt: z.string().datetime({ offset: true }),
        capacity: z.number().int().min(0).max(1000),
        active: z.boolean().default(true),
      })
      .parse(request.body);
    const input = {
      ...raw,
      startsAt: new Date(raw.startsAt).toISOString(),
      endsAt: new Date(raw.endsAt).toISOString(),
    };
    const storeId = input.storeId || user.storeId!;
    sameStore(user, storeId);
    ensure(
      Date.parse(input.endsAt) > Date.parse(input.startsAt) &&
        Date.parse(input.startsAt) > Date.now(),
      400,
      "INVALID_TIME",
      "时段必须在未来且结束晚于开始",
    );
    return db.transaction(async (sql) => {
      ensure(
        await get(sql, "stores", storeId, true),
        404,
        "NOT_FOUND",
        "门店不存在",
      );
      const existing = await list<Slot>(sql, "slots");
      ensure(
        !existing.some(
          (s) =>
            s.storeId === storeId &&
            Date.parse(s.startsAt) < Date.parse(input.endsAt) &&
            Date.parse(s.endsAt) > Date.parse(input.startsAt),
        ),
        409,
        "OVERLAPPING_SLOT",
        "本店已有重叠时段",
      );
      const slot: Slot = { ...input, id: id(), storeId, reserved: 0 };
      await put(sql, "slots", slot);
      await audit(
        sql,
        user.id,
        "slot.created",
        "slot",
        slot.id,
        `容量${slot.capacity}`,
      );
      return slot;
    });
  });
  app.patch<{ Params: { id: string } }>(
    route("/admin/slots/:id"),
    async (request) => {
      const user = roles(request, ["store_admin"]);
      const input = z
        .object({
          capacity: z.number().int().min(0).max(1000).optional(),
          active: z.boolean().optional(),
        })
        .parse(request.body);
      return db.transaction(async (sql) => {
        const old = await get<Slot>(sql, "slots", request.params.id, true);
        ensure(old, 404, "NOT_FOUND", "时段不存在");
        sameStore(user, old.storeId);
        ensure(
          input.capacity === undefined || input.capacity >= old.reserved,
          409,
          "CAPACITY_TOO_SMALL",
          "容量不得低于已占用名额",
        );
        const updated = { ...old, ...input };
        await put(sql, "slots", updated);
        await audit(
          sql,
          user.id,
          "slot.updated",
          "slot",
          old.id,
          `容量${updated.capacity}，${updated.active ? "开放" : "关闭"}；已有预约保留`,
        );
        return updated;
      });
    },
  );
  app.post(route("/admin/projects"), async (request) => {
    const user = roles(request, ["platform_admin"]);
    const input = projectSchema.parse(request.body);
    return db.transaction(async (sql) => {
      await sql.query("LOCK TABLE av_projects IN SHARE ROW EXCLUSIVE MODE");
      ensure(
        !(await list<Project>(sql, "projects")).some(
          (p) => p.code === input.code,
        ),
        409,
        "DUPLICATE_CODE",
        "标准项目编码已存在",
      );
      const p = { ...input, id: id() };
      await put(sql, "projects", p);
      await audit(sql, user.id, "project.created", "project", p.id, p.name);
      return p;
    });
  });
  app.patch<{ Params: { id: string } }>(
    route("/admin/projects/:id"),
    async (request) => {
      const user = roles(request, ["platform_admin"]);
      const input = projectSchema.partial().parse(request.body);
      return db.transaction(async (sql) => {
        await sql.query("LOCK TABLE av_projects IN SHARE ROW EXCLUSIVE MODE");
        const old = await get<Project>(
          sql,
          "projects",
          request.params.id,
          true,
        );
        ensure(old, 404, "NOT_FOUND", "标准项目不存在");
        ensure(
          !input.code ||
            !(await list<Project>(sql, "projects")).some(
              (p) => p.id !== old.id && p.code === input.code,
            ),
          409,
          "DUPLICATE_CODE",
          "标准项目编码已存在",
        );
        const updated = { ...old, ...input };
        await put(sql, "projects", updated);
        await audit(
          sql,
          user.id,
          "project.updated",
          "project",
          old.id,
          updated.name,
        );
        return updated;
      });
    },
  );
  app.post(route("/admin/rules"), async (request) => {
    const user = roles(request, ["platform_admin"]);
    const input = ruleSchema.parse(request.body);
    return db.transaction(async (sql) => {
      const model = await get<CarModel>(sql, "models", input.modelId, true);
      ensure(model, 400, "MODEL_NOT_FOUND", "车型不存在");
      ensure(
        model.applicableProjectIds === undefined ||
          model.applicableProjectIds.includes(input.projectId),
        400,
        "PROJECT_NOT_APPLICABLE",
        "本项目不在已维护的车型适用保养范围内",
      );
      const project = await get<Project>(sql, "projects", input.projectId);
      ensure(
        project?.active && project.category !== "diagnosis",
        400,
        "PROJECT_NOT_FOUND",
        "请选择有效的周期保养项目",
      );
      ensure(
        !input.verified || input.isDemo || !!input.sourceUrl,
        400,
        "SOURCE_REQUIRED",
        "核验真实车型规则需提供官方手册来源",
      );
      const existing = (await list<MaintenanceRule>(sql, "rules")).filter(
        (r) => r.modelId === input.modelId && r.projectId === input.projectId,
      );
      const rule: MaintenanceRule = {
        ...input,
        id: id(),
        version: Math.max(0, ...existing.map((r) => r.version)) + 1,
      };
      for (const old of existing)
        if (old.verified) await put(sql, "rules", { ...old, verified: false });
      await put(sql, "rules", rule);
      await audit(
        sql,
        user.id,
        "rule.published",
        "rule",
        rule.id,
        `${rule.sourceTitle}，版本${rule.version}`,
      );
      return rule;
    });
  });
  app.patch<{ Params: { id: string } }>(
    route("/admin/rules/:id"),
    async (request) => {
      const user = roles(request, ["platform_admin"]);
      const input = ruleSchema.partial().parse(request.body);
      const observed = await get<MaintenanceRule>(db, "rules", request.params.id);
      ensure(observed, 404, "NOT_FOUND", "规则不存在");
      return db.transaction(async (sql) => {
        // Match manual publication: lock models before their rule rows.
        // A move locks both source and destination in stable order.
        const modelIds = [...new Set([observed.modelId, input.modelId || observed.modelId])].sort();
        for (const modelId of modelIds) await get<CarModel>(sql, "models", modelId, true);
        const old = await get<MaintenanceRule>(
          sql,
          "rules",
          request.params.id,
          true,
        );
        ensure(old, 404, "NOT_FOUND", "规则不存在");
        ensure(old.modelId === observed.modelId, 409, "RULE_MODEL_CHANGED", "规则所属车型已被更新，请刷新后重试");
        ensure(!old.manualImportId, 409, 'MANUAL_RULE_IMMUTABLE', '导入规则请通过新手册任务发布新版本，原文与审核证据保持不变');
        ensure(!old.supersededBy, 409, "RULE_SUPERSEDED", "该规则已被新手册版本替代，请发布新版本，不能改写历史依据");
        const rule = { ...old, ...input, version: old.version + 1 };
        const model = await get<CarModel>(sql, "models", rule.modelId);
        ensure(model, 400, "MODEL_NOT_FOUND", "车型不存在");
        ensure(
          model.applicableProjectIds === undefined ||
            model.applicableProjectIds.includes(rule.projectId),
          400,
          "PROJECT_NOT_APPLICABLE",
          "本项目不在已维护的车型适用保养范围内",
        );
        const project = await get<Project>(sql, "projects", rule.projectId);
        ensure(
          project?.active && project.category !== "diagnosis",
          400,
          "PROJECT_NOT_FOUND",
          "请选择有效的周期保养项目",
        );
        ensure(
          !rule.verified || rule.isDemo || !!rule.sourceUrl,
          400,
          "SOURCE_REQUIRED",
          "核验真实车型规则需提供官方手册来源",
        );
        await put(sql, "rules", rule);
        await audit(
          sql,
          user.id,
          "rule.updated",
          "rule",
          rule.id,
          `版本${rule.version}；${rule.sourceTitle}`,
        );
        return rule;
      });
    },
  );
  app.post(route("/admin/stores"), async (request) => {
    const user = roles(request, ["platform_admin"]);
    const input = storeSchema.parse(request.body);
    ensure(
      !(input.type === "4s" && input.approved) ||
        !!input.verificationEvidence?.trim(),
      400,
      "EVIDENCE_REQUIRED",
      "批准4S店需填写品牌授权核验依据",
    );
    const store: Store = { ...input, id: id() };
    await put(db, "stores", store);
    await audit(
      db,
      user.id,
      "store.created",
      "store",
      store.id,
      `${input.name}；核验依据：${input.verificationEvidence || "未提供"}`,
    );
    return store;
  });
  app.patch<{ Params: { id: string } }>(
    route("/admin/stores/:id"),
    async (request) => {
      const user = roles(request, ["platform_admin", "store_admin"]);
      const input = storeSchema.partial().parse(request.body);
      if (user.role === "store_admin") {
        sameStore(user, request.params.id);
        ensure(
          input.approved === undefined &&
            input.type === undefined &&
            input.isDemo === undefined &&
            input.verificationEvidence === undefined,
          403,
          "FORBIDDEN",
          "门店不能自行修改审核状态、类型或核验依据",
        );
      }
      return db.transaction(async (sql) => {
        const old = await get<Store & { verificationEvidence?: string }>(
          sql,
          "stores",
          request.params.id,
          true,
        );
        ensure(old, 404, "NOT_FOUND", "门店不存在");
        const store = { ...old, ...input };
        ensure(
          !(store.type === "4s" && store.approved) ||
            !!store.verificationEvidence?.trim(),
          400,
          "EVIDENCE_REQUIRED",
          "批准4S店需填写品牌授权核验依据",
        );
        await put(sql, "stores", store);
        await audit(
          sql,
          user.id,
          "store.updated",
          "store",
          store.id,
          `${store.approved ? "已审核" : "未审核"}；核验依据：${store.verificationEvidence || "未提供"}`,
        );
        return store;
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    route("/admin/faults/:id/assign"),
    async (request) => {
      const user = roles(request, ["store_admin"]);
      const input = z.object({ expertId: z.string() }).parse(request.body);
      return db.transaction(async (sql) => {
        const fault = await get<Fault>(sql, "faults", request.params.id, true);
        ensure(fault, 404, "NOT_FOUND", "故障单不存在");
        sameStore(user, fault.storeId);
        const expert = await get<User>(sql, "users", input.expertId);
        ensure(
          expert?.role === "expert" && expert.storeId === user.storeId,
          400,
          "EXPERT_MISMATCH",
          "只能分配给本店专家",
        );
        const updated = { ...fault, assignedExpertId: expert.id };
        await put(sql, "faults", updated);
        await audit(
          sql,
          user.id,
          "fault.assigned",
          "fault",
          fault.id,
          expert.name,
        );
        return updated;
      });
    },
  );
}
