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
}

// Changes to a file's details (not its content).
export interface MetadataChanges {
  name?: string;
  trashed?: boolean; // true moves it to Drive's trash, restorable for 30 days
  appProperties?: Record<string, string>;
}

// The Drive operations Tilde needs. Tests use an in-memory fake instead.
export interface Drive {
  // A stable id of the signed-in Google account (not the email address).
  whoAmI(): Promise<string>;
  list(folderId: string): Promise<DriveFile[]>;
  get(fileId: string): Promise<DriveFile>;
  download(fileId: string): Promise<Uint8Array>;
  createFolder(name: string, parentId: string): Promise<DriveFile>;
  createFile(name: string, parentId: string, content: Uint8Array): Promise<DriveFile>;
  updateFile(fileId: string, content: Uint8Array): Promise<DriveFile>;
  // Changes a file's details; with `move`, also moves it to another folder.
  updateMetadata(fileId: string, changes: MetadataChanges, move?: { from: string; to: string }): Promise<DriveFile>;
}

// Thrown when Drive cannot be reached because the computer is offline.
export class OfflineError extends Error {
  constructor() {
    super('Offline');
  }
}

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const FIELDS = 'id,name,mimeType,headRevisionId,appProperties,modifiedTime';

async function request(url: string, init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {}): Promise<Response> {
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
  if (!response.ok) throw new Error(`Google Drive answered ${response.status}: ${await response.text()}`);
  return response;
}

export const googleDrive: Drive = {
  async whoAmI() {
    const about = (await (await request(`https://www.googleapis.com/drive/v3/about?fields=user(permissionId)`)).json()) as
      { user: { permissionId: string } };
    return about.user.permissionId;
  },

  // Lists a folder's files and subfolders (not the ones in the trash).
  async list(folderId) {
    const files: DriveFile[] = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
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
    return (await request(`${API}/${fileId}?fields=${FIELDS}`)).json();
  },

  async download(fileId) {
    return new Uint8Array(await (await request(`${API}/${fileId}?alt=media`)).arrayBuffer());
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
    const response = await request(`${API}/${fileId}?${params}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    return response.json();
  },

  // Replaces a file's content. Drive keeps the old content in its version history.
  async updateFile(fileId, content) {
    const response = await request(`${UPLOAD_API}/${fileId}?uploadType=media&fields=${FIELDS}`, {
      method: 'PATCH',
      body: content.slice(),
    });
    return response.json();
  },
};
