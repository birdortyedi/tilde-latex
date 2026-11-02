import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetOtherAccounts, type Draft, type DraftKey, type DraftStore } from './drafts';
import { createProject, findOrCreateRootFolder } from './driveProjects';
import type { Project, ProjectFile } from './projects';
import { AUTOSAVE_DELAY, ProjectSync, RETRY_DELAY, type SyncState } from './sync';
import { FakeDrive } from './testing/fakeDrive';

// An in-memory stand-in for the drafts kept in IndexedDB.
class MemoryDrafts implements DraftStore {
  all = new Map<string, Draft>();
  private key = (k: DraftKey) => `${k.accountId}|${k.projectId}|${k.path}`;
  async put(draft: Draft) { this.all.set(this.key(draft), { ...draft }); }
  async remove(key: DraftKey) { this.all.delete(this.key(key)); }
  async list() { return [...this.all.values()]; }
  async clear() { this.all.clear(); }
  // The draft of a file in the test project, made by the account "me".
  get(path: string) { return [...this.all.values()].find((d) => d.accountId === 'me' && d.path === path); }
}

describe('forgetOtherAccounts', () => {
  it('deletes only the drafts of other Google accounts', async () => {
    const drafts = new MemoryDrafts();
    const draft = { projectId: 'p', projectName: 'paper', path: 'main.tex', content: 'x' };
    await drafts.put({ ...draft, accountId: 'me' });
    await drafts.put({ ...draft, accountId: 'someone else' });
    await forgetOtherAccounts(drafts, 'me');
    expect((await drafts.list()).map((d) => d.accountId)).toEqual(['me']);
  });
});

