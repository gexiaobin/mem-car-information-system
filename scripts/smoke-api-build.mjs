import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

/** Exercise the actual Node bundle against an empty, isolated in-memory database. */
export async function smokeApiBuild({ root, expectedVersion } = {}) {
  root = resolve(root || dirname(fileURLToPath(import.meta.url)), root ? '' : '..');
  const temporaryRoot = resolve(tmpdir());
  const temporary = await mkdtemp(join(temporaryRoot, 'autovoyage-api-smoke-'));
  assert.equal(dirname(temporary), temporaryRoot);
  let child;
  let finished;
  let output = '';
  let exited = false;
  try {
    const port = await unusedPort();
    child = spawn(process.execPath, [join(root, 'apps/api/dist/server.js')], {
      cwd: join(root, 'apps/api'),
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        NODE_OPTIONS: '',
        DATABASE_DRIVER: 'pglite',
        PGLITE_PATH: ':memory:',
        SEED_DEMO: 'false',
        DEMO_MODE: 'false',
        SESSION_SECRET: 'autovoyage-isolated-build-smoke-0123456789',
        HOST: '127.0.0.1',
        PORT: String(port),
        APP_ORIGIN: `http://127.0.0.1:${port}`,
        UPLOAD_DIR: join(temporary, 'uploads'),
        PGHOST: '127.0.0.1',
        PGDATABASE: 'isolated_build_smoke',
        PGUSER: 'isolated_build_smoke',
        PGPASSWORD: '',
        PGSCHEMA: 'public',
        AI_API_KEY: '',
        AI_BASE_URL: '',
        AI_MODEL: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', chunk => { output = (output + chunk.toString()).slice(-64000); });
    }
    finished = new Promise(resolve => {
      child.once('error', error => {
        output += `\n${error.message}`;
        exited = true;
        resolve();
      });
      child.once('exit', () => { exited = true; resolve(); });
    });
    const deadline = Date.now() + 45000;
    let health;
    while (Date.now() < deadline && !exited) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          health = await response.json();
          break;
        }
      } catch { /* The child may still be initializing PGlite. */ }
      await pause(100);
    }
    assert.ok(health, `Native Node API bundle failed to start.\n${output}`);
    assert.equal(health.status, 'ok');
    assert.equal(health.database, 'pglite');
    if (expectedVersion) assert.equal(health.version, expectedVersion);
    process.stdout.write(`Native Node API smoke passed: ${health.version}, isolated ${health.database}.\n`);
    return health;
  } finally {
    if (child && !exited) {
      child.kill('SIGTERM');
      await Promise.race([finished, pause(3000)]);
      if (!exited) {
        child.kill('SIGKILL');
        await finished;
      }
    }
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await smokeApiBuild();
}
