import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANGED_ELSEWHERE, createLocal, GONE_ELSEWHERE, LocalSync, SAVE_DELAY, toProject, untitledName, type LocalProject, type LocalStore } from './localProjects';

function memoryStore(): LocalStore & { saved: Map<string, LocalProject>; puts: number } {
  const saved = new Map<string, LocalProject>();
  return {
    saved,
    puts: 0,
    async get(id) { const found = saved.get(id); return found && structuredClone(found); },
    async put(project) {
      this.puts++;
      saved.set(project.id, structuredClone(project));
    },
    async remove(id) { saved.delete(id); },
    async list() { return [...saved.values()]; },
  };
}

describe('projects kept in this browser', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('names new projects so no two are the same', () => {
    expect(untitledName([])).toBe('Untitled');
    expect(untitledName(['Untitled', 'Untitled 2', 'paper'])).toBe('Untitled 3');
  });

  async function opened() {
    const store = memoryStore();
    const local = await createLocal(store, 'Untitled', [{ path: 'main.tex', content: 'Hello' }]);
    const changed = vi.fn();
    const sync = new LocalSync(store, local.id, toProject(local), local.edited, changed);
    return { store, local, sync, changed };
  }

  it('saves a moment after typing stops, once for many edits', async () => {
    const { store, local, sync } = await opened();
    sync.project.files[0].content = 'Hello, world';
    sync.edited('main.tex');
    sync.edited('main.tex');
    expect(sync.hasUnsaved()).toBe(true);
    const before = store.puts;
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);
    expect(store.puts).toBe(before + 1);
    expect(store.saved.get(local.id)?.files[0].content).toBe('Hello, world');
    expect(sync.hasUnsaved()).toBe(false);
  });

  it('keeps file actions, and comes back the same after a reload', async () => {
    const { store, local, sync } = await opened();
    await sync.addFile('chapters/intro.tex', 'Intro');
    await sync.addFile('figures/plot.png', new Uint8Array([1, 2, 3]));
    await sync.moveFile('main.tex', 'paper.tex');
    await sync.setMainFile('paper.tex');
    expect(await sync.renameFolder('chapters', 'sections')).toEqual([['chapters/intro.tex', 'sections/intro.tex']]);
    await sync.deleteFile('figures/plot.png');
    const reloaded = toProject(store.saved.get(local.id) as LocalProject);
    expect(reloaded.files.map((f) => f.path)).toEqual(['paper.tex', 'sections/intro.tex']);
    expect(reloaded.mainFile).toBe('paper.tex');
  });

  it('saves what is pending when another project is opened', async () => {
    const { store, local, sync } = await opened();
    sync.project.files[0].content = 'Last words';
    sync.edited('main.tex');
    sync.close();
    await sync.idle();
    expect(store.saved.get(local.id)?.files[0].content).toBe('Last words');
  });

  it('says so when the browser cannot keep it, and tries again with the next edit', async () => {
    const { store, sync, changed } = await opened();
    store.put = () => Promise.reject(new Error('QuotaExceededError'));
    await sync.addFile('big.pdf', new Uint8Array(10));
    expect(sync.state).toBe('error');
    expect(sync.errorMessage).toContain('QuotaExceededError');
    expect(sync.hasUnsaved()).toBe(true);
    expect(changed).toHaveBeenCalled();
  });

  it('stops, and says so, when another tab changed the project, instead of overwriting it', async () => {
    const { store, local, sync } = await opened();
    // Another tab saves the same project.
    store.saved.set(local.id, { ...structuredClone(store.saved.get(local.id) as LocalProject), files: [{ path: 'main.tex', content: 'From the other tab' }], edited: local.edited + 1000 });
    sync.project.files[0].content = 'From this tab';
    sync.edited('main.tex');
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);
    expect(sync.state).toBe('error');
    expect(sync.errorMessage).toBe(CHANGED_ELSEWHERE);
    expect(store.saved.get(local.id)?.files[0].content).toBe('From the other tab');
  });

  it('stops when another tab saved the project to Drive or deleted it, instead of bringing it back', async () => {
    const { store, local, sync } = await opened();
    store.saved.delete(local.id);
    await sync.addFile('notes.tex', 'x');
    expect(sync.errorMessage).toBe(GONE_ELSEWHERE);
    expect(store.saved.has(local.id)).toBe(false);
  });

  it('keeps saving its own writes, and counts an edit made during a write as not saved yet', async () => {
    const { store, local, sync } = await opened();
    await sync.addFile('a.tex', 'a');
    await sync.addFile('b.tex', 'b'); // the second save sees its own first write, not another tab
    expect(sync.state).toBe('saved');
    const put = store.put.bind(store);
    store.put = async (project) => {
      sync.project.files[0].content = 'typed during the write';
      sync.edited('main.tex');
      await put(project);
    };
    sync.project.files[0].content = 'first';
    sync.edited('main.tex');
    await sync.saveNow();
    expect(sync.hasUnsaved()).toBe(true);
    store.put = put;
    await vi.advanceTimersByTimeAsync(SAVE_DELAY);
    expect(sync.hasUnsaved()).toBe(false);
    expect(store.saved.get(local.id)?.files[0].content).toBe('typed during the write');
  });
});
