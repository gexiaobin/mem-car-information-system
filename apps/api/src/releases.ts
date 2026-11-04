import { z } from 'zod';
import type { SystemRelease, SystemReleasesResponse } from '@autovoyage/shared';
import { createReleaseManifest, type BuildReleaseManifest } from '../../../scripts/release-manifest.mjs';
import type { Context } from './context.js';
import { authenticated, route } from './context.js';
import type { Database } from './db.js';
import { ensure } from './domain.js';

declare const __AUTOVOYAGE_RELEASE__: BuildReleaseManifest | undefined;
export const runningRelease: BuildReleaseManifest = typeof __AUTOVOYAGE_RELEASE__ === 'undefined' ? createReleaseManifest() : __AUTOVOYAGE_RELEASE__;
interface StoredSystemRelease extends SystemRelease { sourceDigest: string; moduleHashes: Record<string, string>; notesHash: string }
const moduleChanges: Record<string, string> = {
  catalog: '车型与参考服务目录更新。', manuals: '保养手册与规则功能更新。', api: '业务服务与数据校验更新。',
  web: '页面展示与交互体验优化。', shared: '公共业务状态与数据结构更新。', operations: '系统配置与运行维护更新。',
};
const publicRelease = (value: StoredSystemRelease): SystemRelease => ({ id: value.id, version: value.version, title: value.title, changes: value.changes, deployedAt: value.deployedAt, revision: value.revision });

/** The insert-only identity keeps the first successful deployment time stable across restarts and rollbacks. */
export async function recordRelease(db: Database, manifest: BuildReleaseManifest = runningRelease, deployedAt = new Date().toISOString()): Promise<SystemRelease> {
  return db.transaction(async sql => {
    await sql.query('LOCK TABLE av_releases IN SHARE ROW EXCLUSIVE MODE');
    const found = await sql.query<{ data: StoredSystemRelease }>('SELECT data FROM av_releases WHERE id=$1', [manifest.id]);
    if (found[0]) return publicRelease(found[0].data);
    const previous = (await sql.query<{ data: StoredSystemRelease }>("SELECT data FROM av_releases ORDER BY data->>'deployedAt' DESC, id DESC LIMIT 1"))[0]?.data;
    const freshNotes = !previous || previous.notesHash !== manifest.notesHash;
    const changedModules = [...new Set([...Object.keys(manifest.moduleHashes), ...Object.keys(previous?.moduleHashes || {})])].filter(name => !previous || previous.moduleHashes[name] !== manifest.moduleHashes[name]);
    const changes = freshNotes && manifest.changes.length ? manifest.changes : changedModules.map(name => moduleChanges[name] || '系统功能与体验更新。');
    const value: StoredSystemRelease = {
      id: manifest.id, version: manifest.version, title: freshNotes ? manifest.title : '云程功能与体验更新',
      changes: [...new Set(changes.length ? changes : ['系统运行版本更新。'])], deployedAt, revision: manifest.revision,
      sourceDigest: manifest.sourceDigest, moduleHashes: manifest.moduleHashes, notesHash: manifest.notesHash,
    };
    await sql.query('INSERT INTO av_releases (id,data) VALUES ($1,$2::jsonb) ON CONFLICT (id) DO NOTHING', [value.id, JSON.stringify(value)]);
    return publicRelease(value);
  });
}

export function registerReleases({ app, db }: Context) {
  let deployment: Promise<SystemRelease> | undefined;
  let failed = false;
  const recordDeployment = () => deployment ||= recordRelease(db).catch(error => { failed = true; throw error; });
  app.addHook('onListen', async () => { await recordDeployment(); });
  app.get(route('/releases'), async request => {
    authenticated(request);
    const query = z.object({ offset: z.coerce.number().int().min(0).max(100000).default(0), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    const result = await db.query<{ data: StoredSystemRelease }>("SELECT data FROM av_releases ORDER BY data->>'deployedAt' DESC, id DESC LIMIT $1 OFFSET $2", [query.limit, query.offset]);
    const counts = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM av_releases');
    return { currentVersion: runningRelease.version, currentReleaseId: runningRelease.id, items: result.map(row => publicRelease(row.data)), total: Number(counts[0].count), ...query } satisfies SystemReleasesResponse;
  });
  return { recordDeployment, assertHealthy: () => ensure(!failed, 503, 'RELEASE_RECORD_FAILED', '系统更新记录写入失败，请检查服务启动状态') };
}
