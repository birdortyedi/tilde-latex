import * as Y from 'yjs';
import { SignInNeededError } from './auth';
import { OfflineError, type Drive } from './drive';
import type { DraftStore } from './drafts';
import type { Project, ProjectFile } from './projects';
import {
  addSharedBinary, addSharedText, fixDuplicatePaths, moveShared, removeShared, savedLacks, setSharedMainFile, setSharedName, sharedFileAt,
  sharedFiles, sharedIds, sharedMainFile, sharedName, type SharedEntry, type SharedIds,
} from './sharedDoc';
import type { SharedStore } from './sharedStore';
import type { LoadedShared } from './sharing';
import { AUTOSAVE_DELAY, ProjectSync, RETRY_DELAY, type DriveChanges, type SyncListener, type SyncState } from './sync';

// Keeps a shared project in step with Drive (see sharedDoc.ts and sharing.ts).
//
// The text is one Yjs document, saved as one Drive file. Saving reads that
// file, merges it in, and writes it back only if it lacks something of this
// browser's. If two people write at the same moment, one write covers the
// other, but the covered edits are still in that person's browser, and their
// next round writes them back. So there is never a conflict to choose.
//
// Each browser reads the file again every few seconds while someone else has
// the project open (the mailbox file says who), and every half minute
// otherwise. The owner's browser also keeps the project's plain files in
// the folder up to date (the "mirror"), so it stays an ordinary LaTeX project.

export const SAVE_TOGETHER = 1_000; // milliseconds after typing, while others are here
export const POLL_TOGETHER = 3_000; // how often to read Drive while others are here
export const POLL_ALONE = 30_000;
export const HEARTBEAT = 20_000; // how often to say "I am here" in the mailbox
export const HERE_FOR = 90_000; // someone counts as here this long after their last word
const MIRROR_DELAY = 3_000;

// Marks changes that came from Drive, so they are not mistaken for this browser's edits.
const FROM_DRIVE = Symbol('from Drive');

export interface SharedListener extends SyncListener {
  peopleChanged(): void; // who else has the project open
  missingChanged(): void; // binary files this browser may not read yet
}

interface Mailbox {
  here?: Record<string, { name: string; at: number; account?: string }>; // by tab
}

// Saving changes for the owner's plain files: never kept as drafts, since the
// shared document is the copy that matters.
const noDrafts: DraftStore = { put: async () => {}, remove: async () => {}, list: async () => [], clear: async () => {} };

export class SharedSync {
  readonly conflicts = new Set<string>(); // never any: edits merge
  readonly project: Project; // what the editor shows: built from the document
  readonly doc: Y.Doc;
  readonly ids: SharedIds;
  people: string[] = []; // names of the others who have the project open
  missing = new Map<string, string>(); // binary files this browser cannot read yet: Drive id → path
  state: SyncState = 'saved';
  errorMessage = '';
  private stateId: string;
  private saved: Uint8Array; // the document as it was in Drive when last read or written
  private revision: string | undefined;
  private localChange = false; // edits here since the last save
  private remoteChange = false; // Drive's copy changed since the last check
  private problem: 'offline' | 'signin' | 'error' | null = null;
  private uploading = false;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private storeTimer: ReturnType<typeof setTimeout> | undefined;
  private mirrorTimer: ReturnType<typeof setTimeout> | undefined;
  private session = crypto.randomUUID(); // this tab, in the mailbox
  private byId = new Map<string, ProjectFile>(); // the project's files by document id
  private paths = new Map<string, string>(); // document id → path, as last shown
  private bytes = new Map<string, Uint8Array>(); // binary files' content by Drive id
  private undo = new Map<Y.Text, Y.UndoManager>();
  private listener: SharedListener;
  private mirror: { project: Project; sync: ProjectSync; paths: Map<string, string> } | null = null;
  private mirroring: Promise<void> = Promise.resolve();

