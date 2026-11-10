import { z } from "zod";
import type {
  Appointment,
  BookingInput,
  Fault,
  Offer,
  PriceSnapshot,
  Project,
  ServiceChange,
  Slot,
  User,
  Vehicle,
} from "@autovoyage/shared";
import type { Context } from "./context.js";
import {
  authenticated,
  owner,
  roles,
  ownVehicle,
  route,
  sameStore,
} from "./context.js";
import type { Sql } from "./db.js";
import { get, list, put } from "./db.js";
import { effectiveOffers } from "./prices.js";
import {
  audit,
  ensure,
  id,
  notify,
  now,
  shanghaiDay,
  recalculateMaintenance,
} from "./domain.js";
const activeStates = ["pending", "confirmed", "in_service", "awaiting_owner"];
const bookingSchema = z.object({
  vehicleId: z.string().min(1),
  offerIds: z.array(z.string()).min(1).max(12),
  slotId: z.string(),
  expectedVersions: z.record(z.string(), z.number().int().positive()),
  requestId: z.string().min(8).max(120),
  faultId: z.string().optional(),
  customItems: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
});
const actionSchema = z.object({
  action: z.enum([
    "confirm",
    "reject",
    "cancel",
    "start",
    "finish",
    "complete",
    "dispute",
  ]),
  reason: z.string().max(2000).optional(),
  completedProjectIds: z.array(z.string()).optional(),
  serviceKm: z.number().int().min(0).max(2000000).optional(),
});
interface StoredAppointment extends Appointment {
  requestHash: string;
}
const canonical = (input: BookingInput) =>
  JSON.stringify({
    vehicleId: input.vehicleId,
    slotId: input.slotId,
    offerIds: [...input.offerIds].sort(),
    expectedVersions: Object.fromEntries(
      Object.entries(input.expectedVersions).sort(),
    ),
    faultId: input.faultId || null,
    customItems: [...(input.customItems || [])].sort(),
  });
