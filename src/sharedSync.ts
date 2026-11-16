import * as Y from 'yjs';
import { SignInNeededError } from './auth';
import { OfflineError, type Drive } from './drive';
import type { DraftStore } from './drafts';
import type { Project, ProjectFile } from './projects';
import {
  addSharedBinary, addSharedText, fixDuplicatePaths, moveShared, plainFileIds, plainHashes, plainRevisions, removeShared, savedLacks, setSharedDriveId, textHash,
  setSharedMainFile, setSharedName, sharedFileAt,
  sharedFiles, sharedIds, sharedMainFile, sharedName, type SharedEntry, type SharedIds,
} from './sharedDoc';
import type { SharedStore } from './sharedStore';
import type { LoadedShared } from './sharing';
import { colorFor, fromPeer, Live, type MakeLink, type Signals } from './live';
import { mergeOutside, outsideCopyPath } from './outsideEdits';
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
export const HEARTBEAT = 10_000; // how often to say "I am here" in the mailbox
const CONNECTING_CHECK = 2_000; // how often to read the mailbox while a direct connection is being made
const CONFIRM_DELAY = 5_000; // when to check that a write was not covered by someone else's
const PEER_FILE_WAIT = 4_000; // how long to wait for a connected peer to send a file before asking for "Allow"
export const HERE_FOR = 90_000; // someone counts as here this long after their last word
const LEADER_FRESH = 25_000; // an owner's tab heard from within this long can keep the plain files
const MIRROR_DELAY = 3_000;
const MIRROR_RETRY = 10_000; // after a failed update of the plain files
const MIRROR_CHECK = 60_000; // how often the tab keeping the plain files reads them again anyway
const ACCESS_CHECK = 60_000; // how often a viewer's tab asks Drive whether it may edit by now

// Marks changes that came from Drive, so they are not mistaken for this browser's edits.
const FROM_DRIVE = Symbol('from Drive');

export interface SharedListener extends SyncListener {
  peopleChanged(): void; // who else has the project open
  missingChanged(): void; // binary files this browser may not read yet
  notice(text: string): void; // something the user should know, e.g. an edit made outside Tilde
}