  constructor(
    private drive: Drive,
    private store: SharedStore,
    private accountId: string,
    private myName: string,
    loaded: LoadedShared,
    listener: SharedListener,
    plain?: Project, // the owner's plain files in the folder; absent for collaborators
  ) {
    this.stateId = loaded.stateId;
    this.doc = loaded.doc;
    this.saved = loaded.saved;
    this.revision = loaded.revision;
    const ids = sharedIds(this.doc);
    if (!ids) throw new Error('This shared project is damaged: it does not say where its files are.');
    this.ids = ids;
    this.listener = {
      stateChanged: () => { if (!this.closed) listener.stateChanged(); },
      fileReplaced: () => {},
      filesChanged: (changes) => { if (!this.closed) listener.filesChanged(changes); },
      peopleChanged: () => { if (!this.closed) listener.peopleChanged(); },
      missingChanged: () => { if (!this.closed) listener.missingChanged(); },
    };
    this.project = { name: sharedName(this.doc), files: [], driveId: ids.folderId, mainFile: sharedMainFile(this.doc) };
    if (plain) {
      for (const file of plain.files) if (file.driveId && typeof file.content !== 'string') this.bytes.set(file.driveId, file.content);
      const sync = new ProjectSync(drive, noDrafts, accountId, plain, { stateChanged: () => this.update(), fileReplaced: () => {}, filesChanged: () => {} });
      this.mirror = { project: plain, sync, paths: new Map() };
      // The owner may have renamed the folder in Drive since: everyone sees the new name.
      const renamed = plain.name !== sharedName(this.doc);
      if (renamed) setSharedName(this.doc, plain.name);
      this.localChange = this.adoptPlainFiles() || renamed;
    }
    this.rebuild(false);
    this.doc.on('afterTransaction', (transaction: Y.Transaction) => this.changed(transaction));
    void this.loadBinaries();
    if (this.mirror) this.scheduleMirror(0);
    this.schedulePoll(POLL_TOGETHER);
    void this.heartbeat();
  }

  // ---- What the editor and the file tree use (the same as ProjectSync) ----

  // The editor calls this after every change to a file's text; the document
  // already has it (see textFor), so this only reports the state.
  edited(path: string): void {
    if (sharedFileAt(this.doc, path)) this.update();
  }

  saveNow(): Promise<void> {
    clearTimeout(this.saveTimer);
    return this.enqueue(() => this.round());
  }

  // Right after opening: puts back edits from last time that never reached Drive.
  restoreDrafts(): Promise<void> {
    this.enqueue(async () => {
      const copy = await this.store.get(this.accountId, this.ids.folderId);
      if (copy) Y.applyUpdate(this.doc, copy.update); // merges like anyone's edits
    });
    return this.saveNow();
  }

  // When the user comes back to the tab: read Drive now.
  checkDrive(): Promise<void> {
    return this.saveNow();
  }

  // The shared text of a file, for the editor, with an undo history that
  // undoes only this browser's edits.
  textFor(path: string): { text: Y.Text; undo: Y.UndoManager } | null {
    const text = sharedFileAt(this.doc, path)?.text;
    if (!text) return null;
    let undo = this.undo.get(text);
    if (!undo) {
      undo = new Y.UndoManager(text);
      this.undo.set(text, undo);
    }
    return { text, undo };
  }

  // Inserts text into a file's shared text, for files not open in the
  // editor (the editor writes into the open one itself). Returns false for a
  // file that has no shared text.
  insertText(path: string, at: number, text: string): boolean {
    const shared = sharedFileAt(this.doc, path)?.text;
    if (!shared) return false;
    shared.insert(Math.min(at, shared.length), text);
    return true;
  }

