import { loadConfig } from "./config.js";
import { connectDatabase } from "./db.js";
import { seed } from "./seed.js";
if (process.env.SEED_DEMO !== "true")
  throw new Error("初始化演示数据需要显式设置 SEED_DEMO=true");
const config = loadConfig({ production: false, seedDemo: true });
if (config.demoPassword === "Yuncheng2026!" && config.driver === "postgres")
  throw new Error("远程数据库初始化必须先设置强随机 DEMO_PASSWORD");
const db = await connectDatabase(config);
try {
  await db.migrate();
  await seed(db, config);
  process.stdout.write(
    "云程数据库结构与演示数据初始化完成。演示数据均有标记；密码不写入日志。\n",
  );
} finally {
  await db.close();
}
