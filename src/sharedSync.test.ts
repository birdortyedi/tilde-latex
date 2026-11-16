import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openProject } from './driveProjects';
import { sharedFileAt } from './sharedDoc';
import { MemoryShared } from './sharedStore';
import { SharedSync, type SharedListener } from './sharedSync';
import { joinedProjects, joinFromPicked, loadShared, makeShared, rememberJoined, SHARED_FILE } from './sharing';
import { FakeDrive } from './testing/fakeDrive';

const bytes = (text: string) => new TextEncoder().encode(text);
const quiet = (): SharedListener => ({
  stateChanged: () => {}, fileReplaced: () => {}, filesChanged: vi.fn(), peopleChanged: () => {}, missingChanged: () => {},
});
const textIn = (sync: SharedSync, path: string) => sync.project.files.find((f) => f.path === path)?.content;

// Furkan (account A) owns the project "Paper" and shares it; Bora (account B)
// joins by picking everything in its folder, as the Picker lets them.
async function sharedPaper() {
  const drive = new FakeDrive();
  const a = drive.forAccount('A');
  const b = drive.forAccount('B');
  const root = await a.createFolder('LaTeX Projects', 'root');
  const folder = await a.createFolder('Paper', root.id);
  await a.createFile('main.tex', folder.id, bytes('\\documentclass{article}'));
  const png = await a.createFile('plot.png', (await a.createFolder('figures', folder.id)).id, new Uint8Array([1, 2, 3]));
  const plain = await openProject(a, folder);
  const loaded = await makeShared(a, plain);
  const store = new MemoryShared();
  const syncA = new SharedSync(a, store, 'A', 'Furkan', loaded, quiet(), plain);
  await syncA.saveNow();
  for (const item of drive.items.values()) if (item.parentId === folder.id || item.id === png.id) drive.grant(item.id, 'B');
  const picked = [...drive.items.values()].filter((i) => i.grants.has('B')).map((i) => i.id);
  const joined = await joinFromPicked(b, picked);
  const syncB = new SharedSync(b, store, 'B', 'Bora', joined.loaded, quiet());
  return { drive, a, b, folder, syncA, syncB, store, joined };
}

