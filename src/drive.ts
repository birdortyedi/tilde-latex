import { forgetToken, getAccessToken, SignInNeededError } from './auth';

// Thin wrapper around the Google Drive API v3, using plain fetch calls.
// See https://developers.google.com/drive/api/reference/rest/v3/files

export const FOLDER_TYPE = 'application/vnd.google-apps.folder';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  // Changes every time the file's content is saved; used to notice that
  // another computer changed the file since we loaded it.
  headRevisionId?: string;
  // Small private notes Tilde keeps on a file, e.g. a project's main file.
  appProperties?: Record<string, string>;
  modifiedTime?: string; // e.g. "2026-11-02T13:01:14.810Z"
  trashed?: boolean; // in Drive's trash (deleted, restorable for 30 days)
  parents?: string[]; // the folder it is in
  ownedByMe?: boolean; // made by this account (or given to it), not someone else's
}

// Someone (or everyone with the link) who may open a file or folder.
export interface Permission {
  id: string;
  type: string; // "user", "group", "domain" or "anyone"
  role: string; // "owner", "writer", "commenter" or "reader"
  emailAddress?: string;
  displayName?: string;
  domain?: string;
  photoLink?: string;
}

export type Role = 'writer' | 'reader';

// A Google account as others see it: its name, and the address of its profile photo, if it has one.
export interface Profile {
  name: string;
  photo?: string;
}

// Changes to a file's details (not its content).
export interface MetadataChanges {
  name?: string;
  trashed?: boolean; // true moves it to Drive's trash, restorable for 30 days
  appProperties?: Record<string, string | null>; // null removes a note
}

// The Drive operations Tilde needs. Tests use an in-memory fake instead.
export interface Drive {
  // Files and folders carrying one of Tilde's private notes (not in the trash).
  findByProperty(key: string, value: string): Promise<DriveFile[]>;
  // A stable id of the signed-in Google account (not the email address).
  whoAmI(): Promise<string>;
  // The signed-in account's name and profile photo, as Google shows them, for "who is here".
  myProfile(): Promise<Profile>;
  list(folderId: string): Promise<DriveFile[]>;
  get(fileId: string): Promise<DriveFile>;
  download(fileId: string): Promise<Uint8Array>;
  createFolder(name: string, parentId: string): Promise<DriveFile>;
  createFile(name: string, parentId: string, content: Uint8Array): Promise<DriveFile>;
  updateFile(fileId: string, content: Uint8Array): Promise<DriveFile>;
  // Changes a file's details; with `move`, also moves it to another folder.
  updateMetadata(fileId: string, changes: MetadataChanges, move?: { from: string; to: string }): Promise<DriveFile>;
  // Asks Drive to keep one version of a file forever. Drive cannot undo this
  // (only delete the version), so Tilde never does. Returns that version and when it was saved.
  keepRevision(fileId: string, revisionId: string): Promise<{ id: string; modifiedTime?: string }>;
  // The content of an old version of a file.
  downloadRevision(fileId: string, revisionId: string): Promise<Uint8Array>;
  // Shares a file or folder Tilde made with someone, who may edit it (or
  // only view it). Google emails them, with `message` in the email.
  share(fileId: string, email: string, message: string, role?: Role): Promise<void>;
  // Who may open a file or folder, and changing or taking that away.
  permissions(fileId: string): Promise<Permission[]>;
  setRole(fileId: string, permissionId: string, role: Role): Promise<void>;
  removePermission(fileId: string, permissionId: string): Promise<void>;
  // Whether the signed-in account may change a file (and not only view it).
  canEdit(fileId: string): Promise<boolean>;
  // Lets anyone with the link view a file Tilde made (no Google account needed).
  shareByLink(fileId: string): Promise<void>;
}

// Thrown when Drive cannot be reached because the computer is offline.
export class OfflineError extends Error {
  constructor() {
    super('Offline');
  }
}

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const FIELDS = 'id,name,mimeType,headRevisionId,appProperties,modifiedTime,trashed,parents,ownedByMe';

// Drive's error answer is JSON; its reason and message are what a person can read.
function driveProblem(text: string): string {
  try {
    const { error } = JSON.parse(text) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const reason = error?.errors?.[0]?.reason;
    if (error?.message) return reason ? `${error.message} (${reason})` : error.message;
  } catch {
    // Not JSON: as it is.
  }
  return text;
}

export const RETRIES = 5; // tries again up to this often, waiting 1, 2, 4, 8 and 16 seconds

async function request(url: string, init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    if (!navigator.onLine) throw new OfflineError();
    const token = await getAccessToken();
    let response: Response;
    try {
      response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    } catch {
      throw new OfflineError(); // fetch only fails like this when the network is unreachable
    }
    if (response.status === 401) {
      forgetToken();
      throw new SignInNeededError();
    }
    if (response.ok) return response;
    const text = await response.text();
    // Drive asks to slow down with 429, or 403 "rateLimitExceeded" (also
    // "userRateLimitExceeded"): the request was not carried out, so it can
    // be sent again. A 5xx is trouble on Google's side; only reading is
    // tried again then, since a change may have gone through after all.
    const slowDown = response.status === 429 || (response.status === 403 && /rateLimitExceeded/i.test(text));
    const readFailed = response.status >= 500 && (init.method ?? 'GET') === 'GET';
    if (!(slowDown || readFailed) || attempt >= RETRIES) throw new Error(`Google Drive answered ${response.status}: ${driveProblem(text)}`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt + Math.random() * 1000));
  }
}

