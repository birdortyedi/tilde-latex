import * as Y from 'yjs';
import { FOLDER_TYPE, type Drive, type DriveFile } from './drive';
import type { Project } from './projects';
import { docFromProject, sharedIds, type SharedIds } from './sharedDoc';

// Sharing a project with co-authors, through Drive alone. With drive.file,
// each person's Tilde sees only the files it created and the files that
// person picked, so a file one person adds later is invisible to the others.
// That is why the text lives in one file everyone picks once when joining.

export const SHARED_FILE = 'Tilde shared project.tilde'; // the text, as a Yjs document
export const MAILBOX_FILE = 'Tilde mailbox.tilde'; // who has the project open
export const UPLOADS_FOLDER = 'Tilde uploads'; // images and other binary files collaborators add
const JOINED_FILE = 'Tilde joined projects.tilde'; // in a collaborator's own projects folder

// Tilde's own files in a shared project's folder, which are not part of the LaTeX project.
export const isTildeFile = (file: DriveFile): boolean =>
  file.name.endsWith('.tilde') || (file.mimeType === FOLDER_TYPE && file.name === UPLOADS_FOLDER);

export interface LoadedShared {
  stateId: string;
  doc: Y.Doc;
  saved: Uint8Array; // the document as it was in Drive
  revision?: string;
}

export async function loadShared(drive: Drive, stateId: string): Promise<LoadedShared> {
  const [info, saved] = await Promise.all([drive.get(stateId), drive.download(stateId)]);
  const doc = new Y.Doc();
  if (saved.length > 0) Y.applyUpdate(doc, saved);
  return { stateId, doc, saved, revision: info.headRevisionId };
}

// The shared document of a project folder, if the project is shared.
export async function sharedStateIn(drive: Drive, folderId: string): Promise<string | undefined> {
  return (await drive.list(folderId)).find((file) => file.name === SHARED_FILE && !file.trashed)?.id;
}

// Makes a project shared: adds the mailbox, the uploads folder and the shared
// document (its text files and references to its binary files) to its folder.
export async function makeShared(drive: Drive, project: Project): Promise<LoadedShared> {
  const folderId = project.driveId;
  if (!folderId) throw new Error(`${project.name} is not in Google Drive.`);
  const mailbox = await drive.createFile(MAILBOX_FILE, folderId, new TextEncoder().encode('{}'));
  const uploads = await drive.createFolder(UPLOADS_FOLDER, folderId);
  const doc = docFromProject(project, { folderId, mailboxId: mailbox.id, uploadsId: uploads.id });
  const saved = Y.encodeStateAsUpdate(doc);
  const state = await drive.createFile(SHARED_FILE, folderId, saved);
  return { stateId: state.id, doc, saved, revision: state.headRevisionId };
}

// The address that opens the "join" steps for a shared project.
export function joinLink(folderId: string, base = `${location.origin}${import.meta.env.BASE_URL}`): string {
  return `${base}#join=${folderId}`;
}

// The folder id in a join link's address, if this page was opened with one.
export function joinTarget(hash: string): string | null {
  return /^#join=([\w-]+)$/.exec(hash)?.[1] ?? null;
}

// Shares the project's folder with someone; Google emails them the link.
export async function invite(drive: Drive, project: Project, email: string, from: string, link: string): Promise<void> {
  if (!project.driveId) throw new Error(`${project.name} is not in Google Drive.`);
  await drive.share(project.driveId, email, `${from} shares the LaTeX project "${project.name}" with you in Tilde. `
    + `To write in it together, open this link and sign in with this Google account: ${link}`);
}

// What a collaborator picked when joining: the shared document, and whether
// the mailbox and uploads folder are among the picked files too.
export async function joinFromPicked(drive: Drive, pickedIds: string[]): Promise<{ loaded: LoadedShared; ids: SharedIds; missing: string[] }> {
  const picked = new Set(pickedIds);
  const files = await Promise.all(pickedIds.map((id) => drive.get(id)));
  const state = files.find((file) => file.name === SHARED_FILE);
  if (!state) throw new Error(`"${SHARED_FILE}" was not among the chosen files. Choose again and select everything in the folder.`);
  const loaded = await loadShared(drive, state.id);
  const ids = sharedIds(loaded.doc);
  if (!ids) throw new Error(`"${SHARED_FILE}" is damaged: it does not say where the project's files are.`);
  const missing = [[MAILBOX_FILE, ids.mailboxId], [UPLOADS_FOLDER, ids.uploadsId]]
    .filter(([, id]) => !picked.has(id)).map(([name]) => name);
  return { loaded, ids, missing };
}

// The projects others shared with this account, kept in a small file in
// its own projects folder, so its other computers know them too.
export interface Joined {
  folderId: string;
  stateId: string;
  name: string;
}

async function joinedFile(drive: Drive, rootId: string): Promise<DriveFile | undefined> {
  return (await drive.list(rootId)).find((file) => file.name === JOINED_FILE);
}

export async function joinedProjects(drive: Drive, rootId: string): Promise<Joined[]> {
  const file = await joinedFile(drive, rootId);
  if (!file) return [];
  try {
    const list: unknown = JSON.parse(new TextDecoder().decode(await drive.download(file.id)));
    return Array.isArray(list) ? list.filter((j): j is Joined => typeof j?.folderId === 'string' && typeof j?.stateId === 'string') : [];
  } catch {
    return [];
  }
}

// Adds a project to the list, or updates its name.
export async function rememberJoined(drive: Drive, rootId: string, joined: Joined): Promise<void> {
  await writeJoined(drive, rootId, [...(await joinedProjects(drive, rootId)).filter((j) => j.stateId !== joined.stateId), joined]);
}

// Leaving a project: it leaves the list. The owner still shares the folder
// (only they can stop that, in Drive), so the join link brings it back.
export async function forgetJoined(drive: Drive, rootId: string, folderId: string): Promise<void> {
  await writeJoined(drive, rootId, (await joinedProjects(drive, rootId)).filter((j) => j.folderId !== folderId));
}

async function writeJoined(drive: Drive, rootId: string, list: Joined[]): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(list));
  const file = await joinedFile(drive, rootId);
  if (file) await drive.updateFile(file.id, bytes);
  else await drive.createFile(JOINED_FILE, rootId, bytes);
}
