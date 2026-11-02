import { FOLDER_TYPE, type Drive, type DriveFile } from './drive';
import { isTextFile } from './fileTree';
import type { Project, ProjectFile } from './projects';

// Every project is a folder inside this one, at the top of the user's Drive.
// A project's subfolders and files mirror its paths: "figures/plot.png" is
// the file plot.png in the subfolder figures.
export const ROOT_FOLDER_NAME = 'LaTeX Projects';

const isFolder = (file: DriveFile): boolean => file.mimeType === FOLDER_TYPE;

// "chapters/intro.tex" → ["chapters", "intro.tex"]; "main.tex" → ["", "main.tex"]
function splitPath(path: string): [string, string] {
  const slash = path.lastIndexOf('/');
  return [slash < 0 ? '' : path.slice(0, slash), path.slice(slash + 1)];
}

// Tilde's note on the folder that holds the projects. Tilde finds the folder
// by this note, not by its name, so the user can rename it or move it
// anywhere in Drive.
const PROJECTS_TAG = 'tildeProjects';

// The folder that holds the projects. The first time, it is created as
// "LaTeX Projects" at the top of Drive (or found there, from before the note
// existed). Because of the drive.file scope, Drive only shows us folders
// Tilde created or the user picked.
export async function projectsFolder(drive: Drive): Promise<DriveFile> {
  const tagged = (await drive.findByProperty(PROJECTS_TAG, 'true')).find(isFolder);
  if (tagged) return tagged;
  const named = (await drive.list('root')).find((f) => isFolder(f) && f.name === ROOT_FOLDER_NAME);
  const folder = named ?? (await drive.createFolder(ROOT_FOLDER_NAME, 'root'));
  return drive.updateMetadata(folder.id, { appProperties: { [PROJECTS_TAG]: 'true' } });
}

export async function findOrCreateRootFolder(drive: Drive): Promise<string> {
  return (await projectsFolder(drive)).id;
}

// Makes another folder (one the user picked) the projects folder, and moves
// every project into it. Returns how many projects moved.
export async function moveProjectsFolder(drive: Drive, fromId: string, to: DriveFile): Promise<number> {
  const projects = await listProjects(drive, fromId);
  for (const project of projects) await drive.updateMetadata(project.id, {}, { from: fromId, to: to.id });
  await drive.updateMetadata(to.id, { appProperties: { [PROJECTS_TAG]: 'true' } });
  await drive.updateMetadata(fromId, { appProperties: { [PROJECTS_TAG]: null } });
  return projects.length;
}

// The project folders, sorted by name.
export async function listProjects(drive: Drive, rootId: string): Promise<DriveFile[]> {
  return (await drive.list(rootId)).filter(isFolder).sort((a, b) => a.name.localeCompare(b.name));
}

// When a project was last edited: Tilde notes it on the project folder when
// saving (Drive does not update a folder's own date when files inside change).
export function lastEdited(folder: DriveFile): Date | undefined {
  const when = folder.appProperties?.lastEdited ?? folder.modifiedTime;
  return when ? new Date(when) : undefined;
}

export async function stampLastEdited(drive: Drive, project: Project): Promise<void> {
  if (project.driveId) await drive.updateMetadata(project.driveId, { appProperties: { lastEdited: new Date().toISOString() } });
}

export async function createProject(
  drive: Drive, rootId: string, name: string, files: ProjectFile[],
  onProgress?: (done: number, total: number) => void,
): Promise<Project> {
  if ((await listProjects(drive, rootId)).some((p) => p.name === name)) {
    throw new Error(`A project called "${name}" already exists.`);
  }
  const folder = await drive.createFolder(name, rootId);
  const project: Project = {
    name,
    driveId: folder.id,
    files: files.map((f) => ({ path: f.path, content: f.content, changed: true })),
  };
  await saveProject(drive, project, onProgress); // uploads every file, since all are new
  await stampLastEdited(drive, project);
  return project;
}

// Downloads all files of a project folder, including its subfolders.
export async function openProject(drive: Drive, folder: DriveFile): Promise<Project> {
  const files: ProjectFile[] = [];
  const walk = async (folderId: string, prefix: string): Promise<void> => {
    await Promise.all((await drive.list(folderId)).map(async (item) => {
      const path = prefix + item.name;
      if (isFolder(item)) return walk(item.id, `${path}/`);
      const bytes = await drive.download(item.id);
      const content = isTextFile(path) ? new TextDecoder().decode(bytes) : bytes;
      files.push({ path, content, driveId: item.id, revision: item.headRevisionId });
    }));
  };
  await walk(folder.id, '');
  return { name: folder.name, driveId: folder.id, files, mainFile: folder.appProperties?.mainFile };
}

// Renames a file and/or moves it to another folder of the project, creating
// missing folders. Drive keeps the file's version history.
export async function moveFile(drive: Drive, project: Project, file: ProjectFile, newPath: string): Promise<void> {
  if (!project.driveId) throw new Error(`${project.name} is not in Google Drive.`);
  if (file.driveId) {
    const folders = new Map<string, string>([['', project.driveId]]);
    const [oldDir] = splitPath(file.path);
    const [newDir, newName] = splitPath(newPath);
    const from = await folderFor(drive, folders, oldDir);
    const to = await folderFor(drive, folders, newDir);
    await drive.updateMetadata(file.driveId, { name: newName }, from === to ? undefined : { from, to });
  }
  file.path = newPath;
}

