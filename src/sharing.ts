import * as Y from 'yjs';
import { FOLDER_TYPE, type Drive, type DriveFile, type Role } from './drive';
import type { Project, SafeCopy } from './projects';
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
  file.name.endsWith('.tilde') || (file.mimeType === FOLDER_TYPE && file.name === UPLOADS_FOLDER) || file.appProperties?.tilde === 'shared-pdf';

export interface LoadedShared {
  stateId: string;
  doc: Y.Doc;
  saved: Uint8Array; // the document as it was in Drive
  revision?: string;
  safeCopy?: SafeCopy; // the version of the whole project kept forever lately (see SharedSync)
  ids: SharedIds; // the project's folder, mailbox and uploads folder, checked (see checkedIds)
}

// Tilde's notes on the shared file: its version kept forever, and when that version was saved.
export const SHARED_SAFE_COPY = 'tildeSafeCopy';
export const SHARED_SAFE_COPY_TIME = 'tildeSafeCopyTime';

// folderId: the project's folder, as this account knows it (its own project
// list, or the join link), never as the shared document says.
export async function loadShared(drive: Drive, stateId: string, folderId: string): Promise<LoadedShared> {
  const [info, saved] = await Promise.all([drive.get(stateId), drive.download(stateId)]);
  const doc = new Y.Doc();
  if (saved.length > 0) Y.applyUpdate(doc, saved);
  const ids = await checkedIds(drive, doc, info, folderId);
  const kept = info.appProperties?.[SHARED_SAFE_COPY];
  const keptTime = info.appProperties?.[SHARED_SAFE_COPY_TIME];
  return { stateId, doc, saved, revision: info.headRevisionId, ids, ...(kept && keptTime ? { safeCopy: { revision: kept, time: keptTime } } : {}) };
}

// Drive's answer when this account's Tilde may not see a file (drive.file).
export const cannotSee = (error: unknown): boolean => error instanceof Error && /^Google Drive answered 40[34]\b/.test(error.message)
  && !/rateLimitExceeded/i.test(error.message);

const damaged = (): Error => new Error(`This shared project's "${SHARED_FILE}" points to files outside the project's folder, `
  + 'so Tilde did not open it. Ask the project\'s owner to look at it.');

// Where the project's mailbox and uploads folder are. Anyone who may write
// in the project can change what the shared document says, so Tilde checks
// with Drive that each is what it should be, in the project's folder, before
// writing to it. (One Tilde may not see is left as it is: Tilde cannot write
// to it either.)
async function checkedIds(drive: Drive, doc: Y.Doc, state: DriveFile, folderId: string): Promise<SharedIds> {
  const said = sharedIds(doc);
  if (!said) throw new Error(`"${SHARED_FILE}" is damaged: it does not say where the project's files are.`);
  const inFolder = (file: DriveFile) => !file.parents || file.parents.includes(folderId);
  if (!inFolder(state)) throw damaged();
  const look = (id: string) => drive.get(id).catch((error: unknown) => {
    if (cannotSee(error) || !/^[\w-]+$/.test(id)) return null;
    throw error;
  });
  const [mailbox, uploads] = await Promise.all([look(said.mailboxId), look(said.uploadsId)]);
  if (mailbox && !(mailbox.name === MAILBOX_FILE && inFolder(mailbox))) throw damaged();
  if (uploads && !(uploads.name === UPLOADS_FOLDER && uploads.mimeType === FOLDER_TYPE && inFolder(uploads))) throw damaged();
  return { folderId, mailboxId: said.mailboxId, uploadsId: said.uploadsId };
}

// Whether a binary file the shared document names is one of this project's:
// in its folder (or a folder in it), or in its uploads folder. Anyone who may
// write can put any Drive id in the document; without this, a co-author could
// make someone's Tilde read a file of theirs from another project and copy it
// into this one. Walks up through the folders. Tilde may not see the folders
// of someone else's project (drive.file): one of theirs it cannot look past
// counts as this project's; one of this account's own never does.
export async function inProject(drive: Drive, fileId: string, ids: SharedIds): Promise<boolean> {
  let file = await drive.get(fileId);
  for (let depth = 0; depth < 32; depth++) {
    const parent = file.parents?.[0];
    if (!parent) return false;
    if (parent === ids.folderId || parent === ids.uploadsId) return true;
    try {
      file = await drive.get(parent);
    } catch (error) {
      if (cannotSee(error)) return file.ownedByMe === false;
      throw error;
    }
  }
  return false;
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
  return { stateId: state.id, doc, saved, revision: state.headRevisionId, ids: { folderId, mailboxId: mailbox.id, uploadsId: uploads.id } };
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
// With role "reader", they may read and compile it, not change it.
export async function invite(drive: Drive, project: Project, email: string, from: string, link: string, role: Role = 'writer'): Promise<void> {
  if (!project.driveId) throw new Error(`${project.name} is not in Google Drive.`);
  await drive.share(project.driveId, email, `${from} shares the LaTeX project "${project.name}" with you in Tilde`
    + (role === 'reader' ? ', to read. To open it' : '. To write in it together') + `, open this link and sign in with this Google account: ${link}`, role);
}

// What a collaborator picked when joining: the shared document, and whether
// the mailbox and uploads folder are among the picked files too.
export async function joinFromPicked(drive: Drive, pickedIds: string[], folderId: string): Promise<{ loaded: LoadedShared; ids: SharedIds; missing: string[] }> {
  const picked = new Set(pickedIds);
  const files = await Promise.all(pickedIds.map((id) => drive.get(id)));
  const state = files.find((file) => file.name === SHARED_FILE);
  if (!state) throw new Error(`"${SHARED_FILE}" was not among the chosen files. Choose again and select everything in the folder.`);
  const loaded = await loadShared(drive, state.id, folderId);
  const ids = loaded.ids;
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
