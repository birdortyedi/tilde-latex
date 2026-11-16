// Tilde's small drawn icons (16 by 16, one line weight), for buttons made in
// code. Drawn, not typed, so they sit on the same line whatever the font.

const draw = (inner: string, filled = false): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ${filled ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"'}>${inner}</svg>`;

export const ICONS = {
  more: draw('<circle cx="3.5" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="12.5" cy="8" r="1.1"/>', true),
};

// A button's content: an icon. The button keeps its own aria-label and title.
export function setIcon(button: HTMLElement, name: keyof typeof ICONS): void {
  button.innerHTML = ICONS[name]; // Tilde's own fixed drawings
}
