import { run, SHARED } from './database';

// A shared project's document as this browser has it, kept in IndexedDB while
// it has edits that have not reached Drive, so a crashed tab or a lost
// network loses nothing. Removed once everything is saved, and on sign-out.

export interface SharedCopy {
  accountId: string; // the Google account that made the edits
  projectId: string; // the project's Drive folder
  projectName: string;
  update: Uint8Array; // the whole document (Y.encodeStateAsUpdate)
}

export interface SharedStore {
  put(copy: SharedCopy): Promise<void>;
  get(accountId: string, projectId: string): Promise<SharedCopy | undefined>;
  remove(accountId: string, projectId: string): Promise<void>;
  list(): Promise<SharedCopy[]>;
  clear(): Promise<void>;
}

export const browserShared: SharedStore = {
  async put(copy) {
    await run(SHARED, 'readwrite', (store) => store.put(copy));
  },
  async get(accountId, projectId) {
    return run(SHARED, 'readonly', (store) => store.get([accountId, projectId]) as IDBRequest<SharedCopy | undefined>);
  },
  async remove(accountId, projectId) {
    await run(SHARED, 'readwrite', (store) => store.delete([accountId, projectId]));
  },
  async list() {
    return run(SHARED, 'readonly', (store) => store.getAll() as IDBRequest<SharedCopy[]>);
  },
  async clear() {
    await run(SHARED, 'readwrite', (store) => store.clear());
  },
};

// For tests.
export class MemoryShared implements SharedStore {
  copies = new Map<string, SharedCopy>();
  async put(copy: SharedCopy) { this.copies.set(`${copy.accountId}/${copy.projectId}`, copy); }
  async get(accountId: string, projectId: string) { return this.copies.get(`${accountId}/${projectId}`); }
  async remove(accountId: string, projectId: string) { this.copies.delete(`${accountId}/${projectId}`); }
  async list() { return [...this.copies.values()]; }
  async clear() { this.copies.clear(); }
}
