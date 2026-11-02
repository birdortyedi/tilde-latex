// Tilde's own IndexedDB database in the browser. It holds:
// - "drafts": edits that have not reached Drive yet (see drafts.ts)
// - "packages": TeX package files downloaded from the package server (see packageCache.ts)

const DB_NAME = 'tilde';
// 2: drafts are tagged with the Google account. 3: package cache.
const DB_VERSION = 3;

export const DRAFTS = 'drafts';
export const PACKAGES = 'packages';

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 2) {
        // Version 1 drafts have no account, so they cannot be given to anyone safely.
        if (db.objectStoreNames.contains(DRAFTS)) db.deleteObjectStore(DRAFTS);
        db.createObjectStore(DRAFTS, { keyPath: ['accountId', 'projectId', 'path'] });
      }
      if (event.oldVersion < 3) db.createObjectStore(PACKAGES, { keyPath: 'path' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

// Runs one IndexedDB request on a store and waits for its transaction to finish.
export async function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  makeRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const transaction = (await openDatabase()).transaction(storeName, mode);
  const request = makeRequest(transaction.objectStore(storeName));
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
  });
}