  addFile(path: string, content: string | Uint8Array): Promise<void> {
    return this.action(async () => {
      const existing = sharedFileAt(this.doc, path);
      if (typeof content === 'string') {
        if (existing?.text) {
          const text = existing.text;
          this.doc.transact(() => {
            text.delete(0, text.length);
            text.insert(0, content);
          });
        } else {
          if (existing) removeShared(this.doc, path);
          addSharedText(this.doc, path, content);
        }
      } else {
        const driveId = await this.uploadBinary(path, content);
        this.bytes.set(driveId, content);
        this.doc.transact(() => {
          if (existing) removeShared(this.doc, path);
          addSharedBinary(this.doc, path, driveId);
        });
      }
      await this.round();
    });
  }

  deleteFile(path: string): Promise<void> {
    return this.action(async () => {
      removeShared(this.doc, path);
      await this.round();
    });
  }

  moveFile(from: string, to: string): Promise<void> {
    return this.action(async () => {
      moveShared(this.doc, from, to);
      if (this.project.mainFile === from) setSharedMainFile(this.doc, to);
      await this.round();
    });
  }

  renameFolder(dir: string, newName: string): Promise<[string, string][]> {
    const newDir = [...dir.split('/').slice(0, -1), newName].join('/');
    const moved = this.project.files.filter((f) => f.path.startsWith(`${dir}/`)).map((f): [string, string] => [f.path, newDir + f.path.slice(dir.length)]);
    return this.action(async () => {
      moveShared(this.doc, dir, newDir);
      const main = this.project.mainFile;
      if (main?.startsWith(`${dir}/`)) setSharedMainFile(this.doc, newDir + main.slice(dir.length));
      await this.round();
    }).then(() => moved);
  }

  setMainFile(path: string): Promise<void> {
    return this.action(async () => {
      setSharedMainFile(this.doc, path);
      await this.round();
    });
  }

  // The project's name, which everyone sees.
  rename(name: string): Promise<void> {
    return this.action(async () => {
      setSharedName(this.doc, name);
      await this.round();
    });
  }

  // Not offered for shared projects: Drive's version history of the shared
  // file holds the whole project, not one file.
  async safeCopyText(path: string): Promise<string> {
    throw new Error(`${path} is in a shared project, which has no earlier version per file yet.`);
  }

  async driveVersion(path: string): Promise<Uint8Array> {
    throw new Error(`${path} is in a shared project, where edits merge instead.`);
  }

  async keepMine(path: string): Promise<void> {
    this.conflicts.delete(path);
  }

  async keepDrive(path: string): Promise<void> {
    this.conflicts.delete(path);
  }

  // Binary files this browser could not read, once the user has allowed them in the Picker.
  retryMissing(): Promise<void> {
    return this.loadBinaries();
  }

  hasUnsaved(): boolean {
    return this.localChange;
  }

  // Whether this browser's account owns the project (and keeps its plain files).
  get isOwner(): boolean {
    return this.mirror !== null;
  }

  idle(): Promise<void> {
    return this.queue.then(() => this.mirroring);
  }

  close(): void {
    this.closed = true;
    for (const timer of [this.saveTimer, this.pollTimer, this.heartbeatTimer, this.storeTimer, this.mirrorTimer]) clearTimeout(timer);
    this.mirror?.sync.close();
    void this.leaveMailbox();
  }

  // ---- Saving and reading Drive ----

  // One round: read Drive's copy if it changed, merge it in, and write ours
  // back if Drive's lacks anything of it.
  private async round(): Promise<void> {
    const info = await this.drive.get(this.stateId);
    if (info.headRevisionId !== this.revision) {
      const saved = await this.drive.download(this.stateId);
      Y.applyUpdate(this.doc, saved, FROM_DRIVE);
      this.saved = saved;
      this.revision = info.headRevisionId;
      this.remoteChange = true;
      // Two files made with one name at the same moment: everyone renames the same one.
      fixDuplicatePaths(this.doc);
    }
    if (this.localChange || this.remoteChange) {
      this.localChange = false;
      this.remoteChange = false;
      if (savedLacks(this.saved, this.doc)) {
        this.uploading = true;
        this.update();
        const update = Y.encodeStateAsUpdate(this.doc);
        try {
          const saved = await this.drive.updateFile(this.stateId, update);
          this.saved = update;
          this.revision = saved.headRevisionId;
        } catch (error) {
          this.localChange = true; // still unsaved
          throw error;
        } finally {
          this.uploading = false;
        }
      }
      if (!this.localChange) this.store.remove(this.accountId, this.ids.folderId)
        .catch((error: unknown) => console.warn('Could not update the copy kept in the browser', error));
    }
  }