describe('ProjectSync', () => {
  let drive: FakeDrive;
  let drafts: MemoryDrafts;
  let project: Project;
  let sync: ProjectSync;
  let replaced: Record<string, string>; // what the editor was told to show
  let states: SyncState[]; // every status shown, in order

  const file = (path: string): ProjectFile => {
    const found = project.files.find((f) => f.path === path);
    if (!found) throw new Error(`No ${path}`);
    return found;
  };
  const onDrive = (path: string) => drive.read(`LaTeX Projects/paper/${path}`);
  // The user types in the editor.
  const type = (path: string, content: string) => {
    file(path).content = content;
    sync.edited(path);
  };
  // The other computer saves a new version of a file.
  const otherComputerSaves = (path: string, content: string) =>
    drive.updateFile(file(path).driveId ?? '', new TextEncoder().encode(content));

  beforeEach(async () => {
    vi.useFakeTimers();
    drive = new FakeDrive();
    drafts = new MemoryDrafts();
    const rootId = await findOrCreateRootFolder(drive);
    project = await createProject(drive, rootId, 'paper', [
      { path: 'main.tex', content: 'v1' },
      { path: 'refs.bib', content: 'bib' },
    ]);
    replaced = {};
    states = [];
    sync = new ProjectSync(drive, drafts, 'me', project, {
      stateChanged: () => states.push(sync.state),
      fileReplaced: (path, content) => { replaced[path] = content; },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves 3 seconds after the last edit, not before', async () => {
    type('main.tex', 'v2');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY - 1000);
    type('main.tex', 'v3'); // typing again restarts the wait
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY - 1000);
    expect(onDrive('main.tex')).toBe('v1');
    expect(sync.state).toBe('unsaved');

    await vi.advanceTimersByTimeAsync(1000);
    await sync.idle();
    expect(onDrive('main.tex')).toBe('v3');
    expect(sync.state).toBe('saved');
    // "Saving…" only appears while uploading, after the wait.
    expect(states.filter((s, i) => s !== states[i - 1])).toEqual(['unsaved', 'saving', 'saved']);
  });

  it('keeps a copy in the browser until the edit is in Drive', async () => {
    type('main.tex', 'v2');
    expect(drafts.get('main.tex')?.content).toBe('v2');
    await sync.saveNow();
    expect(drafts.all.size).toBe(0);
  });

  it('keeps edits locally while offline and saves them when the network is back', async () => {
    drive.offline = true;
    type('main.tex', 'v2');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY);
    await sync.idle();
    expect(sync.state).toBe('offline');
    expect(onDrive('main.tex')).toBe('v1');
    expect(drafts.get('main.tex')?.content).toBe('v2');

    drive.offline = false;
    await vi.advanceTimersByTimeAsync(RETRY_DELAY); // tries again by itself
    await sync.idle();
    expect(onDrive('main.tex')).toBe('v2');
    expect(sync.state).toBe('saved');
    expect(drafts.all.size).toBe(0);
  });

  it('asks to sign in again when the token ran out, and waits for that', async () => {
    drive.signedOut = true;
    type('main.tex', 'v2');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY + RETRY_DELAY);
    await sync.idle();
    expect(sync.state).toBe('signin');
    expect(drafts.get('main.tex')?.content).toBe('v2');

    drive.signedOut = false; // the user clicked "Sign in"
    await sync.saveNow();
    expect(onDrive('main.tex')).toBe('v2');
    expect(sync.state).toBe('saved');
  });

  describe('when a file changed both here and on the other computer', () => {
    beforeEach(async () => {
      await otherComputerSaves('main.tex', 'theirs');
      type('main.tex', 'mine');
      await sync.saveNow();
    });

    it('does not overwrite Drive and reports a conflict', () => {
      expect(sync.state).toBe('conflict');
      expect([...sync.conflicts]).toEqual(['main.tex']);
      expect(onDrive('main.tex')).toBe('theirs');
      expect(drafts.get('main.tex')?.content).toBe('mine');
    });

    it('"Keep mine" overwrites Drive', async () => {
      await sync.keepMine('main.tex');
      expect(onDrive('main.tex')).toBe('mine');
      expect(sync.state).toBe('saved');
      expect(drafts.all.size).toBe(0);
    });

    it('"Keep Drive\'s" loads Drive\'s version into the editor', async () => {
      await sync.keepDrive('main.tex');
      expect(file('main.tex').content).toBe('theirs');
      expect(replaced['main.tex']).toBe('theirs');
      expect(onDrive('main.tex')).toBe('theirs');
      expect(sync.state).toBe('saved');
      expect(drafts.all.size).toBe(0);
    });

    it('offers Drive\'s version for "Download both"', async () => {
      expect(new TextDecoder().decode(await sync.driveVersion('main.tex'))).toBe('theirs');
    });
  });

  // A draft as an earlier visit would have left it.
  const draftOf = (path: string, content: string, accountId = 'me'): Draft => ({
    accountId, projectId: project.driveId ?? '', projectName: 'paper', path, content, revision: file(path).revision,
  });

  it('restores edits that never reached Drive and saves them', async () => {
    await drafts.put(draftOf('main.tex', 'after crash'));
    await sync.restoreDrafts();
    expect(replaced['main.tex']).toBe('after crash');
    expect(onDrive('main.tex')).toBe('after crash');
    expect(drafts.all.size).toBe(0);
  });

  it('never restores edits made by another Google account', async () => {
    await drafts.put(draftOf('main.tex', 'not yours', 'someone else'));
    await sync.restoreDrafts();
    expect(file('main.tex').content).toBe('v1');
    expect(onDrive('main.tex')).toBe('v1');
  });

  it('turns a restored edit into a conflict if Drive changed meanwhile', async () => {
    await drafts.put(draftOf('main.tex', 'after crash'));
    await otherComputerSaves('main.tex', 'theirs');
    await sync.restoreDrafts();
    expect(sync.state).toBe('conflict');
    expect(onDrive('main.tex')).toBe('theirs');
  });

  it('on return to the tab, loads files changed elsewhere that were not edited here', async () => {
    await otherComputerSaves('refs.bib', 'new bib');
    await sync.checkDrive();
    expect(file('refs.bib').content).toBe('new bib');
    expect(replaced['refs.bib']).toBe('new bib');
    expect(sync.state).toBe('saved');
  });

  it('on return to the tab, a file edited here and changed elsewhere becomes a conflict', async () => {
    type('main.tex', 'mine');
    await otherComputerSaves('main.tex', 'theirs');
    await sync.checkDrive();
    expect(sync.state).toBe('conflict');
    expect(file('main.tex').content).toBe('mine');
  });
});
