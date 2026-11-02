// Tilde's own question box, instead of the browser's prompt() and confirm().
// Those are blocked by some browsers and can hide behind other windows (for
// example right after the Google Picker closes), which looks like a hang.

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`index.html is missing ${selector}`);
  return found;
}

const dialog = element<HTMLDialogElement>('#ask-dialog');
const message = element<HTMLParagraphElement>('#ask-message');
const input = element<HTMLInputElement>('#ask-input');
const okButton = element<HTMLButtonElement>('#ask-ok');

function ask(text: string, okLabel: string, value: string | null): Promise<string | null> {
  message.textContent = text;
  okButton.textContent = okLabel;
  input.hidden = value === null;
  input.value = value ?? '';
  dialog.returnValue = '';
  dialog.showModal();
  if (value !== null) input.select();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? input.value : null), { once: true });
  });
}

// Asks for a line of text. Resolves with null if the user cancels.
export function askText(text: string, value = ''): Promise<string | null> {
  return ask(text, 'OK', value);
}

// Asks a yes/no question. Resolves with true if the user clicks the OK button.
export async function askConfirm(text: string, okLabel = 'OK'): Promise<boolean> {
  return (await ask(text, okLabel, null)) !== null;
}
