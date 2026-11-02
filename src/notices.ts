// Short notices in the corner ("Deleted refs.bib") that fade after a few
// seconds, and a "working" overlay for slow steps like opening a project.
// Errors stay until the user closes them.

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`index.html is missing ${selector}`);
  return found;
}

const toasts = element<HTMLDivElement>('#toasts');
const busy = element<HTMLDivElement>('#busy');
const busyText = element<HTMLSpanElement>('#busy-text');

export type NoticeKind = 'success' | 'info' | 'error';

export function notify(text: string, kind: NoticeKind = 'success'): void {
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const message = document.createElement('span');
  message.textContent = text;
  const close = document.createElement('button');
  close.className = 'quiet';
  close.textContent = '×';
  close.title = 'Close';
  close.addEventListener('click', () => toast.remove());
  toast.append(message, close);
  toasts.append(toast);
  // Longer texts stay a little longer; errors stay until closed.
  if (kind !== 'error') setTimeout(() => toast.remove(), Math.min(4000 + text.length * 40, 10_000));
  while (toasts.children.length > 4) toasts.firstElementChild?.remove();
}

// Shows the overlay, or changes its text if it is already shown.
export function showBusy(text: string): void {
  busyText.textContent = text;
  busy.hidden = false;
}

export function hideBusy(): void {
  busy.hidden = true;
}
