import { FOLDER_TYPE, type Drive, type DriveFile } from './drive';
import { isTextFile } from './fileTree';
import type { Project, ProjectFile } from './projects';

// Every project is a folder inside this one, at the top of the user's Drive.
// A project's subfolders and files mirror its paths: "figures/plot.png" is
// the file plot.png in the subfolder figures.
export const ROOT_FOLDER_NAME = 'LaTeX Projects';

const isFolder = (file: DriveFile): boolean => file.mimeType === FOLDER_TYPE;

// Finds the "LaTeX Projects" folder, or creates it the first time.
// Because of the drive.file scope, Drive only shows us a folder Tilde created.
export async function findOrCreateRootFolder(drive: Drive): Promise<string> {
  const existing = (await drive.list('root')).find((f) => isFolder(f) && f.name === ROOT_FOLDER_NAME);
  return existing?.id ?? (await drive.createFolder(ROOT_FOLDER_NAME, 'root')).id;
}

// The project folders, sorted by name.
export async function listProjects(drive: Drive, rootId: string): Promise<DriveFile[]> {
  return (await drive.list(rootId)).filter(isFolder).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createProject(drive: Drive, rootId: string, name: string, files: ProjectFile[]): Promise<Project> {
  if ((await listProjects(drive, rootId)).some((p) => p.name === name)) {
    throw new Error(`A project called "${name}" already exists.`);
  }
  const folder = await drive.createFolder(name, rootId);
  const project: Project = {
    name,
    driveId: folder.id,
    files: files.map((f) => ({ path: f.path, content: f.content, changed: true })),
  };
  await saveProject(drive, project); // uploads every file, since all are new
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
  return { name: folder.name, driveId: folder.id, files };
}

// The current Drive revision of every file in a project, by file id.
// Costs one request per folder, not one per file.
export async function currentRevisions(drive: Drive, project: Project): Promise<Map<string, string | undefined>> {
  const revisions = new Map<string, string | undefined>();
  const walk = async (folderId: string): Promise<void> => {
    await Promise.all((await drive.list(folderId)).map(async (item) => {
      if (isFolder(item)) return walk(item.id);
      revisions.set(item.id, item.headRevisionId);
    }));
  };
  if (project.driveId) await walk(project.driveId);
  return revisions;
}

// Saves every changed file to Drive and returns the paths of files it did
// NOT save: those that changed in Drive (for example on another computer)
// since we loaded them. Those are never overwritten silently.
export async function saveProject(drive: Drive, project: Project): Promise<string[]> {
  if (!project.driveId) throw new Error(`${project.name} is not in Google Drive.`);
  const conflicts: string[] = [];
  const folders = new Map<string, string>([['', project.driveId]]);

  for (const file of project.files.filter((f) => f.changed)) {
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
      const slash = file.path.lastIndexOf('/');
      const parentId = await folderFor(drive, folders, slash < 0 ? '' : file.path.slice(0, slash));
      saved = await drive.createFile(file.path.slice(slash + 1), parentId, bytes);
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
  const slash = dir.lastIndexOf('/');
  const parentId = await folderFor(drive, folders, slash < 0 ? '' : dir.slice(0, slash));
  const name = dir.slice(slash + 1);
  const existing = (await drive.list(parentId)).find((f) => isFolder(f) && f.name === name);
  const id = existing?.id ?? (await drive.createFolder(name, parentId)).id;
  folders.set(dir, id);
  return id;
}
