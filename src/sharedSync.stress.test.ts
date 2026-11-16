import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openProject } from './driveProjects';
import { FOLDER_TYPE } from './drive';
import { sharedFiles } from './sharedDoc';
import { MemoryShared } from './sharedStore';
import { SharedSync, type SharedListener } from './sharedSync';
import { isTildeFile, joinFromPicked, loadShared, makeShared } from './sharing';
import { FakeDrive } from './testing/fakeDrive';
import { fakeLinks } from './testing/fakeLink';
import type { MakeLink } from './live';

// A stress test: three tabs (two of the owner's, one collaborator's) do
// many random things in a random order, with time passing, networks lost and
// tabs closed and opened again. At the end, with everyone back online,
// everyone must have the same text, Drive's shared file must have it too,
// and the owner's plain files must match it exactly.

const quiet = (): SharedListener => ({
  stateChanged: () => {}, fileReplaced: () => {}, filesChanged: () => {}, peopleChanged: () => {}, missingChanged: () => {}, notice: () => {},
});

// A small seeded random number generator, so a failing run can be repeated.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Tab {
  name: string;
  account: 'A' | 'B';
  drive: FakeDrive;
  store: MemoryShared;
  sync: SharedSync;
}

const textFiles = (sync: SharedSync) => Object.fromEntries(sync.project.files
  .filter((f) => typeof f.content === 'string').map((f) => [f.path, f.content as string]).sort(([x], [y]) => x.localeCompare(y)));

// The plain files in the owner's project folder, by path (Tilde's own files left out).
function plainFiles(drive: FakeDrive, folderId: string): Record<string, string>[] {
  const out: Record<string, string> = {};
  const paths: string[] = [];
  const walk = (parentId: string, prefix: string) => {
    for (const item of drive.items.values()) {
      if (item.parentId !== parentId || item.trashed) continue;
      if (prefix === '' && isTildeFile(item)) continue;
      const path = prefix + item.name;
      if (item.mimeType === FOLDER_TYPE) walk(item.id, `${path}/`);
      else {
        paths.push(path);
        if (path.endsWith('.tex')) out[path] = new TextDecoder().decode(item.content);
      }
    }
  };
  walk(folderId, '');
  return [Object.fromEntries(Object.entries(out).sort(([x], [y]) => x.localeCompare(y))), Object.fromEntries(paths.map((p) => [p, String(paths.filter((q) => q === p).length)]))];
}

