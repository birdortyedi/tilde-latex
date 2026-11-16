import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openProject } from './driveProjects';
import { sharedFileAt } from './sharedDoc';
import { MemoryShared } from './sharedStore';
import { SharedSync, type SharedListener } from './sharedSync';
import { forgetJoined, joinedProjects, joinFromPicked, loadShared, makeShared, rememberJoined, SHARED_FILE } from './sharing';
import { FakeDrive } from './testing/fakeDrive';
import { fakeLinks } from './testing/fakeLink';
import type { MakeLink } from './live';

const bytes = (text: string) => new TextEncoder().encode(text);
const quiet = (): SharedListener => ({
  stateChanged: () => {}, fileReplaced: () => {}, filesChanged: vi.fn(), peopleChanged: () => {}, missingChanged: () => {}, notice: vi.fn(),
});
const textIn = (sync: SharedSync, path: string) => sync.project.files.find((f) => f.path === path)?.content;

// Furkan (account A) owns the project "Paper" and shares it; Bora (account B)
// joins by picking everything in its folder, as the Picker lets them.
async function sharedPaper(makeLink?: MakeLink) {
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
  const syncA = new SharedSync(a, store, 'A', 'Furkan', loaded, quiet(), plain, makeLink);
  await syncA.saveNow();
  for (const item of drive.items.values()) if (item.parentId === folder.id || item.id === png.id) drive.grant(item.id, 'B');
  const picked = [...drive.items.values()].filter((i) => i.grants.has('B')).map((i) => i.id);
  const joined = await joinFromPicked(b, picked);
  const syncB = new SharedSync(b, store, 'B', { name: 'Bora', photo: 'https://lh3.googleusercontent.com/bora' }, joined.loaded, quiet(), undefined, makeLink);
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
    await vi.advanceTimersByTimeAsync(8_000);
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

  it('lets a viewer read along without writing anything to Drive', async () => {
    const { drive, syncA, syncB } = await start();
    for (const item of drive.items.values()) drive.viewOnly(item.id, 'B');
    syncB.viewOnly();
    const written = () => [...drive.items.values()].map((i) => i.headRevisionId).join();
    await vi.advanceTimersByTimeAsync(15_000); // B's mailbox rounds: B must not say "here"
    expect(syncA.people).toEqual([]);
    const before = written();
    syncB.textFor('main.tex')?.text.insert(0, 'x'); // what an edit would do; the editor blocks typing
    await syncB.saveNow();
    await expect(syncB.addFile('new.tex', '')).rejects.toThrow('only view');
    expect(written()).toBe(before);
    expect(syncB.state).toBe('saved');
    syncA.textFor('main.tex')?.text.insert(0, '% A\n');
    await syncA.saveNow();
    await syncB.saveNow();
    expect(textIn(syncB, 'main.tex')).toContain('% A\n');
  });

  it('notices when a viewer may edit again', async () => {
    const { drive, syncB } = await start();
    for (const item of drive.items.values()) drive.viewOnly(item.id, 'B');
    syncB.viewOnly();
    const canEdit = vi.fn();
    syncB.onCanEdit = canEdit;
    await vi.advanceTimersByTimeAsync(70_000);
    expect(canEdit).not.toHaveBeenCalled();
    for (const item of drive.items.values()) item.readers.delete('B');
    await vi.advanceTimersByTimeAsync(70_000);
    expect(canEdit).toHaveBeenCalled();
  });

  it('turns into a viewer when the owner changes the access to "can view"', async () => {
    const { drive, syncB } = await start();
    const notice = vi.fn();
    (syncB as unknown as { listener: SharedListener }).listener.notice = notice;
    for (const item of drive.items.values()) drive.viewOnly(item.id, 'B');
    syncB.textFor('main.tex')?.text.insert(0, '% B\n');
    await syncB.saveNow();
    expect(syncB.readOnly).toBe(true);
    expect(notice).toHaveBeenCalled();
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
    // The copy in the browser stays until a later look at Drive confirms the save.
    const copiesOfB = async () => (await store.list()).filter((c) => c.accountId === 'B');
    expect(await copiesOfB()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await copiesOfB()).toEqual([]);
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

  it('merges an edit made to a plain file outside Tilde, noticed when coming back to the tab', async () => {
    const { drive, syncA, syncB } = await start();
    await settle(syncA); // the owner's Tilde notes the versions it wrote
    syncB.textFor('main.tex')?.text.insert(0, '% B\n');
    await syncB.saveNow();
    const plainMain = [...drive.items.values()].find((i) => i.name === 'main.tex') as { id: string };
    await drive.updateFile(plainMain.id, bytes('\\documentclass{article} % edited on the Drive website'));
    await syncA.checkDrive();
    await settle(syncA);
    expect(textIn(syncA, 'main.tex')).toBe('% B\n\\documentclass{article} % edited on the Drive website');
    expect(drive.read('LaTeX Projects/Paper/main.tex')).toBe('% B\n\\documentclass{article} % edited on the Drive website');
  });

  it('merges an outside edit when the owner opens the project again', async () => {
    const { a, drive, folder, store, syncA, joined } = await start();
    await settle(syncA);
    syncA.close();
    const plainMain = [...drive.items.values()].find((i) => i.name === 'main.tex') as { id: string };
    await drive.updateFile(plainMain.id, bytes('\\documentclass[11pt]{article}'));
    const again = new SharedSync(a, store, 'A', 'Furkan', await loadShared(a, joined.loaded.stateId), quiet(), await openProject(a, folder));
    open.push(again);
    await settle(again);
    expect(textIn(again, 'main.tex')).toBe('\\documentclass[11pt]{article}');
  });

  it('keeps an outside edit as a copy where it clashes with an edit in Tilde', async () => {
    const { drive, syncA, syncB } = await start();
    await settle(syncA);
    const text = syncB.textFor('main.tex')?.text;
    text?.delete(15, 7);
    text?.insert(15, 'report'); // \documentclass{report}
    await syncB.saveNow();
    const plainMain = [...drive.items.values()].find((i) => i.name === 'main.tex') as { id: string };
    await drive.updateFile(plainMain.id, bytes('\\documentclass{book}'));
    await syncA.checkDrive();
    await settle(syncA);
    expect(textIn(syncA, 'main.tex')).toBe('\\documentclass{report}');
    expect(textIn(syncA, 'main (changed outside Tilde).tex')).toBe('\\documentclass{book}');
  });

  it("lets only one of the owner's tabs write the plain files", async () => {
    const { a, drive, folder, store, syncA, syncB, joined } = await start();
    const second = new SharedSync(a, store, 'A', 'Furkan', await loadShared(a, joined.loaded.stateId), quiet(), await openProject(a, folder));
    open.push(second);
    await settle(second);
    const leading = (sync: SharedSync) => (sync as unknown as { leading: boolean }).leading;
    expect([leading(syncA), leading(second)].filter(Boolean)).toHaveLength(1);
    await syncB.addFile('sections/discussion.tex', 'Discussion.');
    await syncA.saveNow();
    await second.saveNow();
    await settle(syncA);
    await settle(second);
    const copies = [...drive.items.values()].filter((i) => i.name === 'discussion.tex' && !i.trashed);
    expect(copies).toHaveLength(1);
    expect(drive.read('LaTeX Projects/Paper/sections/discussion.tex')).toBe('Discussion.');
  });

  it("takes over the plain files from an owner's tab that went away without a word", async () => {
    const { a, folder, store, syncA, joined } = await start();
    const second = new SharedSync(a, store, 'A', 'Furkan', await loadShared(a, joined.loaded.stateId), quiet(), await openProject(a, folder));
    open.push(second);
    await settle(second);
    const inside = (sync: SharedSync) => sync as unknown as { leading: boolean; leaveMailbox: () => Promise<void> };
    const [leader, other] = inside(syncA).leading ? [syncA, second] : [second, syncA];
    expect([inside(leader).leading, inside(other).leading]).toEqual([true, false]);
    // The leading tab crashes: it never leaves the mailbox.
    inside(leader).leaveMailbox = async () => {};
    leader.close();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(inside(other).leading).toBe(true);
  });

  it('merges an outside edit found while the project is open instead of writing over it', async () => {
    const { drive, syncA, syncB } = await start();
    await settle(syncA);
    const plainMain = [...drive.items.values()].find((i) => i.name === 'main.tex') as { id: string };
    // Edited on the Drive website while Tilde is open, and a co-author edits the same file elsewhere.
    await drive.updateFile(plainMain.id, bytes('\\documentclass{article} % outside'));
    syncB.textFor('main.tex')?.text.insert(0, '% B\n');
    await syncB.saveNow();
    await syncA.saveNow(); // the owner's tab writes the plain file: Drive has a version it did not write
    await settle(syncA);
    await settle(syncA);
    expect(textIn(syncA, 'main.tex')).toBe('% B\n\\documentclass{article} % outside');
    expect(drive.read('LaTeX Projects/Paper/main.tex')).toBe('% B\n\\documentclass{article} % outside');
  });

  it("does not bring back files a collaborator deleted or renamed while the owner was away", async () => {
    const { a, drive, folder, store, syncA, syncB, joined } = await start();
    await syncB.addFile('old.tex', 'Old.');
    await syncA.saveNow();
    await settle(syncA); // the owner's plain old.tex exists now
    expect(drive.read('LaTeX Projects/Paper/old.tex')).toBe('Old.');
    syncA.close();
    await syncB.deleteFile('old.tex');
    await syncB.moveFile('main.tex', 'ch1.tex');
    const again = new SharedSync(a, store, 'A', 'Furkan', await loadShared(a, joined.loaded.stateId), quiet(), await openProject(a, folder));
    open.push(again);
    await settle(again);
    await settle(again);
    expect(again.project.files.map((f) => f.path).sort()).toEqual(['ch1.tex', 'figures/plot.png']);
    expect(drive.read('LaTeX Projects/Paper/old.tex')).toBeUndefined();
    expect(drive.read('LaTeX Projects/Paper/main.tex')).toBeUndefined();
    expect(drive.read('LaTeX Projects/Paper/ch1.tex')).toBe('\\documentclass{article}');
  });

  it("does not undo others' edits when another of the owner's tabs takes over the plain files", async () => {
    const { a, folder, store, syncA, syncB, joined } = await start();
    const second = new SharedSync(a, store, 'A', 'Furkan', await loadShared(a, joined.loaded.stateId), quiet(), await openProject(a, folder));
    open.push(second);
    await settle(second);
    const inside = (sync: SharedSync) => sync as unknown as { leading: boolean; leaveMailbox: () => Promise<void>; listener: SharedListener };
    const [leader, other] = inside(syncA).leading ? [syncA, second] : [second, syncA];
    // A long while of edits, written to the plain files by the leading tab only.
    for (const word of ['one ', 'two ', 'three ']) {
      syncB.textFor('main.tex')?.text.insert(0, word);
      await syncB.saveNow();
      await leader.saveNow();
      await settle(leader);
    }
    await other.saveNow();
    const notice = vi.fn();
    inside(other).listener.notice = notice;
    inside(leader).leaveMailbox = async () => {};
    leader.close();
    await vi.advanceTimersByTimeAsync(40_000);
    await other.idle();
    expect(inside(other).leading).toBe(true);
    expect(textIn(other, 'main.tex')).toBe('three two one \\documentclass{article}');
    expect(notice).not.toHaveBeenCalled(); // nothing taken for an edit made outside Tilde
  });

  it('keeps edits in the browser until Drive is seen to have them, even if a write covered them', async () => {
    const { a, drive, store, syncA, syncB, joined } = await start();
    syncA.textFor('main.tex')?.text.insert(0, '% A\n');
    syncB.textFor('main.tex')?.text.insert(23, '\n% B');
    await vi.advanceTimersByTimeAsync(600); // both keep a copy in the browser
    await Promise.all([syncA.saveNow(), syncB.saveNow()]); // one write covers the other
    syncA.close(); // and A's tab is closed right away
    expect((await store.list()).some((c) => c.accountId === 'A')).toBe(true);
    const again = new SharedSync(a, store, 'A', 'Furkan', await loadShared(a, joined.loaded.stateId), quiet());
    open.push(again);
    await again.restoreDrafts();
    const stateId = joined.loaded.stateId;
    expect(sharedFileAt((await loadShared(drive, stateId)).doc, 'main.tex')?.text?.toString()).toContain('% A');
  });

  it('replaces an image the owner adds again, without throwing the new one away', async () => {
    const { drive, syncA } = await start();
    await settle(syncA);
    const before = syncA.project.files.find((f) => f.path === 'figures/plot.png');
    await syncA.addFile('figures/plot.png', new Uint8Array([7, 7, 7]));
    await settle(syncA);
    const plots = [...drive.items.values()].filter((i) => i.name === 'plot.png' && !i.trashed);
    expect(plots).toHaveLength(1);
    expect(plots[0].content).toEqual(new Uint8Array([7, 7, 7]));
    expect(plots[0].id).not.toBe(before?.driveId);
    expect(syncA.project.files.find((f) => f.path === 'figures/plot.png')?.content).toEqual(new Uint8Array([7, 7, 7]));
  });

  it('does not take a lost network for an edit made outside Tilde', async () => {
    const { a, drive, syncA } = await start();
    await settle(syncA);
    const plainMain = [...drive.items.values()].find((i) => i.name === 'main.tex') as { id: string };
    await drive.updateFile(plainMain.id, bytes('\\documentclass{article} % outside'));
    const realDownload = a.downloadRevision.bind(a);
    a.downloadRevision = async () => { throw new (await import('./drive')).OfflineError(); };
    await syncA.checkDrive();
    await settle(syncA);
    expect(syncA.project.files.some((f) => f.path.includes('changed outside'))).toBe(false);
    a.downloadRevision = realDownload;
    await syncA.checkDrive();
    await settle(syncA);
    expect(textIn(syncA, 'main.tex')).toBe('\\documentclass{article} % outside');
    expect(syncA.project.files.some((f) => f.path.includes('changed outside'))).toBe(false);
  });

  it("keeps one browser copy for all of an account's tabs, without one tab dropping another's edits", async () => {
    const { a, b, store, syncB, joined } = await start();
    const second = new SharedSync(b, store, 'B', 'Bora', await loadShared(a.forAccount('B'), joined.loaded.stateId), quiet());
    open.push(second);
    b.offline = true;
    syncB.textFor('main.tex')?.text.insert(0, '% tab 1\n');
    second.textFor('main.tex')?.text.insert(0, '% tab 2\n');
    await vi.advanceTimersByTimeAsync(1_000);
    const kept = (await store.list()).find((c) => c.accountId === 'B');
    const doc = (await import('yjs')).Doc;
    const copy = new doc();
    (await import('yjs')).applyUpdate(copy, kept?.update ?? new Uint8Array());
    const text = sharedFileAt(copy, 'main.tex')?.text?.toString() ?? '';
    expect([text.includes('% tab 1'), text.includes('% tab 2')]).toEqual([true, true]);
  });

  it('removes a browser copy that brings nothing new once Drive is seen to have it', async () => {
    const { b, store, syncB, joined } = await start();
    await syncB.saveNow();
    syncB.close();
    await store.put({ accountId: 'B', projectId: joined.ids.folderId, projectName: 'Paper', update: (await import('yjs')).encodeStateAsUpdate(syncB.doc) });
    const again = new SharedSync(b, store, 'B', 'Bora', await loadShared(b, joined.loaded.stateId), quiet());
    open.push(again);
    await again.restoreDrafts();
    await vi.advanceTimersByTimeAsync(6_000);
    await again.saveNow();
    await vi.advanceTimersByTimeAsync(100);
    expect((await store.list()).filter((c) => c.accountId === 'B')).toEqual([]);
  });

  it('knows which Drive files are part of the project already', async () => {
    const { drive, syncA } = await start();
    await settle(syncA);
    const plainMain = [...drive.items.values()].find((i) => i.name === 'main.tex') as { id: string };
    const png = [...drive.items.values()].find((i) => i.name === 'plot.png') as { id: string };
    expect([syncA.belongs(plainMain.id), syncA.belongs(png.id), syncA.belongs('somewhere-else')]).toEqual([true, true, false]);
  });

  it('does not count a tab that left long ago as here', async () => {
    const { drive, syncA, joined } = await start();
    await vi.advanceTimersByTimeAsync(4_000);
    const mailbox = joined.ids.mailboxId;
    const box = JSON.parse(new TextDecoder().decode(await drive.download(mailbox))) as { here: Record<string, { name: string; at: number; account: string }> };
    const newest = Math.max(...Object.values(box.here).map((h) => h.at));
    box.here['0000-closed'] = { name: 'Ghost', at: newest - 5 * 60_000, account: 'G' };
    await drive.updateFile(mailbox, bytes(JSON.stringify(box)));
    await vi.advanceTimersByTimeAsync(12_000);
    expect(syncA.people).not.toContain('Ghost');
  });

  it("undoes only this browser's typing, not text Tilde inserted or merged", async () => {
    const { syncA } = await start();
    syncA.insertText('main.tex', 0, '% inserted\n');
    expect(syncA.textFor('main.tex')?.undo.undoStack).toHaveLength(0);
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
    await forgetJoined(b, root.id, folder.id);
    expect(await joinedProjects(b, root.id)).toEqual([]);
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

describe('a shared project with direct connections', () => {
  let open: SharedSync[] = [];
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    for (const sync of open) sync.close();
    open = [];
    vi.useRealTimers();
  });
  // Both browsers say "here" in the mailbox, find each other and connect.
  const connected = async () => {
    const paper = await sharedPaper(fakeLinks());
    open.push(paper.syncA, paper.syncB);
    for (let i = 0; i < 20 && (paper.syncA.livePeople.length === 0 || paper.syncB.livePeople.length === 0); i++) {
      await vi.advanceTimersByTimeAsync(2_000);
    }
    return paper;
  };

  it('connects the two browsers through the mailbox', async () => {
    const { syncA, syncB } = await connected();
    expect(syncA.livePeople).toEqual(['Bora']);
    expect(syncB.livePeople).toEqual(['Furkan']);
  });

  it("shows each other's faces, and finds a connected person's cursor", async () => {
    const { syncA, syncB } = await connected();
    expect(syncA.faces).toEqual([{ account: 'B', name: 'Bora', photo: 'https://lh3.googleusercontent.com/bora', live: true }]);
    expect(syncB.faces).toEqual([{ account: 'A', name: 'Furkan', live: true }]); // Furkan has no photo
    expect(syncA.cursorOf('B')).toBeNull(); // Bora has no cursor in a file yet
    const text = syncB.textFor('main.tex')?.text;
    if (!text) throw new Error('no text');
    const at = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, 5));
    syncB.awareness?.setLocalStateField('cursor', { anchor: at, head: at });
    await vi.advanceTimersByTimeAsync(0);
    expect(syncA.cursorOf('B')).toEqual({ path: 'main.tex', offset: 5 });
  });

  it('sends typing at once, without waiting for Drive', async () => {
    const { syncA, syncB, drive } = await connected();
    const reads = drive.items.size;
    syncB.textFor('main.tex')?.text.insert(0, '% live\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(textIn(syncA, 'main.tex')).toBe('% live\n\\documentclass{article}');
    expect(drive.items.size).toBe(reads);
  });

  it("shows each other's name for the cursors", async () => {
    const { syncA, syncB } = await connected();
    const names = (sync: SharedSync) => [...(sync.awareness?.getStates().values() ?? [])].map((s) => (s.user as { name: string }).name).sort();
    expect(names(syncA)).toEqual(['Bora', 'Furkan']);
    expect(names(syncB)).toEqual(['Bora', 'Furkan']);
  });

  it('sends an image the other may not read from Drive yet', async () => {
    const { syncA, syncB } = await connected();
    const big = new Uint8Array(40_000).map((_, i) => i % 251); // more than one piece
    await syncB.addFile('figures/big.png', big);
    await vi.advanceTimersByTimeAsync(0);
    const listener = (syncA as unknown as { listener: SharedListener }).listener;
    const asked = vi.fn();
    listener.missingChanged = asked;
    await syncA.saveNow();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(syncA.missing.size).toBe(0);
    expect(syncA.project.files.find((f) => f.path === 'figures/big.png')?.content).toEqual(big);
    expect(asked.mock.calls.length).toBeGreaterThan(0); // the tree is told; with nothing missing, no "Allow"
  });

  it('connects three browsers with each other', async () => {
    const links = fakeLinks();
    const paper = await sharedPaper(links);
    const second = new SharedSync(paper.a, new MemoryShared(), 'A', 'Furkan', await loadShared(paper.a, paper.joined.loaded.stateId), quiet(), await openProject(paper.a, paper.folder), links);
    open.push(paper.syncA, paper.syncB, second);
    const connections = (sync: SharedSync) => (sync as unknown as { live: { connected(): string[] } }).live.connected().length;
    for (let i = 0; i < 30 && [paper.syncA, paper.syncB, second].some((s) => connections(s) < 2); i++) await vi.advanceTimersByTimeAsync(2_000);
    expect([paper.syncA, paper.syncB, second].map(connections)).toEqual([2, 2, 2]);
    paper.syncB.textFor('main.tex')?.text.insert(0, 'x');
    await vi.advanceTimersByTimeAsync(0);
    expect([textIn(paper.syncA, 'main.tex'), textIn(second, 'main.tex')]).toEqual(['x\\documentclass{article}', 'x\\documentclass{article}']);
  });

  it('connects again when the other person comes back', async () => {
    const links = fakeLinks();
    const paper = await sharedPaper(links);
    open.push(paper.syncA, paper.syncB);
    for (let i = 0; i < 20 && paper.syncA.livePeople.length === 0; i++) await vi.advanceTimersByTimeAsync(2_000);
    paper.syncB.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(paper.syncA.livePeople).toEqual([]);
    const back = new SharedSync(paper.b, new MemoryShared(), 'B', 'Bora', await loadShared(paper.b, paper.joined.loaded.stateId), quiet(), undefined, links);
    open.push(back);
    for (let i = 0; i < 20 && paper.syncA.livePeople.length === 0; i++) await vi.advanceTimersByTimeAsync(2_000);
    expect(paper.syncA.livePeople).toEqual(['Bora']);
    back.textFor('main.tex')?.text.insert(0, 'y');
    await vi.advanceTimersByTimeAsync(0);
    expect(textIn(paper.syncA, 'main.tex')).toBe('y\\documentclass{article}');
  });

  it('sends a large document to the other browser in pieces', async () => {
    const { syncA, syncB } = await connected();
    const big = 'x'.repeat(400_000); // a thesis-sized paste
    syncB.textFor('main.tex')?.text.insert(0, big);
    await vi.advanceTimersByTimeAsync(0);
    expect(syncB.livePeople).toEqual(['Furkan']); // still connected
    expect(String(textIn(syncA, 'main.tex')).length).toBe(big.length + 23);
  });

  it('falls back to Drive when the other browser leaves', async () => {
    const { syncA, syncB } = await connected();
    syncB.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncA.livePeople).toEqual([]);
  });
});
