import type { FileInput, TexliveRemoteFile } from 'texlyre-busytex';
import { PACKAGES, run } from './database';

// TeX package files the engine downloaded from the package server (TikZ,
// pgfplots, ...). The engine keeps them in REMOTE_DIR as "<format>_<name>",
// for example "26_tikz.sty", but forgets them when the page is closed.
// Tilde keeps a copy in the browser and hands them back to the engine when it
// starts, so each file is downloaded only once and later compiles work offline.

export const REMOTE_DIR = '/tmp/texlive_remote';

interface CachedPackage {
  path: string; // e.g. "26_tikz.sty"
  server: string; // the package server it came from (a new TeX Live year means a new server)
  content: Uint8Array;
}

const known = new Set<string>(); // paths already in the cache

// "26_tikz.sty" → the engine's own description: name "tikz.sty", format 26.
export function toRemoteFile(path: string, content: Uint8Array): TexliveRemoteFile | null {
  const match = /^(\d+)_(.+)$/.exec(path);
  return match ? { format: Number(match[1]), name: match[2], content } : null;
}

// All cached files from this server, ready for runner.writeTexliveRemoteFiles.
// Files from another (older) server are deleted.
export async function cachedPackages(server: string): Promise<TexliveRemoteFile[]> {
  const files: TexliveRemoteFile[] = [];
  for (const cached of await run(PACKAGES, 'readonly', (store) => store.getAll() as IDBRequest<CachedPackage[]>)) {
    const file = toRemoteFile(cached.path, cached.content);
    if (cached.server !== server || !file) {
      await run(PACKAGES, 'readwrite', (store) => store.delete(cached.path));
      continue;
    }
    files.push(file);
    known.add(cached.path);
  }
  return files;
}

// Stores the files from REMOTE_DIR that are not cached yet. Returns how many were new.
export async function storeNewPackages(server: string, files: FileInput[]): Promise<number> {
  const fresh = files.filter((f) => !known.has(f.path) && toRemoteFile(f.path, new Uint8Array()));
  for (const file of fresh) {
    const content = typeof file.content === 'string' ? new TextEncoder().encode(file.content) : file.content;
    const cached: CachedPackage = { path: file.path, server, content };
    await run(PACKAGES, 'readwrite', (store) => store.put(cached));
    known.add(file.path);
  }
  return fresh.length;
}
