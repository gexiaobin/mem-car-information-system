import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { CarModel, RegistrationFields, RegistrationImport, Vehicle } from "@autovoyage/shared";
import type { Context } from "./context.js";
import { owner, ownVehicle, route } from "./context.js";
import { get, list, put } from "./db.js";
import { AppError, audit, ensure, id, now, sha256, shanghaiDay } from "./domain.js";
import { discardNewFile, receiveImage, type ImageFile } from "./images.js";
import { recognizeRegistration } from "./vision.js";
import { ensureUniqueOwnerPlate, normalizePlate } from "./vehicle-identity.js";

interface StoredRegistration extends RegistrationImport {
  fileId: string;
  imageHash: string;
  attempts: number;
  targetVehicleId: string | null;
  confirmationHash?: string;
}
const emptyFields = (): RegistrationFields => ({ plate: null, vehicleType: null, ownerName: null, useNature: null, brandModel: null, vin: null, engineNumber: null, registerDate: null, issueDate: null });
function publicRegistration(job: StoredRegistration): RegistrationImport {
  const { fileId: _, imageHash: __, attempts: ___, targetVehicleId: ____, confirmationHash: _____, ...result } = job;
  return result;
}
const optionalText = z.string().trim().min(1).max(100).nullable();
const date = z.string().date().refine(value => value <= shanghaiDay(), "日期不能在未来");
const confirmationSchema = z.object({
  fields: z.object({
    plate: z.string().trim().min(1).max(20).transform(normalizePlate),
    vehicleType: optionalText,
    ownerName: optionalText,
    useNature: optionalText,
    brandModel: z.string().trim().min(1).max(100),
    vin: z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VIN应为17位字母数字，且不含I、O、Q").nullable(),
    engineNumber: optionalText,
    registerDate: date.nullable(),
    issueDate: date.nullable(),
  }).strict().refine(fields => !fields.registerDate || !fields.issueDate || fields.issueDate >= fields.registerDate, "发证日期不能早于注册日期"),
  vehicle: z.object({
    modelId: z.string().min(1), name: z.string().trim().min(1).max(100),
    startDate: date, initialKm: z.number().int().min(0).max(2000000),
  }).strict().optional(),
}).strict();

