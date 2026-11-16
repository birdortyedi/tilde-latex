import type { Drive, DriveFile } from './drive';
import type { Project } from './projects';

// "Share the PDF by link": the compiled PDF is saved in the project's folder
// in Drive, and anyone with its link can view it (a supervisor or a
// reviewer, without an account or Tilde). Tilde's note on the file keeps it
// out of the project's own files, so it is never compiled or copied.

const NOTE = { tilde: 'shared-pdf' };

// The PDF this project shares by link, if it does.
export async function sharedPdf(drive: Drive, folderId: string): Promise<DriveFile | undefined> {
  return (await drive.list(folderId)).find((file) => file.appProperties?.tilde === NOTE.tilde);
}

export const pdfLink = (fileId: string): string => `https://drive.google.com/file/d/${fileId}/view`;

// Saves the PDF (replacing the one shared before, so the link stays the
// same) and makes its link work for anyone. Returns the link.
export async function sharePdf(drive: Drive, project: Project, pdf: Uint8Array): Promise<string> {
  const folderId = project.driveId;
  if (!folderId) throw new Error(`${project.name} is not in Google Drive.`);
  const existing = await sharedPdf(drive, folderId);
  let file: DriveFile;
  if (existing) {
    file = await drive.updateFile(existing.id, pdf);
  } else {
    const taken = new Set(project.files.map((f) => f.path));
    const name = taken.has(`${project.name}.pdf`) ? `${project.name} (shared).pdf` : `${project.name}.pdf`;
    file = await drive.createFile(name, folderId, pdf);
    await drive.updateMetadata(file.id, { appProperties: NOTE });
  }
  await drive.shareByLink(file.id);
  return pdfLink(file.id);
}

// Stops sharing: the link stops working, and the PDF goes to the trash in
// Drive. (Drive still shows a file in the trash to anyone with its link, so
// the link's permission is taken away first.)
export async function stopSharingPdf(drive: Drive, folderId: string): Promise<boolean> {
  const existing = await sharedPdf(drive, folderId);
  if (!existing) return false;
  await stopLink(drive, existing.id);
  await drive.updateMetadata(existing.id, { trashed: true });
  return true;
}

export async function stopLink(drive: Drive, fileId: string): Promise<void> {
  for (const permission of await drive.permissions(fileId)) {
    if (permission.type === 'anyone') await drive.removePermission(fileId, permission.id);
  }
}
