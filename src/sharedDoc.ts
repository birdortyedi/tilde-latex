import * as Y from 'yjs';
import type { Project } from './projects';

// The text of a shared project, as a Yjs document: edits from several people
// merge by themselves, in any order, without a server. Saved to Drive as one
// file (see sharedSync.ts).
//
//   doc.getMap('files'): one entry per file, under an id that never changes,
//     so a rename and an edit made at the same time both survive:
//       'path'    e.g. "chapters/intro.tex"
//       'text'    a Y.Text, for text files
//       'driveId' for images and other binary files, which stay ordinary
//                 Drive files (too big to rewrite with every save)
//   doc.getMap('project'): 'name', 'mainFile', and the Drive ids of the
//     project's folder, mailbox file and uploads folder.

export interface SharedEntry {
  id: string;
  path: string;
  text?: Y.Text;
  driveId?: string;
}

export interface SharedIds {
  folderId: string; // the project's folder
  mailboxId: string; // "Tilde mailbox.tilde": who has the project open
  uploadsId: string; // "Tilde uploads": binary files collaborators add
}

const filesMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => doc.getMap('files');
const projectMap = (doc: Y.Doc): Y.Map<string> => doc.getMap('project');

function entryOf(id: string, map: Y.Map<unknown>): SharedEntry {
  const text = map.get('text');
  const driveId = map.get('driveId');
  return {
    id,
    path: String(map.get('path') ?? ''),
    ...(text instanceof Y.Text ? { text } : {}),
    ...(typeof driveId === 'string' ? { driveId } : {}),
  };
}

// Every file, sorted by path.
export function sharedFiles(doc: Y.Doc): SharedEntry[] {
  return [...filesMap(doc)].map(([id, map]) => entryOf(id, map)).sort((a, b) => a.path.localeCompare(b.path));
}

export function sharedFileAt(doc: Y.Doc, path: string): SharedEntry | undefined {
  return sharedFiles(doc).find((entry) => entry.path === path);
}

function addEntry(doc: Y.Doc, path: string, fill: (map: Y.Map<unknown>) => void): string {
  const id = crypto.randomUUID();
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    filesMap(doc).set(id, map);
    map.set('path', path);
    fill(map);
  });
  return id;
}

export function addSharedText(doc: Y.Doc, path: string, content: string): string {
  return addEntry(doc, path, (map) => map.set('text', new Y.Text(content)));
}

export function addSharedBinary(doc: Y.Doc, path: string, driveId: string): string {
  return addEntry(doc, path, (map) => map.set('driveId', driveId));
}

// Renames or moves a file; with a folder path, everything in that folder.
export function moveShared(doc: Y.Doc, from: string, to: string): void {
  doc.transact(() => {
    for (const [, map] of filesMap(doc)) {
      const path = String(map.get('path'));
      if (path === from) map.set('path', to);
      else if (path.startsWith(`${from}/`)) map.set('path', to + path.slice(from.length));
    }
  });
}

export function removeShared(doc: Y.Doc, path: string): void {
  const entry = sharedFileAt(doc, path);
  if (entry) filesMap(doc).delete(entry.id);
}

export function sharedMainFile(doc: Y.Doc): string | undefined {
  return projectMap(doc).get('mainFile');
}

export function setSharedMainFile(doc: Y.Doc, path: string): void {
  projectMap(doc).set('mainFile', path);
}

export function sharedName(doc: Y.Doc): string {
  return projectMap(doc).get('name') ?? 'Shared project';
}

export function setSharedName(doc: Y.Doc, name: string): void {
  projectMap(doc).set('name', name);
}

export function sharedIds(doc: Y.Doc): SharedIds | null {
  const map = projectMap(doc);
  const [folderId, mailboxId, uploadsId] = [map.get('folderId'), map.get('mailboxId'), map.get('uploadsId')];
  return folderId && mailboxId && uploadsId ? { folderId, mailboxId, uploadsId } : null;
}

// A new shared document from a project: its text files with their text, its
// binary files by their Drive id.
export function docFromProject(project: Project, ids: SharedIds): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const map = projectMap(doc);
    map.set('name', project.name);
    map.set('folderId', ids.folderId);
    map.set('mailboxId', ids.mailboxId);
    map.set('uploadsId', ids.uploadsId);
    if (project.mainFile) map.set('mainFile', project.mainFile);
    for (const file of project.files) {
      if (typeof file.content === 'string') addSharedText(doc, file.path, file.content);
      else if (file.driveId) addSharedBinary(doc, file.path, file.driveId);
    }
  });
  return doc;
}

// Two people can make a file of the same name at the same moment. Every
// browser renames the later one (by id) the same way, "intro (2).tex", so
// they all end up with the same names. Returns whether anything was renamed.
export function fixDuplicatePaths(doc: Y.Doc): boolean {
  const taken = new Set<string>();
  const renames: [Y.Map<unknown>, string][] = [];
  const byId = [...filesMap(doc)].sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [, map] of byId) {
    const path = String(map.get('path'));
    if (!taken.has(path)) {
      taken.add(path);
      continue;
    }
    const dot = path.lastIndexOf('.');
    const slash = path.lastIndexOf('/');
    const [base, extension] = dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ''];
    let n = 2;
    while (taken.has(`${base} (${n})${extension}`)) n++;
    const free = `${base} (${n})${extension}`;
    taken.add(free);
    renames.push([map, free]);
  }
  if (renames.length > 0) doc.transact(() => { for (const [map, path] of renames) map.set('path', path); });
  return renames.length > 0;
}

// Whether `saved` (a document as it is stored in Drive) lacks anything of
// `doc`: an edit, a deletion or a file. If so, this browser must save.
// Applying our document to a copy of the saved one reports an update only
// when it brings something new.
export function savedLacks(saved: Uint8Array, doc: Y.Doc): boolean {
  const copy = new Y.Doc();
  if (saved.length > 0) Y.applyUpdate(copy, saved);
  let changed = false;
  copy.on('update', () => { changed = true; });
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  copy.destroy();
  return changed;
}
