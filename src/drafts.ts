// Edits that have not reached Drive yet, kept in the browser's IndexedDB so
// that a crashed tab or a lost network loses nothing. A draft is removed once
// its file is saved to Drive, and all drafts are removed on sign-out.

export interface Draft {
  accountId: string; // the Google account that made the edit
  projectId: string; // the project's Drive folder
  projectName: string; // for file names when the drafts are downloaded
  path: string;
  content: string;
  // The Drive revision the edit started from. If Drive has another revision
  // when the draft is restored, the file changed elsewhere: a conflict.
  revision?: string;
}

export type DraftKey = Pick<Draft, 'accountId' | 'projectId' | 'path'>;

// The draft operations Tilde needs. Tests use an in-memory fake instead.
export interface DraftStore {
  put(draft: Draft): Promise<void>;
  remove(key: DraftKey): Promise<void>;
  list(): Promise<Draft[]>; // every draft in this browser
  clear(): Promise<void>;
}

// Deletes drafts left in this browser by other Google accounts, so one
// person's unsaved edits are never shown to someone else.
export async function forgetOtherAccounts(store: DraftStore, accountId: string): Promise<void> {
  for (const draft of await store.list()) {
    if (draft.accountId !== accountId) await store.remove(draft);
  }
}

const DB_NAME = 'tilde';
const DB_VERSION = 2; // 2: drafts are tagged with the Google account
const STORE = 'drafts';

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Version 1 drafts have no account, so they cannot be given to anyone safely.
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE, { keyPath: ['accountId', 'projectId', 'path'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

// Runs one IndexedDB request and waits for its transaction to finish.
async function run<T>(mode: IDBTransactionMode, makeRequest: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const transaction = (await openDatabase()).transaction(STORE, mode);
  const request = makeRequest(transaction.objectStore(STORE));
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
  });
}

export const browserDrafts: DraftStore = {
  async put(draft) {
    await run('readwrite', (store) => store.put(draft));
  },
  async remove({ accountId, projectId, path }) {
    await run('readwrite', (store) => store.delete([accountId, projectId, path]));
  },
  async list() {
    return run('readonly', (store) => store.getAll() as IDBRequest<Draft[]>);
  },
  async clear() {
    await run('readwrite', (store) => store.clear());
  },
};
