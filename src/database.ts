// Tilde's own IndexedDB database in the browser. It holds:
// - "drafts": edits that have not reached Drive yet (see drafts.ts)
// - "packages": TeX package files downloaded from the package server (see packageCache.ts)
// - "shared": shared projects' text with edits that have not reached Drive yet (see sharedStore.ts)
// - "local": projects started without signing in, kept only in this browser (see localProjects.ts)

const DB_NAME = 'tilde';
// 2: drafts are tagged with the Google account. 3: package cache. 4: shared projects.
// 5: projects kept in this browser.
const DB_VERSION = 5;

export const DRAFTS = 'drafts';
export const PACKAGES = 'packages';
export const SHARED = 'shared';
export const LOCAL = 'local';

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
      if (event.oldVersion < 4) db.createObjectStore(SHARED, { keyPath: ['accountId', 'projectId'] });
      if (event.oldVersion < 5) db.createObjectStore(LOCAL, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      // A newer Tilde in another tab needs to change the database: let it,
      // and open it again here the next time it is needed.
      db.onversionchange = () => {
        db.close();
        database = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    // An older Tilde in another tab keeps the database open, so it cannot be
    // changed: say so, instead of waiting for ever. The next call tries again.
    request.onblocked = () => {
      database = null;
      reject(new Error('Tilde is open in another tab, in an older version. Close that tab, then reload this one.'));
    };
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