// After a file was deleted or moved out of `dir`, moves `dir` and its parent
// folders to Drive's trash if they are now empty. A folder is kept if the
// project still has files in it, or if Drive still shows anything in it.
export async function removeEmptyFolders(drive: Drive, project: Project, dir: string): Promise<void> {
  if (!project.driveId) return;
  for (let current = dir; current !== ''; current = splitPath(current)[0]) {
    if (project.files.some((f) => f.path.startsWith(`${current}/`))) return;
    const folderId = await findFolder(drive, project.driveId, current);
    if (!folderId || (await drive.list(folderId)).length > 0) return;
    await drive.updateMetadata(folderId, { trashed: true });
  }
}

// The Drive id of a folder like "chapters/appendix" inside the project, found
// by walking down from the project folder; undefined if there is none.
async function findFolder(drive: Drive, projectId: string, dir: string): Promise<string | undefined> {
  let folderId: string | undefined = projectId;
  for (const name of dir.split('/')) {
    if (!folderId) break;
    folderId = (await drive.list(folderId)).find((f) => isFolder(f) && f.name === name)?.id;
  }
  return folderId;
}

// Renames a folder of the project (it stays where it is) and updates the
// paths of the files in it. Drive keeps every file's history.
export async function renameFolder(drive: Drive, project: Project, dir: string, newName: string): Promise<string> {
  if (!project.driveId) throw new Error(`${project.name} is not in Google Drive.`);
  const [parent] = splitPath(dir);
  const newDir = parent ? `${parent}/${newName}` : newName;
  const folderId = await findFolder(drive, project.driveId, dir);
  if (folderId) await drive.updateMetadata(folderId, { name: newName });
  for (const file of project.files) {
    if (file.path.startsWith(`${dir}/`)) file.path = newDir + file.path.slice(dir.length);
  }
  return newDir;
}

// Moves a file to Drive's trash, where it can be restored for 30 days.
export async function trashFile(drive: Drive, file: ProjectFile): Promise<void> {
  if (file.driveId) await drive.updateMetadata(file.driveId, { trashed: true });
}

// Remembers the main file on the project folder, so every computer uses the same one.
export async function setMainFile(drive: Drive, project: Project, path: string): Promise<void> {
  if (!project.driveId) throw new Error(`${project.name} is not in Google Drive.`);
  await drive.updateMetadata(project.driveId, { appProperties: { mainFile: path } });
  project.mainFile = path;
}

// Every file of a project as it is in Drive now, by file id: its path in
// the project and its current revision. Costs one request per folder, not
// one per file.
export async function filesOnDrive(drive: Drive, project: Project): Promise<Map<string, { path: string; revision?: string }>> {
  const files = new Map<string, { path: string; revision?: string }>();
  const walk = async (folderId: string, prefix: string): Promise<void> => {
    await Promise.all((await drive.list(folderId)).map(async (item) => {
      const path = prefix + item.name;
      if (isFolder(item)) return walk(item.id, `${path}/`);
      files.set(item.id, { path, revision: item.headRevisionId });
    }));
  };
  if (project.driveId) await walk(project.driveId, '');
  return files;
}

// Saves every changed file to Drive and returns the paths of files it did
// NOT save: those that changed in Drive (for example on another computer)
// since we loaded them. Those are never overwritten silently.
export async function saveProject(
  drive: Drive, project: Project, onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  if (!project.driveId) throw new Error(`${project.name} is not in Google Drive.`);
  const conflicts: string[] = [];
  const folders = new Map<string, string>([['', project.driveId]]);

  const changed = project.files.filter((f) => f.changed);
  for (const [index, file] of changed.entries()) {
    onProgress?.(index, changed.length);
    const content = file.content;
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    let saved: DriveFile;
    if (file.driveId) {
      const current = await drive.get(file.driveId);
      if (current.headRevisionId !== file.revision) {
        conflicts.push(file.path);
        continue;
      }
      saved = await drive.updateFile(file.driveId, bytes);
    } else {
      const [dir, name] = splitPath(file.path);
      saved = await drive.createFile(name, await folderFor(drive, folders, dir), bytes);
    }
    file.driveId = saved.id;
    file.revision = saved.headRevisionId;
    // If the user typed more while we were uploading, the file still needs saving.
    if (file.content === content) file.changed = false;
  }
  return conflicts;
}

// Returns the Drive folder for a path like "chapters/appendix" inside the
// project, creating missing folders on the way. `folders` remembers the ones found.
async function folderFor(drive: Drive, folders: Map<string, string>, dir: string): Promise<string> {
  const known = folders.get(dir);
  if (known) return known;
  const [parent, name] = splitPath(dir);
  const parentId = await folderFor(drive, folders, parent);
  const existing = (await drive.list(parentId)).find((f) => isFolder(f) && f.name === name);
  const id = existing?.id ?? (await drive.createFolder(name, parentId)).id;
  folders.set(dir, id);
  return id;
}
