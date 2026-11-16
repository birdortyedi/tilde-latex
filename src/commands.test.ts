import { describe as group, expect, it } from 'vitest';
import { COMMANDS, describe, findCommands, keycaps } from './commands';

group('the keyboard shortcut list', () => {
  it('names the keys as this computer does', () => {
    expect(keycaps('Mod-Shift-Enter', true)).toEqual(['⌘', '⇧', '↵']);
    expect(keycaps('Mod-Shift-Enter', false)).toEqual(['Ctrl', 'Shift', 'Enter']);
    expect(keycaps('Mod-Alt-m', true)).toEqual(['⌘', '⌥', 'M']);
    expect(keycaps('Mod--', false)).toEqual(['Ctrl', '−']);
    expect(keycaps('?', true)).toEqual(['?']);
    expect(describe('Mod-0 fits the width', false)).toBe('Ctrl+0 fits the width');
  });

  it('finds commands by any of their words, and lists them all for an empty search', () => {
    expect(findCommands('')).toHaveLength(COMMANDS.length);
    expect(findCommands('pdf line').map((c) => c.label)).toEqual(['Show the cursor\'s line in the PDF', 'Go to a line of the PDF in the source']);
    expect(findCommands('BOLD')[0].id).toBe('bold');
    expect(findCommands('nothing like this')).toEqual([]);
  });

  it('lists every shortcut of the README', () => {
    // Keep this in step with "Keyboard shortcuts" in README.md.
    for (const keys of ['Mod-s', 'Mod-Shift-Enter', 'Mod-b', 'Mod-i', 'Mod-/', 'Mod-v', 'Mod-k', 'Mod-Alt-m', 'Mod-f', 'Escape']) {
      expect(COMMANDS.some((c) => c.keys.includes(keys))).toBe(true);
    }
  });
});