interface Mailbox {
  // By tab; leads: it keeps the owner's plain files (see isLeader).
  here?: Record<string, { name: string; at: number; account?: string; leads?: boolean }>;
  signals?: Signals; // introductions for direct connections (see live.ts)
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
  livePeople: string[] = []; // those of them this browser is connected to directly
  missing = new Map<string, string>(); // binary files this browser cannot read yet: Drive id → path
  state: SyncState = 'saved';
  errorMessage = '';
  readOnly = false; // shared with this account as "can view" (see viewOnly)
  onCanEdit: () => void = () => {}; // a viewer was allowed to edit meanwhile (main.ts opens the project again)
  private accessChecked = 0;
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
  private live: Live | null = null;
  private here: NonNullable<Mailbox['here']> = {}; // the mailbox's tabs, as last read
  private lastBeat = 0; // when this tab last said "here"
  private rounds = 0; // looks at the mailbox so far
  private lastRound = 0; // when the mailbox was last read and written successfully
  private selfSeen = 0; // looks at the mailbox in a row that found this tab's own word there
  private leading = false; // whether this tab keeps the owner's plain files (see isLeader)
  private written = new Set<string>(); // versions of plain files this tab wrote
  private rereadPlain = false; // the plain files may have changed under this tab: read them again first
  private lastMirror = 0; // when the plain files were last brought up to date
  private lastSeen = new Map<string, { at: number; local: number }>(); // tabs in the mailbox: their last word, and when this tab saw it
  private unconfirmed = false; // this browser wrote Drive's copy, but no later round has seen it there yet
  private loadingBinaries: Promise<void> | null = null;
  private loadAgain = false;
  private missingTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private drive: Drive,
    private store: SharedStore,
    private accountId: string,
    private myName: string,
    loaded: LoadedShared,
    listener: SharedListener,
    plain?: Project, // the owner's plain files in the folder; absent for collaborators
    makeLink?: MakeLink, // direct connections to the others (absent: Drive only)
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
      notice: (text) => { if (!this.closed) listener.notice(text); },
    };
    this.project = { name: sharedName(this.doc), files: [], driveId: ids.folderId, mainFile: sharedMainFile(this.doc) };
    if (plain) {
      for (const file of plain.files) if (file.driveId && typeof file.content !== 'string') this.bytes.set(file.driveId, file.content);
      this.mirror = { project: plain, sync: this.plainSync(plain), paths: new Map() };
      // The owner may have renamed the folder in Drive since: everyone sees the new name.
      const renamed = plain.name !== sharedName(this.doc);
      if (renamed) setSharedName(this.doc, plain.name);
      this.localChange = renamed;
    }
    if (makeLink) {
      this.live = new Live(this.doc, this.session, { name: myName, color: colorFor(accountId) }, makeLink,
        () => this.liveChanged(),
        (driveId) => this.bytes.get(driveId),
        (driveId, bytes) => this.fileFromPeer(driveId, bytes));
    }
    this.rebuild(false);
    this.doc.on('afterTransaction', (transaction: Y.Transaction) => this.changed(transaction));
    void this.loadBinaries();
    this.schedulePoll(POLL_TOGETHER);
    void this.mailboxRound();
  }

  // The project is shared with this account as "can view": nothing is written
  // to Drive (not even "I am here", so others do not see this browser), and
  // others' edits still arrive through Drive.
  viewOnly(): void {
    this.readOnly = true;
    this.accessChecked = Date.now();
    this.live?.close();
    this.live = null;
    this.localChange = false;
    this.update();
  }

  // The shared file in Drive, which everyone in the project may open.
  get stateFileId(): string {
    return this.stateId;
  }

  // The cursors and names of the people connected directly, for the editor.
  get awareness() {
    return this.live?.awareness ?? null;
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
      if (!copy) return;
      Y.applyUpdate(this.doc, copy.update); // merges like anyone's edits
      this.unconfirmed = true; // the copy goes once a round sees Drive has it all
    });
    return this.saveNow();
  }

  // When the user comes back to the tab: read Drive now; the owner's Tilde
  // also looks for edits made to the plain files outside Tilde meanwhile.
  checkDrive(): Promise<void> {
    const saving = this.saveNow();
    if (this.mirror && this.leadingNow()) {
      const sync = this.mirror.sync;
      this.mirroring = this.mirroring.then(async () => {
        await saving; // the revisions the owner's other computer wrote are in the document by now
        await sync.checkDrive();
        await this.outsideEdits();
      }).catch((error: unknown) => console.warn('Could not check for edits made outside Tilde', error));
    }
    return saving;
  }

  // The shared text of a file, for the editor, with an undo history that
  // undoes only this browser's edits.
  textFor(path: string): { text: Y.Text; undo: Y.UndoManager; awareness: Live['awareness'] | null } | null {
    const text = sharedFileAt(this.doc, path)?.text;
    if (!text) return null;
    let undo = this.undo.get(text);
    if (!undo) {
      // Only this browser's typing (the editor adds itself); not drafts, merges or others' edits.
      undo = new Y.UndoManager(text, { trackedOrigins: new Set() });
      this.undo.set(text, undo);
    }
    return { text, undo, awareness: this.awareness };
  }

  // Inserts text into a file's shared text, for files not open in the
  // editor (the editor writes into the open one itself). Returns false for a
  // file that has no shared text.
  insertText(path: string, at: number, text: string): boolean {
    const shared = sharedFileAt(this.doc, path)?.text;
    if (!shared) return false;
    if (this.readOnly) return true; // nothing to change
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
        const driveId = await this.uploadBinary(path, content, existing?.driveId !== undefined);
        this.bytes.set(driveId, content);
        this.doc.transact(() => {
          // A replaced image keeps its entry, now pointing to the new Drive
          // file, so everyone loads the new one.
          if (existing?.driveId) setSharedDriveId(this.doc, existing.id, driveId);
          else {
            if (existing) removeShared(this.doc, path);
            addSharedBinary(this.doc, path, driveId);
          }
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

  // Whether a Drive file is part of this shared project already: one of its
  // images, or a plain file Tilde wrote for one of its text files.
  belongs(driveId: string): boolean {
    return [...plainFileIds(this.doc).values()].includes(driveId) || sharedFiles(this.doc).some((e) => e.driveId === driveId);
  }

  // The page is going away: keep the edits in the browser and leave the
  // mailbox, as far as there is time for it.
  leave(): void {
    void this.storeNow();
    void this.leaveMailbox();
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
    for (const timer of [this.saveTimer, this.pollTimer, this.heartbeatTimer, this.storeTimer, this.mirrorTimer, this.missingTimer]) clearTimeout(timer);
    void this.storeNow(); // edits of the last half second, or not yet confirmed in Drive
    this.mirror?.sync.close();
    this.live?.close();
    void this.leaveMailbox();
  }

  // ---- Saving and reading Drive ----

  // One round: read Drive's copy if it changed, merge it in, and write ours
  // back if Drive's lacks anything of it.
  private async round(): Promise<void> {
    const info = await this.drive.get(this.stateId);
    if (this.readOnly) {
      if (info.headRevisionId !== this.revision) {
        Y.applyUpdate(this.doc, await this.drive.download(this.stateId), FROM_DRIVE);
        this.revision = info.headRevisionId;
      }
      this.localChange = false;
      if (Date.now() - this.accessChecked >= ACCESS_CHECK) {
        this.accessChecked = Date.now();
        if (await this.drive.canEdit(this.stateId) && !this.closed) this.onCanEdit();
      }
      return;
    }
    // This browser's last write is still Drive's newest version: confirmed.
    if (this.unconfirmed && info.headRevisionId === this.revision) this.confirmed();
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
          // Someone writing at the same moment can still cover this write:
          // the copy in the browser stays until a later round sees Drive has it.
          this.unconfirmed = true;
          this.schedulePoll(this.people.length > this.livePeople.length ? POLL_TOGETHER : CONFIRM_DELAY);
        } catch (error) {
          this.localChange = true; // still unsaved
          this.keepInBrowser();
          throw error;
        } finally {
          this.uploading = false;
        }
      } else if (this.unconfirmed) {
        this.confirmed(); // Drive's newer version has everything of this browser's
      }
    }
  }

  // Drive has all of this browser's edits: the copy in the browser can go.
  private confirmed(): void {
    this.unconfirmed = false;
    if (this.localChange) return;
    const saved = this.saved;
    // Only if Drive has everything in it: another tab may have added edits of its own.
    this.store.get(this.accountId, this.ids.folderId).then(async (copy) => {
      if (!copy) return;
      const kept = new Y.Doc();
      Y.applyUpdate(kept, copy.update);
      if (!savedLacks(saved, kept)) await this.store.remove(this.accountId, this.ids.folderId);
      kept.destroy();
    }).catch((error: unknown) => console.warn('Could not update the copy kept in the browser', error));
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
    // From Drive or from a peer: someone else's change, which they save themselves.
    const elsewhere = transaction.origin === FROM_DRIVE || fromPeer(transaction.origin);
    if (structure) this.rebuild(true);
    if (!elsewhere && !this.readOnly) {
      this.localChange = true;
      this.keepInBrowser();
      // Others connected directly have the edit already; others reach it through Drive.
      this.scheduleSave(this.people.length > this.livePeople.length ? SAVE_TOGETHER : AUTOSAVE_DELAY);
    }
    if (this.mirror) this.scheduleMirror(MIRROR_DELAY);
    this.update();
  }

  private byText(text: Y.Text): ProjectFile | undefined {
    for (const entry of sharedFiles(this.doc)) if (entry.text === text) return this.byId.get(entry.id);
    return undefined;
  }

  // Makes the project's file list match the document again, and tells the
  // editor about files added, renamed or deleted (by someone else, or by
  // Tilde itself, like a copy of an outside edit).
  private rebuild(notify: boolean): void {
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
    if (notify && (changes.added.length + changes.moved.length + changes.removed.length) > 0) this.listener.filesChanged(changes);
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
  private loadBinaries(): Promise<void> {
    // One run at a time; changes during a run start another after it.
    if (this.loadingBinaries) {
      this.loadAgain = true;
      return this.loadingBinaries;
    }
    this.loadingBinaries = this.loadBinariesOnce().finally(() => {
      this.loadingBinaries = null;
      if (this.loadAgain && !this.closed) {
        this.loadAgain = false;
        void this.loadBinaries();
      }
    });
    return this.loadingBinaries;
  }

  private async loadBinariesOnce(): Promise<void> {
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
    if (missing.size > 0 && (this.live?.connected().length ?? 0) > 0) {
      // A connected peer likely has them: ask, and ask the user only for those still missing after a moment.
      this.live?.want([...missing.keys()]);
      clearTimeout(this.missingTimer);
      this.missingTimer = setTimeout(() => this.listener.missingChanged(), PEER_FILE_WAIT);
    } else {
      this.listener.missingChanged();
    }
  }

  // A binary file a peer sent: shown now; reading it from Drive still needs an "Allow" next time.
  private fileFromPeer(driveId: string, bytes: Uint8Array): void {
    if (!this.missing.has(driveId)) return;
    this.bytes.set(driveId, bytes);
    this.missing.delete(driveId);
    this.rebuild(true);
    this.listener.missingChanged();
  }

  // A direct connection opened or closed.
  private liveChanged(): void {
    if (this.missing.size > 0) this.live?.want([...this.missing.keys()]);
    this.updatePeople();
  }

  // Who else is here (by account, not this account's own tabs) and which of
  // them are connected directly; tells the status bar when that changes.
  private updatePeople(): void {
    const connected = new Set(this.live?.connected() ?? []);
    const others = Object.entries(this.here).filter(([, h]) => h.account !== this.accountId);
    const names = (entries: typeof others) => [...new Map(entries.map(([, h]) => [h.account ?? h.name, h.name])).values()].sort();
    const people = names(others);
    const livePeople = names(others.filter(([session]) => connected.has(session)));
    if (people.join('\n') === this.people.join('\n') && livePeople.join('\n') === this.livePeople.join('\n')) return;
    const arrived = people.length > this.people.length;
    this.people = people;
    this.livePeople = livePeople;
    this.listener.peopleChanged();
    // While someone is here but not connected directly, Drive carries their edits: read it often.
    if (arrived || people.length > livePeople.length) this.schedulePoll(POLL_TOGETHER);
  }

  private async uploadBinary(path: string, content: Uint8Array, replacing: boolean): Promise<string> {
    if (this.mirror && this.leadingNow()) {
      // The owner's binary files are plain files in their folder, like before
      // sharing (written by the tab that keeps the plain files). A replaced
      // one goes to Drive's trash and the new one is a new Drive file, so
      // browsers that have the old one load the new one.
      if (replacing && this.mirror.project.files.some((f) => f.path === path)) await this.mirror.sync.deleteFile(path);
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
    const writtenFor = new Map([...plainFileIds(this.doc)].map(([id, driveId]) => [driveId, id]));
    const claimed = new Set(writtenFor.values());
    for (const file of this.mirror.project.files) {
      // Written by Tilde for an entry (which may have been renamed or deleted
      // since: the mirror then moves or deletes it).
      const was = file.driveId ? writtenFor.get(file.driveId) : undefined;
      if (was) {
        this.mirror.paths.set(was, file.path);
        continue;
      }
      // Otherwise by its Drive id (binary files) or its path, but never an
      // entry that has a plain file of its own already.
      const entry = entries.find((e) => (file.driveId && e.driveId === file.driveId) || (e.path === file.path && !claimed.has(e.id)));
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

  // Plain text files whose Drive version is not the one Tilde wrote last
  // were edited outside Tilde: their edit is merged into the shared text, or,
  // where it touches the same place as an edit in Tilde, kept as a copy.
  private async outsideEdits(): Promise<void> {
    if (!this.mirror || this.closed || !this.leadingNow()) return;
    // The newest shared text first: it has the notes of the tab that kept the plain files before.
    await this.saveNow();
    if (this.hasUnsaved()) return; // no network: check later
    const seen = plainRevisions(this.doc);
    const fileIds = plainFileIds(this.doc);
    const claimed = new Set(fileIds.values());
    for (const entry of sharedFiles(this.doc)) {
      // The entry's own plain file: the one Tilde wrote for it (wherever it is
      // now), or for an entry Tilde has not written yet, the one at its path
      // that no other entry owns.
      const own = fileIds.get(entry.id);
      const file = this.mirror.project.files.find((f) => (own ? f.driveId === own : f.path === entry.path && !claimed.has(f.driveId ?? '')));
      if (!entry.text || !file?.driveId || !file.revision || typeof file.content !== 'string') continue;
      const last = seen.get(entry.id);
      if (last === file.revision) continue;
      // Shared before Tilde noted versions (nothing to compare with), or a
      // version this tab wrote itself (its note may not have been made yet).
      if (!last || this.written.has(file.revision) || (plainHashes(this.doc).get(entry.id) ?? '').split(' ').includes(textHash(file.content))) {
        seen.set(entry.id, file.revision);
        continue;
      }
      const theirs = file.content;
      let base: string | null = null;
      try {
        base = new TextDecoder().decode(await this.drive.downloadRevision(file.driveId, last));
      } catch (error) {
        // Offline or signed out: try again later. Otherwise Drive no longer
        // has that version: keep the outside edit as a copy.
        if (error instanceof OfflineError || error instanceof SignInNeededError) throw error;
      }
      seen.set(entry.id, file.revision);
      const text = entry.text;
      const changes = base === null ? null : mergeOutside(base, text.toString(), theirs);
      if (changes && changes.length === 0) continue;
      if (changes) {
        this.doc.transact(() => {
          for (const change of [...changes].sort((a, b) => b.from - a.from)) {
            text.delete(change.from, change.to - change.from);
            text.insert(change.from, change.insert);
          }
        });
        this.listener.notice(`${entry.path} was changed outside Tilde. The change is now in the shared project.`);
      } else {
        let copy = outsideCopyPath(entry.path);
        for (let n = 2; sharedFileAt(this.doc, copy); n++) copy = outsideCopyPath(entry.path, n);
        addSharedText(this.doc, copy, theirs);
        this.listener.notice(`${entry.path} was changed outside Tilde where it was also edited in Tilde. The outside version is kept as ${copy}.`);
      }
    }
  }

  private scheduleMirror(delay: number): void {
    clearTimeout(this.mirrorTimer);
    this.mirrorTimer = setTimeout(() => {
      this.mirroring = this.mirroring.then(() => this.mirrorNow()).catch((error: unknown) => {
        // Lost network, or the plain files changed under this tab: read them again and try again soon.
        console.warn('Could not update the plain files', error);
        this.rereadPlain = true;
        if (!this.closed) this.scheduleMirror(MIRROR_RETRY);
      });
    }, delay);
  }

  // Makes the plain files match the document: renames, deletions, new files
  // and text. A collaborator's binary files stay in the uploads folder.
  // The owner's other computer does the same, so before making a file, see
  // whether it made it already; and where both saved a file, the text is
  // the same merged text, so this one's is kept.
  private async mirrorNow(): Promise<void> {
    if (!this.mirror || this.closed || !this.leadingNow()) return;
    this.lastMirror = Date.now();
    const { project: plain, sync, paths } = this.mirror;
    const fileAt = (path: string) => plain.files.find((f) => f.path === path);
    const fileIds = plainFileIds(this.doc);
    let entries = sharedFiles(this.doc);
    if (this.rereadPlain || entries.some((e) => e.text && !fileAt(e.path) && !(paths.get(e.id) && fileAt(paths.get(e.id) as string)))) {
      this.rereadPlain = false;
      await sync.checkDrive();
      this.adoptPlainFiles(); // files it brought in: Tilde's own for files deleted since, or new ones
      await this.outsideEdits(); // and files changed outside Tilde
      entries = sharedFiles(this.doc);
    }
    // 1. Plain files of deleted files go to Drive's trash.
    const ids = new Set(entries.map((e) => e.id));
    for (const [id, path] of [...paths]) {
      if (ids.has(id)) continue;
      if (fileAt(path)) await sync.deleteFile(path); // if this fails (no network), the next pass tries again
      paths.delete(id);
    }
    // 2. Renamed files move, each to a free place (a file still waiting to
    // move out of the way is waited for: the next pass moves the rest).
    // A file moves at most once per pass, and there are at most as many passes as files.
    for (let moved = true, pass = 0; moved && pass < entries.length; pass++) {
      moved = false;
      const movedNow = new Set<string>();
      for (const entry of entries) {
        const own = entry.driveId ? plain.files.find((f) => f.driveId === entry.driveId) : undefined;
        if (entry.driveId && !own) continue; // a collaborator's upload
        const before = own?.path ?? paths.get(entry.id);
        if (!before || !fileAt(before)) continue;
        paths.set(entry.id, before);
        if (before === entry.path || fileAt(entry.path)) continue;
        if (movedNow.has(before)) continue; // moved there in this pass already: one file, two entries
        await sync.moveFile(before, entry.path);
        paths.set(entry.id, entry.path);
        movedNow.add(entry.path);
        moved = true;
      }
    }
    // 3. Text, written into each file's own plain file only; a new file gets one
    // where its place is free. What is about to be written is noted (and saved)
    // first, so it is never taken for an edit made outside Tilde.
    const hashes = plainHashes(this.doc);
    let noted = false;
    for (const entry of entries) {
      const text = entry.text?.toString();
      const mine = paths.get(entry.id);
      const file = mine ? fileAt(mine) : undefined;
      const writes = text !== undefined && (file ? mine === entry.path && file.content !== text : !fileAt(entry.path));
      // The last few, since a write noted here may never happen (the tab goes away) while an earlier one did.
      const recent = (hashes.get(entry.id) ?? '').split(' ').filter(Boolean);
      if (writes && !recent.includes(textHash(text))) {
        hashes.set(entry.id, [...recent.slice(-7), textHash(text)].join(' '));
        noted = true;
      }
    }
    if (noted) {
      // No plain file is written before its note is in Drive for sure: saved,
      // and seen there again by a later look (a write at the same moment can cover it).
      await this.saveNow();
      for (let tries = 0; tries < 3 && this.unconfirmed && !this.hasUnsaved(); tries++) await this.saveNow();
      if (this.hasUnsaved() || this.unconfirmed || !this.leadingNow()) {
        this.scheduleMirror(MIRROR_DELAY);
        return;
      }
    }
    for (const entry of entries) {
      if (!entry.text) continue;
      const text = entry.text.toString();
      const mine = paths.get(entry.id);
      const file = mine ? fileAt(mine) : undefined;
      if (file) {
        if (mine === entry.path && file.content !== text) {
          file.content = text;
          file.changed = true; // saved below, by this pass only (no timer of its own)
        }
      } else if (!fileAt(entry.path)) {
        await sync.addFile(entry.path, text);
        paths.set(entry.id, entry.path);
        // Noted at once, so if this tab goes away, the next one knows whose file it is.
        const made = fileAt(entry.path)?.driveId;
        if (made) fileIds.set(entry.id, made);
      }
    }
    const main = sharedMainFile(this.doc);
    if (main && main !== plain.mainFile && fileAt(main)) await sync.setMainFile(main);
    if (sync.hasUnsaved()) await sync.saveNow();
    if (sync.conflicts.size > 0) {
      // Drive has a version of a plain file this tab did not write, and it
      // is the only owner's tab that writes them: an edit made outside Tilde.
      // Take it in and merge it (the next round writes the merged text), never write over it.
      for (const path of [...sync.conflicts]) await sync.keepDrive(path);
      await this.outsideEdits();
    }
    // Note the versions just written, so they are not taken for edits made
    // outside Tilde, and which plain file belongs to which file.
    const seen = plainRevisions(this.doc);
    for (const entry of entries) {
      const mine = paths.get(entry.id);
      const file = entry.text && mine === entry.path ? fileAt(mine) : undefined;
      if (file?.revision && seen.get(entry.id) !== file.revision) seen.set(entry.id, file.revision);
      if (file?.driveId && fileIds.get(entry.id) !== file.driveId) fileIds.set(entry.id, file.driveId);
    }
  }

  // ---- Who is here ----

  // One look at the mailbox: says "here" every HEARTBEAT, sees who else is
  // here, and makes direct connections to them (see live.ts). While one is
  // being made, it looks every few seconds.
  private async mailboxRound(): Promise<void> {
    if (this.closed) return;
    try {
      const box = await this.readMailbox();
      const now = Date.now();
      // Whether this tab's own word was still in the mailbox: another tab's write may have wiped it out.
      this.selfSeen = box.here?.[this.session] ? this.selfSeen + 1 : 0;
      // Another computer's clock may differ from this one, so a tab's age is
      // counted from when this tab last saw its entry change.
      // A tab seen for the first time counts from how much older its word is
      // than the newest one, so a tab closed long ago is not taken for here.
      const fresh = (here: Mailbox['here']) => Object.fromEntries(Object.entries(here ?? {}).filter(([session, h]) => {
        const seen = this.lastSeen.get(session);
        const newest = Math.max(...Object.values(here ?? {}).map((other) => other.at));
        if (!seen) this.lastSeen.set(session, { at: h.at, local: now - Math.min(Math.max(newest - h.at, 0), HERE_FOR) });
        else if (seen.at !== h.at) this.lastSeen.set(session, { at: h.at, local: now });
        return session === this.session || now - (this.lastSeen.get(session)?.local ?? now) < HERE_FOR;
      }));
      this.here = fresh(box.here);
      const beat = !this.readOnly && (now - this.lastBeat >= HEARTBEAT || !this.here[this.session]);
      if (beat) this.here[this.session] = { name: this.myName, at: now, account: this.accountId, leads: this.leading };
      const signals = await this.live?.step(Object.keys(this.here), box.signals ?? {}) ?? null;
      if (this.closed) return; // left meanwhile: do not say "here" again
      if (beat || signals) {
        // Read again just before writing, so others' words written meanwhile are kept.
        const latest = await this.readMailbox();
        const here = { ...fresh(latest.here), ...(beat ? { [this.session]: this.here[this.session] } : {}) };
        const merged: Signals = { ...latest.signals };
        for (const [key, signal] of Object.entries(signals ?? {})) {
          if (signal) merged[key] = signal;
          else delete merged[key]; // eslint-disable-line @typescript-eslint/no-dynamic-delete -- a plain JSON record
        }
        await this.drive.updateFile(this.ids.mailboxId, new TextEncoder().encode(JSON.stringify({ here, signals: merged })));
        if (beat) this.lastBeat = now;
        this.here = here;
      }
      this.updatePeople();
      this.rounds++;
      this.lastRound = Date.now();
      const leading = this.isLeader();
      if (leading && !this.leading) {
        this.leading = true;
        this.startMirroring();
      }
      if (!leading) this.stopMirroring();
      // Now and then, read the plain files again and catch up, whatever may have been missed.
      if (this.leading && Date.now() - this.lastMirror > MIRROR_CHECK) {
        this.rereadPlain = true;
        this.scheduleMirror(0);
      }
      // The other tabs must see whether this one keeps the plain files: say so at once.
      if ((this.here[this.session]?.leads ?? false) !== this.leading) this.lastBeat = 0;
    } catch (error) {
      console.warn('Could not update who is here', error);
      this.stopMirroring(); // without the mailbox, another tab may be keeping the plain files by now
    }
    clearTimeout(this.heartbeatTimer);
    const others = Object.keys(this.here).filter((session) => session !== this.session);
    const connected = new Set(this.live?.connected() ?? []);
    const waiting = this.live !== null && (this.live.connecting() || others.some((session) => !connected.has(session)));
    // The first rounds come quickly, so the owner's tabs agree soon on which keeps the plain files.
    const soon = waiting || this.rounds < 2 || this.lastBeat === 0;
    this.heartbeatTimer = setTimeout(() => void this.mailboxRound(), soon ? CONNECTING_CHECK : HEARTBEAT);
  }

  // Of the owner's tabs that have the project open (on one computer or
  // several), only one keeps the plain files: the one with the smallest id
  // among those heard from lately (a tab closed or reloaded without saying
  // goodbye stops counting soon). So a plain file with a version that tab did
  // not write was edited outside Tilde. Decided after two looks at the
  // mailbox, so each tab has seen the others.
  private isLeader(): boolean {
    // Only once the others can see this tab too: its word must have stayed in the mailbox.
    if (!this.mirror || this.rounds < 2 || this.selfSeen < 1) return false;
    const now = Date.now();
    const others = Object.entries(this.here).filter(([session, h]) => session !== this.session && h.account === this.accountId
      && now - (this.lastSeen.get(session)?.local ?? now) < LEADER_FRESH);
    // A tab that keeps them already goes on (a tab opened later does not take
    // over); if two say so at once, the one with the smaller id goes on.
    const keeping = others.filter(([, h]) => h.leads).map(([session]) => session);
    if (keeping.length > 0) return this.leading && keeping.every((session) => this.session < session);
    return others.every(([session]) => this.session < session);
  }

  // Whether this tab keeps the plain files right now: only while it hears
  // from the mailbox; a tab that lost the network for a while may have been
  // replaced by another.
  private leadingNow(): boolean {
    return this.leading && Date.now() - this.lastRound < LEADER_FRESH / 2;
  }

  // Saving for the owner's plain files, through a Drive that notes each
  // version it writes, so they are never taken for edits made outside Tilde.
  private plainSync(plain: Project): ProjectSync {
    const drive = this.drive;
    const noting: Drive = Object.create(drive) as Drive;
    noting.updateFile = async (fileId, content) => this.noteWritten(await drive.updateFile(fileId, content));
    noting.createFile = async (name, parentId, content) => this.noteWritten(await drive.createFile(name, parentId, content));
    return new ProjectSync(noting, noDrafts, this.accountId, plain, { stateChanged: () => this.update(), fileReplaced: () => {}, filesChanged: () => {} });
  }

  // This tab now keeps the plain files: first plain files that are not in
  // the document join it, and edits made outside Tilde are brought in, so
  // the plain files are not written over before. Starts afresh, without
  // writes left over from an earlier time this tab kept them.
  private startMirroring(): void {
    if (!this.mirror) return;
    this.mirror.sync.close();
    // Plain files that never reached Drive (made while offline, say) are made again from the document.
    const plain = this.mirror.project;
    plain.files.splice(0, plain.files.length, ...plain.files.filter((f) => f.driveId));
    for (const file of plain.files) file.changed = false;
    const sync = this.plainSync(this.mirror.project);
    this.mirror.sync = sync;
    this.mirroring = this.mirroring.then(async () => {
      // Another tab may have kept them until now: first the newest shared
      // text (with that tab's notes of what it wrote), then the plain files again.
      await this.saveNow();
      if (this.hasUnsaved()) return; // no network: the next round that leads tries again
      await sync.checkDrive();
      this.adoptPlainFiles();
      await this.outsideEdits();
    }).catch((error: unknown) => console.warn('Could not check for edits made outside Tilde', error));
    this.scheduleMirror(0);
  }

  // Another tab keeps the plain files now: this one's writes still waiting
  // (to be tried again after a lost network, say) are dropped.
  private stopMirroring(): void {
    if (!this.leading) return;
    this.leading = false;
    this.mirror?.sync.close();
  }

  // A version of a plain file this tab wrote (see the noting Drive above).
  private noteWritten<T extends { headRevisionId?: string }>(file: T): T {
    if (file.headRevisionId) this.written.add(file.headRevisionId);
    return file;
  }

  private async readMailbox(): Promise<Mailbox> {
    try {
      const box: unknown = JSON.parse(new TextDecoder().decode(await this.drive.download(this.ids.mailboxId)));
      return box !== null && typeof box === 'object' && !Array.isArray(box) ? box as Mailbox : {};
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
      const signals = Object.fromEntries(Object.entries(box.signals ?? {}).filter(([key]) => !key.split('>').includes(this.session)));
      await this.drive.updateFile(this.ids.mailboxId, new TextEncoder().encode(JSON.stringify({ here, signals })));
    } catch {
      // The entry runs out by itself after HERE_FOR.
    }
  }

  // ---- Plumbing ----

  private schedulePoll(delay: number): void {
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      // While someone is here but not connected directly, Drive carries their edits: read it often.
      void this.saveNow().then(() => {
        if (!this.closed) this.schedulePoll(this.people.length > this.livePeople.length ? POLL_TOGETHER : this.unconfirmed ? CONFIRM_DELAY : POLL_ALONE);
      });
    }, delay);
  }

  private scheduleSave(delay: number): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), delay);
  }

  // Keeps the document in the browser while it has unsaved edits.
  private keepInBrowser(): void {
    clearTimeout(this.storeTimer);
    this.storeTimer = setTimeout(() => void this.storeNow(), 500);
  }

  // The copy is shared by this account's tabs on this computer, so this tab
  // adds its document to it rather than replacing another tab's.
  private async storeNow(): Promise<void> {
    if (!this.localChange && !this.unconfirmed && !this.uploading) return;
    try {
      const before = await this.store.get(this.accountId, this.ids.folderId);
      const mine = Y.encodeStateAsUpdate(this.doc);
      const update = before ? Y.mergeUpdates([before.update, mine]) : mine;
      await this.store.put({ accountId: this.accountId, projectId: this.ids.folderId, projectName: this.project.name, update });
    } catch (error) {
      console.warn('Could not keep the edits in the browser', error);
    }
  }

  // Like enqueue, but the caller also gets the error, to show it.
  private action(task: () => Promise<void>): Promise<void> {
    if (this.readOnly) return Promise.reject(new Error('You can only view this project, so its files cannot be changed here.'));
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
    // The owner made this account a viewer meanwhile.
    if (!this.readOnly && error instanceof Error && /403[\s\S]*insufficient(File)?Permissions/i.test(error.message)) {
      this.viewOnly();
      this.listener.notice('The owner changed your access to "can view". Edits you made since the last save are only in this browser; '
        + 'Download as .zip keeps them.');
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

