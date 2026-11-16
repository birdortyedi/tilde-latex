// A small pop-up menu under a button, for the "+" and "⋯" buttons in the
// file tree. It closes when an item is chosen, on Escape, or when clicking
// elsewhere (the browser's popover feature does the last two).

export interface MenuItem {
  label: string;
  action?: () => void; // none: a heading, not a choice
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean; // an on/off choice: a tick when on, in a column of its own
}

const TICK = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';

let open: HTMLElement | null = null;

export function openMenu(anchor: HTMLElement, items: MenuItem[]): void {
  open?.hidePopover();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.popover = 'auto';
  menu.setAttribute('role', 'menu');
  // With on/off choices in it, every item leaves room for the tick, so the labels line up.
  const ticks = items.some((item) => item.checked !== undefined);
  for (const item of items) {
    if (!item.action) {
      const heading = document.createElement('div');
      heading.className = 'menu-heading';
      heading.textContent = item.label;
      menu.append(heading);
      continue;
    }
    const action = item.action;
    const button = document.createElement('button');
    button.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
    if (item.checked !== undefined) button.setAttribute('aria-checked', String(item.checked));
    if (ticks) {
      const tick = document.createElement('span');
      tick.className = 'tick';
      if (item.checked) tick.innerHTML = TICK; // Tilde's own fixed drawing
      button.append(tick);
    }
    button.append(item.label);
    button.disabled = item.disabled ?? false;
    if (item.danger) button.classList.add('danger');
    button.addEventListener('click', () => {
      menu.hidePopover();
      action();
    });
    menu.append(button);
  }
  // Up and down arrows move between the items.
  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:enabled')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  });
  menu.addEventListener('toggle', (event) => {
    if ((event as ToggleEvent).newState === 'closed') {
      menu.remove();
      if (open === menu) open = null;
    }
  });

  document.body.append(menu);
  const box = anchor.getBoundingClientRect();
  menu.showPopover();
  // Under the button, but never past the right edge of the window.
  menu.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  // Open upwards if there is no room below.
  const height = menu.offsetHeight;
  menu.style.top = `${box.bottom + 4 + height > window.innerHeight ? box.top - height - 4 : box.bottom + 4}px`;
  open = menu;
  menu.querySelector<HTMLButtonElement>('button:enabled')?.focus();
}
