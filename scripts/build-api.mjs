import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReleaseManifest } from './release-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = createReleaseManifest({ root });
await build({
  absWorkingDir: root, entryPoints: ['apps/api/src/server.ts'], outfile: 'apps/api/dist/server.js',
  bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external',
  define: { __AUTOVOYAGE_RELEASE__: JSON.stringify(manifest) }, logLevel: 'info',
});
process.stdout.write(`Release ${manifest.version} is embedded in the API build.\n`);