  // Every change to the document: from typing here, a file action, or Drive.
  private changed(transaction: Y.Transaction): void {
    if (this.closed || transaction.changed.size === 0) return;
    let structure = false;
    for (const type of transaction.changed.keys()) {
      const file = type instanceof Y.Text ? this.byText(type) : undefined;
      if (file && type instanceof Y.Text) file.content = type.toString();
      else structure = true;
    }
    if (structure) this.rebuild(transaction.origin === FROM_DRIVE);
    if (transaction.origin !== FROM_DRIVE) {
      this.localChange = true;
      this.keepInBrowser();
      this.scheduleSave(this.people.length > 0 ? SAVE_TOGETHER : AUTOSAVE_DELAY);
    }
    if (this.mirror) this.scheduleMirror(MIRROR_DELAY);
    this.update();
  }

  private byText(text: Y.Text): ProjectFile | undefined {
    for (const entry of sharedFiles(this.doc)) if (entry.text === text) return this.byId.get(entry.id);
    return undefined;
  }

  // Makes the project's file list match the document again, and tells the
  // editor about files added, renamed or deleted by someone else.
  private rebuild(fromDrive: boolean): void {
    const entries = sharedFiles(this.doc);
    const changes: DriveChanges = { added: [], moved: [], removed: [], kept: [] };
    const files: ProjectFile[] = [];
    const ids = new Set<string>();
    for (const entry of entries) {
      ids.add(entry.id);
      const before = this.paths.get(entry.id);
      if (before === undefined) changes.added.push(entry.path);
      else if (before !== entry.path) changes.moved.push([before, entry.path]);
      this.paths.set(entry.id, entry.path);
      const file = this.fileFor(entry);
      if (file) files.push(file);
    }
    for (const [id, path] of this.paths) {
      if (ids.has(id)) continue;
      changes.removed.push(path);
      this.paths.delete(id);
      this.byId.delete(id);
    }
    this.project.files.splice(0, this.project.files.length, ...files);
    this.project.mainFile = sharedMainFile(this.doc);
    this.project.name = sharedName(this.doc);
    if (fromDrive && (changes.added.length + changes.moved.length + changes.removed.length) > 0) this.listener.filesChanged(changes);
    if (entries.some((e) => e.driveId && !this.bytes.has(e.driveId) && !this.missing.has(e.driveId))) void this.loadBinaries();
  }

  // The project file for a document entry; binary files only once their content is here.
  private fileFor(entry: SharedEntry): ProjectFile | null {
    let file = this.byId.get(entry.id);
    const content = entry.text ? entry.text.toString() : entry.driveId ? this.bytes.get(entry.driveId) : undefined;
    if (content === undefined) return null;
    if (!file) {
      file = { path: entry.path, content, driveId: entry.driveId };
      this.byId.set(entry.id, file);
    }
    file.path = entry.path;
    file.content = content;
    return file;
  }

  // Downloads the binary files this browser has not got yet. Those it may
  // not read (added by someone else) wait for an "Allow" in the Picker.
  private async loadBinaries(): Promise<void> {
    const wanted = sharedFiles(this.doc).filter((e) => e.driveId && !this.bytes.has(e.driveId));
    if (wanted.length === 0 && this.missing.size === 0) return;
    const missing = new Map<string, string>();
    for (const entry of wanted) {
      const driveId = entry.driveId as string;
      try {
        this.bytes.set(driveId, await this.drive.download(driveId));
      } catch (error) {
        if (error instanceof OfflineError || error instanceof SignInNeededError) return;
        missing.set(driveId, entry.path);
      }
    }
    this.missing = missing;
    this.rebuild(true);
    this.listener.missingChanged();
  }

