import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Store } from "@autovoyage/shared";
import type { Context } from "./context.js";
import { authenticated, publicUser, roles, route } from "./context.js";
import { get, list, put } from "./db.js";
import {
  audit,
  checkPassword,
  ensure,
  hashPassword,
  id,
  sha256,
} from "./domain.js";
import type { StoredUser } from "./seed.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const initialPassword = () =>
  Array.from(
    randomBytes(12),
    (byte) => ALPHABET[byte % ALPHABET.length],
  ).join("");

const memberSchema = z.object({
  name: z.string().trim().min(1).max(40),
  email: z.string().email().max(254),
  role: z.enum(["store_admin", "expert"]),
  storeId: z.string().optional(),
});

const newPasswordSchema = z
  .string()
  .min(8, "密码至少 8 位")
  .max(256)
  .regex(/[A-Za-z]/, "密码需包含字母")
  .regex(/[0-9]/, "密码需包含数字");

export function registerMembers({ app, db }: Context) {
  app.post(
    route("/admin/store-members"),
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => {
      const user = roles(request, ["store_admin", "platform_admin"]);
      const input = memberSchema.parse(request.body);
      const storeId = user.role === "store_admin" ? user.storeId : input.storeId;
      ensure(storeId, 400, "STORE_REQUIRED", "请选择成员所属门店");
      return db.transaction(async (sql) => {
        const store = await get<Store>(sql, "stores", storeId!);
        ensure(store, 404, "STORE_NOT_FOUND", "门店不存在");
        const users = await list<StoredUser>(sql, "users");
        ensure(
          !users.some(
            (u) => u.email.toLowerCase() === input.email.toLowerCase(),
          ),
          409,
          "DUPLICATE_EMAIL",
          "该邮箱已被使用",
        );
        const password = initialPassword();
        const member: StoredUser = {
          id: id(),
          name: input.name,
          email: input.email.toLowerCase(),
          role: input.role,
          storeId,
          passwordHash: await hashPassword(password),
          active: true,
          mustChangePassword: true,
        };
        await put(sql, "users", member);
        await audit(
          sql,
          user.id,
          "member.created",
          "user",
          member.id,
          `创建成员 ${member.name}`,
        );
        // The initial password is returned once and never persisted in readable form.
        return { member: publicUser(member), initialPassword: password };
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    route("/admin/store-members/:id/deactivate"),
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request) => {
      const user = roles(request, ["store_admin", "platform_admin"]);
      ensure(
        request.params.id !== user.id,
        409,
        "CANNOT_REMOVE_SELF",
        "不能停用自己的账号",
      );
      return db.transaction(async (sql) => {
        const target = await get<StoredUser>(
          sql,
          "users",
          request.params.id,
          true,
        );
        ensure(target, 404, "NOT_FOUND", "成员不存在");
        ensure(
          target.role === "store_admin" || target.role === "expert",
          403,
          "FORBIDDEN",
          "只能停用门店成员",
        );
        ensure(
          user.role === "platform_admin" || target.storeId === user.storeId,
          403,
          "FORBIDDEN",
          "只能停用本店成员",
        );
        ensure(target.active, 409, "ALREADY_INACTIVE", "该成员已停用");
        await put(sql, "users", { ...target, active: false });
        await sql.query("DELETE FROM av_sessions WHERE user_id=$1", [
          target.id,
        ]);
        await audit(
          sql,
          user.id,
          "member.deactivated",
          "user",
          target.id,
          `停用成员 ${target.name}`,
        );
        return { ok: true };
      });
    },
  );
  app.post(
    route("/auth/change-password"),
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => {
      const user = authenticated(request);
      const input = z
        .object({
          currentPassword: z.string().min(1).max(256),
          newPassword: newPasswordSchema,
        })
        .parse(request.body);
      ensure(
        input.currentPassword !== input.newPassword,
        400,
        "SAME_PASSWORD",
        "新密码不能与当前密码相同",
      );
      const raw = request.cookies.av_session;
      const unsigned = raw ? request.unsignCookie(raw) : null;
      return db.transaction(async (sql) => {
        const stored = await get<StoredUser>(sql, "users", user.id, true);
        ensure(stored?.active, 401, "AUTH_REQUIRED", "登录状态已失效，请重新登录");
        ensure(
          await checkPassword(input.currentPassword, stored.passwordHash),
          403,
          "INVALID_CREDENTIALS",
          "当前密码不正确",
        );
        await put(sql, "users", {
          ...stored,
          passwordHash: await hashPassword(input.newPassword),
          mustChangePassword: false,
        });
        if (unsigned?.valid && unsigned.value)
          await sql.query(
            "DELETE FROM av_sessions WHERE user_id=$1 AND hash<>$2",
            [user.id, sha256(unsigned.value)],
          );
        await audit(
          sql,
          user.id,
          "account.password_changed",
          "user",
          user.id,
          "更新登录密码",
        );
        return { ok: true };
      });
    },
  );
}