async function run(seed: number, live: boolean, steps: number): Promise<void> {
  const rand = random(seed);
  // Ids from the same seed, so a failing run can be repeated exactly.
  const ids = random(seed * 7919);
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
    const hex = () => Math.floor(ids() * 0x100000000).toString(16).padStart(8, '0');
    return `${hex()}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-8${hex().slice(0, 3)}-${hex()}${hex().slice(0, 4)}` as `${string}-${string}-${string}-${string}-${string}`;
  });
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const drive = new FakeDrive();
  const owner = drive.forAccount('A');
  const root = await owner.createFolder('LaTeX Projects', 'root');
  const folder = await owner.createFolder('Paper', root.id);
  await owner.createFile('main.tex', folder.id, new TextEncoder().encode('\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n'));
  const loaded = await makeShared(owner, await openProject(owner, folder));
  for (const item of drive.items.values()) if (item.parentId === folder.id) drive.grant(item.id, 'B');
  const makeLink: MakeLink | undefined = live ? fakeLinks() : undefined;

  const open = async (name: string, account: 'A' | 'B', store: MemoryShared): Promise<Tab> => {
    const view = drive.forAccount(account);
    const sync = account === 'A'
      ? new SharedSync(view, store, 'A', 'Furkan', await loadShared(view, loaded.stateId), quiet(), await openProject(view, folder), makeLink)
      : new SharedSync(view, store, 'B', 'Bora', (await joinFromPicked(view, [...drive.items.values()].filter((i) => i.grants.has('B')).map((i) => i.id))).loaded,
        quiet(), undefined, makeLink);
    await sync.restoreDrafts();
    return { name, account, drive: view, store, sync };
  };
  const tabs: Tab[] = [
    await open('A1', 'A', new MemoryShared()),
    await open('A2', 'A', new MemoryShared()),
    await open('B', 'B', new MemoryShared()),
  ];
  const words = ['alpha', 'beta', 'gamma', 'delta', '\\cite{x}', '$x^2$', '\n'];
  const names = ['intro.tex', 'sec/method.tex', 'sec/results.tex', 'notes.tex', 'appendix/a.tex'];
  const log: string[] = [];
  const safely = async (what: string, work: () => Promise<unknown>) => {
    log.push(what);
    try { await work(); } catch { /* offline or a file that just went away: fine */ }
  };

  for (let step = 0; step < steps; step++) {
    const tab = pick(tabs);
    const files = tab.sync.project.files.filter((f) => typeof f.content === 'string');
    const roll = rand();
    if (roll < 0.35 && files.length > 0) {
      const file = pick(files);
      const text = tab.sync.textFor(file.path)?.text;
      if (text) {
        const at = Math.floor(rand() * (text.length + 1));
        if (rand() < 0.7) text.insert(at, `${pick(words)} `);
        else text.delete(at, Math.min(text.length - at, 1 + Math.floor(rand() * 8)));
        log.push(`${tab.name} edits ${file.path}`);
      }
    } else if (roll < 0.45) {
      const path = pick(names);
      await safely(`${tab.name} adds ${path}`, () => tab.sync.addFile(path, `% ${path} by ${tab.name}\n`));
    } else if (roll < 0.5 && files.length > 1) {
      const file = pick(files.filter((f) => f.path !== 'main.tex'));
      if (file) await safely(`${tab.name} deletes ${file.path}`, () => tab.sync.deleteFile(file.path));
    } else if (roll < 0.56 && files.length > 1) {
      const file = pick(files.filter((f) => f.path !== 'main.tex'));
      const to = pick(names);
      if (file && !tab.sync.project.files.some((f) => f.path === to)) await safely(`${tab.name} renames ${file.path} to ${to}`, () => tab.sync.moveFile(file.path, to));
    } else if (roll < 0.7) {
      await safely(`${tab.name} saves`, () => tab.sync.saveNow());
    } else if (roll < 0.76) {
      tab.drive.offline = !tab.drive.offline;
      log.push(`${tab.name} ${tab.drive.offline ? 'goes offline' : 'is back online'}`);
    } else if (roll < 0.8) {
      // The tab is closed (or crashes) and opened again; unsaved edits come back from the browser.
      log.push(`${tab.name} closes and opens again`);
      const crash = rand() < 0.5;
      if (crash) (tab.sync as unknown as { leaveMailbox: () => Promise<void> }).leaveMailbox = async () => {};
      tab.sync.close();
      const offline = tab.drive.offline;
      const again = await open(tab.name, tab.account, tab.store).catch(() => null);
      if (again) {
        again.drive.offline = offline;
        tabs[tabs.indexOf(tab)] = again;
      } else {
        // Could not open while offline: open once back online.
        tab.drive.offline = false;
        tabs[tabs.indexOf(tab)] = await open(tab.name, tab.account, tab.store);
      }
    } else {
      await vi.advanceTimersByTimeAsync(Math.floor(rand() * 6_000));
    }
  }

  // Everyone back online; time passes until everything is saved and the plain files caught up.
  for (const tab of tabs) tab.drive.offline = false;
  for (let i = 0; i < 12; i++) {
    await vi.advanceTimersByTimeAsync(10_000);
    for (const tab of tabs) await tab.sync.saveNow();
  }
  for (const tab of tabs) await tab.sync.idle();
  await vi.advanceTimersByTimeAsync(20_000);
  for (const tab of tabs) await tab.sync.saveNow();
  for (const tab of tabs) await tab.sync.idle();

  const context = `seed ${seed}, ${live ? 'live' : 'Drive only'}, steps:\n${log.slice(-40).join('\n')}`;
  const expected = textFiles(tabs[0].sync);
  for (const tab of tabs) expect(textFiles(tab.sync), `${tab.name} differs; ${context}`).toEqual(expected);
  const inDrive = Object.fromEntries(sharedFiles((await loadShared(drive, loaded.stateId)).doc)
    .filter((e) => e.text).map((e) => [e.path, e.text?.toString() ?? '']).sort(([x], [y]) => x.localeCompare(y)));
  expect(inDrive, `Drive's shared file differs; ${context}`).toEqual(expected);
  const paths = Object.keys(expected);
  expect(new Set(paths).size, `duplicate paths; ${context}`).toBe(paths.length);
  expect(paths.filter((p) => p.includes('changed outside')), `false outside edits; ${context}`).toEqual([]);
  const [plain, counts] = plainFiles(drive, folder.id);
  const differing = [...new Set([...Object.keys(plain), ...Object.keys(expected)])].filter((p) => plain[p] !== expected[p])
    .map((p) => `${p}: plain ${JSON.stringify(plain[p]?.slice(0, 60))} / shared ${JSON.stringify(expected[p]?.slice(0, 60))}`);
  expect(differing, `the plain files differ; ${context}`).toEqual([]);
  expect(Object.entries(counts).filter(([, n]) => n !== '1').map(([p]) => p), `duplicate plain files; ${context}`).toEqual([]);
  for (const tab of tabs) tab.sync.close();
}

describe('a shared project under stress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // lost networks are expected here
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // A longer run for hunting bugs: STRESS_SEEDS=50 STRESS_STEPS=300 npx vitest run src/sharedSync.stress.test.ts
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
  const seeds = Number(env.STRESS_SEEDS ?? 6);
  const steps = Number(env.STRESS_STEPS ?? 150);
  for (let seed = 1; seed <= seeds; seed++) {
    it(`stays consistent through Drive only (seed ${seed})`, async () => { await run(seed, false, steps); }, 120_000);
    it(`stays consistent with direct connections (seed ${seed})`, async () => { await run(seed + 1000, true, steps); }, 120_000);
  }
});
