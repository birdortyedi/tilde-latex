import { DRAFTS, run } from './database';

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

export const browserDrafts: DraftStore = {
  async put(draft) {
    await run(DRAFTS, 'readwrite', (store) => store.put(draft));
  },
  async remove({ accountId, projectId, path }) {
    await run(DRAFTS, 'readwrite', (store) => store.delete([accountId, projectId, path]));
  },
  async list() {
    return run(DRAFTS, 'readonly', (store) => store.getAll() as IDBRequest<Draft[]>);
  },
  async clear() {
    await run(DRAFTS, 'readwrite', (store) => store.clear());
  },
};
