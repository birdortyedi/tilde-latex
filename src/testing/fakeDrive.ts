import { SignInNeededError } from '../auth';
import { FOLDER_TYPE, OfflineError, type Drive, type DriveFile, type MetadataChanges } from '../drive';

// An in-memory stand-in for Google Drive. Each upload gets a new revision id,
// like the real Drive.
export class FakeDrive implements Drive {
  offline = false; // set to true to act like a lost network
  signedOut = false; // set to true to act like an expired Google token
  items = new Map<string, DriveFile & { parentId: string; content?: Uint8Array; trashed?: boolean }>();
  // Every version ever saved, by revision id, and the ones kept forever.
  revisions = new Map<string, { content: Uint8Array; time: string }>();
  keptForever = new Set<string>();
  private nextId = 1;

  private add(name: string, parentId: string, mimeType: string, content?: Uint8Array): DriveFile {
    const id = `id${this.nextId++}`;
    const item = { id, name, parentId, mimeType, content, headRevisionId: content ? `rev${this.nextId++}` : undefined };
    this.items.set(id, item);
    if (content && item.headRevisionId) this.revisions.set(item.headRevisionId, { content, time: new Date().toISOString() });
    return this.info(id);
  }

  private check(): void {
    if (this.offline) throw new OfflineError();
    if (this.signedOut) throw new SignInNeededError();
  }

  private item(id: string) {
    const item = this.items.get(id);
    if (!item) throw new Error(`No file ${id}`);
    return item;
  }

  private info(id: string): DriveFile {
    const { name, mimeType, headRevisionId, appProperties } = this.item(id);
    return { id, name, mimeType, headRevisionId, ...(appProperties ? { appProperties } : {}) };
  }

  // A path like "LaTeX Projects/paper/figures/plot.png" → that file's text.
  read(path: string): string | undefined {
    let parentId = 'root';
    let item;
    for (const name of path.split('/')) {
      item = [...this.items.values()].find((i) => i.parentId === parentId && i.name === name && !i.trashed);
      if (!item) return undefined;
      parentId = item.id;
    }
    return item?.content && new TextDecoder().decode(item.content);
  }

  async whoAmI() { this.check(); return 'me'; }
  async findByProperty(key: string, value: string) {
    this.check();
    return [...this.items.values()].filter((i) => !i.trashed && i.appProperties?.[key] === value).map((i) => this.info(i.id));
  }
  async list(folderId: string) {
    this.check();
    return [...this.items.values()].filter((i) => i.parentId === folderId && !i.trashed).map((i) => this.info(i.id));
  }
  async get(fileId: string) { this.check(); return this.info(fileId); }
  async download(fileId: string) { this.check(); return this.item(fileId).content ?? new Uint8Array(); }
  async createFolder(name: string, parentId: string) { this.check(); return this.add(name, parentId, FOLDER_TYPE); }
  async createFile(name: string, parentId: string, content: Uint8Array) {
    this.check();
    return this.add(name, parentId, 'application/octet-stream', content);
  }
  async updateMetadata(fileId: string, changes: MetadataChanges, move?: { from: string; to: string }) {
    this.check();
    const item = this.item(fileId);
    if (move && item.parentId !== move.from) throw new Error(`${item.name} is not in ${move.from}`);
    if (move) item.parentId = move.to;
    if (changes.name !== undefined) item.name = changes.name;
    if (changes.trashed !== undefined) item.trashed = changes.trashed;
    if (changes.appProperties) {
      // Like Drive: new notes are added, a null removes one.
      const merged = { ...item.appProperties, ...changes.appProperties };
      item.appProperties = Object.fromEntries(Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== null));
    }
    return this.info(fileId);
  }
  async updateFile(fileId: string, content: Uint8Array) {
    this.check();
    const item = this.item(fileId);
    item.content = content;
    item.headRevisionId = `rev${this.nextId++}`;
    this.revisions.set(item.headRevisionId, { content, time: new Date().toISOString() });
    return this.info(fileId);
  }
  async keepRevision(_fileId: string, revisionId: string) {
    this.check();
    const revision = this.revisions.get(revisionId);
    if (!revision) throw new Error(`No revision ${revisionId}`);
    this.keptForever.add(revisionId);
    return { id: revisionId, modifiedTime: revision.time };
  }
  async downloadRevision(_fileId: string, revisionId: string) {
    this.check();
    const revision = this.revisions.get(revisionId);
    if (!revision) throw new Error(`No revision ${revisionId}`);
    return revision.content;
  }
}