  private async uploadBinary(path: string, content: Uint8Array): Promise<string> {
    if (this.mirror) {
      // The owner's binary files are plain files in their folder, like before sharing.
      await this.mirror.sync.addFile(path, content);
      const file = this.mirror.project.files.find((f) => f.path === path);
      if (!file?.driveId) throw new Error(`Could not save ${path} to Google Drive.`);
      return file.driveId;
    }
    // A collaborator may only add files to the uploads folder (see sharing.ts).
    return (await this.drive.createFile(path.replaceAll('/', ' - '), this.ids.uploadsId, content)).id;
  }

  // ---- The owner's plain files ----

  // Plain files in the folder that the document does not know (made before
  // sharing by another Tilde, or uploaded on the Drive website) join it.
  // Returns whether any did.
  private adoptPlainFiles(): boolean {
    if (!this.mirror) return false;
    let adopted = false;
    const entries = sharedFiles(this.doc);
    for (const file of this.mirror.project.files) {
      const entry = entries.find((e) => e.path === file.path || (file.driveId && e.driveId === file.driveId));
      if (entry) {
        this.mirror.paths.set(entry.id, file.path);
        continue;
      }
      const id = typeof file.content === 'string' ? addSharedText(this.doc, file.path, file.content)
        : file.driveId ? addSharedBinary(this.doc, file.path, file.driveId) : null;
      if (id) this.mirror.paths.set(id, file.path);
      adopted ||= id !== null;
    }
    return adopted;
  }

  private scheduleMirror(delay: number): void {
    clearTimeout(this.mirrorTimer);
    this.mirrorTimer = setTimeout(() => {
      this.mirroring = this.mirroring.then(() => this.mirrorNow()).catch((error: unknown) => console.warn('Could not update the plain files', error));
    }, delay);
  }

  // Makes the plain files match the document: renames, deletions, new files
  // and text. A collaborator's binary files stay in the uploads folder.
  // The owner's other computer does the same, so before making a file, see
  // whether it made it already; and where both saved a file, the text is
  // the same merged text, so this one's is kept.
  private async mirrorNow(): Promise<void> {
    if (!this.mirror || this.closed) return;
    const { project: plain, sync, paths } = this.mirror;
    const fileAt = (path: string) => plain.files.find((f) => f.path === path);
    const entries = sharedFiles(this.doc);
    if (entries.some((e) => e.text && !fileAt(e.path) && !(paths.get(e.id) && fileAt(paths.get(e.id) as string)))) await sync.checkDrive();
    const ids = new Set(entries.map((e) => e.id));
    for (const [id, path] of [...paths]) {
      if (ids.has(id)) continue;
      paths.delete(id);
      if (fileAt(path)) await sync.deleteFile(path);
    }
    for (const entry of entries) {
      const own = entry.driveId ? plain.files.find((f) => f.driveId === entry.driveId) : undefined;
      if (entry.driveId && !own) continue; // a collaborator's upload
      const before = own?.path ?? paths.get(entry.id);
      if (before && before !== entry.path && fileAt(before) && !fileAt(entry.path)) await sync.moveFile(before, entry.path);
      paths.set(entry.id, entry.path);
      if (!entry.text) continue;
      const text = entry.text.toString();
      const file = fileAt(entry.path);
      if (!file) await sync.addFile(entry.path, text);
      else if (file.content !== text) {
        file.content = text;
        sync.edited(entry.path);
      }
    }
    const main = sharedMainFile(this.doc);
    if (main && main !== plain.mainFile && fileAt(main)) await sync.setMainFile(main);
    for (const path of [...sync.conflicts]) await sync.keepMine(path);
    if (sync.hasUnsaved()) await sync.saveNow();
  }

  // ---- Who is here ----

