import { SignInNeededError } from '../auth';
import { FOLDER_TYPE, OfflineError, type Drive, type DriveFile, type MetadataChanges, type Permission, type Role } from '../drive';

type FakeItem = DriveFile & {
  parentId: string;
  content?: Uint8Array;
  trashed?: boolean;
  creator: string; // the account whose Tilde made it
  grants: Set<string>; // accounts that picked it in the Picker
  readers: Set<string>; // accounts that may only view it
};

// An in-memory stand-in for Google Drive. Each upload gets a new revision id,
// like the real Drive.
//
// forAccount() gives the same Drive as another Google account sees it through
// Tilde with drive.file: only the files that account's Tilde created and the
// ones it picked (grant). The FakeDrive itself sees everything.
export class FakeDrive implements Drive {
  offline = false; // set to true to act like a lost network
  signedOut = false; // set to true to act like an expired Google token
  account = 'me';
  items = new Map<string, FakeItem>();
  // Every version ever saved, by revision id, and the ones kept forever.
  revisions = new Map<string, { content: Uint8Array; time: string }>();
  keptForever = new Set<string>();
  shares: { fileId: string; email: string; message: string; role: Role }[] = [];
  people = new Map<string, Permission[]>(); // who each file was shared with
  linkShared = new Set<string>(); // files anyone with the link may view
  private strict = false;
  private counter = { next: 1 }; // shared by all accounts' views

  forAccount(account: string): FakeDrive {
    const view = Object.create(this) as FakeDrive;
    view.account = account;
    view.strict = true;
    view.offline = false;
    view.signedOut = false;
    return view;
  }

  // What the Picker does: lets an account's Tilde see a file.
  grant(fileId: string, account: string): void {
    this.items.get(fileId)?.grants.add(account);
  }

  private add(name: string, parentId: string, mimeType: string, content?: Uint8Array): DriveFile {
    if (this.strict && parentId !== 'root') this.item(parentId); // a folder it cannot see is "not found"
    const id = `id${this.counter.next++}`;
    const item: FakeItem = {
      id, name, parentId, mimeType, content, creator: this.account, grants: new Set(), readers: new Set(),
      headRevisionId: content ? `rev${this.counter.next++}` : undefined,
    };
    this.items.set(id, item);
    if (content && item.headRevisionId) this.revisions.set(item.headRevisionId, { content, time: new Date().toISOString() });
    return this.info(id);
  }

  private visible(item: FakeItem): boolean {
    return !this.strict || item.creator === this.account || item.grants.has(this.account);
  }

  // What sharing as "can view" does: the account may read the file, not change it.
  viewOnly(fileId: string, account: string): void {
    this.items.get(fileId)?.readers.add(account);
  }

  private writable(item: FakeItem): FakeItem {
    if (item.readers.has(this.account)) throw new Error('Google Drive answered 403: insufficientFilePermissions');
    return item;
  }

  private check(): void {
    if (this.offline) throw new OfflineError();
    if (this.signedOut) throw new SignInNeededError();
  }

  private item(id: string): FakeItem {
    const item = this.items.get(id);
    if (!item || !this.visible(item)) throw new Error(`Google Drive answered 404: File not found: ${id}`);
    return item;
  }

  private info(id: string): DriveFile {
    const { name, mimeType, headRevisionId, appProperties, trashed, parentId, creator } = this.item(id);
    return { id, name, mimeType, headRevisionId, parents: [parentId], ownedByMe: creator === this.account, ...(appProperties ? { appProperties } : {}), ...(trashed ? { trashed } : {}) };
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

  async whoAmI() { this.check(); return this.account; }
  async myProfile() { this.check(); return { name: this.account, photo: `https://lh3.googleusercontent.com/${this.account}` }; }
  async findByProperty(key: string, value: string) {
    this.check();
    return [...this.items.values()].filter((i) => !i.trashed && this.visible(i) && i.appProperties?.[key] === value).map((i) => this.info(i.id));
  }
  async list(folderId: string) {
    this.check();
    return [...this.items.values()].filter((i) => i.parentId === folderId && !i.trashed && this.visible(i)).map((i) => this.info(i.id));
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
    const item = this.writable(this.item(fileId));
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
    const item = this.writable(this.item(fileId));
    item.content = content;
    item.headRevisionId = `rev${this.counter.next++}`;
    this.revisions.set(item.headRevisionId, { content, time: new Date().toISOString() });
    return this.info(fileId);
  }
  async share(fileId: string, email: string, message: string, role: Role = 'writer') {
    this.check();
    this.item(fileId);
    this.shares.push({ fileId, email, message, role });
    const list = this.people.get(fileId) ?? [];
    list.push({ id: `perm-${email}`, type: 'user', role, emailAddress: email });
    this.people.set(fileId, list);
  }
  async permissions(fileId: string) {
    this.check();
    const item = this.item(fileId);
    return [{ id: `perm-${item.creator}`, type: 'user', role: 'owner', emailAddress: `${item.creator}@example.org` }, ...(this.people.get(fileId) ?? []),
      ...(this.linkShared.has(fileId) ? [{ id: 'anyoneWithLink', type: 'anyone', role: 'reader' }] : [])];
  }
  async setRole(fileId: string, permissionId: string, role: Role) {
    this.check();
    const permission = this.people.get(fileId)?.find((p) => p.id === permissionId);
    if (!permission) throw new Error('Google Drive answered 404: Permission not found');
    permission.role = role;
  }
  async removePermission(fileId: string, permissionId: string) {
    this.check();
    if (permissionId === 'anyoneWithLink') this.linkShared.delete(fileId);
    this.people.set(fileId, (this.people.get(fileId) ?? []).filter((p) => p.id !== permissionId));
  }
  async canEdit(fileId: string) {
    this.check();
    return !this.item(fileId).readers.has(this.account);
  }
  async shareByLink(fileId: string) {
    this.check();
    this.item(fileId);
    this.linkShared.add(fileId);
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
