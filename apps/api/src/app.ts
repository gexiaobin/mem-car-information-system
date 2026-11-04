import Fastify from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type {
  Appointment,
  Bootstrap,
  CarModel,
  Fault,
  ImportJob,
  MaintenanceRule,
  Notice,
  Observation,
  Offer,
  Project,
  PublicConfig,
  ServiceChange,
  ServiceRecord,
  Slot,
  Store,
  User,
  Vehicle,
} from "@autovoyage/shared";
import { loadConfig, type Config } from "./config.js";
import { connectDatabase, get, list, put, type Database } from "./db.js";
import { seed, type StoredUser } from "./seed.js";
import {
  AppError,
  audit,
  checkPassword,
  ensure,
  id,
  maintenanceFor,
  notify,
  now,
  sha256,
  shanghaiDay,
  saveMaintenanceMessages,
  recalculateMaintenance,
} from "./domain.js";
import {
  authenticated,
  owner,
  roles,
  ownVehicle,
  publicUser,
  route,
  sameStore,
} from "./context.js";
import { expireAppointments, registerBookings } from "./bookings.js";
import { registerAdmin } from "./admin.js";
import { registerCatalog } from "./catalog.js";
import { registerImages } from "./images.js";
import { registerRegistration } from "./registration.js";
import { registerManuals } from "./manuals.js";
import { registerManualFiles } from "./manual-files.js";
import { ensureUniqueOwnerPlate } from "./vehicle-identity.js";
import { effectiveOffers } from "./prices.js";
export async function createApp(
  options: { config?: Config; db?: Database; logger?: boolean } = {},
) {
  const config = options.config || loadConfig();
  const db = options.db || (await connectDatabase(config));
  await db.migrate();
  await seed(db, config);
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: config.production,
    bodyLimit: 1024 * 1024,
    requestTimeout: 60000,
  });
  app.decorateRequest("user", null);
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 12, parts: 13 },
  });
  await app.register(rateLimit, {
    max: 180,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      error: { code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试" },
    }),
  });
  const publicConfig = (): PublicConfig => ({
    version: "0.1.0",
    demoMode: config.demoMode,
    database: config.driver,
    aiConfigured: !!(config.aiBaseUrl && config.aiKey && config.aiModel),
    mapProvider: config.mapProvider,
    amapKey: config.amapKey,
    amapSecurityCode: config.amapSecurityCode,
  });
  app.addHook("onRequest", async (request, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "strict-origin-when-cross-origin");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.origin;
      let same = false;
      try {
        same =
          !!origin && new URL(origin).origin === new URL(config.origin).origin;
      } catch {}
      ensure(
        same,
        403,
        "ORIGIN_REJECTED",
        "请求来源无效，请从云程站点重新操作",
      );
    }
    const raw = request.cookies.av_session;
    if (!raw) return;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    const rows = await db.query<{ user_id: string }>(
      "SELECT user_id FROM av_sessions WHERE hash=$1 AND expires_at>NOW()",
      [sha256(unsigned.value)],
    );
    if (!rows[0]) return;
    const stored = await get<StoredUser>(db, "users", rows[0].user_id);
    if (stored?.active) request.user = publicUser(stored);
  });
  app.setErrorHandler((error, request, reply) => {
    const failure = error as Error & { statusCode?: number; code?: string };
    if (error instanceof AppError)
      return reply
        .code(error.status)
        .send({ error: { code: error.code, message: error.message } });
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "填写信息格式不正确，请检查必填项、日期及金额",
          details: error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      });
    if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE")
      return reply.code(413).send({
        error: { code: "IMAGE_TOO_LARGE", message: "图片不能超过8MB" },
      });
    if (failure.message === "IMAGE_DECODE")
      return reply.code(400).send({
        error: {
          code: "IMAGE_DECODE",
          message: "图片无法解码，请重新选择有效图片",
        },
      });
    if ((error as { code?: string }).code === "23505")
      return reply.code(409).send({
        error: {
          code: "DUPLICATE_DATA",
          message: "数据已存在或请求正在处理中，请刷新后重试",
        },
      });
    const status =
      failure.statusCode &&
      failure.statusCode >= 400 &&
      failure.statusCode < 500
        ? failure.statusCode
        : 500;
    // Avoid logging request bodies, uploaded images, credentials, coordinates, or provider error payloads.
    request.log.error(
      { code: (error as { code?: string }).code || "INTERNAL", status },
      "API request failed",
    );
    return reply.code(status).send({
      error: {
        code: status === 500 ? "INTERNAL_ERROR" : "BAD_REQUEST",
        message:
          status === 500
            ? "服务暂时不可用，请稍后重试"
            : "请求无效，请检查后重试",
      },
    });
  });
  app.get(route("/health"), async () => {
    await db.query("SELECT 1");
    return { status: "ok", version: "0.1.0", database: config.driver };
  });
  app.get(route("/config"), async () => publicConfig());
  app.get(route("/offers"), async (request) => {
    owner(request);
    const input = z.object({ date: z.string().date() }).parse(request.query);
    return db.transaction(async (sql) => {
      const stores = await list<Store>(sql, "stores");
      return (await effectiveOffers(sql, input.date)).filter((o) =>
        stores.some((s) => s.id === o.storeId && s.approved),
      );
    });
  });
  app.get(route("/auth/me"), async (request) => ({ user: request.user }));
  app.post(
    route("/auth/login"),
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = z
        .object({
          email: z.string().email().max(254),
          password: z.string().min(1).max(256),
        })
        .parse(request.body);
      const stored = (await list<StoredUser>(db, "users")).find(
        (u) => u.email.toLowerCase() === input.email.toLowerCase() && u.active,
      );
      const valid = stored
        ? await checkPassword(input.password, stored.passwordHash)
        : await checkPassword(
            input.password,
            "0123456789abcdef0123456789abcdef:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
          );
      ensure(stored && valid, 401, "INVALID_CREDENTIALS", "邮箱或密码不正确");
      const token = randomBytes(32).toString("base64url");
      await db.query(
        "INSERT INTO av_sessions(hash,user_id,expires_at) VALUES ($1,$2,$3)",
        [
          sha256(token),
          stored.id,
          new Date(Date.now() + 12 * 3600000).toISOString(),
        ],
      );
      reply.setCookie("av_session", token, {
        httpOnly: true,
        secure:
          config.production &&
          !(config.allowHttpPreview && config.origin.startsWith("http://")),
        sameSite: "lax",
        signed: true,
        path: "/",
        maxAge: 12 * 3600,
      });
      return { user: publicUser(stored) };
    },
  );
  app.post(route("/auth/logout"), async (request, reply) => {
    const raw = request.cookies.av_session;
    const unsigned = raw ? request.unsignCookie(raw) : null;
    if (unsigned?.valid && unsigned.value)
      await db.query("DELETE FROM av_sessions WHERE hash=$1", [
        sha256(unsigned.value),
      ]);
    reply.clearCookie("av_session", { path: "/" });
    return { ok: true };
  });
  app.delete(route("/auth/account"), async (request, reply) => {
    const user = owner(request);
    await db.transaction(async (sql) => {
      const active = (await list<Appointment>(sql, "appointments")).some(
        (a) =>
          a.ownerId === user.id &&
          ["pending", "confirmed", "in_service", "awaiting_owner"].includes(
            a.status,
          ),
      );
      ensure(
        !active,
        409,
        "ACTIVE_APPOINTMENTS",
        "请先处理未完成的预约，再申请注销",
      );
      const stored = await get<StoredUser>(sql, "users", user.id, true);
      ensure(stored, 404, "NOT_FOUND", "账号不存在");
      await put(sql, "users", { ...stored, active: false });
      await sql.query("DELETE FROM av_sessions WHERE user_id=$1", [user.id]);
      await audit(
        sql,
        user.id,
        "account.deactivated",
        "user",
        user.id,
        "车主主动注销；业务记录按项目留存策略保存",
      );
    });
    reply.clearCookie("av_session", { path: "/" });
    return { ok: true };
  });
  app.get(route("/bootstrap"), async (request) => {
    const user = authenticated(request);
    return db.transaction(async (sql) => {
      await expireAppointments(sql);
      const models = await list<CarModel>(sql, "models"),
        projects = await list<Project>(sql, "projects"),
        rules = await list<MaintenanceRule>(sql, "rules");
      const allStores = await list<Store>(sql, "stores"),
        allOffers = await list<Offer>(sql, "offers"),
        allSlots = await list<Slot>(sql, "slots"),
        allVehicles = await list<Vehicle>(sql, "vehicles"),
        allAppointments = await list<Appointment>(sql, "appointments"),
        allFaults = await list<Fault>(sql, "faults");
      const faults =
        user.role === "owner"
          ? allFaults.filter((f) => f.ownerId === user.id)
          : user.role === "store_admin"
            ? allFaults.filter((f) => f.storeId === user.storeId)
            : user.role === "expert"
              ? allFaults.filter(
                  (f) =>
                    f.storeId === user.storeId &&
                    f.assignedExpertId === user.id,
                )
              : [];
      const appointments =
        user.role === "owner"
          ? allAppointments.filter((a) => a.ownerId === user.id)
          : user.role === "store_admin"
            ? allAppointments.filter((a) => a.storeId === user.storeId)
            : user.role === "expert"
              ? allAppointments.filter(
                  (a) =>
                    a.storeId === user.storeId &&
                    faults.some((f) => f.id === a.faultId),
                )
              : [];
      const vehicles =
        user.role === "owner"
          ? allVehicles.filter((v) => v.ownerId === user.id)
          : user.role === "platform_admin"
            ? []
            : allVehicles.filter(
                (v) =>
                  appointments.some((a) => a.vehicleId === v.id) ||
                  faults.some((f) => f.vehicleId === v.id),
              );
      const stores =
        user.role === "platform_admin"
          ? allStores
          : user.role === "owner"
            ? allStores.filter((s) => s.approved)
            : allStores.filter((s) => s.id === user.storeId);
      const ownerOffers =
        user.role === "owner"
          ? await effectiveOffers(sql, shanghaiDay(), allOffers)
          : [];
      const offers =
        user.role === "owner"
          ? ownerOffers.filter((o) => stores.some((s) => s.id === o.storeId))
          : allOffers.filter(
              (o) =>
                user.role === "platform_admin" || o.storeId === user.storeId,
            );
      const slots = allSlots.filter((s) =>
        user.role === "owner"
          ? stores.some((store) => store.id === s.storeId)
          : user.role === "platform_admin"
            ? false
            : s.storeId === user.storeId,
      );
      const serviceRecords = (await list<ServiceRecord>(sql, "records")).filter(
        (r) =>
          user.role === "owner"
            ? vehicles.some((v) => v.id === r.vehicleId)
            : appointments.some((a) => a.id === r.appointmentId),
      );
      const maintenance =
        user.role === "owner"
          ? vehicles.flatMap((v) =>
              maintenanceFor(
                v,
                projects,
                rules,
                serviceRecords,
                new Date(),
                models.find((m) => m.id === v.modelId),
              ),
            )
          : [];
      if (user.role === "owner")
        await saveMaintenanceMessages(sql, user.id, maintenance);
      const result: Bootstrap = {
        user,
        config: publicConfig(),
        models,
        projects,
        rules,
        stores,
        offers,
        slots,
        vehicles,
        appointments,
        faults,
        maintenance,
        serviceRecords,
        changes: (await list<ServiceChange>(sql, "changes")).filter((c) =>
          appointments.some((a) => a.id === c.appointmentId),
        ),
        messages: (await list<Notice>(sql, "messages"))
          .filter((m) => m.userId === user.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        imports:
          user.role === "owner"
            ? (await list<ImportJob>(sql, "imports")).filter(
                (j) => j.ownerId === user.id,
              )
            : [],
        observations:
          user.role === "owner"
            ? (await list<Observation>(sql, "observations")).filter((o) =>
                vehicles.some((v) => v.id === o.vehicleId),
              )
            : [],
        users:
          user.role === "owner"
            ? []
            : (await list<StoredUser>(sql, "users"))
                .filter(
                  (u) =>
                    u.active &&
                    (user.role === "platform_admin" ||
                      u.storeId === user.storeId),
                )
                .map(publicUser),
        logs: user.role === "platform_admin" ? await list(sql, "logs") : [],
      };
      return result;
    });
  });
  const vehicleSchema = z.object({
    modelId: z.string(),
    plate: z.string().trim().min(1).max(20),
    name: z.string().trim().min(1).max(100),
    startDate: z.string().date(),
    initialKm: z.number().int().min(0).max(2000000),
  });
  app.post(route("/vehicles"), async (request) => {
    const user = owner(request);
    const input = vehicleSchema.parse(request.body);
    const model = await get<CarModel>(db, "models", input.modelId);
    ensure(model, 400, "MODEL_NOT_FOUND", "车型不存在");
    ensure(
      input.startDate <= shanghaiDay(),
      400,
      "FUTURE_DATE",
      "启用日期不能在未来",
    );
    const vehicle: Vehicle = {
      ...input,
      id: id(),
      ownerId: user.id,
      totalKm: null,
      observedAt: null,
      isDemo: model.isDemo,
    };
    return db.transaction(async sql => {
      await get(sql, "users", user.id, true);
      await ensureUniqueOwnerPlate(sql, user.id, input.plate);
      await put(sql, "vehicles", vehicle);
      await audit(sql, user.id, "vehicle.created", "vehicle", vehicle.id, "创建车辆档案，等待图片里程确认");
      return vehicle;
    });
  });
  app.patch<{ Params: { id: string } }>(
    route("/vehicles/:id"),
    async (request) => {
      const user = owner(request);
      const input = vehicleSchema.partial().parse(request.body);
      return db.transaction(async (sql) => {
        await get(sql, "users", user.id, true);
        const old = await ownVehicle<Vehicle>(
          sql,
          request.params.id,
          user,
          true,
        );
        ensure(
          input.modelId === undefined || input.modelId === old.modelId,
          400,
          "MODEL_IMMUTABLE",
          "已建档车辆不能直接替换车型，请新建档案",
        );
        ensure(
          input.initialKm === undefined || input.initialKm === old.initialKm,
          400,
          "BASELINE_IMMUTABLE",
          "初始里程不能静默改写",
        );
        ensure(
          !input.startDate || input.startDate <= shanghaiDay(),
          400,
          "FUTURE_DATE",
          "启用日期不能在未来",
        );
        const updated = { ...old, ...input };
        await ensureUniqueOwnerPlate(sql, user.id, updated.plate, old.id);
        await put(sql, "vehicles", updated);
        await audit(
          sql,
          user.id,
          "vehicle.updated",
          "vehicle",
          old.id,
          "更新车辆资料",
        );
        return updated;
      });
    },
  );
  app.get<{ Params: { id: string } }>(
    route("/vehicles/:id/history"),
    async (request) => {
      const user = owner(request);
      await ownVehicle<Vehicle>(db, request.params.id, user);
      return {
        observations: (await list<Observation>(db, "observations")).filter(
          (o) => o.vehicleId === request.params.id,
        ),
        records: (await list<ServiceRecord>(db, "records")).filter(
          (r) => r.vehicleId === request.params.id,
        ),
      };
    },
  );
  app.post(route("/faults"), async (request) => {
    const user = owner(request);
    const input = z
      .object({
        vehicleId: z.string(),
        storeId: z.string(),
        title: z.string().trim().min(1).max(120),
        description: z.string().trim().min(1).max(6000),
        conditions: z.string().max(2000).default(""),
        occurredAt: z.string().datetime({ offset: true }),
        imageUrls: z.array(z.string()).max(4).default([]),
      })
      .parse(request.body);
    await ownVehicle<Vehicle>(db, input.vehicleId, user);
    const store = await get<Store>(db, "stores", input.storeId);
    ensure(store?.approved, 400, "STORE_UNAVAILABLE", "请选择已审核的入驻门店");
    ensure(
      Date.parse(input.occurredAt) <= Date.now() + 60000,
      400,
      "FUTURE_DATE",
      "故障发生时间不能在未来",
    );
    for (const url of input.imageUrls) {
      ensure(
        /^\/api\/v1\/files\/[\w-]+$/.test(url),
        400,
        "INVALID_IMAGE",
        "故障照片必须先上传",
      );
      const file = await get<{ ownerId: string; purpose?: string }>(
        db,
        "files",
        url.split("/").pop()!,
      );
      ensure(file?.ownerId === user.id, 403, "FORBIDDEN", "不能使用他人的图片");
      ensure(file.purpose !== "registration" && file.purpose !== "manual", 400, "PRIVATE_DOCUMENT", "行驶证与保养手册不能用作向门店共享的故障照片");
    }
    const fault: Fault = {
      ...input,
      id: id(),
      ownerId: user.id,
      assignedExpertId: null,
      status: "pending",
      reply: "",
      estimateLowCents: null,
      estimateHighCents: null,
      diagnosisCents: null,
      uncertainty: "",
      confirmed: false,
      createdAt: now(),
    };
    await put(db, "faults", fault);
    await audit(
      db,
      user.id,
      "fault.created",
      "fault",
      fault.id,
      "提交故障报修",
    );
    return fault;
  });
  app.post<{ Params: { id: string } }>(
    route("/faults/:id/reply"),
    async (request) => {
      const user = roles(request, ["store_admin", "expert"]);
      const input = z
        .object({
          reply: z.string().trim().min(1).max(6000),
          status: z.enum(["need_info", "replied"]).default("replied"),
          estimateLowCents: z.number().int().min(0).nullable().default(null),
          estimateHighCents: z.number().int().min(0).nullable().default(null),
          diagnosisCents: z.number().int().min(0).nullable().default(null),
          uncertainty: z.string().max(4000).default(""),
          assignedExpertId: z.string().optional(),
        })
        .parse(request.body);
      return db.transaction(async (sql) => {
        const fault = await get<Fault>(sql, "faults", request.params.id, true);
        ensure(fault, 404, "NOT_FOUND", "故障单不存在");
        sameStore(user, fault.storeId);
        if (user.role === "expert")
          ensure(
            fault.assignedExpertId === user.id,
            403,
            "FORBIDDEN",
            "仅能回复分配给本人的故障单",
          );
        ensure(
          !["booked", "closed"].includes(fault.status),
          409,
          "INVALID_STATE",
          "故障单已关联预约或已关闭",
        );
        ensure(
          input.estimateLowCents === null ||
            input.estimateHighCents === null ||
            input.estimateLowCents <= input.estimateHighCents,
          400,
          "INVALID_ESTIMATE",
          "预估区间上限不能低于下限",
        );
        if (
          input.status === "replied" &&
          (input.estimateLowCents !== null || input.estimateHighCents !== null)
        )
          ensure(
            !!input.uncertainty.trim(),
            400,
            "UNCERTAINTY_REQUIRED",
            "请说明估价的不确定因素",
          );
        const updated: Fault = {
          ...fault,
          ...input,
          assignedExpertId: fault.assignedExpertId,
          confirmed: false,
        };
        await put(sql, "faults", updated);
        await notify(
          sql,
          fault.ownerId,
          input.status === "need_info"
            ? "专家需要补充故障信息"
            : "专家已回复故障咨询",
          "请查看建议、分项预估及不确定因素。预估金额不是确定总价。",
          "fault",
          "/repair",
        );
        await audit(
          sql,
          user.id,
          "fault.replied",
          "fault",
          fault.id,
          input.status,
        );
        return updated;
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    route("/faults/:id/confirm"),
    async (request) => {
      const user = owner(request);
      return db.transaction(async (sql) => {
        const fault = await get<Fault>(sql, "faults", request.params.id, true);
        ensure(
          fault?.ownerId === user.id,
          403,
          "FORBIDDEN",
          "不能确认他人的故障单",
        );
        ensure(
          fault.status === "replied",
          409,
          "INVALID_STATE",
          "请等待专家回复后再确认",
        );
        const updated = { ...fault, confirmed: true };
        await put(sql, "faults", updated);
        await audit(
          sql,
          user.id,
          "fault.scope.confirmed",
          "fault",
          fault.id,
          "车主确认建议范围，预估不视为固定报价",
        );
        return updated;
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    route("/faults/:id/supplement"),
    async (request) => {
      const user = owner(request);
      const input = z
        .object({ description: z.string().trim().min(1).max(4000) })
        .parse(request.body);
      return db.transaction(async (sql) => {
        const fault = await get<Fault>(sql, "faults", request.params.id, true);
        ensure(
          fault?.ownerId === user.id,
          403,
          "FORBIDDEN",
          "不能补充他人的故障单",
        );
        ensure(
          !["booked", "closed"].includes(fault.status),
          409,
          "INVALID_STATE",
          "该故障单已不可补充",
        );
        const updated: Fault = {
          ...fault,
          description: `${fault.description}\n\n【车主补充 ${now()}】\n${input.description}`,
          status: "pending",
          confirmed: false,
        };
        await put(sql, "faults", updated);
        return updated;
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    route("/messages/:id/read"),
    async (request) => {
      const user = authenticated(request);
      const message = await get<Notice>(db, "messages", request.params.id);
      ensure(
        message?.userId === user.id,
        403,
        "FORBIDDEN",
        "不能操作他人的消息",
      );
      const updated = { ...message, readAt: message.readAt || now() };
      await put(db, "messages", updated);
      return updated;
    },
  );
  app.post(route("/messages/read-all"), async (request) => {
    const user = authenticated(request);
    for (const message of (await list<Notice>(db, "messages")).filter(
      (m) => m.userId === user.id && !m.readAt,
    ))
      await put(db, "messages", { ...message, readAt: now() });
    return { ok: true };
  });
  registerBookings({ app, db, config });
  registerAdmin({ app, db, config });
  registerCatalog({ app, db, config });
  const images = registerImages({ app, db, config });
  const registrations = registerRegistration({ app, db, config });
  registerManualFiles({ app, db, config });
  const manuals = registerManuals({ app, db, config });
  await images.resume();
  await registrations.resume();
  await manuals.resume();
  const timer = setInterval(() => {
    void db
      .transaction(async (sql) => {
        await expireAppointments(sql);
        await recalculateMaintenance(sql);
        await sql.query("DELETE FROM av_sessions WHERE expires_at<NOW()");
      })
      .catch(() => {});
  }, 60000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await images.wait();
    await registrations.wait();
    await manuals.wait();
    await db.close();
  });
  return { app, db, config };
}
