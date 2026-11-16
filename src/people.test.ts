import { describe, expect, it } from 'vitest';
import { peopleCount, peopleOf } from './people';
import { invite } from './sharing';
import { FakeDrive } from './testing/fakeDrive';

describe('people and access', () => {
  it('lists the owner first, then editors and viewers, and follows changes', async () => {
    const drive = new FakeDrive();
    const folder = await drive.createFolder('Paper', 'root');
    await invite(drive, { name: 'Paper', files: [], driveId: folder.id }, 'zoe@example.org', 'Furkan', 'https://tilde/#join=x', 'reader');
    await invite(drive, { name: 'Paper', files: [], driveId: folder.id }, 'bora@example.org', 'Furkan', 'https://tilde/#join=x');
    expect(drive.shares[0].message).toContain('to read');
    const show = async () => (await peopleOf(drive, folder.id)).map((p) => `${p.role} ${p.name}`);
    expect(await show()).toEqual(['owner me@example.org', 'writer bora@example.org', 'reader zoe@example.org']);
    await drive.setRole(folder.id, 'perm-zoe@example.org', 'writer');
    await drive.removePermission(folder.id, 'perm-bora@example.org');
    expect(await show()).toEqual(['owner me@example.org', 'writer zoe@example.org']);
    expect(peopleCount(await peopleOf(drive, folder.id))).toBe(2);
  });
});
