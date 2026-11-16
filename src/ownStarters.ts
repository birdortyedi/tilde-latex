import type { Drive, DriveFile } from './drive';
import type { Project, ProjectFile } from './projects';
import { unzipSync } from 'fflate';
import { isTextFile } from './fileTree';
import { zipFiles } from './zipImport';

// The user's own starters ("Save as a starter…"): a project kept as a .zip in
// the projects folder, so the New project dialog offers it on every
// computer. A lab's thesis template, say.

const NOTE = 'tildeStarter'; // Tilde's note on the .zip: the starter's name
const MAIN = 'tildeStarterMain'; // and the file to compile

export interface OwnStarter {
  id: string; // the .zip in Drive
  name: string;
  mainFile?: string;
  saved?: Date;
}

export async function ownStarters(drive: Drive, rootId: string): Promise<OwnStarter[]> {
  return (await drive.list(rootId))
    .filter((file): file is DriveFile & { appProperties: Record<string, string> } => Boolean(file.appProperties?.[NOTE]))
    .map((file) => ({
      id: file.id,
      name: file.appProperties[NOTE],
      mainFile: file.appProperties[MAIN],
      saved: file.modifiedTime ? new Date(file.modifiedTime) : undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Saves a project's files as a starter; one of the same name is replaced.
export async function saveStarter(drive: Drive, rootId: string, name: string, project: Project, mainFile?: string): Promise<void> {
  const bytes = zipFiles(project.files.map((f): ProjectFile => ({ path: f.path, content: f.content })));
  const same = (await ownStarters(drive, rootId)).find((s) => s.name === name);
  const file = same ? await drive.updateFile(same.id, bytes) : await drive.createFile(`${name} (Tilde starter).zip`, rootId, bytes);
  await drive.updateMetadata(file.id, { appProperties: { [NOTE]: name, [MAIN]: mainFile ?? null } });
}

export async function starterFiles(drive: Drive, starter: OwnStarter): Promise<ProjectFile[]> {
  // Exactly as saved, folders and all.
  return Object.entries(unzipSync(await drive.download(starter.id)))
    .filter(([path]) => !path.endsWith('/'))
    .map(([path, bytes]) => ({ path, content: isTextFile(path) ? new TextDecoder().decode(bytes) : bytes }));
}

// Removing a starter puts its .zip in Drive's trash (restorable for 30 days).
export async function removeStarter(drive: Drive, starter: OwnStarter): Promise<void> {
  await drive.updateMetadata(starter.id, { trashed: true });
}
