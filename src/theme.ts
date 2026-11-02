// Light or dark. Tilde follows the computer's setting until the user picks
// one with the button; that choice is remembered in this browser.

const STORAGE_KEY = 'tilde.theme';
type Theme = 'light' | 'dark';

const systemTheme = (): Theme => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function current(): Theme {
  const chosen = document.documentElement.dataset.theme;
  return chosen === 'light' || chosen === 'dark' ? chosen : systemTheme();
}

export function initTheme(button: HTMLButtonElement): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
  } catch { /* use the computer's setting */ }

  const label = (): void => {
    button.textContent = current() === 'dark' ? 'Light' : 'Dark';
    button.title = current() === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme';
  };
  button.addEventListener('click', () => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* not remembered */ }
    label();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', label);
  label();
}
