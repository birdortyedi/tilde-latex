import { SignInNeededError } from '../auth';
import { FOLDER_TYPE, OfflineError, type Drive, type DriveFile } from '../drive';

// An in-memory stand-in for Google Drive. Each upload gets a new revision id,
// like the real Drive.
export class FakeDrive implements Drive {
  offline = false; // set to true to act like a lost network
  signedOut = false; // set to true to act like an expired Google token
  items = new Map<string, DriveFile & { parentId: string; content?: Uint8Array }>();
  private nextId = 1;

  private add(name: string, parentId: string, mimeType: string, content?: Uint8Array): DriveFile {
    const id = `id${this.nextId++}`;
    const item = { id, name, parentId, mimeType, content, headRevisionId: content ? `rev${this.nextId++}` : undefined };
    this.items.set(id, item);
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
    const { name, mimeType, headRevisionId } = this.item(id);
    return { id, name, mimeType, headRevisionId };
  }

  // A path like "LaTeX Projects/paper/figures/plot.png" → that file's text.
  read(path: string): string | undefined {
    let parentId = 'root';
    let item;
    for (const name of path.split('/')) {
      item = [...this.items.values()].find((i) => i.parentId === parentId && i.name === name);
      if (!item) return undefined;
      parentId = item.id;
    }
    return item?.content && new TextDecoder().decode(item.content);
  }

  async whoAmI() { this.check(); return 'me'; }
  async list(folderId: string) {
    this.check();
    return [...this.items.values()].filter((i) => i.parentId === folderId).map((i) => this.info(i.id));
  }
  async get(fileId: string) { this.check(); return this.info(fileId); }
  async download(fileId: string) { this.check(); return this.item(fileId).content ?? new Uint8Array(); }
  async createFolder(name: string, parentId: string) { this.check(); return this.add(name, parentId, FOLDER_TYPE); }
  async createFile(name: string, parentId: string, content: Uint8Array) {
    this.check();
    return this.add(name, parentId, 'application/octet-stream', content);
  }
  async updateFile(fileId: string, content: Uint8Array) {
    this.check();
    const item = this.item(fileId);
    item.content = content;
    item.headRevisionId = `rev${this.nextId++}`;
    return this.info(fileId);
  }
}