async function canAccess(
  sql: Sql,
  user: User,
  appointment: Appointment,
  write = false,
) {
  if (user.role === "owner") {
    ensure(
      appointment.ownerId === user.id,
      403,
      "FORBIDDEN",
      "不能访问他人的预约",
    );
    return;
  }
  sameStore(user, appointment.storeId);
  if (user.role === "expert") {
    const fault = appointment.faultId
      ? await get<Fault>(sql, "faults", appointment.faultId)
      : undefined;
    ensure(
      fault?.assignedExpertId === user.id,
      403,
      "FORBIDDEN",
      "仅能处理分配给本人的工单",
    );
  }
}
async function restoreFault(sql: Sql, appointment: Appointment) {
  if (!appointment.faultId) return;
  const fault = await get<Fault>(sql, "faults", appointment.faultId, true);
  if (
    fault?.status === "booked" &&
    !(await list<Appointment>(sql, "appointments")).some(
      (a) =>
        a.id !== appointment.id &&
        a.faultId === fault.id &&
        activeStates.includes(a.status),
    )
  )
    await put(sql, "faults", { ...fault, status: "replied" });
}
export async function expireAppointments(sql: Sql) {
  const appointments = await list<StoredAppointment>(sql, "appointments");
  for (const a of appointments.filter(
    (a) => a.status === "pending" && a.expiresAt < now(),
  )) {
    const locked = await get<StoredAppointment>(
      sql,
      "appointments",
      a.id,
      true,
    );
    if (!locked || locked.status !== "pending" || locked.expiresAt >= now())
      continue;
    const slot = await get<Slot>(sql, "slots", a.slotId, true);
    if (slot)
      await put(sql, "slots", {
        ...slot,
        reserved: Math.max(0, slot.reserved - 1),
      });
    await put(sql, "appointments", {
      ...locked,
      status: "expired",
      reason: "门店未在有效期内确认",
      updatedAt: now(),
    });
    await restoreFault(sql, locked);
    await notify(
      sql,
      a.ownerId,
      "预约已超时关闭",
      "门店未及时确认，本次预约名额已释放。",
      "appointment",
      "/my",
    );
    await audit(
      sql,
      "system",
      "appointment.expired",
      "appointment",
      a.id,
      "超时关闭并释放一次名额",
    );
  }
}
export function registerBookings({ app, db }: Context) {
  app.post(route("/appointments"), async (request) => {
    const user = owner(request);
    const input = bookingSchema.parse(request.body);
    const requestHash = canonical(input);
    return db.transaction(async (sql) => {
      // Vehicle locking serializes repeat requests and overlapping appointments for the same car.
      const vehicle = await ownVehicle<Vehicle>(
        sql,
        input.vehicleId,
        user,
        true,
      );
      const prior = (await list<StoredAppointment>(sql, "appointments")).find(
        (a) => a.ownerId === user.id && a.requestId === input.requestId,
      );
      if (prior) {
        ensure(
          prior.requestHash === requestHash,
          409,
          "IDEMPOTENCY_CONFLICT",
          "相同请求标识不能用于不同的预约内容",
        );
        return prior;
      }
      await expireAppointments(sql);
      ensure(
        new Set(input.offerIds).size === input.offerIds.length,
        400,
        "DUPLICATE_OFFER",
        "服务项目不能重复",
      );
      ensure(
        new Set(input.customItems).size === input.customItems.length,
        400,
        "DUPLICATE_CUSTOM_ITEM",
        "补充项目不能重复",
      );
      const headers: Offer[] = [];
      for (const offerId of [...input.offerIds].sort()) {
        const offer = await get<Offer>(sql, "offers", offerId, true);
        ensure(offer, 404, "NOT_FOUND", "服务不存在");
        headers.push(offer);
      }
      const storeId = headers[0].storeId;
      const store = await get<{ approved: boolean }>(sql, "stores", storeId);
      ensure(store?.approved, 409, "STORE_UNAVAILABLE", "门店尚未审核或已暂停");
      const slot = await get<Slot>(sql, "slots", input.slotId, true);
      ensure(
        slot && slot.storeId === storeId,
        400,
        "SLOT_MISMATCH",
        "预约时段与门店不匹配",
      );
      ensure(
        slot.active && new Date(slot.startsAt) > new Date(),
        409,
        "SLOT_CLOSED",
        "时段已关闭或已过期",
      );
      ensure(
        slot.reserved < slot.capacity,
        409,
        "SLOT_FULL",
        "该时段已约满，请选择其他时段",
      );
      const serviceDate = shanghaiDay(new Date(slot.startsAt));
      const offers = await effectiveOffers(sql, serviceDate, headers);
      ensure(
        offers.length === headers.length,
        409,
        "PRICE_EXPIRED",
        "服务已下架或服务日没有有效报价，请重新选择",
      );
      for (const offer of offers) {
        ensure(
          offer.active &&
            offer.storeId === storeId &&
            offer.modelId === vehicle.modelId,
          409,
          "OFFER_UNAVAILABLE",
          "服务已下架或不适配当前车型",
        );
        ensure(
          offer.version === input.expectedVersions[offer.id],
          409,
          "PRICE_CHANGED",
          "价格版本已更新，请重新核对报价",
        );
        ensure(
          offer.validFrom <= serviceDate && offer.validTo >= serviceDate,
          409,
          "PRICE_EXPIRED",
          "服务日不在报价有效期内",
        );
        ensure(
          offer.priceType === "fixed" && offer.totalCents !== null,
          409,
          "QUOTE_REQUIRED",
          "此服务需先由门店确认固定报价",
        );
        ensure(
          offer.totalCents ===
            offer.materialCents + offer.laborCents + offer.otherCents,
          409,
          "PRICE_INVALID",
          "门店报价明细不一致，请联系门店",
        );
      }
      ensure(
        new Set(offers.map((o) => o.projectId)).size === offers.length,
        400,
        "DUPLICATE_PROJECT",
        "同一保养项目不能重复预约",
      );
      const all = await list<Appointment>(sql, "appointments");
      for (const a of all.filter(
        (a) => a.vehicleId === vehicle.id && activeStates.includes(a.status),
      )) {
        const other = await get<Slot>(sql, "slots", a.slotId);
        ensure(
          !other ||
            Date.parse(other.endsAt) <= Date.parse(slot.startsAt) ||
            Date.parse(other.startsAt) >= Date.parse(slot.endsAt),
          409,
          "VEHICLE_TIME_CONFLICT",
          "该车辆在此时段已有预约",
        );
      }
      if (input.faultId) {
        const fault = await get<Fault>(sql, "faults", input.faultId, true);
        ensure(
          fault?.ownerId === user.id &&
            fault.vehicleId === vehicle.id &&
            fault.storeId === storeId,
          403,
          "FORBIDDEN",
          "故障单与当前预约不匹配",
        );
        ensure(
          fault.confirmed && fault.status === "replied",
          409,
          "FAULT_NOT_CONFIRMED",
          "请先确认门店答复与服务范围",
        );
        const projects = await list<Project>(sql, "projects");
        ensure(
          offers.every(
            (o) =>
              projects.find((p) => p.id === o.projectId)?.category ===
              "diagnosis",
          ),
          409,
          "DIAGNOSIS_SCOPE_REQUIRED",
          "故障咨询预约仅包含明确固定价的到店诊断服务；维修方案与费用需诊断后另行确认",
        );
        await put(sql, "faults", { ...fault, status: "booked" });
      }
      const snapshot: PriceSnapshot[] = offers.map((o) => ({
        offerId: o.id,
        projectId: o.projectId,
        title: o.title,
        materialSpec: o.materialSpec,
        includes: o.includes,
        excludes: o.excludes,
        taxIncluded: o.taxIncluded,
        materialCents: o.materialCents,
        laborCents: o.laborCents,
        otherCents: o.otherCents,
        totalCents: o.totalCents!,
        version: o.version,
      }));
      const totalCents = snapshot.reduce((n, s) => n + s.totalCents, 0);
      const appointment: StoredAppointment = {
        id: id(),
        ownerId: user.id,
        vehicleId: vehicle.id,
        storeId,
        slotId: slot.id,
        status: "pending",
        snapshot,
        totalCents,
        finalCents: totalCents,
        requestId: input.requestId,
        requestHash,
        customItems: input.customItems,
        createdAt: now(),
        updatedAt: now(),
        reason: "",
        completedProjectIds: [],
        serviceKm: null,
        faultId: input.faultId || null,
        expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(),
      };
      await put(sql, "slots", { ...slot, reserved: slot.reserved + 1 });
      await put(sql, "appointments", appointment);
      await notify(
        sql,
        user.id,
        "预约已提交，待门店确认",
        "门店接单后才代表预约已确认。报价与名额已保存。",
        "appointment",
        "/my",
      );
      await audit(
        sql,
        user.id,
        "appointment.created",
        "appointment",
        appointment.id,
        "保存报价快照并占用名额",
      );
      return appointment;
    });
  });
  app.get<{ Params: { id: string } }>(
    route("/appointments/:id"),
    async (request) => {
      const user = authenticated(request);
      const a = await get<Appointment>(db, "appointments", request.params.id);
      ensure(a, 404, "NOT_FOUND", "预约不存在");
      await canAccess(db, user, a);
      return a;
    },
  );
  app.post<{ Params: { id: string } }>(
    route("/appointments/:id/action"),
    async (request) => {
      const user = authenticated(request);
      const input = actionSchema.parse(request.body);
      return db.transaction(async (sql) => {
        const a = await get<StoredAppointment>(
          sql,
          "appointments",
          request.params.id,
          true,
        );
        ensure(a, 404, "NOT_FOUND", "预约不存在");
        await canAccess(sql, user, a, true);
        const old = a.status;
        let next: Appointment["status"] = old;
        let reason = a.reason;
        if (input.action === "cancel") {
          ensure(user.role === "owner", 403, "FORBIDDEN", "仅车主可取消预约");
          if (old === "cancelled") return a;
          ensure(
            ["pending", "confirmed"].includes(old),
            409,
            "INVALID_STATE",
            "当前状态不可取消",
          );
          ensure(
            !!input.reason?.trim(),
            400,
            "REASON_REQUIRED",
            "请说明取消原因",
          );
          next = "cancelled";
          reason = input.reason!;
        }
        if (input.action === "confirm") {
          ensure(
            user.role === "store_admin",
            403,
            "FORBIDDEN",
            "仅门店管理员可接单",
          );
          if (old === "confirmed") return a;
          ensure(
            old === "pending",
            409,
            "INVALID_STATE",
            "只有待确认预约可接单",
          );
          ensure(a.expiresAt > now(), 409, "EXPIRED", "预约已超过确认时限");
          next = "confirmed";
        }
        if (input.action === "reject") {
          ensure(
            user.role === "store_admin",
            403,
            "FORBIDDEN",
            "仅门店管理员可拒单",
          );
          if (old === "rejected") return a;
          ensure(
            old === "pending",
            409,
            "INVALID_STATE",
            "只有待确认预约可拒绝",
          );
          ensure(
            !!input.reason?.trim(),
            400,
            "REASON_REQUIRED",
            "请说明拒绝原因",
          );
          next = "rejected";
          reason = input.reason!;
        }
        if (input.action === "start") {
          ensure(
            user.role !== "owner",
            403,
            "FORBIDDEN",
            "仅本店人员可开始服务",
          );
          ensure(
            old === "confirmed",
            409,
            "INVALID_STATE",
            "只有已确认预约可开始服务",
          );
          next = "in_service";
        }
        if (input.action === "finish") {
          ensure(
            user.role !== "owner",
            403,
            "FORBIDDEN",
            "仅本店人员可提交完工",
          );
          ensure(
            ["in_service", "confirmed"].includes(old),
            409,
            "INVALID_STATE",
            "当前状态不可提交完工",
          );
          ensure(
            !(await list<ServiceChange>(sql, "changes")).some(
              (c) => c.appointmentId === a.id && c.status === "pending",
            ),
            409,
            "CHANGE_PENDING",
            "增项需车主确认后才能提交完工",
          );
          ensure(
            input.serviceKm !== undefined,
            400,
            "MILEAGE_REQUIRED",
            "请记录到店服务里程",
          );
          const vehicle = await get<Vehicle>(sql, "vehicles", a.vehicleId);
          ensure(
            vehicle &&
              input.serviceKm >= (vehicle.totalKm ?? vehicle.initialKm),
            400,
            "MILEAGE_ROLLBACK",
            "服务里程不能低于最后有效里程",
          );
          ensure(
            input.completedProjectIds?.length,
            400,
            "PROJECT_REQUIRED",
            "请选择实际完成的项目",
          );
          ensure(
            input.completedProjectIds!.every((p) =>
              (a.approvedSnapshot || a.snapshot).some((s) => s.projectId === p),
            ),
            400,
            "PROJECT_MISMATCH",
            "实际项目必须来自已确认的服务范围",
          );
          a.completedProjectIds = [...new Set(input.completedProjectIds)];
          a.serviceKm = input.serviceKm;
          next = "awaiting_owner";
        }
        if (input.action === "dispute") {
          ensure(
            user.role === "owner",
            403,
            "FORBIDDEN",
            "仅车主可提出完工异议",
          );
          ensure(
            old === "awaiting_owner",
            409,
            "INVALID_STATE",
            "当前状态不可提出完工异议",
          );
          ensure(
            !!input.reason?.trim(),
            400,
            "REASON_REQUIRED",
            "请说明需核对的问题",
          );
          reason = input.reason!;
          next = "in_service";
        }
        if (input.action === "complete") {
          ensure(user.role === "owner", 403, "FORBIDDEN", "仅车主可确认完工");
          if (old === "completed") return a;
          ensure(
            old === "awaiting_owner",
            409,
            "INVALID_STATE",
            "请等待门店提交完工",
          );
          ensure(
            a.serviceKm !== null && a.completedProjectIds.length > 0,
            409,
            "SERVICE_INCOMPLETE",
            "实际服务信息不完整",
          );
          for (const projectId of a.completedProjectIds)
            await put(sql, "records", {
              id: `${a.id}:${projectId}`,
              vehicleId: a.vehicleId,
              appointmentId: a.id,
              projectId,
              completedAt: now(),
              totalKm: a.serviceKm,
              source: "门店记录／车主确认",
              totalCents:
                (a.approvedSnapshot || a.snapshot).find(
                  (s) => s.projectId === projectId,
                )?.totalCents || 0,
            });
          next = "completed";
        }
        ensure(
          next !== old || input.action === "dispute",
          409,
          "INVALID_STATE",
          "状态未发生有效变化",
        );
        const updated: StoredAppointment = {
          ...a,
          status: next,
          reason,
          updatedAt: now(),
        };
        await put(sql, "appointments", updated);
        if (next === "completed") await recalculateMaintenance(sql, a.ownerId);
        if (["cancelled", "rejected"].includes(next))
          await restoreFault(sql, updated);
        if (
          ["cancelled", "rejected", "completed"].includes(next) &&
          activeStates.includes(old)
        ) {
          const slot = await get<Slot>(sql, "slots", a.slotId, true);
          if (slot)
            await put(sql, "slots", {
              ...slot,
              reserved: Math.max(0, slot.reserved - 1),
            });
        }
        await notify(
          sql,
          a.ownerId,
          "预约状态已更新",
          `预约状态：${next === "completed" ? "车主已确认完工" : next === "awaiting_owner" ? "请核对实际项目与费用并确认完工" : next === "confirmed" ? "门店已接单" : reason || "服务状态已更新"}`,
          "appointment",
          "/my",
        );
        await audit(
          sql,
          user.id,
          `appointment.${input.action}`,
          "appointment",
          a.id,
          `${old} → ${next}${reason ? "；" + reason : ""}`,
        );
        return updated;
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    route("/appointments/:id/changes"),
    async (request) => {
      const user = roles(request, ["store_admin"]);
      const input = z
        .object({
          reason: z.string().trim().min(1).max(2000),
          description: z.string().trim().min(1).max(4000),
          proposedCents: z.number().int().min(0).max(100000000),
          proposedProjectIds: z.array(z.string()).min(1).max(12).optional(),
        })
        .parse(request.body);
      return db.transaction(async (sql) => {
        const a = await get<Appointment>(
          sql,
          "appointments",
          request.params.id,
          true,
        );
        ensure(a, 404, "NOT_FOUND", "预约不存在");
        sameStore(user, a.storeId);
        ensure(
          ["confirmed", "in_service"].includes(a.status),
          409,
          "INVALID_STATE",
          "当前状态不能新增费用变更",
        );
        ensure(
          !(await list<ServiceChange>(sql, "changes")).some(
            (c) => c.appointmentId === a.id && c.status === "pending",
          ),
          409,
          "CHANGE_PENDING",
          "已有变更待车主确认",
        );
        const current = a.approvedSnapshot || a.snapshot;
        const projectIds =
          input.proposedProjectIds || current.map((s) => s.projectId);
        ensure(
          new Set(projectIds).size === projectIds.length,
          400,
          "DUPLICATE_PROJECT",
          "拟定服务范围不能重复项目",
        );
        const proposedSnapshot: PriceSnapshot[] = [];
        const vehicle = await get<Vehicle>(sql, "vehicles", a.vehicleId);
        ensure(vehicle, 404, "NOT_FOUND", "车辆不存在");
        const slot = await get<Slot>(sql, "slots", a.slotId);
        ensure(slot, 404, "NOT_FOUND", "预约时段不存在");
        const day = shanghaiDay(new Date(slot.startsAt));
        const offers = await effectiveOffers(sql, day);
        for (const projectId of projectIds) {
          const prior = current.find((s) => s.projectId === projectId);
          if (prior) {
            proposedSnapshot.push(prior);
            continue;
          }
          const candidate = offers
            .filter(
              (o) =>
                o.projectId === projectId &&
                o.storeId === a.storeId &&
                o.modelId === vehicle.modelId &&
                o.active &&
                o.priceType === "fixed" &&
                o.totalCents !== null &&
                o.validFrom <= day &&
                o.validTo >= day,
            )
            .sort((x, y) => y.version - x.version)[0];
          ensure(
            candidate,
            400,
            "PROJECT_QUOTE_REQUIRED",
            "新增项目必须有本店适配车型且在服务日有效的固定报价",
          );
          proposedSnapshot.push({
            offerId: candidate.id,
            projectId: candidate.projectId,
            title: candidate.title,
            materialSpec: candidate.materialSpec,
            includes: candidate.includes,
            excludes: candidate.excludes,
            taxIncluded: candidate.taxIncluded,
            materialCents: candidate.materialCents,
            laborCents: candidate.laborCents,
            otherCents: candidate.otherCents,
            totalCents: candidate.totalCents!,
            version: candidate.version,
          });
        }
        const change: ServiceChange = {
          ...input,
          proposedProjectIds: projectIds,
          proposedSnapshot,
          id: id(),
          appointmentId: a.id,
          previousCents: a.finalCents,
          status: "pending",
          createdAt: now(),
          confirmedAt: null,
        };
        await put(sql, "changes", change);
        await notify(
          sql,
          a.ownerId,
          "服务方案待你确认",
          `门店提出项目／材料／费用变更：${input.reason}。确认前不会计入认可范围与费用。`,
          "change",
          "/my",
        );
        await audit(
          sql,
          user.id,
          "change.proposed",
          "change",
          change.id,
          `${input.reason}；拟定项目：${projectIds.join(",")}`,
        );
        return change;
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    route("/changes/:id/decision"),
    async (request) => {
      const user = owner(request);
      const input = z.object({ approved: z.boolean() }).parse(request.body);
      return db.transaction(async (sql) => {
        const c = await get<ServiceChange>(
          sql,
          "changes",
          request.params.id,
          true,
        );
        ensure(c, 404, "NOT_FOUND", "变更不存在");
        const a = await get<Appointment>(
          sql,
          "appointments",
          c.appointmentId,
          true,
        );
        ensure(
          a?.ownerId === user.id,
          403,
          "FORBIDDEN",
          "不能操作他人的费用变更",
        );
        if (c.status !== "pending") {
          ensure(
            (c.status === "approved") === input.approved,
            409,
            "INVALID_STATE",
            "该变更已处理",
          );
          return c;
        }
        ensure(
          ["confirmed", "in_service"].includes(a.status),
          409,
          "INVALID_STATE",
          "预约已不能确认费用变更",
        );
        const updated: ServiceChange = {
          ...c,
          status: input.approved ? "approved" : "rejected",
          confirmedAt: now(),
        };
        await put(sql, "changes", updated);
        if (input.approved)
          await put(sql, "appointments", {
            ...a,
            finalCents: c.proposedCents,
            approvedProjectIds: c.proposedProjectIds || a.approvedProjectIds,
            approvedSnapshot: c.proposedSnapshot || a.approvedSnapshot,
            updatedAt: now(),
          });
        await audit(
          sql,
          user.id,
          "change.decision",
          "change",
          c.id,
          updated.status,
        );
        return updated;
      });
    },
  );
}
