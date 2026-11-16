import type { Drive, Permission } from './drive';

// Who may open a shared project, for the People panel (see main.ts). Drive
// keeps this list; Tilde only shows and changes it.

export const MAX_PEOPLE = 5; // Tilde is made for up to this many people in one project

export interface Person {
  permissionId: string;
  name: string; // a name, an email address, or e.g. "Anyone with the link"
  email?: string;
  role: string; // "owner", "writer", "commenter" or "reader"
  user: boolean; // a person (not a group, a domain or "anyone")
  photo?: string; // their Google profile photo
}

const ORDER: Record<string, number> = { owner: 0, writer: 1, commenter: 2, reader: 3 };

function personFrom(permission: Permission): Person {
  const user = permission.type === 'user';
  const name = permission.type === 'anyone' ? 'Anyone with the link'
    : permission.type === 'domain' ? `Anyone at ${permission.domain ?? 'your organisation'}`
    : permission.displayName || permission.emailAddress || 'Someone';
  return { permissionId: permission.id, name, email: permission.emailAddress, role: permission.role, user, ...(permission.photoLink ? { photo: permission.photoLink } : {}) };
}

// The owner first, then those who may edit, then those who may view, each by name.
export async function peopleOf(drive: Drive, fileId: string): Promise<Person[]> {
  return (await drive.permissions(fileId)).map(personFrom)
    .sort((a, b) => (ORDER[a.role] ?? 9) - (ORDER[b.role] ?? 9) || a.name.localeCompare(b.name));
}

// How many people (not links or domains) may open the project, the owner included.
export const peopleCount = (people: Person[]): number => people.filter((p) => p.user).length;