// A Drive id as part of an address. Ids are letters, digits, - and _ only;
// anything else (an id taken from a shared file someone else wrote, say
// "../files?q=…") could make the address ask Drive for something else.
export function at(id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Not a Google Drive id: ${id.slice(0, 40)}`);
  return id;
}

export const googleDrive: Drive = {
  async findByProperty(key, value) {
    const params = new URLSearchParams({
      q: `appProperties has { key='${key}' and value='${value}' } and trashed = false`,
      fields: `files(${FIELDS})`,
      orderBy: 'modifiedTime desc',
    });
    return ((await (await request(`${API}?${params}`)).json()) as { files: DriveFile[] }).files;
  },

  async whoAmI() {
    const about = (await (await request(`https://www.googleapis.com/drive/v3/about?fields=user(permissionId)`)).json()) as
      { user: { permissionId: string } };
    return about.user.permissionId;
  },

  async myProfile() {
    const about = (await (await request('https://www.googleapis.com/drive/v3/about?fields=user(displayName,photoLink)')).json()) as
      { user: { displayName?: string; photoLink?: string } };
    return { name: about.user.displayName ?? 'Someone', ...(about.user.photoLink ? { photo: about.user.photoLink } : {}) };
  },

  // Lists a folder's files and subfolders (not the ones in the trash).
  async list(folderId) {
    const files: DriveFile[] = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        q: `'${at(folderId)}' in parents and trashed = false`,
        fields: `nextPageToken,files(${FIELDS})`,
        pageSize: '1000',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = (await (await request(`${API}?${params}`)).json()) as { files: DriveFile[]; nextPageToken?: string };
      files.push(...page.files);
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    return files;
  },

  async get(fileId) {
    return (await request(`${API}/${at(fileId)}?fields=${FIELDS}`)).json();
  },

  async download(fileId) {
    return new Uint8Array(await (await request(`${API}/${at(fileId)}?alt=media`)).arrayBuffer());
  },

  async createFolder(name, parentId) {
    const response = await request(`${API}?fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [parentId], mimeType: FOLDER_TYPE }),
    });
    return response.json();
  },

  // Uploads a new file: its name and folder, then its content, in one request.
  async createFile(name, parentId, content) {
    const boundary = `tilde-${crypto.randomUUID()}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify({ name, parents: [parentId] }),
      `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      content.slice(),
      `\r\n--${boundary}--`,
    ]);
    const response = await request(`${UPLOAD_API}?uploadType=multipart&fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return response.json();
  },

  async updateMetadata(fileId, changes, move) {
    const params = new URLSearchParams({ fields: FIELDS });
    if (move) {
      params.set('addParents', move.to);
      params.set('removeParents', move.from);
    }
    const response = await request(`${API}/${at(fileId)}?${params}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    return response.json();
  },

  async keepRevision(fileId, revisionId) {
    const response = await request(`${API}/${at(fileId)}/revisions/${at(revisionId)}?fields=id,modifiedTime`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepForever: true }),
    });
    return response.json();
  },

  async share(fileId, email, message, role = 'writer') {
    const params = new URLSearchParams({ sendNotificationEmail: 'true', emailMessage: message });
    await request(`${API}/${at(fileId)}/permissions?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, type: 'user', emailAddress: email }),
    });
  },

  async permissions(fileId) {
    const fields = 'permissions(id,type,role,emailAddress,displayName,domain,photoLink)';
    return ((await (await request(`${API}/${at(fileId)}/permissions?fields=${fields}`)).json()) as { permissions: Permission[] }).permissions;
  },

  async setRole(fileId, permissionId, role) {
    await request(`${API}/${at(fileId)}/permissions/${at(permissionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
  },

  async removePermission(fileId, permissionId) {
    await request(`${API}/${at(fileId)}/permissions/${at(permissionId)}`, { method: 'DELETE' });
  },

  async canEdit(fileId) {
    const file = (await (await request(`${API}/${at(fileId)}?fields=capabilities(canEdit)`)).json()) as { capabilities?: { canEdit?: boolean } };
    return file.capabilities?.canEdit ?? false;
  },

  async shareByLink(fileId) {
    await request(`${API}/${at(fileId)}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
  },

  async downloadRevision(fileId, revisionId) {
    return new Uint8Array(await (await request(`${API}/${at(fileId)}/revisions/${at(revisionId)}?alt=media`)).arrayBuffer());
  },

  // Replaces a file's content. Drive keeps the old content in its version history.
  async updateFile(fileId, content) {
    const response = await request(`${UPLOAD_API}/${at(fileId)}?uploadType=media&fields=${FIELDS}`, {
      method: 'PATCH',
      body: content.slice(),
    });
    return response.json();
  },
};
