import { SignInNeededError } from './auth';
import { OfflineError, type Drive } from './drive';
import type { DraftKey, DraftStore } from './drafts';
import { currentRevisions, moveFile, removeEmptyFolders, saveProject, setMainFile, trashFile } from './driveProjects';
import { isTextFile } from './fileTree';
import type { Project, ProjectFile } from './projects';

// "chapters/intro.tex" → "chapters"; "main.tex" → ""
const folderOf = (path: string): string => path.split('/').slice(0, -1).join('/');

export const AUTOSAVE_DELAY = 3_000; // milliseconds after the last edit
export const RETRY_DELAY = 30_000; // milliseconds before trying again after a failed save

export type SyncState =
  | 'saved' // everything is in Drive
  | 'unsaved' // edits are waiting for the next save
  | 'saving' // a save is uploading right now
  | 'offline' // no network; edits are kept in the browser
  | 'signin' // the Google token ran out; the user must click "Sign in"
  | 'error' // Drive answered with an error; Tilde tries again later
  | 'conflict'; // a file changed both here and in Drive; the user must choose

export interface SyncListener {
  stateChanged(): void;
  // A file's text was replaced (by Drive's version or a restored draft),
  // so the editor must show the new text.
  fileReplaced(path: string, content: string): void;
}

// Keeps one open Drive project in step with Drive: saves edits a few seconds
// after typing stops, keeps unsaved edits in the browser (drafts), notices
// files changed elsewhere, and never overwrites those without asking.
//
// All Drive work runs one task at a time (the `queue`), so a save and a
// check for changes never step on each other.
export class ProjectSync {
  readonly conflicts = new Set<string>(); // paths changed both here and in Drive
  state: SyncState = 'saved';
  errorMessage = '';
  private problem: 'offline' | 'signin' | 'error' | null = null;
  private projectId: string;
  private uploading = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private saveQueued = false;
  private closed = false;

  constructor(
    private drive: Drive,
    private drafts: DraftStore,
    private accountId: string, // the signed-in Google account, to tag drafts with
    readonly project: Project,
    private listener: SyncListener,
  ) {
    if (!project.driveId) throw new Error(`${project.name} is not in Google Drive.`);
    this.projectId = project.driveId;
  }

  // The editor calls this after every change to a file's text.
  edited(path: string): void {
    const file = this.file(path);
    if (!file) return;
    file.changed = true;
    this.syncDraft(file);
    this.scheduleSave(AUTOSAVE_DELAY);
    this.update();
  }

  // Saves all changed files now (Ctrl/Cmd+S, tab hidden, back online).
  saveNow(): Promise<void> {
    clearTimeout(this.timer);
    if (!this.saveQueued) {
      this.saveQueued = true;
      this.enqueue(async () => {
        this.saveQueued = false;
        await this.save();
      });
    }
    return this.queue;
  }

  // Right after opening: puts back edits that never reached Drive, then saves
  // them. A draft keeps the revision it started from, so if the file changed
  // in Drive meanwhile, saving reports a conflict instead of overwriting.
  restoreDrafts(): Promise<void> {
    this.enqueue(async () => {
      for (const draft of await this.drafts.list()) {
        if (draft.accountId !== this.accountId || draft.projectId !== this.projectId) continue;
        const file = this.file(draft.path);
        if (!file) continue; // the file is no longer in Drive; keep the draft
        file.content = draft.content;
        file.revision = draft.revision;
        file.changed = true;
        this.listener.fileReplaced(file.path, draft.content);
      }
    });
    return this.saveNow();
  }

  // When the user comes back to the tab: loads files that changed in Drive
  // meanwhile. Files also edited here become conflicts instead.
  checkDrive(): Promise<void> {
    return this.enqueue(async () => {
      const revisions = await currentRevisions(this.drive, this.project);
      for (const file of this.project.files) {
        if (!file.driveId || !revisions.has(file.driveId)) continue;
        const revision = revisions.get(file.driveId);
        if (revision === file.revision) continue;
        if (!file.changed) {
          const bytes = await this.drive.download(file.driveId);
          if (!file.changed) { // the user may have typed during the download
            this.replace(file, bytes, revision);
            continue;
          }
        }
        this.conflicts.add(file.path);
      }
    });
  }

  // Conflict choice "Keep mine": overwrite Drive's version with this one.
  keepMine(path: string): Promise<void> {
    return this.enqueue(async () => {
      const file = this.file(path);
      if (!file?.driveId) return;
      file.revision = (await this.drive.get(file.driveId)).headRevisionId;
      this.conflicts.delete(path);
      await this.save();
    });
  }

  // Conflict choice "Keep Drive's": throw away the edits here.
  keepDrive(path: string): Promise<void> {
    return this.enqueue(async () => {
      const file = this.file(path);
      if (!file?.driveId) return;
      const { headRevisionId } = await this.drive.get(file.driveId);
      this.replace(file, await this.drive.download(file.driveId), headRevisionId);
      this.conflicts.delete(path);
    });
  }

