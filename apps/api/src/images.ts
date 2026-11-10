import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { Fault, ImportJob, Vehicle } from "@autovoyage/shared";
import type { Context, Request } from "./context.js";
import { authenticated, owner, ownVehicle, route } from "./context.js";
import { get, list, put, remove } from "./db.js";
import { recognizeMileage } from "./vision.js";
import {
  audit,
  ensure,
  id,
  now,
  notify,
  sha256,
  recalculateMaintenance,
  validateMileageUpdate,
} from "./domain.js";
export interface ImageFile {
  id: string;
  ownerId: string;
  path: string;
  hash: string;
  mime: string;
  createdAt: string;
  purpose?: "registration" | "manual";
}
interface StoredImport extends ImportJob {
  fileId: string;
  imageHash: string;
  attempts: number;
  suppliedObservedAt: string | null;
}
export async function receiveImage(request: Request, ctx: Context, purpose?: "registration") {
  const user = owner(request);
  let buffer: Buffer | undefined;
  const fields: Record<string, string> = {};
  for await (const part of request.parts()) {
    if (part.type === "file") {
      ensure(!buffer, 400, "ONE_IMAGE", "每次只能上传一张图片");
      ensure(
        ["image/jpeg", "image/png", "image/webp"].includes(part.mimetype),
        400,
        "IMAGE_FORMAT",
        "仅支持 JPEG、PNG、WebP 图片",
      );
      buffer = await part.toBuffer();
    } else fields[part.fieldname] = String(part.value);
  }
  ensure(buffer?.length, 400, "IMAGE_REQUIRED", "请选择图片");
  ensure(
    buffer.length <= 8 * 1024 * 1024,
    413,
    "IMAGE_TOO_LARGE",
    "图片不能超过8MB",
  );
  let normalized: Buffer;
  try {
    const image = sharp(buffer, {
      limitInputPixels: 40_000_000,
      animated: false,
    });
    const meta = await image.metadata();
    ensure(
      ["jpeg", "png", "webp"].includes(meta.format || ""),
      400,
      "IMAGE_FORMAT",
      "图片格式与内容不一致",
    );
    normalized = await image
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch (error) {
    if (error instanceof Error && "status" in error) throw error;
    throw new Error("IMAGE_DECODE");
  }
  const hash = sha256(buffer);
  const fileId = id();
  await mkdir(ctx.config.uploadDir, { recursive: true });
  const path = join(ctx.config.uploadDir, `${fileId}.jpg`);
  await writeFile(path, normalized, { flag: "wx" });
  const file: ImageFile = {
    id: fileId,
    ownerId: user.id,
    path,
    hash,
    mime: "image/jpeg",
    createdAt: now(),
    ...(purpose ? { purpose } : {}),
  };
  try {
    await put(ctx.db, "files", file);
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  }
  return { file, fields, url: `/api/v1/files/${fileId}` };
}
export async function discardNewFile(file: ImageFile, ctx: Context) {
  await remove(ctx.db, "files", file.id);
  await unlink(file.path).catch(() => {});
}
export function registerImages(ctx: Context) {
  const { app, db, config } = ctx;
  const running = new Set<string>();
  async function processImport(importId: string): Promise<void> {
    if (running.has(importId)) return;
    running.add(importId);
    try {
      let job = await get<StoredImport>(db, "imports", importId);
      if (!job || !["uploaded", "processing"].includes(job.status)) return;
      if (!config.aiKey || !config.aiBaseUrl || !config.aiModel) {
        await put(db, "imports", {
          ...job,
          status: "failed",
          reason:
            "图片已安全保存；尚未配置 AI 识别服务，请联系管理员配置后重试。",
        });
        return;
      }
      job = {
        ...job,
        status: "processing",
        attempts: job.attempts + 1,
        model: config.aiModel,
      };
      await put(db, "imports", job);
      try {
        const file = await get<ImageFile>(db, "files", job.fileId);
        ensure(file, 404, "FILE_NOT_FOUND", "原图不存在");
        const bytes = await readFile(file.path);
        const parsed = await recognizeMileage(config, bytes);
        const updated: StoredImport = {
          ...job,
          status: "awaiting_confirmation",
          candidate: parsed,
          reason: "识别结果尚未入库，请逐项核对原图、单位与数据时间后确认。",
        };
        await put(db, "imports", updated);
        await notify(
          db,
          job.ownerId,
          "图片识别待核对",
          "请对照原图确认里程、单位及数据时间，确认前不参与保养计算。",
          "import",
          "/",
        );
      } catch (error) {
        const reason =
          error instanceof Error && "code" in error
            ? error.message
            : error instanceof z.ZodError
              ? "识别返回字段结构异常，请重试或重新上传。"
              : error instanceof Error &&
                  ["TimeoutError", "AbortError"].includes(error.name)
                ? "识别超时，请稍后重试。"
                : "图片识别失败，请重试或重新上传。";
        await put(db, "imports", { ...job, status: "failed", reason });
      }
    } finally {
      running.delete(importId);
    }
  }
  app.post(route("/files"), async (request) => {
    const result = await receiveImage(request, ctx);
    return { id: result.file.id, url: result.url };
  });
  app.get<{ Params: { id: string } }>(
    route("/files/:id"),
    async (request, reply) => {
      const user = authenticated(request);
      const file = await get<ImageFile>(db, "files", request.params.id);
      ensure(file, 404, "NOT_FOUND", "图片不存在");
      ensure(file.purpose !== 'manual', 403, 'FORBIDDEN', '手册文件须通过受控手册入口访问');
      let allowed = file.ownerId === user.id;
      if (!allowed && file.purpose !== "registration" && (user.role === "store_admin" || user.role === "expert")) {
        const faults = await list<Fault>(db, "faults");
        allowed = faults.some(
          (f) =>
            f.storeId === user.storeId &&
            (user.role === "store_admin" || f.assignedExpertId === user.id) &&
            f.imageUrls.includes(`/api/v1/files/${file.id}`),
        );
      }
      ensure(allowed, 403, "FORBIDDEN", "无权访问该图片");
      reply
        .header("Cache-Control", "no-store")
        .header("Content-Type", file.mime)
        .header("X-Content-Type-Options", "nosniff");
      return readFile(file.path);
    },
  );
  app.post<{ Params: { id: string } }>(
    route("/vehicles/:id/imports"),
    async (request) => {
      const user = owner(request);
      await ownVehicle<Vehicle>(db, request.params.id, user);
      const { file, fields, url } = await receiveImage(request, ctx);
      let created = false;
      try {
        const imageType = z
          .enum(["dashboard", "app"])
          .parse(fields.imageType || "dashboard");
        if (fields.observedAt)
          ensure(
            Number.isFinite(Date.parse(fields.observedAt)) &&
              Date.parse(fields.observedAt) <= Date.now() + 60000,
            400,
            "INVALID_DATE",
            "数据时间无效或在未来",
          );
        const job = await db.transaction(async (sql) => {
          await ownVehicle<Vehicle>(sql, request.params.id, user, true);
          // Locking the car plus the unique digest index prevents simultaneous paid recognition of one image.
          for (const existing of await list<StoredImport>(sql, "imports"))
            if (
              existing.ownerId === user.id &&
              existing.vehicleId === request.params.id
            ) {
              const oldFile = await get<ImageFile>(
                sql,
                "files",
                existing.fileId,
              );
              if (
                existing.imageHash === file.hash ||
                oldFile?.hash === file.hash
              )
                return existing;
            }
          const value: StoredImport = {
            id: id(),
            ownerId: user.id,
            vehicleId: request.params.id,
            imageUrl: url,
            imageType,
            status:
              config.aiKey && config.aiBaseUrl && config.aiModel
                ? "uploaded"
                : "failed",
            candidate: { totalKm: null, unit: null, observedAt: null },
            reason:
              config.aiKey && config.aiBaseUrl && config.aiModel
                ? "图片已上传，等待识别。"
                : "图片已安全保存；尚未配置 AI 识别服务，请联系管理员配置后重试。",
            createdAt: now(),
            model: config.aiModel,
            fileId: file.id,
            imageHash: file.hash,
            attempts: 0,
            suppliedObservedAt: fields.observedAt || null,
          };
          await put(sql, "imports", value);
          await audit(
            sql,
            user.id,
            "image.uploaded",
            "import",
            value.id,
            "上传本人车辆图片",
          );
          created = true;
          return value;
        });
        if (!created) await discardNewFile(file, ctx);
        else if (job.status === "uploaded") void processImport(job.id);
        return job;
      } catch (error) {
        if (!created) await discardNewFile(file, ctx).catch(() => {});
        throw error;
      }
    },
  );
  app.get<{ Params: { id: string } }>(
    route("/imports/:id"),
    async (request) => {
      const user = owner(request);
      const job = await get<ImportJob>(db, "imports", request.params.id);
      ensure(job, 404, "NOT_FOUND", "识别任务不存在");
      ensure(job.ownerId === user.id, 403, "FORBIDDEN", "无权访问该识别任务");
      return job;
    },
  );
  app.post<{ Params: { id: string } }>(
    route("/imports/:id/retry"),
    async (request) => {
      const user = owner(request);
      const job = await get<StoredImport>(db, "imports", request.params.id);
      ensure(job?.ownerId === user.id, 403, "FORBIDDEN", "无权重试该任务");
      ensure(
        ["failed", "review"].includes(job.status),
        409,
        "INVALID_STATE",
        "当前识别任务不可重试",
      );
      ensure(
        job.attempts < 3,
        409,
        "RETRY_LIMIT",
        "该图片已达到重试上限，请重新上传更清晰的图片",
      );
      ensure(
        config.aiBaseUrl && config.aiKey && config.aiModel,
        503,
        "AI_NOT_CONFIGURED",
        "尚未配置 AI 识别服务，请联系管理员",
      );
      const updated: StoredImport = {
        ...job,
        status: "uploaded",
        reason: "等待重新识别",
      };
      await put(db, "imports", updated);
      void processImport(job.id);
      return updated;
    },
  );
  app.post<{ Params: { id: string } }>(
    route("/imports/:id/confirm"),
    async (request) => {
      const user = owner(request);
      const input = z
        .object({
          totalKm: z.number().finite().min(0).max(2000000),
          unit: z.enum(["km", "mi"]),
          observedAt: z.string().datetime({ offset: true }),
          engineKm: z.number().finite().min(0).max(2000000).optional(),
        })
        .parse(request.body);
      return db.transaction(async (sql) => {
        const job = await get<StoredImport & { confirmationHash?: string }>(
          sql,
          "imports",
          request.params.id,
          true,
        );
        ensure(job?.ownerId === user.id, 403, "FORBIDDEN", "无权确认该任务");
        const confirmationHash = sha256(JSON.stringify(input));
        if (job.status === "confirmed") {
          ensure(
            job.confirmationHash === confirmationHash,
            409,
            "CONFIRMATION_CONFLICT",
            "该图片已确认，不能改写原确认内容",
          );
          return job;
        }
        ensure(
          ["awaiting_confirmation", "review"].includes(job.status),
          409,
          "INVALID_STATE",
          "图片必须先成功识别并核对后才能入库",
        );
        const vehicle = await ownVehicle<Vehicle>(
          sql,
          job.vehicleId,
          user,
          true,
        );
        const totalKm = Math.round(
          input.totalKm * (input.unit === "mi" ? 1.609344 : 1),
        );
        validateMileageUpdate(vehicle, totalKm, input.observedAt, "image");
        await put(sql, "observations", {
          id: id(),
          vehicleId: vehicle.id,
          importId: job.id,
          totalKm,
          engineKm: input.engineKm ?? null,
          observedAt: input.observedAt,
          confirmedAt: now(),
          source: "图片AI识别／车主核对确认",
          originalUnit: input.unit,
          originalValue: input.totalKm,
        });
        await put(sql, "vehicles", {
          ...vehicle,
          totalKm,
          observedAt: input.observedAt,
        });
        const updated: StoredImport & { confirmationHash: string } = {
          ...job,
          confirmationHash,
          status: "confirmed",
          candidate: {
            ...job.candidate,
            totalKm: input.totalKm,
            unit: input.unit,
            observedAt: input.observedAt,
            ...(input.engineKm === undefined
              ? {}
              : { engineKm: input.engineKm }),
          },
          reason: "已由车主核对确认并形成有效里程记录",
        };
        await put(sql, "imports", updated);
        await recalculateMaintenance(sql, user.id);
        await audit(
          sql,
          user.id,
          "import.confirmed",
          "import",
          job.id,
          `确认里程 ${totalKm} km`,
        );
        await notify(
          sql,
          user.id,
          "车辆里程已更新",
          "图片核对结果已入库，保养计划已按项目重新计算。",
          "import",
          "/",
        );
        return updated;
      });
    },
  );
  return {
    resume: async () => {
      for (const job of await list<StoredImport>(db, "imports"))
        if (["uploaded", "processing"].includes(job.status)) {
          if (job.attempts >= 3)
            await put(db, "imports", {
              ...job,
              status: "failed",
              reason: "识别重试上限已达到，请重新上传",
            });
          else void processImport(job.id);
        }
    },
    wait: async () => {
      while (running.size)
        await new Promise((resolve) => setTimeout(resolve, 20));
    },
  };
}
