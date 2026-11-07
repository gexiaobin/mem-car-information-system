/** Maintenance only: no migration, seeding, or application release is performed. */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../apps/api/src/config.js";
import { connectDatabase } from "../apps/api/src/db.js";
import { catalogSources, catalogVersion, legacyGeneralCatalogProjects } from "../apps/api/src/data/public-catalog.js";
import { ProjectResetError, runProjectReset } from "../apps/api/src/project-reset.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("用法：npx tsx scripts/reset-service-projects.ts [--clear-unmatched-demo] [--apply --expect-plan SHA256] [--actor-id ID] [--output .local/report.json]\n默认只读预览。重建25项全部启用的通用目录；严格等价引用迁移。--clear-unmatched-demo仅允许清理无等价、无业务依赖的演示报价/版本/规则。执行前必须保存完整原始快照并复核摘要；未知正式引用或冲突阻止执行。请先核对PGSCHEMA。"); return;
  }
  let apply = false, clearUnmatchedDemo = false;
  let expectedDigest: string | undefined, actorId: string | undefined, output: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (seen.has(arg)) throw new ProjectResetError(`参数重复：${arg}`);
    seen.add(arg);
    if (arg === "--apply") { apply = true; continue; }
    if (arg === "--clear-unmatched-demo") { clearUnmatchedDemo = true; continue; }
    if (!["--expect-plan", "--actor-id", "--output"].includes(arg)) throw new ProjectResetError("未知参数，请使用--help。");
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new ProjectResetError(`参数缺少值：${arg}`);
    if (arg === "--expect-plan") expectedDigest = value;
    if (arg === "--actor-id") actorId = value;
    if (arg === "--output") output = value;
  }
  if ((apply && !expectedDigest) || expectedDigest && !/^[a-f0-9]{64}$/.test(expectedDigest)) throw new ProjectResetError("--apply必须提供dry-run报告中的64位--expect-plan摘要。");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const local = resolve(root, ".local");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = resolve(root, output || `.local/service-reset-${stamp}-${randomBytes(3).toString("hex")}.json`);
  const fromLocal = relative(local, reportPath);
  if (!fromLocal || fromLocal.startsWith("..") || resolve(local, fromLocal) !== reportPath) throw new ProjectResetError("完整快照仅能保存到已忽略的.local目录。");
  await mkdir(dirname(reportPath), { recursive: true });
  const config = loadConfig({ production: false, driver: "postgres", seedDemo: false, sessionSecret: "service-reset-maintenance-config-only-32-chars" });
  if (!config.pg.password) throw new ProjectResetError("请在本地.env配置PGPASSWORD。");
  const db = await connectDatabase(config);
  try {
    const report = await runProjectReset(db, { apply, clearUnmatchedDemo, expectedDigest, actorId,
      // Preserve the original reviewed 25-service reset target as references grow.
      generalProjects: legacyGeneralCatalogProjects, sources: catalogSources, catalogVersion,
      beforeApply: async prepared => { await writeFile(reportPath, JSON.stringify(prepared, null, 2) + "\n", { flag: "wx", mode: 0o600 }); },
    });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: apply ? "w" : "wx", mode: 0o600 });
    console.log(JSON.stringify({ mode: report.mode, status: report.status, canApply: report.plan.blockers.length === 0,
      changed: report.plan.changed, beforeCounts: report.plan.beforeCounts, afterCounts: report.plan.afterCounts,
      mappedOldProjects: report.plan.mappings.length, unmatchedProjects: report.plan.unmatched.length,
      writes: Object.fromEntries(Object.entries(report.plan.writes).map(([key, rows]) => [key, rows!.length])),
      deletes: Object.fromEntries(Object.entries(report.plan.deletes).map(([key, rows]) => [key, rows!.length])),
      blockers: report.plan.blockers, digest: report.plan.digest, reportPath }, null, 2));
  } finally { await db.close(); }
}
main().catch(error => {
  const code = String((error as { code?: unknown })?.code || "");
  console.error(error instanceof ProjectResetError ? error.message : `操作未完成${/^[A-Z0-9]{5}$/.test(code) ? `（PostgreSQL ${code}）` : ""}；请核对数据库/schema与本地快照。若报告仍为prepared，请先核对实际数据库状态。连接参数未打印。`);
  process.exitCode = 1;
});
