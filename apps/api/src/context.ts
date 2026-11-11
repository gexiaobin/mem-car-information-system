import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@autovoyage/shared";
import type { Config } from "./config.js";
import type { Database, Sql } from "./db.js";
import { get } from "./db.js";
import { ensure } from "./domain.js";
import type { StoredUser } from "./seed.js";
declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}
export interface Context {
  app: FastifyInstance;
  db: Database;
  config: Config;
}
export const publicUser = (user: StoredUser): User => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  storeId: user.storeId,
  mustChangePassword: user.mustChangePassword,
});
export function authenticated(request: FastifyRequest): User {
  ensure(request.user, 401, "AUTH_REQUIRED", "请先登录");
  return request.user;
}
export function owner(request: FastifyRequest): User {
  const user = authenticated(request);
  ensure(user.role === "owner", 403, "FORBIDDEN", "仅车主可执行此操作");
  return user;
}
export function roles(request: FastifyRequest, allowed: User["role"][]): User {
  const user = authenticated(request);
  ensure(
    allowed.includes(user.role),
    403,
    "FORBIDDEN",
    "当前角色无权执行此操作",
  );
  return user;
}
export async function ownVehicle<T extends { ownerId: string }>(
  sql: Sql,
  vehicleId: string,
  user: User,
  lock = false,
): Promise<T> {
  const vehicle = await get<T>(sql, "vehicles", vehicleId, lock);
  ensure(vehicle, 404, "NOT_FOUND", "车辆不存在");
  ensure(
    user.role === "owner" && vehicle.ownerId === user.id,
    403,
    "FORBIDDEN",
    "不能访问其他车主的车辆",
  );
  return vehicle;
}
export function sameStore(user: User, storeId: string) {
  ensure(
    user.storeId === storeId &&
      (user.role === "store_admin" || user.role === "expert"),
    403,
    "FORBIDDEN",
    "只能处理本店业务",
  );
}
export const route = (path: string) => `/api/v1${path}`;
export type Request = FastifyRequest;
export type Reply = FastifyReply;
