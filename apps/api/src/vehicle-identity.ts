import type { Vehicle } from "@autovoyage/shared";
import type { Sql } from "./db.js";
import { list } from "./db.js";
import { ensure } from "./domain.js";

/** Spaces and visual separators do not make the same plate a different vehicle. */
export const normalizePlate = (value: string) => value.normalize("NFKC").toUpperCase().replace(/[\s·•.\-]/g, "");

export async function ensureUniqueOwnerPlate(sql: Sql, ownerId: string, plate: string, exceptId?: string) {
  const key = normalizePlate(plate);
  ensure(key.length > 0, 400, "PLATE_REQUIRED", "请填写车牌号码");
  ensure(!(await list<Vehicle>(sql, "vehicles")).some(vehicle => vehicle.ownerId === ownerId && vehicle.id !== exceptId && normalizePlate(vehicle.plate) === key), 409, "DUPLICATE_VEHICLE_PLATE", "该车牌已在你的车辆档案中，请选择现有车辆上传行驶证");
}
