export interface BuildReleaseManifest {
  id: string;
  version: string;
  title: string;
  changes: string[];
  revision: string | null;
  sourceDigest: string;
  moduleHashes: Record<string, string>;
  notesHash: string;
}
export function createReleaseManifest(options?: { root?: string; revision?: string; git?: boolean }): BuildReleaseManifest;
