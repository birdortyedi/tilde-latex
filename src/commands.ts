// The keyboard shortcuts, as a list Go to anything shows when the search
// starts with "?" (and the ? key opens it so). Each command says its keys,
// in the words of this computer (⌘ on a Mac, Ctrl elsewhere); those Tilde
// can run from the list carry an id (see runCommand in main.ts).

export type CommandId = 'compile' | 'showInPdf' | 'bold' | 'italic' | 'lineComment' | 'comment' | 'find' | 'goTo';

export interface Command {
  label: string;
  group: 'PDF' | 'Writing' | 'Moving around';
  keys: string[]; // key combinations like "Mod-Shift-Enter"; several are alternatives
  where?: string; // when the keys work, or what to do instead of keys
  id?: CommandId;
}

export const COMMANDS: Command[] = [
  { label: 'Update the PDF', group: 'PDF', keys: ['Mod-s'], id: 'compile' },
  { label: 'Show the cursor\'s line in the PDF', group: 'PDF', keys: ['Mod-Shift-Enter'], id: 'showInPdf' },
  { label: 'Go to a line of the PDF in the source', group: 'PDF', keys: [], where: 'Double-click the PDF' },
  { label: 'Zoom the PDF', group: 'PDF', keys: ['Mod-+', 'Mod--'], where: 'over the PDF; Mod-0 fits the width' },
  { label: 'Bold', group: 'Writing', keys: ['Mod-b'], where: 'around the selection', id: 'bold' },
  { label: 'Italic', group: 'Writing', keys: ['Mod-i'], where: 'around the selection', id: 'italic' },
  { label: 'Comment lines out, or back in', group: 'Writing', keys: ['Mod-/'], id: 'lineComment' },
  { label: 'Comment on the selected text', group: 'Writing', keys: ['Mod-Alt-m'], id: 'comment' },
  { label: 'Find and replace', group: 'Writing', keys: ['Mod-f'], where: 'Enter for the next match, Shift-Enter for the one before', id: 'find' },
  { label: 'Paste an image, or cells from a spreadsheet as a table', group: 'Writing', keys: ['Mod-v'] },
  { label: 'Larger or smaller text in the editor', group: 'Writing', keys: ['Mod-+', 'Mod--'], where: 'in the editor; Mod-0 for the usual size' },
  { label: 'Go to anything', group: 'Moving around', keys: ['Mod-k'], where: 'files, headings, labels, citation keys and text', id: 'goTo' },
  { label: 'Back to the open project', group: 'Moving around', keys: ['Escape'], where: 'on the project page' },
  { label: 'Keyboard shortcuts', group: 'Moving around', keys: ['?'], where: 'outside the text' },
];

const MAC_NAMES: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↵', Escape: 'Esc' };
const OTHER_NAMES: Record<string, string> = { Mod: 'Ctrl', Escape: 'Esc' };

// The keycaps of one combination: "Mod-Shift-Enter" → ["⌘", "⇧", "↵"] on a Mac,
// ["Ctrl", "Shift", "Enter"] elsewhere. "Mod--" is Mod and the minus key.
export function keycaps(combo: string, mac: boolean): string[] {
  const parts = combo.endsWith('--') ? [...combo.slice(0, -2).split('-'), '−'] : combo.split('-');
  return parts.map((part) => (mac ? MAC_NAMES : OTHER_NAMES)[part] ?? (part.length === 1 ? part.toUpperCase() : part));
}

// The words of a command's note, with "Mod-0" written for this computer.
export function describe(text: string, mac: boolean): string {
  return text.replace(/Mod-(\w)/g, (_, key: string) => `${mac ? '⌘' : 'Ctrl+'}${key}`);
}

// The commands whose words match every word typed, in the order of the list.
export function findCommands(typed: string): Command[] {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  return COMMANDS.filter((command) => {
    const text = `${command.label} ${command.where ?? ''} ${command.group}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
