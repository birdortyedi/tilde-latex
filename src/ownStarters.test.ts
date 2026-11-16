import { describe, expect, it } from 'vitest';
import { listProjects } from './driveProjects';
import { ownStarters, removeStarter, saveStarter, starterFiles } from './ownStarters';
import { FakeDrive } from './testing/fakeDrive';

describe('your own starters', () => {
  it('are kept as a .zip in the projects folder, and give back the same files', async () => {
    const drive = new FakeDrive();
    const root = await drive.createFolder('LaTeX Projects', 'root');
    const project = { name: 'Thesis', files: [{ path: 'src/thesis.tex', content: '\\documentclass{book}' }, { path: 'src/logo.png', content: new Uint8Array([7]) }] };
    await saveStarter(drive, root.id, 'Lab thesis', project, 'src/thesis.tex');
    await saveStarter(drive, root.id, 'Lab thesis', project, 'src/thesis.tex'); // replaces it
    const starters = await ownStarters(drive, root.id);
    expect(starters.map((s) => [s.name, s.mainFile])).toEqual([['Lab thesis', 'src/thesis.tex']]);
    expect(await starterFiles(drive, starters[0])).toEqual(project.files);
    expect(await listProjects(drive, root.id)).toEqual([]); // not a project
    await removeStarter(drive, starters[0]);
    expect(await ownStarters(drive, root.id)).toEqual([]);
  });
});
