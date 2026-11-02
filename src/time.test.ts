import { describe, expect, it } from 'vitest';
import { timeAgo, versionTime } from './time';

const now = new Date('2026-11-02T15:00:00');
const ago = (ms: number) => timeAgo(new Date(now.getTime() - ms), now, 'en-GB');

describe('timeAgo', () => {
  it('says how long ago, for the last week', () => {
    expect(ago(20_000)).toBe('just now');
    expect(ago(5 * 60_000)).toBe('5 minutes ago');
    expect(ago(2 * 3_600_000)).toBe('2 hours ago');
    expect(ago(30 * 3_600_000)).toBe('yesterday');
    expect(ago(3 * 86_400_000)).toBe('3 days ago');
  });

  it('shows the date for older edits, with the year only when it differs', () => {
    expect(timeAgo(new Date('2026-09-14T10:00:00'), now, 'en-GB')).toBe('14 Sept');
    expect(timeAgo(new Date('2025-09-14T10:00:00'), now, 'en-GB')).toBe('14 Sept 2025');
  });
});

describe('versionTime', () => {
  const now = new Date(2026, 10, 2, 18, 0);
  it('says the time today, "yesterday" and then the date', () => {
    expect(versionTime(new Date(2026, 10, 2, 10, 42), now, 'en-GB')).toBe('10:42');
    expect(versionTime(new Date(2026, 10, 1, 16, 20), now, 'en-GB')).toBe('yesterday, 16:20');
    expect(versionTime(new Date(2026, 9, 28, 9, 5), now, 'en-GB')).toBe('28 Oct, 09:05');
    expect(versionTime(new Date(2025, 11, 30, 9, 5), now, 'en-GB')).toBe('30 Dec 2025, 09:05');
  });
});
