import { describe, expect, it } from 'vitest';
import { createProject, openProject } from './driveProjects';
import { FOLDER_TYPE } from './drive';
import { pdfLink, sharedPdf, sharePdf, stopSharingPdf } from './pdfLink';
import { FakeDrive } from './testing/fakeDrive';

describe('sharing the PDF by link', () => {
  it('saves it in the project folder, out of the project, and keeps one link', async () => {
    const drive = new FakeDrive();
    const root = await drive.createFolder('LaTeX Projects', 'root');
    const project = await createProject(drive, root.id, 'Paper', [{ path: 'main.tex', content: 'x' }]);
    const link = await sharePdf(drive, project, new Uint8Array([1]));
    const file = await sharedPdf(drive, project.driveId ?? '');
    expect(link).toBe(pdfLink(file?.id ?? ''));
    expect(file?.name).toBe('Paper.pdf');
    expect(drive.linkShared.has(file?.id ?? '')).toBe(true);
    expect((await openProject(drive, { id: project.driveId ?? '', name: 'Paper', mimeType: FOLDER_TYPE })).files.map((f) => f.path)).toEqual(['main.tex']);
    expect(await sharePdf(drive, project, new Uint8Array([2]))).toBe(link); // updated, same link
    expect(drive.read('LaTeX Projects/Paper/Paper.pdf')).toBe('\u0002');
    const id = file?.id ?? '';
    expect(await stopSharingPdf(drive, project.driveId ?? '')).toBe(true);
    expect(drive.linkShared.has(id)).toBe(false); // the link stops working, not only the file trashed
    expect(await sharedPdf(drive, project.driveId ?? '')).toBeUndefined();
  });
});
