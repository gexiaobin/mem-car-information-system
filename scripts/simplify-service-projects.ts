/** Default is read-only. Run --apply only after reviewing the local plan. */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../apps/api/src/config.js";
import { connectDatabase } from "../apps/api/src/db.js";
import { catalogProjects, legacyGeneralCatalogProjects } from "../apps/api/src/data/public-catalog.js";
import { ProjectSimplificationError, runProjectSimplification } from "../apps/api/src/project-simplification.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("用法：npx tsx scripts/simplify-service-projects.ts [--apply] [--actor-id ID] [--expect-plan SHA256] [--output .local/report.json]\n默认只读预览。--apply 仅停用符合条件的非通用项目，保留引用、手工编辑与历史资料；不删除项目。应用前保存恢复快照，并逐项写入真实管理员审计。");
    return;
  }
  let apply = false;
  let actorId: string | undefined;
  let expectedDigest: string | undefined;
  let output: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (seen.has(arg)) throw new ProjectSimplificationError(`参数重复：${arg}`);
    seen.add(arg);
    if (arg === "--apply") { apply = true; continue; }
    if (!["--actor-id", "--expect-plan", "--output"].includes(arg))
      throw new ProjectSimplificationError("存在未知参数，请使用 --help 查看用法。");
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new ProjectSimplificationError(`参数缺少值：${arg}`);
    if (arg === "--actor-id") actorId = value;
    else if (arg === "--expect-plan") expectedDigest = value;
    else output = value;
  }
  if (expectedDigest && !/^[a-f0-9]{64}$/.test(expectedDigest))
    throw new ProjectSimplificationError("--expect-plan 必须是 dry-run 报告中的64位SHA256摘要。");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const localRoot = resolve(root, ".local");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = resolve(root, output || `.local/service-simplification-${stamp}-${randomBytes(3).toString("hex")}.json`);
  const fromLocal = relative(localRoot, reportPath);
  if (!fromLocal || fromLocal.startsWith("..") || resolve(localRoot, fromLocal) !== reportPath)
    throw new ProjectSimplificationError("报告必须保存在已忽略的 .local 目录内。");
  const config = loadConfig({ production: false, driver: "postgres", seedDemo: false,
    sessionSecret: "service-simplification-local-cli-config-only" });
  if (!config.pg.password) throw new ProjectSimplificationError("请先在本地 .env 配置 PGPASSWORD。");
  await mkdir(dirname(reportPath), { recursive: true });
  const db = await connectDatabase(config);
  try {
    const report = await runProjectSimplification(db, {
      // This maintenance command retains its original 25-service policy.
      apply, actorId, expectedDigest, catalogProjects, generalProjects: legacyGeneralCatalogProjects,
      beforeApply: async prepared => {
        await writeFile(reportPath, JSON.stringify(prepared, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      },
    });
    // Apply's prepared report already exists; dry-run never overwrites a file.
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: apply ? "w" : "wx", mode: 0o600 });
    const reasons = report.plan.preserved.reduce<Record<string, number>>((counts, entry) => {
      counts[entry.reason] = (counts[entry.reason] || 0) + 1;
      return counts;
    }, {});
    console.log(JSON.stringify({
      mode: report.mode, status: report.status, total: report.plan.total,
      generalCatalogCount: report.plan.generalCatalogIds.length,
      activeBefore: report.plan.activeBefore, activeAfter: report.plan.activeAfter,
      disableCount: report.plan.candidates.length, preservedReasons: reasons,
      candidates: report.plan.candidates.map(project => ({ id: project.id, name: project.name })),
      digest: report.plan.digest, reportPath,
    }, null, 2));
  } finally { await db.close(); }
}

main().catch(error => {
  const code = String((error as { code?: unknown })?.code || "");
  const hints: Record<string, string> = {
    "42P01": "业务表缺失，请核对 PGSCHEMA 与已部署数据库结构；脚本不会自动迁移。",
    "42501": "数据库权限不足。", "55P03": "等待业务锁超时，请稍后重新预览。",
    "40P01": "锁发生冲突，本事务已回滚，请重新预览。", "57014": "操作超时，请重新预览。",
  };
  console.error(error instanceof ProjectSimplificationError ? error.message :
    `操作未完成${/^[A-Z0-9]{5}$/.test(code) ? `（PostgreSQL ${code}）` : ""}；${hints[code] || "请检查数据库或本地报告。"}若已生成 prepared 报告，请核对数据库状态后再执行。连接参数未打印。`);
  process.exitCode = 1;
});