export function registerRegistration(ctx: Context) {
  const { app, db, config } = ctx;
  const running = new Set<string>();
  const configured = () => !!(config.aiKey && config.aiBaseUrl && config.aiModel);
  async function process(jobId: string) {
    if (running.has(jobId)) return;
    running.add(jobId);
    try {
      let job = await get<StoredRegistration>(db, "registration_imports", jobId);
      if (!job || !["uploaded", "processing"].includes(job.status)) return;
      if (!configured()) {
        await put(db, "registration_imports", { ...job, status: "failed", reason: "尚未配置图片识别服务，请配置后重试。" });
        return;
      }
      job = { ...job, status: "processing", attempts: job.attempts + 1, model: config.aiModel };
      await put(db, "registration_imports", job);
      try {
        const file = await get<ImageFile>(db, "files", job.fileId);
        ensure(file?.purpose === "registration" && file.ownerId === job.ownerId, 404, "FILE_NOT_FOUND", "行驶证图片不存在");
        const candidate = await recognizeRegistration(config, await readFile(file.path));
        await put(db, "registration_imports", { ...job, candidate, status: "awaiting_confirmation", reason: "请逐项对照原图核对，确认前不会创建或修改车辆档案。" });
      } catch (error) {
        const reason = error instanceof AppError
          ? error.message
          : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
            ? "识别超时，请稍后重试。"
            : "未能识别行驶证信息，请重新上传清晰的行驶证正页。";
        await put(db, "registration_imports", { ...job, status: "failed", reason });
      }
    } finally { running.delete(jobId); }
  }

  app.post(route("/registration-imports"), async request => {
    const user = owner(request);
    const { file, fields, url } = await receiveImage(request, ctx, "registration");
    let created = false;
    try {
      ensure(fields.consent === "true", 400, "RECOGNITION_CONSENT_REQUIRED", "请先确认使用已配置的AI服务识别行驶证信息");
      const targetVehicleId = fields.vehicleId || null;
      if (targetVehicleId) await ownVehicle<Vehicle>(db, targetVehicleId, user);
      const job = await db.transaction(async sql => {
        // One owner lock serializes deduplication and vehicle identity operations.
        await get(sql, "users", user.id, true);
        const existing = (await list<StoredRegistration>(sql, "registration_imports")).find(item => item.ownerId === user.id && item.imageHash === file.hash && item.targetVehicleId === targetVehicleId);
        if (existing) return existing;
        const value: StoredRegistration = {
          id: id(), ownerId: user.id, vehicleId: targetVehicleId, targetVehicleId,
          imageUrl: url, status: configured() ? "uploaded" : "failed",
          candidate: emptyFields(), confirmedFields: null,
          reason: configured() ? "行驶证已上传，等待识别。" : "尚未配置图片识别服务，请配置后重试。",
          createdAt: now(), confirmedAt: null, model: config.aiModel,
          fileId: file.id, imageHash: file.hash, attempts: 0,
        };
        await put(sql, "registration_imports", value);
        await audit(sql, user.id, "registration.uploaded", "registration", value.id, "上传本人行驶证待核对；未修改车辆档案");
        created = true;
        return value;
      });
      if (!created) await discardNewFile(file, ctx);
      else if (job.status === "uploaded") void process(job.id);
      return publicRegistration(job);
    } catch (error) {
      if (!created) await discardNewFile(file, ctx).catch(() => {});
      throw error;
    }
  });
  app.get(route("/registration-imports"), async request => {
    const user = owner(request);
    return (await list<StoredRegistration>(db, "registration_imports"))
      .filter(job => job.ownerId === user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(publicRegistration);
  });
  app.get<{ Params: { id: string } }>(route("/registration-imports/:id"), async request => {
    const user = owner(request);
    const job = await get<StoredRegistration>(db, "registration_imports", request.params.id);
    ensure(job?.ownerId === user.id, 403, "FORBIDDEN", "无权访问该行驶证档案");
    return publicRegistration(job);
  });
  app.post<{ Params: { id: string } }>(route("/registration-imports/:id/retry"), async request => {
    const user = owner(request);
    const job = await db.transaction(async sql => {
      const old = await get<StoredRegistration>(sql, "registration_imports", request.params.id, true);
      ensure(old?.ownerId === user.id, 403, "FORBIDDEN", "无权重试该行驶证任务");
      ensure(old.status === "failed", 409, "INVALID_STATE", "当前行驶证任务不可重试");
      ensure(old.attempts < 3, 409, "RETRY_LIMIT", "该图片已达到重试上限，请重新上传清晰的行驶证");
      ensure(configured(), 503, "AI_NOT_CONFIGURED", "尚未配置图片识别服务");
      return put(sql, "registration_imports", { ...old, status: "uploaded" as const, reason: "等待重新识别" });
    });
    void process(job.id);
    return publicRegistration(job);
  });
  app.post<{ Params: { id: string } }>(route("/registration-imports/:id/confirm"), async request => {
    const user = owner(request);
    const input = confirmationSchema.parse(request.body);
    return db.transaction(async sql => {
      const job = await get<StoredRegistration>(sql, "registration_imports", request.params.id, true);
      ensure(job?.ownerId === user.id, 403, "FORBIDDEN", "无权确认该行驶证任务");
      const confirmationHash = sha256(JSON.stringify(input));
      if (job.status === "confirmed") {
        ensure(job.confirmationHash === confirmationHash, 409, "CONFIRMATION_CONFLICT", "该行驶证已确认，不能覆盖原确认内容");
        return publicRegistration(job);
      }
      ensure(job.status === "awaiting_confirmation", 409, "INVALID_STATE", "行驶证必须先识别成功并由车主核对");
      await get(sql, "users", user.id, true);
      let vehicleId = job.targetVehicleId;
      if (vehicleId) {
        ensure(!input.vehicle, 400, "EXISTING_VEHICLE", "行驶证关联现有车辆时不能改写车辆基准信息");
        const vehicle = await ownVehicle<Vehicle>(sql, vehicleId, user, true);
        ensure(normalizePlate(vehicle.plate) === input.fields.plate, 409, "REGISTRATION_PLATE_MISMATCH", "行驶证车牌与所选车辆不一致，请选择正确车辆或先修改车辆车牌");
      } else {
        ensure(input.vehicle, 400, "VEHICLE_REQUIRED", "请明确选择车型、车辆启用日期及启用里程");
        const model = await get<CarModel>(sql, "models", input.vehicle.modelId, true);
        ensure(model, 400, "MODEL_NOT_FOUND", "请选择已有的准确车型配置，不能由行驶证品牌型号推测保养规则");
        await ensureUniqueOwnerPlate(sql, user.id, input.fields.plate);
        vehicleId = id();
        const vehicle: Vehicle = { ...input.vehicle, id: vehicleId, ownerId: user.id, plate: input.fields.plate, totalKm: null, observedAt: null, isDemo: model.isDemo };
        await put(sql, "vehicles", vehicle);
        await audit(sql, user.id, "vehicle.created", "vehicle", vehicleId, "车主核对行驶证后选择车型并创建车辆档案");
      }
      const updated: StoredRegistration = {
        ...job, vehicleId, status: "confirmed", confirmedFields: input.fields,
        confirmedAt: now(), confirmationHash, reason: "已由车主核对确认，行驶证档案仅本人可见。",
      };
      await put(sql, "registration_imports", updated);
      await audit(sql, user.id, "registration.confirmed", "registration", job.id, "车主逐项核对后确认行驶证档案");
      return publicRegistration(updated);
    });
  });
  return {
    resume: async () => {
      for (const job of await list<StoredRegistration>(db, "registration_imports"))
        if (["uploaded", "processing"].includes(job.status)) {
          if (job.attempts >= 3) await put(db, "registration_imports", { ...job, status: "failed", reason: "识别重试上限已达到，请重新上传" });
          else void process(job.id);
        }
    },
    wait: async () => { while (running.size) await new Promise(resolve => setTimeout(resolve, 20)); },
  };
}
