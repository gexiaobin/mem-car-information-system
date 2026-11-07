import {
  randomUUID,
  scrypt as rawScrypt,
  timingSafeEqual,
  randomBytes,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import type {
  CarModel,
  MaintenanceItem,
  MaintenanceRule,
  Project,
  ServiceRecord,
  Vehicle,
} from "@autovoyage/shared";
import type { Sql } from "./db.js";
import { hasRecurringMaintenanceThreshold, usesIndependentConditionThreshold } from "@autovoyage/shared";
import { get, list, put } from "./db.js";
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function ensure(
  condition: unknown,
  status: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
const scrypt = promisify(rawScrypt);
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}
export async function checkPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const sha256 = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
export function shanghaiDay(value = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
export function addMonthsClamped(date: string, months: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const result = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(d, last));
  return result.toISOString().slice(0, 10);
}
export function maintenanceFor(
  vehicle: Vehicle,
  projects: Project[],
  rules: MaintenanceRule[],
  records: ServiceRecord[],
  date = new Date(),
  model?: CarModel,
): MaintenanceItem[] {
  const applicableIds = model?.applicableProjectIds ?? [
    ...new Set(
      rules
        .filter((r) => r.modelId === vehicle.modelId && r.verified)
        .map((r) => r.projectId),
    ),
  ];
  const applicable = projects.filter(
    (p) =>
      p.active && p.category !== "diagnosis" && applicableIds.includes(p.id),
  );
  if (!applicable.length)
    return [
      {
        vehicleId: vehicle.id,
        projectId: "__vehicle_rules__",
        scope: "vehicle",
        name: "车型保养规则待补充",
        status: "missing",
        dueAt: null,
        dueKm: null,
        currentKm: vehicle.totalKm,
        sourceTitle: "尚未核验适用车型的保养项目范围",
        sourceUrl: "",
        isDemo: vehicle.isDemo,
        reason:
          "请平台依据本年款及动力配置的官方手册补充适用项目与规则；资料不足时不能判断无需保养。",
      },
    ];
  return applicable.map((project) => {
    const rule = rules.find(
      (r) =>
        r.modelId === vehicle.modelId &&
        r.projectId === project.id &&
        r.verified,
    );
    const common = {
      vehicleId: vehicle.id,
      projectId: project.id,
      name: project.name,
      scope: "project" as const,
      currentKm: vehicle.totalKm,
      sourceTitle: rule?.sourceTitle || "尚未核验适用车型的官方手册",
      sourceUrl: rule?.sourceUrl || "",
      isDemo: vehicle.isDemo || !!rule?.isDemo,
      action: rule?.action,
      triggerType: rule?.triggerType,
      conditionThresholdsIndependent: rule ? usesIndependentConditionThreshold(rule) : false,
      condition: rule?.condition,
      notes: rule?.notes,
    };
    if (!rule)
      return {
        ...common,
        status: "missing",
        dueAt: null,
        dueKm: null,
        reason: "请补充并复核本年款车型的保养规则",
      };
    const independentCondition = usesIndependentConditionThreshold(rule) && hasRecurringMaintenanceThreshold(rule);
    if ((rule.triggerType === 'condition' && !independentCondition) || rule.triggerType === 'as_needed')
      return { ...common, status: 'conditional', dueAt: null, dueKm: null,
        reason: [rule.condition || '按手册条件检查或处理，无固定到期时间', rule.notes].filter(Boolean).join('；') };
    const latest = records
      .filter((r) => r.vehicleId === vehicle.id && r.projectId === project.id)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
    // A manual may give one recurring interval without a distinct first service.
    // Keep the original null first fields, and use that documented recurrence
    // from the vehicle's start only when neither independent first value exists.
    const recurringFromStart = rule.firstMonths == null && rule.firstKm == null;
    const intervalMonths = latest || recurringFromStart ? rule.intervalMonths : rule.firstMonths;
    const dueAt = intervalMonths == null ? null : addMonthsClamped(
      latest ? shanghaiDay(new Date(latest.completedAt)) : vehicle.startDate,
      intervalMonths,
    );
    const intervalKm = latest || recurringFromStart ? rule.intervalKm : rule.firstKm;
    const dueKm =
      intervalKm == null
        ? null
        : (latest?.totalKm ?? vehicle.initialKm) + intervalKm;
    const today = shanghaiDay(date);
    const days = dueAt === null ? Infinity : Math.ceil(
      (new Date(`${dueAt}T00:00:00+08:00`).getTime() -
        new Date(`${today}T00:00:00+08:00`).getTime()) /
        86400000,
    );
    const canUseKm =
      rule.mileageType === "total_km" && vehicle.totalKm !== null;
    const distanceDue = canUseKm && dueKm !== null && vehicle.totalKm! >= dueKm;
    const stale =
      !vehicle.observedAt ||
      (date.getTime() - new Date(vehicle.observedAt).getTime()) / 86400000 > 30;
    const reason = (message: string) => [message, independentCondition ? rule.condition : ""].filter(Boolean).join("；");
    if (days <= 0 || distanceDue)
      return {
        ...common,
        status: "due",
        dueAt,
        dueKm,
        reason: reason(days <= 0 ? "已达到时间阈值" : "已达到里程阈值"),
      };
    // A reliable calendar deadline remains actionable even if the mileage side
    // needs a new observation. Preserve that limitation in the explanation.
    if (days <= 30) {
      const mileageNotice = dueKm === null ? "" : rule.mileageType === "engine_km"
        ? "发动机累计里程仍待核验" : !canUseKm || stale ? "里程数据仍待更新，里程可能更早到期"
          : latest && vehicle.totalKm! < latest.totalKm ? "图片里程早于已确认的服务里程，仍待更新" : "";
      return { ...common, status: "soon", dueAt, dueKm, reason: reason(["距离时间阈值不足30天", mileageNotice].filter(Boolean).join("；")) };
    }
    if (rule.mileageType === "engine_km" && dueKm !== null)
      return {
        ...common,
        status: "missing",
        dueAt,
        dueKm,
        reason: reason("本项目要求发动机累计里程，请补充核验；时间到期仍会提醒"),
      };
    if (dueKm !== null && latest && vehicle.totalKm !== null && vehicle.totalKm < latest.totalKm)
      return {
        ...common,
        status: "missing",
        dueAt,
        dueKm,
        reason: reason("图片里程早于已确认的服务里程，请上传更新图片后判断剩余里程"),
      };
    if (dueKm !== null && (!canUseKm || stale))
      return {
        ...common,
        status: "missing",
        dueAt,
        dueKm,
        reason: reason(stale ? "里程数据待更新，不能据此判断无需保养" : "缺少有效里程"),
      };
    if (
      days <= 30 ||
      (canUseKm && dueKm !== null && dueKm - vehicle.totalKm! <= 500)
    )
      return {
        ...common,
        status: "soon",
        dueAt,
        dueKm,
        reason: reason("距离里程阈值不足500km"),
      };
    return {
      ...common,
      status: "ok",
      dueAt,
      dueKm,
      reason: reason("尚未达到本项目的时间或里程阈值"),
    };
  });
}
export async function audit(
  sql: Sql,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  detail: string,
) {
  await put(sql, "logs", {
    id: id(),
    actorId,
    action,
    entityType,
    entityId,
    detail,
    createdAt: now(),
  });
}
export async function notify(
  sql: Sql,
  userId: string,
  title: string,
  body: string,
  type: string,
  link: string,
) {
  await put(sql, "messages", {
    id: id(),
    userId,
    title,
    body,
    type,
    link,
    readAt: null,
    createdAt: now(),
  });
}
export async function saveMaintenanceMessages(
  sql: Sql,
  userId: string,
  items: MaintenanceItem[],
) {
  for (const item of items.filter(
    (m) => m.scope !== "vehicle" && (m.status === "due" || m.status === "soon"),
  )) {
    const noticeId = `maint:${item.vehicleId}:${item.projectId}:${item.dueAt}:${item.dueKm}:${item.status}`;
    if (!(await get(sql, "messages", noticeId)))
      await put(sql, "messages", {
        id: noticeId,
        userId,
        title: `${item.name}${item.status === "due" ? "已到期" : "临近保养"}`,
        body: `${item.reason}。${item.isDemo ? "当前按课程演示规则计算，请勿用于真实车辆。" : ""}`,
        type: "maintenance",
        link: "/",
        readAt: null,
        createdAt: now(),
      });
  }
}
export async function recalculateMaintenance(sql: Sql, ownerId?: string) {
  const vehicles = (await list<Vehicle>(sql, "vehicles")).filter(
    (v) => !ownerId || v.ownerId === ownerId,
  );
  const projects = await list<Project>(sql, "projects"),
    models = await list<CarModel>(sql, "models"),
    rules = await list<MaintenanceRule>(sql, "rules"),
    records = await list<ServiceRecord>(sql, "records");
  for (const vehicle of vehicles)
    await saveMaintenanceMessages(
      sql,
      vehicle.ownerId,
      maintenanceFor(
        vehicle,
        projects,
        rules,
        records,
        new Date(),
        models.find((m) => m.id === vehicle.modelId),
      ),
    );
}
