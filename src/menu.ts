// A small pop-up menu under a button, for the "+" and "⋯" buttons in the
// file tree. It closes when an item is chosen, on Escape, or when clicking
// elsewhere (the browser's popover feature does the last two).

export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
}

let open: HTMLElement | null = null;

export function openMenu(anchor: HTMLElement, items: MenuItem[]): void {
  open?.hidePopover();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.popover = 'auto';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    const button = document.createElement('button');
    button.textContent = item.label;
    button.setAttribute('role', 'menuitem');
    button.disabled = item.disabled ?? false;
    if (item.danger) button.classList.add('danger');
    button.addEventListener('click', () => {
      menu.hidePopover();
      item.action();
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
  menu.style.left = `${Math.min(box.left, window.innerWidth - 200)}px`;
  menu.showPopover();
  // Open upwards if there is no room below.
  const height = menu.offsetHeight;
  menu.style.top = `${box.bottom + 4 + height > window.innerHeight ? box.top - height - 4 : box.bottom + 4}px`;
  open = menu;
  menu.querySelector<HTMLButtonElement>('button:enabled')?.focus();
}
