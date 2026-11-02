// "Edited 2 hours ago", "Edited yesterday", "Edited 3 Nov": short and easy to
// compare at a glance. Older than a week shows the date instead.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeAgo(date: Date, now = new Date(), locale?: string): string {
  const elapsed = now.getTime() - date.getTime();
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < 7 * DAY) return relative.format(-Math.floor(elapsed / DAY), 'day');
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

// When a version was saved, for "Go back to the version from …": the time
// today, "yesterday, 16:20", or the date and time before that.
export function versionTime(date: Date, now = new Date(), locale?: string): string {
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.round((day(now) - day(date)) / DAY);
  if (daysAgo === 0) return time;
  if (daysAgo === 1) return `yesterday, ${time}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  const dateText = date.toLocaleDateString(locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return `${dateText}, ${time}`;
}
