import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenv } from "dotenv";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv({ path: resolve(root, ".env"), quiet: true });
export interface Config {
  production: boolean;
  allowHttpPreview: boolean;
  port: number;
  host: string;
  origin: string;
  driver: "postgres" | "pglite";
  pglitePath: string;
  pg: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl: false | { rejectUnauthorized: boolean };
    schema?: string;
  };
  demoMode: boolean;
  seedDemo: boolean;
  demoPassword: string;
  sessionSecret: string;
  uploadDir: string;
  aiBaseUrl: string;
  aiKey: string;
  aiModel: string;
  aiApiStyle: "chat_completions" | "responses";
  aiTimeoutMs: number;
  mapProvider: "amap" | "osm";
  amapKey: string;
  amapSecurityCode: string;
}
export function loadConfig(overrides: Partial<Config> = {}): Config {
  const production = process.env.NODE_ENV === "production";
  const cfg: Config = {
    production,
    allowHttpPreview: process.env.ALLOW_HTTP_PREVIEW === "true",
    port: Number(process.env.PORT || 3001),
    host: process.env.HOST || "127.0.0.1",
    origin: process.env.APP_ORIGIN || "http://localhost:5173",
    driver: process.env.DATABASE_DRIVER === "postgres" ? "postgres" : "pglite",
    pglitePath:
      process.env.PGLITE_PATH === ":memory:"
        ? ":memory:"
        : resolve(
            root,
            process.env.PGLITE_PATH?.startsWith("../")
              ? ".local/postgres"
              : process.env.PGLITE_PATH || ".local/postgres",
          ),
    pg: {
      host: process.env.PGHOST || "127.0.0.1",
      port: Number(process.env.PGPORT || 5432),
      database: process.env.PGDATABASE || "mem_car_info",
      user: process.env.PGUSER || "mem_car_app",
      password: process.env.PGPASSWORD || "",
      ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: true } : false,
      schema: process.env.PGSCHEMA || "public",
    },
    demoMode: process.env.DEMO_MODE === "true",
    seedDemo: process.env.SEED_DEMO === "true",
    demoPassword: process.env.DEMO_PASSWORD || "",
    sessionSecret: process.env.SESSION_SECRET || "",
    uploadDir: resolve(
      root,
      process.env.UPLOAD_DIR?.startsWith("../")
        ? ".local/uploads"
        : process.env.UPLOAD_DIR || ".local/uploads",
    ),
    aiBaseUrl: process.env.AI_BASE_URL || "",
    aiKey: process.env.AI_API_KEY || "",
    aiModel: process.env.AI_MODEL || "",
    aiApiStyle: (process.env.AI_API_STYLE || "chat_completions") as Config["aiApiStyle"],
    aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS || 90000),
    mapProvider: process.env.MAP_PROVIDER === "amap" ? "amap" : "osm",
    amapKey: process.env.AMAP_WEB_KEY || "",
    amapSecurityCode: process.env.AMAP_SECURITY_CODE || "",
    ...overrides,
  };
  if (cfg.pg.schema && !/^[a-z_][a-z0-9_]{0,62}$/.test(cfg.pg.schema))
    throw new Error("PGSCHEMA 必须是有效的小写SQL标识符");
  if (!["chat_completions", "responses"].includes(cfg.aiApiStyle))
    throw new Error("AI_API_STYLE 必须为 chat_completions 或 responses");
  if (!Number.isInteger(cfg.aiTimeoutMs) || cfg.aiTimeoutMs < 1000 || cfg.aiTimeoutMs > 180000)
    throw new Error("AI_TIMEOUT_MS 必须是 1000 至 180000 毫秒的整数");
  if (cfg.sessionSecret.length < 32)
    throw new Error("SESSION_SECRET 必须至少 32 个字符");
  if (cfg.seedDemo && cfg.demoPassword.length < 12)
    throw new Error("DEMO_PASSWORD 必须至少 12 个字符");
  if (cfg.production) {
    if (cfg.driver !== "postgres")
      throw new Error("生产环境必须使用 PostgreSQL");
    if (!cfg.pg.password) throw new Error("生产环境未配置 PostgreSQL 密码");
    if (
      !cfg.origin.startsWith("https://") &&
      !(cfg.allowHttpPreview && cfg.origin.startsWith("http://"))
    )
      throw new Error(
        "生产环境 APP_ORIGIN 必须使用 HTTPS；仅课程HTTP预览可显式设置 ALLOW_HTTP_PREVIEW=true",
      );
    if (/replace|development|change-before|local-/i.test(cfg.sessionSecret))
      throw new Error("生产环境必须设置随机 SESSION_SECRET");
    if (cfg.demoMode || cfg.seedDemo)
      throw new Error(
        "生产环境须关闭 DEMO_MODE 与 SEED_DEMO；请先在隔离的课程演示环境初始化数据",
      );
  }
  return cfg;
}