describe('a shared project', () => {
  let open: SharedSync[] = [];
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    for (const sync of open) sync.close();
    open = [];
    vi.useRealTimers();
  });
  const start = async () => {
    const paper = await sharedPaper();
    open.push(paper.syncA, paper.syncB);
    return paper;
  };
  // Lets the owner's plain files catch up (they follow a few seconds behind).
  const settle = async (sync: SharedSync) => {
    await vi.advanceTimersByTimeAsync(4_000);
    await sync.idle();
  };

  it('is joined from the picked files, with nothing missing', async () => {
    const { joined, syncB } = await start();
    expect(joined.missing).toEqual([]);
    expect(textIn(syncB, 'main.tex')).toBe('\\documentclass{article}');
    expect(syncB.project.name).toBe('Paper');
  });

  it("brings a collaborator's edit to the owner, and into the owner's plain file", async () => {
    const { drive, syncA, syncB } = await start();
    syncB.textFor('main.tex')?.text.insert(0, '% Bora\n');
    await syncB.saveNow();
    await syncA.saveNow();
    expect(textIn(syncA, 'main.tex')).toBe('% Bora\n\\documentclass{article}');
    await settle(syncA);
    expect(drive.read('LaTeX Projects/Paper/main.tex')).toBe('% Bora\n\\documentclass{article}');
  });

  it('keeps both edits when two people save at the same moment', async () => {
    const { drive, syncA, syncB } = await start();
    syncA.textFor('main.tex')?.text.insert(0, '% A\n');
    syncB.textFor('main.tex')?.text.insert(23, '\n% B');
    await Promise.all([syncA.saveNow(), syncB.saveNow()]); // one write covers the other
    await syncA.saveNow();
    await syncB.saveNow();
    await syncA.saveNow();
    const expected = '% A\n\\documentclass{article}\n% B';
    expect([textIn(syncA, 'main.tex'), textIn(syncB, 'main.tex')]).toEqual([expected, expected]);
    const stateId = [...drive.items.values()].find((i) => i.name === SHARED_FILE)?.id as string;
    expect(sharedFileAt((await loadShared(drive, stateId)).doc, 'main.tex')?.text?.toString()).toBe(expected);
  });

  it("makes a collaborator's new file a plain file of the owner, and follows renames", async () => {
    const { drive, syncA, syncB } = await start();
    const listener = vi.fn();
    (syncA as unknown as { listener: SharedListener }).listener.filesChanged = listener;
    await syncB.addFile('sections/method.tex', 'We measure.');
    await syncA.saveNow();
    expect(textIn(syncA, 'sections/method.tex')).toBe('We measure.');
    await settle(syncA);
    expect(drive.read('LaTeX Projects/Paper/sections/method.tex')).toBe('We measure.');
    await syncB.moveFile('main.tex', 'paper.tex');
    await syncA.saveNow();
    await settle(syncA);
    expect(drive.read('LaTeX Projects/Paper/paper.tex')).toBe('\\documentclass{article}');
    expect(drive.read('LaTeX Projects/Paper/main.tex')).toBeUndefined();
  });

  it("asks the owner to allow an image a collaborator added, then shows it", async () => {
    const { drive, syncA, syncB } = await start();
    await syncB.addFile('figures/new.png', new Uint8Array([9]));
    await syncA.saveNow();
    await vi.advanceTimersByTimeAsync(0);
    expect([...syncA.missing.values()]).toEqual(['figures/new.png']);
    expect(syncA.project.files.some((f) => f.path === 'figures/new.png')).toBe(false);
    drive.grant([...syncA.missing.keys()][0], 'A');
    await syncA.retryMissing();
    expect(syncA.missing.size).toBe(0);
    expect(syncA.project.files.find((f) => f.path === 'figures/new.png')?.content).toEqual(new Uint8Array([9]));
  });

  it('keeps edits made offline in the browser and saves them on the next visit', async () => {
    const { b, syncB, store, joined } = await start();
    b.offline = true;
    syncB.textFor('main.tex')?.text.insert(0, 'offline ');
    await syncB.saveNow();
    expect(syncB.state).toBe('offline');
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await store.list()).map((c) => c.accountId)).toEqual(['B']);
    syncB.close();
    b.offline = false;
    const again = new SharedSync(b, store, 'B', 'Bora', await loadShared(b, joined.loaded.stateId), quiet());
    open.push(again);
    await again.restoreDrafts();
    expect(textIn(again, 'main.tex')).toBe('offline \\documentclass{article}');
    expect(again.state).toBe('saved');
    expect(await store.list()).toEqual([]);
  });

  it('sends text inserted into a closed file to the others', async () => {
    const { syncA, syncB } = await start();
    expect(syncB.insertText('main.tex', 23, '\n\\usepackage{graphicx}')).toBe(true);
    expect(textIn(syncB, 'main.tex')).toBe('\\documentclass{article}\n\\usepackage{graphicx}');
    await syncB.saveNow();
    await syncA.saveNow();
    expect(textIn(syncA, 'main.tex')).toBe('\\documentclass{article}\n\\usepackage{graphicx}');
    expect(syncB.insertText('figures/plot.png', 0, 'x')).toBe(false);
  });

  it('shows who else has the project open', async () => {
    const { syncA, syncB } = await start();
    await vi.advanceTimersByTimeAsync(21_000); // each says "here" again
    expect(syncA.people).toEqual(['Bora']);
    expect(syncB.people).toEqual(['Furkan']);
  });

  it("never lists the account's own other tabs, such as the one before a reload", async () => {
    const { b, syncA, syncB, joined } = await start();
    const again = new SharedSync(b, new MemoryShared(), 'B', 'Bora', await loadShared(b, joined.loaded.stateId), quiet());
    open.push(again);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(again.people).toEqual(['Furkan']);
    expect(syncA.people).toEqual(['Bora']);
    expect(syncB.people).toEqual(['Furkan']);
  });

  it('remembers the projects a collaborator joined', async () => {
    const { b, folder, joined } = await start();
    const root = await b.createFolder('LaTeX Projects', 'root');
    await rememberJoined(b, root.id, { folderId: folder.id, stateId: joined.loaded.stateId, name: 'Paper' });
    await rememberJoined(b, root.id, { folderId: folder.id, stateId: joined.loaded.stateId, name: 'Paper v2' });
    expect(await joinedProjects(b, root.id)).toEqual([{ folderId: folder.id, stateId: joined.loaded.stateId, name: 'Paper v2' }]);
  });

  it('says which files were not picked when joining', async () => {
    const { drive, joined } = await start();
    const b2 = drive.forAccount('C');
    drive.grant(joined.loaded.stateId, 'C');
    const result = await joinFromPicked(b2, [joined.loaded.stateId]);
    expect(result.missing).toEqual(['Tilde mailbox.tilde', 'Tilde uploads']);
  });

  it('never shows its own files as part of the project', async () => {
    const { a, folder } = await start();
    expect((await openProject(a, folder)).files.map((f) => f.path).sort()).toEqual(['figures/plot.png', 'main.tex']);
  });
});