  // File actions. They run in the same queue as saving, so they never clash
  // with a save, and their errors are passed to the caller.

  // Adds a file (new, uploaded or duplicated), or replaces the content of an
  // existing one, and saves it to Drive.
  addFile(path: string, content: string | Uint8Array): Promise<void> {
    return this.action(async () => {
      const existing = this.file(path);
      if (existing) {
        existing.content = content;
        existing.changed = true;
        if (typeof content === 'string') this.listener.fileReplaced(path, content);
      } else {
        this.project.files.push({ path, content, changed: true });
      }
      await this.save();
    });
  }

  // Moves a file to Drive's trash (restorable there for 30 days).
  deleteFile(path: string): Promise<void> {
    return this.action(async () => {
      const file = this.file(path);
      if (!file) return;
      await trashFile(this.drive, file);
      this.project.files.splice(this.project.files.indexOf(file), 1);
      await removeEmptyFolders(this.drive, this.project, folderOf(path));
      this.conflicts.delete(path);
      file.changed = false;
      this.syncDraft(file); // removes its draft
    });
  }

  // Renames a file or moves it to another folder; unsaved edits move with it.
  moveFile(from: string, to: string): Promise<void> {
    return this.action(async () => {
      const file = this.file(from);
      if (!file) return;
      await moveFile(this.drive, this.project, file, to);
      await removeEmptyFolders(this.drive, this.project, folderOf(from));
      if (this.project.mainFile === from) await setMainFile(this.drive, this.project, to);
      if (this.conflicts.delete(from)) this.conflicts.add(to);
      this.drafts.remove({ accountId: this.accountId, projectId: this.projectId, path: from })
        .catch((error: unknown) => console.warn('Could not update the copy kept in the browser', error));
      this.syncDraft(file);
    });
  }

  setMainFile(path: string): Promise<void> {
    return this.action(() => setMainFile(this.drive, this.project, path));
  }

  // Drive's version of a file, for the conflict choice "Download both".
  async driveVersion(path: string): Promise<Uint8Array> {
    const file = this.file(path);
    if (!file?.driveId) throw new Error(`${path} is not in Google Drive.`);
    return this.drive.download(file.driveId);
  }

  hasUnsaved(): boolean {
    return this.project.files.some((f) => f.changed);
  }

  // Resolves when all Drive work that was started has finished.
  idle(): Promise<void> {
    return this.queue;
  }

  // Stops all work, for example when another project is opened.
  // Unsaved edits stay in the drafts and come back next time.
  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
  }

  private async save(): Promise<void> {
    const pending = this.project.files.filter((f) => f.changed);
    if (pending.length === 0) return;
    this.uploading = true;
    this.update();
    try {
      for (const path of await saveProject(this.drive, this.project)) this.conflicts.add(path);
    } finally {
      this.uploading = false;
      // Even if saving stopped halfway (network lost), update the drafts of
      // the files that did reach Drive.
      for (const file of pending) this.syncDraft(file);
    }
  }

  private replace(file: ProjectFile, bytes: Uint8Array, revision: string | undefined): void {
    file.content = isTextFile(file.path) ? new TextDecoder().decode(bytes) : bytes;
    file.revision = revision;
    file.changed = false;
    this.syncDraft(file);
    if (typeof file.content === 'string') this.listener.fileReplaced(file.path, file.content);
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
      this.problem = 'signin'; // wait for the user to sign in again
      return;
    }
    this.problem = error instanceof OfflineError ? 'offline' : 'error';
    this.errorMessage = error instanceof Error ? error.message : String(error);
    this.scheduleSave(RETRY_DELAY);
  }

  private scheduleSave(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.saveNow(), delay);
  }

  // Keeps the browser copy in step with the file: a draft while it has
  // unsaved edits, none once it is saved.
  private syncDraft(file: ProjectFile): void {
    const key: DraftKey = { accountId: this.accountId, projectId: this.projectId, path: file.path };
    const work = file.changed && typeof file.content === 'string'
      ? this.drafts.put({ ...key, projectName: this.project.name, content: file.content, revision: file.revision })
      : this.drafts.remove(key);
    work.catch((error: unknown) => console.warn('Could not update the copy kept in the browser', error));
  }

  private update(): void {
    if (this.closed) return;
    this.state = this.conflicts.size > 0 ? 'conflict'
      : !this.hasUnsaved() ? 'saved'
      : this.uploading ? 'saving'
      : (this.problem ?? 'unsaved');
    this.listener.stateChanged();
  }

  private file(path: string): ProjectFile | undefined {
    return this.project.files.find((f) => f.path === path);
  }
}
