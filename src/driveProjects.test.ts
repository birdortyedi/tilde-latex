import { beforeEach, describe, expect, it } from 'vitest';
import { FOLDER_TYPE, type Drive, type DriveFile } from './drive';
import { createProject, findOrCreateRootFolder, listProjects, openProject, saveProject } from './driveProjects';

// An in-memory stand-in for Google Drive. Each upload gets a new revision id,
// like the real Drive.
class FakeDrive implements Drive {
  items = new Map<string, DriveFile & { parentId: string; content?: Uint8Array }>();
  private nextId = 1;

  private add(name: string, parentId: string, mimeType: string, content?: Uint8Array): DriveFile {
    const id = `id${this.nextId++}`;
    const item = { id, name, parentId, mimeType, content, headRevisionId: content ? `rev${this.nextId++}` : undefined };
    this.items.set(id, item);
    return this.info(id);
  }

  private item(id: string) {
    const item = this.items.get(id);
    if (!item) throw new Error(`No file ${id}`);
    return item;
  }

  private info(id: string): DriveFile {
    const { name, mimeType, headRevisionId } = this.item(id);
    return { id, name, mimeType, headRevisionId };
  }

  // A path like "LaTeX Projects/paper/figures/plot.png" → that file's text.
  read(path: string): string | undefined {
    let parentId = 'root';
    let item;
    for (const name of path.split('/')) {
      item = [...this.items.values()].find((i) => i.parentId === parentId && i.name === name);
      if (!item) return undefined;
      parentId = item.id;
    }
    return item?.content && new TextDecoder().decode(item.content);
  }

  async list(folderId: string) {
    return [...this.items.values()].filter((i) => i.parentId === folderId).map((i) => this.info(i.id));
  }
  async get(fileId: string) { return this.info(fileId); }
  async download(fileId: string) { return this.item(fileId).content ?? new Uint8Array(); }
  async createFolder(name: string, parentId: string) { return this.add(name, parentId, FOLDER_TYPE); }
  async createFile(name: string, parentId: string, content: Uint8Array) {
    return this.add(name, parentId, 'application/octet-stream', content);
  }
  async updateFile(fileId: string, content: Uint8Array) {
    const item = this.item(fileId);
    item.content = content;
    item.headRevisionId = `rev${this.nextId++}`;
    return this.info(fileId);
  }
}

const text = (s: string) => new TextEncoder().encode(s);

describe('Drive projects', () => {
  let drive: FakeDrive;
  let rootId: string;

  beforeEach(async () => {
    drive = new FakeDrive();
    rootId = await findOrCreateRootFolder(drive);
  });

  it('creates the "LaTeX Projects" folder once and reuses it', async () => {
    expect(await findOrCreateRootFolder(drive)).toBe(rootId);
    expect(await drive.list('root')).toHaveLength(1);
  });

  it('creates a project with subfolders and opens it again', async () => {
    const image = new Uint8Array([1, 2, 3]);
    await createProject(drive, rootId, 'paper', [
      { path: 'main.tex', content: '\\input{chapters/intro}' },
      { path: 'chapters/intro.tex', content: 'Intro' },
      { path: 'chapters/figures/plot.png', content: image },
    ]);
    expect(drive.read('LaTeX Projects/paper/chapters/intro.tex')).toBe('Intro');

    const [folder] = await listProjects(drive, rootId);
    const project = await openProject(drive, folder);
    const byPath = Object.fromEntries(project.files.map((f) => [f.path, f.content]));
    expect(byPath).toEqual({
      'main.tex': '\\input{chapters/intro}',
      'chapters/intro.tex': 'Intro',
      'chapters/figures/plot.png': image,
    });
  });

  it('refuses to create a project whose name is taken', async () => {
    await createProject(drive, rootId, 'paper', []);
    await expect(createProject(drive, rootId, 'paper', [])).rejects.toThrow('already exists');
  });

  it('saves only changed files and marks them saved', async () => {
    const project = await createProject(drive, rootId, 'paper', [
      { path: 'main.tex', content: 'old' },
      { path: 'refs.bib', content: 'bib' },
    ]);
    const main = project.files[0];
    main.content = 'new';
    main.changed = true;

    expect(await saveProject(drive, project)).toEqual([]);
    expect(drive.read('LaTeX Projects/paper/main.tex')).toBe('new');
    expect(main.changed).toBe(false);
  });

  it('does not overwrite a file that changed in Drive since it was loaded', async () => {
    const project = await createProject(drive, rootId, 'paper', [{ path: 'main.tex', content: 'mine' }]);
    const main = project.files[0];
    await drive.updateFile(main.driveId ?? '', text('from the other computer'));
    main.content = 'my edit';
    main.changed = true;

    expect(await saveProject(drive, project)).toEqual(['main.tex']);
    expect(drive.read('LaTeX Projects/paper/main.tex')).toBe('from the other computer');
    expect(main.changed).toBe(true); // the edit is kept, still unsaved
  });

  it('adds a new file inside an existing subfolder', async () => {
    const project = await createProject(drive, rootId, 'paper', [{ path: 'figures/a.png', content: text('a') }]);
    project.files.push({ path: 'figures/b.png', content: text('b'), changed: true });
    await saveProject(drive, project);

    const folders = [...drive.items.values()].filter((i) => i.name === 'figures');
    expect(folders).toHaveLength(1);
    expect(drive.read('LaTeX Projects/paper/figures/b.png')).toBe('b');
  });
});
