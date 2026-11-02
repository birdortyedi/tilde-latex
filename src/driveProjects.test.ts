import { beforeEach, describe, expect, it } from 'vitest';
import { FakeDrive } from './testing/fakeDrive';
import { createProject, findOrCreateRootFolder, listProjects, openProject, saveProject } from './driveProjects';

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
