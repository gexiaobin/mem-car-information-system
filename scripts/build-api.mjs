import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReleaseManifest } from './release-manifest.mjs';
import { smokeApiBuild } from './smoke-api-build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = createReleaseManifest({ root });
const result = await build({
  absWorkingDir: root, entryPoints: ['apps/api/src/server.ts'], outfile: 'apps/api/dist/server.js',
  bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external',
  // Workspace sources need compilation; only third-party packages stay external.
  alias: { '@autovoyage/shared': resolve(root, 'packages/shared/src/index.ts') },
  metafile: true,
  define: { __AUTOVOYAGE_RELEASE__: JSON.stringify(manifest) }, logLevel: 'info',
});
const unresolvedWorkspaceImports = Object.values(result.metafile.outputs)
  .flatMap(output => output.imports)
  .filter(dependency => dependency.external && dependency.path.startsWith('@autovoyage/'));
if (unresolvedWorkspaceImports.length) {
  throw new Error(`API build contains uncompiled workspace imports: ${unresolvedWorkspaceImports.map(dependency => dependency.path).join(', ')}`);
}
await smokeApiBuild({ root, expectedVersion: manifest.version });
process.stdout.write(`Release ${manifest.version} is embedded in the API build.\n`);
