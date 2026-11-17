import { LOCAL, run } from './database';
import type { Project, ProjectFile } from './projects';
import type { SyncState } from './sync';

// Projects started without signing in ("Start writing" on the welcome
// page). They are kept only in this browser (IndexedDB) and belong to no
// Google account, until "Save to Google Drive" makes them ordinary Drive
// projects and removes them from here. Browsers may clear this storage
// (Safari after seven days without a visit), which the user is told.

export interface LocalProject {
  id: string;
  name: string;
  files: { path: string; content: string | Uint8Array }[];
  mainFile?: string;
  edited: number; // milliseconds since 1970, for "Edited 5 minutes ago"
}

// The operations Tilde needs. Tests use an in-memory fake instead.
export interface LocalStore {
  get(id: string): Promise<LocalProject | undefined>;
  put(project: LocalProject): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<LocalProject[]>;
}

export const browserLocal: LocalStore = {
  async get(id) {
    return run(LOCAL, 'readonly', (store) => store.get(id) as IDBRequest<LocalProject | undefined>);
  },
  async put(project) {
    await run(LOCAL, 'readwrite', (store) => store.put(project));
  },
  async remove(id) {
    await run(LOCAL, 'readwrite', (store) => store.delete(id));
  },
  async list() {
    return run(LOCAL, 'readonly', (store) => store.getAll() as IDBRequest<LocalProject[]>);
  },
};

export const SAVE_DELAY = 500; // milliseconds after the last edit

// The open project as a Project, and back.
export const toProject = (local: LocalProject): Project => ({
  name: local.name,
  files: local.files.map((f) => ({ path: f.path, content: f.content })),
  mainFile: local.mainFile,
});

const toLocal = (id: string, project: Project): LocalProject => ({
  id,
  name: project.name,
  files: project.files.map((f) => ({ path: f.path, content: f.content })),
  mainFile: project.mainFile,
  edited: Date.now(),
});

// A name for a new project that none of the others has: "Untitled", "Untitled 2", …
export function untitledName(taken: string[]): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'Untitled' : `Untitled ${n}`;
    if (!taken.includes(name)) return name;
  }
}

// A new project in this browser, saved right away.
export async function createLocal(store: LocalStore, name: string, files: ProjectFile[]): Promise<LocalProject> {
  const local = toLocal(crypto.randomUUID(), { name, files });
  await store.put(local);
  return local;
}

// Keeps the open project in this browser: like ProjectSync (sync.ts) for a
// Drive project, with the same file actions, but every save goes to IndexedDB.
// The project may be open in two tabs: before each save it checks that the
// stored copy is still the one it last read or wrote, and otherwise stops
// and says so, so neither tab overwrites the other's work.
export const CHANGED_ELSEWHERE = 'This project was changed in another tab of this browser, so this tab stopped keeping it. '
  + 'To keep what you wrote here, download it as a .zip (in the project\'s ⋯ menu), then reload the tab.';
export const GONE_ELSEWHERE = 'This project was saved to Google Drive or deleted in another tab of this browser, so this tab '
  + 'stopped keeping it. To keep what you wrote here, download it as a .zip (in the project\'s ⋯ menu).';

export class LocalSync {
  readonly conflicts = new Set<string>(); // never any: only this browser changes the project
  state: SyncState = 'saved';
  errorMessage = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private pending = false;
  private changes = 0; // edits so far; a save counts only for the edits it wrote
  private stopped = false; // another tab changed or removed the stored copy
  private closed = false;

  constructor(
    private store: LocalStore,
    readonly id: string,
    readonly project: Project,
    private stored: number, // the "edited" time of the copy this tab read or last wrote
    private stateChanged: () => void,
  ) {}

  // The editor calls this after every change to a file's text.
  edited(path: string): void {
    if (!this.file(path)) return;
    this.pending = true;
    this.changes++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.saveNow(), SAVE_DELAY);
  }

  saveNow(): Promise<void> {
    clearTimeout(this.timer);
    this.queue = this.queue.then(() => this.save());
    return this.queue;
  }

  // Nothing to restore: every edit is in the browser already.
  restoreDrafts(): Promise<void> {
    return Promise.resolve();
  }

  addFile(path: string, content: string | Uint8Array): Promise<void> {
    const existing = this.file(path);
    if (existing) existing.content = content;
    else this.project.files.push({ path, content });
    return this.change();
  }

  deleteFile(path: string): Promise<void> {
    const file = this.file(path);
    if (file) this.project.files.splice(this.project.files.indexOf(file), 1);
    return this.change();
  }

  moveFile(from: string, to: string): Promise<void> {
    const file = this.file(from);
    if (file) file.path = to;
    if (this.project.mainFile === from) this.project.mainFile = to;
    return this.change();
  }

  // Returns the old and new paths of the files in the folder, so the editor can follow them.
  async renameFolder(dir: string, newName: string): Promise<[string, string][]> {
    const parent = dir.split('/').slice(0, -1).join('/');
    const newDir = parent ? `${parent}/${newName}` : newName;
    const moved: [string, string][] = [];
    for (const file of this.project.files) {
      if (!file.path.startsWith(`${dir}/`)) continue;
      const to = newDir + file.path.slice(dir.length);
      moved.push([file.path, to]);
      if (this.project.mainFile === file.path) this.project.mainFile = to;
      file.path = to;
    }
    await this.change();
    return moved;
  }

  rename(name: string): Promise<void> {
    this.project.name = name;
    return this.change();
  }

  setMainFile(path: string): Promise<void> {
    this.project.mainFile = path;
    return this.change();
  }

  hasUnsaved(): boolean {
    return this.pending;
  }

  idle(): Promise<void> {
    return this.queue;
  }

  // Another project is opened: what is not saved yet is saved now.
  close(): void {
    if (this.pending) void this.saveNow();
    this.closed = true;
  }

  private file(path: string): ProjectFile | undefined {
    return this.project.files.find((f) => f.path === path);
  }

  private change(): Promise<void> {
    this.pending = true;
    this.changes++;
    return this.saveNow();
  }

  private async save(): Promise<void> {
    if (!this.pending || this.stopped) return;
    const changes = this.changes;
    try {
      const now = await this.store.get(this.id);
      if (now?.edited !== this.stored) {
        this.stopped = true;
        this.setState('error', now ? CHANGED_ELSEWHERE : GONE_ELSEWHERE);
        return;
      }
      const record = toLocal(this.id, this.project);
      await this.store.put(record);
      this.stored = record.edited;
      if (this.changes === changes) this.pending = false; // edits made during the write wait for the next save
      this.setState('saved', '');
    } catch (error) {
      // Tried again with the next edit.
      this.setState('error', `This browser could not keep the project: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private setState(state: SyncState, message: string): void {
    this.state = state;
    this.errorMessage = message;
    if (!this.closed) this.stateChanged();
    else if (state === 'error') console.warn(`${this.project.name}: ${message}`); // another project is open now
  }
}
