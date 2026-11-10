import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { User } from "@autovoyage/shared";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const origin = "http://localhost:5173";
const password = "TestPassword2026!";
let service: Awaited<ReturnType<typeof createApp>>;
let temporary: string;
const cookies: Record<string, string> = {};

const call = async (
  method: "GET" | "POST",
  url: string,
  cookie?: string,
  payload?: unknown,
) =>
  service.app.inject({
    method,
    url,
    headers: { origin, ...(cookie ? { cookie } : {}) },
    ...(payload === undefined ? {} : { payload }),
  });

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "autovoyage-members-"));
  service = await createApp({
    config: loadConfig({
      production: false,
      driver: "pglite",
      pglitePath: ":memory:",
      seedDemo: true,
      demoMode: true,
      demoPassword: password,
      sessionSecret: "test-secret-at-least-32-characters-long",
      uploadDir: temporary,
      aiBaseUrl: "",
      aiKey: "",
      aiModel: "",
      origin,
    }),
  });
  for (const [role, email] of Object.entries({
    owner: "owner@autovoyage.demo",
    store: "store@autovoyage.demo",
    admin: "admin@autovoyage.demo",
  })) {
    const res = await call("POST", "/api/v1/auth/login", undefined, {
      email,
      password,
    });
    assert.equal(res.statusCode, 200, res.body);
    cookies[role] = String(res.headers["set-cookie"]).split(";")[0];
  }
});

after(async () => {
  await service?.app.close();
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test("store manager creates a member with a one-time initial password", async () => {
  const res = await call("POST", "/api/v1/admin/store-members", cookies.store, {
    name: "新同事",
    email: "new.member@autovoyage.demo",
    role: "expert",
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { member: User & { passwordHash?: string }; initialPassword: string };
  assert.equal(body.member.role, "expert");
  assert.equal(body.member.mustChangePassword, true);
  assert.equal(body.member.storeId, "store-coast");
  assert.equal(body.member.passwordHash, undefined);
  assert.ok(/[A-Za-z0-9]{12}/.test(body.initialPassword));
  assert.ok(!res.body.includes("passwordHash"));

  const duplicate = await call("POST", "/api/v1/admin/store-members", cookies.store, {
    name: "重复邮箱",
    email: "NEW.MEMBER@autovoyage.demo",
    role: "expert",
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, "DUPLICATE_EMAIL");

  const forbidden = await call("POST", "/api/v1/admin/store-members", cookies.owner, {
    name: "越权",
    email: "intruder@autovoyage.demo",
    role: "expert",
  });
  assert.equal(forbidden.statusCode, 403);
});

test("a new member must set a personal password before using the account", async () => {
  const created = await call("POST", "/api/v1/admin/store-members", cookies.store, {
    name: "强制改密",
    email: "forced.change@autovoyage.demo",
    role: "store_admin",
  });
  assert.equal(created.statusCode, 200, created.body);
  const initial = (created.json() as { initialPassword: string }).initialPassword;

  const login = await call("POST", "/api/v1/auth/login", undefined, {
    email: "forced.change@autovoyage.demo",
    password: initial,
  });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal((login.json() as { user: User }).user.mustChangePassword, true);
  const memberCookie = String(login.headers["set-cookie"]).split(";")[0];

  const wrong = await call("POST", "/api/v1/auth/change-password", memberCookie, {
    currentPassword: "not-the-password1",
    newPassword: "MemberPassword2026!",
  });
  assert.equal(wrong.statusCode, 403);
  assert.equal(wrong.json().error.code, "INVALID_CREDENTIALS");

  const weak = await call("POST", "/api/v1/auth/change-password", memberCookie, {
    currentPassword: initial,
    newPassword: "abcdefgh",
  });
  assert.equal(weak.statusCode, 400);
  assert.equal(weak.json().error.code, "VALIDATION_ERROR");

  const changed = await call("POST", "/api/v1/auth/change-password", memberCookie, {
    currentPassword: initial,
    newPassword: "MemberPassword2026!",
  });
  assert.equal(changed.statusCode, 200, changed.body);

  const again = await call("POST", "/api/v1/auth/login", undefined, {
    email: "forced.change@autovoyage.demo",
    password: "MemberPassword2026!",
  });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal((again.json() as { user: User }).user.mustChangePassword, false);
});

test("deactivating a member ends its sessions and keeps history", async () => {
  const created = await call("POST", "/api/v1/admin/store-members", cookies.store, {
    name: "即将停用",
    email: "to.deactivate@autovoyage.demo",
    role: "expert",
  });
  assert.equal(created.statusCode, 200, created.body);
  const { member } = created.json() as { member: User };

  const login = await call("POST", "/api/v1/auth/login", undefined, {
    email: "to.deactivate@autovoyage.demo",
    password: (created.json() as { initialPassword: string }).initialPassword,
  });
  const memberCookie = String(login.headers["set-cookie"]).split(";")[0];
  assert.equal((await call("GET", "/api/v1/auth/me", memberCookie)).statusCode, 200);

  const self = await call(
    "POST",
    `/api/v1/admin/store-members/${member.id}/deactivate`,
    cookies.owner,
  );
  assert.equal(self.statusCode, 403);

  const missing = await call(
    "POST",
    "/api/v1/admin/store-members/owner-demo/deactivate",
    cookies.store,
  );
  assert.equal(missing.statusCode, 403);

  const mine = await call(
    "POST",
    "/api/v1/admin/store-members/store-demo/deactivate",
    cookies.store,
  );
  assert.equal(mine.statusCode, 409);
  assert.equal(mine.json().error.code, "CANNOT_REMOVE_SELF");

  const done = await call(
    "POST",
    `/api/v1/admin/store-members/${member.id}/deactivate`,
    cookies.store,
  );
  assert.equal(done.statusCode, 200, done.body);
  assert.equal((await call("GET", "/api/v1/auth/me", memberCookie)).json().user, null);

  const bootstrap = await call("GET", "/api/v1/bootstrap", cookies.store);
  assert.equal(bootstrap.statusCode, 200);
  assert.ok(
    !(bootstrap.json() as { users: User[] }).users.some((u) => u.id === member.id),
    "deactivated members disappear from the store list",
  );

  const rejected = await call("POST", "/api/v1/auth/login", undefined, {
    email: "to.deactivate@autovoyage.demo",
    password: "whatever123",
  });
  assert.equal(rejected.statusCode, 401);
});

test("platform administrators can open accounts for a chosen store", async () => {
  const res = await call("POST", "/api/v1/admin/store-members", cookies.admin, {
    name: "平台开号",
    email: "platform.opened@autovoyage.demo",
    role: "store_admin",
    storeId: "store-coast",
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((res.json() as { member: User }).member.storeId, "store-coast");

  const withoutStore = await call("POST", "/api/v1/admin/store-members", cookies.admin, {
    name: "缺少门店",
    email: "no.store@autovoyage.demo",
    role: "store_admin",
  });
  assert.equal(withoutStore.statusCode, 400);
  assert.equal(withoutStore.json().error.code, "STORE_REQUIRED");
});