  private async heartbeat(): Promise<void> {
    if (this.closed) return;
    try {
      const box = await this.readMailbox();
      const now = Date.now();
      const here = Object.fromEntries(Object.entries(box.here ?? {}).filter(([, h]) => now - h.at < HERE_FOR));
      here[this.session] = { name: this.myName, at: now, account: this.accountId };
      await this.drive.updateFile(this.ids.mailboxId, new TextEncoder().encode(JSON.stringify({ ...box, here })));
      // Others, once each: not this account's own tabs (another computer, or this tab before a reload).
      const others = new Map(Object.values(here).filter((h) => h.account !== this.accountId).map((h) => [h.account ?? h.name, h.name]));
      const people = [...others.values()].sort();
      if (people.join('\n') !== this.people.join('\n')) {
        const arrived = people.length > this.people.length;
        this.people = people;
        this.listener.peopleChanged();
        if (arrived) this.schedulePoll(POLL_TOGETHER);
      }
    } catch (error) {
      console.warn('Could not update who is here', error);
    }
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => void this.heartbeat(), HEARTBEAT);
  }

  private async readMailbox(): Promise<Mailbox> {
    try {
      return JSON.parse(new TextDecoder().decode(await this.drive.download(this.ids.mailboxId))) as Mailbox;
    } catch (error) {
      if (error instanceof SyntaxError) return {};
      throw error;
    }
  }

  private async leaveMailbox(): Promise<void> {
    try {
      const box = await this.readMailbox();
      if (!box.here?.[this.session]) return;
      const here = Object.fromEntries(Object.entries(box.here).filter(([session]) => session !== this.session));
      await this.drive.updateFile(this.ids.mailboxId, new TextEncoder().encode(JSON.stringify({ ...box, here })));
    } catch {
      // The entry runs out by itself after HERE_FOR.
    }
  }

  // ---- Plumbing ----

  private schedulePoll(delay: number): void {
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      void this.saveNow().then(() => this.schedulePoll(this.people.length > 0 ? POLL_TOGETHER : POLL_ALONE));
    }, delay);
  }

  private scheduleSave(delay: number): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), delay);
  }

  // Keeps the document in the browser while it has unsaved edits.
  private keepInBrowser(): void {
    clearTimeout(this.storeTimer);
    this.storeTimer = setTimeout(() => {
      if (!this.localChange) return;
      this.store.put({ accountId: this.accountId, projectId: this.ids.folderId, projectName: this.project.name, update: Y.encodeStateAsUpdate(this.doc) })
        .catch((error: unknown) => console.warn('Could not keep the edits in the browser', error));
    }, 500);
  }

  // Like enqueue, but the caller also gets the error, to show it.
  private action(task: () => Promise<void>): Promise<void> {
    let failure: { error: unknown } | null = null;
    this.enqueue(async () => {
      try {
        await task();
      } catch (error) {
        failure = { error };
        throw error;
      }
    });
    return this.queue.then(() => {
      if (failure) throw failure.error;
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (this.closed) return;
      try {
        await task();
        this.problem = null;
      } catch (error) {
        this.failed(error);
      }
      this.update();
    });
    return this.queue;
  }

  private failed(error: unknown): void {
    if (error instanceof SignInNeededError) {
      this.problem = 'signin';
      return;
    }
    this.problem = error instanceof OfflineError ? 'offline' : 'error';
    this.errorMessage = error instanceof Error ? error.message : String(error);
    this.scheduleSave(RETRY_DELAY);
  }

  private update(): void {
    if (this.closed) return;
    const mirrorState = this.mirror?.sync.state;
    const mirrorProblem = mirrorState === 'offline' || mirrorState === 'signin' || mirrorState === 'error' ? mirrorState : null;
    this.state = !this.hasUnsaved() && !mirrorProblem ? 'saved'
      : this.uploading ? 'saving'
      : (this.problem ?? mirrorProblem ?? 'unsaved');
    if (this.state === 'error' && !this.problem && this.mirror) this.errorMessage = this.mirror.sync.errorMessage;
    this.listener.stateChanged();
  }
}

