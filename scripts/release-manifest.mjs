import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['apps/api/src', 'apps/web/src', 'apps/web/public', 'packages/shared/src', 'design-system', 'deploy', 'scripts'];
const rootFiles = ['package.json', 'package-lock.json', 'tsconfig.base.json', 'compose.yml', 'compose.preview.yml', '.dockerignore', 'apps/api/package.json', 'apps/api/tsconfig.json', 'apps/web/package.json', 'apps/web/tsconfig.json', 'apps/web/vite.config.ts', 'apps/web/index.html', 'packages/shared/package.json', 'release.config.json'];
const skipped = new Set(['node_modules', 'dist', '.git', '.local', 'uploads', 'coverage', 'test-results', 'playwright-report']);
const textExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.mts', '.cjs', '.json', '.css', '.html', '.md', '.txt', '.yml', '.yaml', '.svg', '.conf', '.sh', '']);
const digest = value => createHash('sha256').update(value).digest('hex');
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function filesIn(root, path) {
  if (!existsSync(join(root, path))) return [];
  return readdirSync(join(root, path), { withFileTypes: true }).sort((a, b) => order(a.name, b.name)).flatMap(entry => {
    if (skipped.has(entry.name) || /^\.env(?:\.|$)/.test(entry.name)) return [];
    const name = `${path}/${entry.name}`;
    return entry.isDirectory() ? filesIn(root, name) : entry.isFile() && !name.endsWith('.log') ? [name] : [];
  });
}

function normalizedBytes(path, bytes) {
  const text = textExtensions.has(extname(path).toLowerCase()) || /^Dockerfile(?:\..+)?$/i.test(basename(path));
  return text ? Buffer.from(bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')) : bytes;
}

function moduleFor(path) {
  if (/^apps\/api\/src\/data\/catalog-|^apps\/api\/src\/data\/public-catalog/.test(path)) return 'catalog';
  if (/^apps\/api\/src\/manual/.test(path)) return 'manuals';
  if (path.startsWith('apps/api/src/')) return 'api';
  if (path.startsWith('apps/web/')) return 'web';
  if (path.startsWith('packages/shared/')) return 'shared';
  return 'operations';
}

/** Uses only named source paths. Private .env files, uploads, logs and Git messages never enter the manifest. */
export function createReleaseManifest(options = {}) {
  const root = resolve(options.root || repositoryRoot);
  const configPath = join(root, 'release.config.json');
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
  const baseVersion = typeof config.version === 'string' && /^\d+\.\d+\.\d+$/.test(config.version) ? config.version : '0.8.0';
  const title = typeof config.title === 'string' && config.title.trim() ? config.title.trim().slice(0, 120) : '云程功能与体验更新';
  const changes = Array.isArray(config.changes) ? config.changes.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim().slice(0, 500)).slice(0, 20) : [];
  const files = [...new Set([...rootFiles.filter(path => existsSync(join(root, path))), ...roots.flatMap(path => filesIn(root, path))])].sort(order);
  const modules = {};
  for (const path of files) {
    const hash = digest(normalizedBytes(path, readFileSync(join(root, path))));
    const module = moduleFor(path);
    (modules[module] ||= []).push(`${path}\0${hash}`);
  }
  const moduleHashes = Object.fromEntries(Object.entries(modules).sort(([a], [b]) => order(a, b)).map(([name, rows]) => [name, digest(rows.join('\n'))]));
  const sourceDigest = digest(JSON.stringify(moduleHashes));
  let revision = null;
  if (typeof options.revision === 'string' && /^[a-f0-9]{40}$/i.test(options.revision)) revision = options.revision.toLowerCase();
  else if (options.git !== false) {
    try {
      const value = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
      if (/^[a-f0-9]{40}$/.test(value)) revision = value;
    } catch { /* Source archives do not contain Git metadata. */ }
  }
  return { id: `release-${sourceDigest}`, version: `${baseVersion}+${sourceDigest.slice(0, 10)}`, title, changes, revision, sourceDigest, moduleHashes, notesHash: digest(JSON.stringify({ title, changes })) };
}
