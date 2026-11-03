/** One-time initialization; existing app accounts are never reset. Secrets stay local. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import { loadConfig } from '../apps/api/src/config.js';
import { connectDatabase, get, put } from '../apps/api/src/db.js';
import { seed, type StoredUser } from '../apps/api/src/seed.js';
import { hashPassword } from '../apps/api/src/domain.js';

const local = dotenv.parse(await readFile('.env', 'utf8'));
if (!local.PGPASSWORD) throw new Error('请先填写 .env 的 PGPASSWORD');
const origin = `http://${local.PGHOST}:58083`;
let server: Record<string, string>;
try { server = dotenv.parse(await readFile('.env.server', 'utf8')); }
catch {
  server = { ...local, NODE_ENV: 'production', DATABASE_DRIVER: 'postgres', APP_ORIGIN: origin, ALLOW_HTTP_PREVIEW: 'true', APP_PORT: '58083', PGHOST_INTERNAL: 'postgresql', DATABASE_NETWORK: 'postgresql_default', SESSION_SECRET: randomBytes(48).toString('hex'), DEMO_PASSWORD: randomBytes(24).toString('base64url'), DEMO_MODE: 'false', SEED_DEMO: 'false' };
  for (const name of ['OWNER', 'STORE', 'EXPERT', 'ADMIN']) server[`INITIAL_${name}_PASSWORD`] = randomBytes(18).toString('base64url');
  await writeFile('.env.server', Object.entries(server).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
}
const config = loadConfig({ production: false, driver: 'postgres', seedDemo: true, demoMode: false, demoPassword: server.DEMO_PASSWORD, sessionSecret: server.SESSION_SECRET, pg: { host: local.PGHOST, port: Number(local.PGPORT || 5432), database: local.PGDATABASE, user: local.PGUSER, password: local.PGPASSWORD, ssl: local.PGSSL === 'true' ? { rejectUnauthorized: true } : false, schema: 'public' } });
const db = await connectDatabase(config);
try {
  await db.migrate();
  const existing = await get(db, 'users', 'owner-demo');
  await seed(db, config);
  if (!existing) {
    const access: string[] = ['# 云程 · 服务器预览账号', '', `访问：${server.APP_ORIGIN}`, '', '以下是本次新建课程演示账号。口令保存在本机，不进入 Git。', '', '| 角色 | 邮箱 | 密码 |', '| --- | --- | --- |'];
    for (const [id, name, role, label] of [['owner-demo', 'owner', 'OWNER', '车主'], ['store-demo', 'store', 'STORE', '门店'], ['expert-demo', 'expert', 'EXPERT', '专家'], ['admin-demo', 'admin', 'ADMIN', '平台']] as const) {
      const user = await get<StoredUser>(db, 'users', id);
      if (!user) throw new Error('初始化账号缺失');
      const password = server[`INITIAL_${role}_PASSWORD`];
      await put(db, 'users', { ...user, passwordHash: await hashPassword(password) });
      access.push(`| ${label} | ${name}@autovoyage.demo | ${password} |`);
    }
    await mkdir('.local', { recursive: true });
    await writeFile('.local/server-access.md', access.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    console.log('服务器数据库已初始化；4个新账号各有独立随机口令，见本机 .local/server-access.md。');
  } else console.log('已有云程账号，保留原账号密码；仅执行非破坏迁移与必要演示项目增量。');
  console.log('生产环境变量已准备在未跟踪的 .env.server；真实密码未打印到日志。');
} finally { await db.close(); }
