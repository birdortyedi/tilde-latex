// Tilde runs only in its own tab. Another site could otherwise show Tilde
// inside a frame on its own page, hide it under something else, and trick
// someone into clicking Tilde's buttons (sharing a PDF by link, inviting
// someone). GitHub Pages cannot send the header that forbids framing, so
// Tilde checks for itself. main.ts imports this first: throwing here stops
// the rest of Tilde from starting.
export function isFramed(win: Window): boolean {
  try {
    return win.top !== win.self;
  } catch {
    return true; // a frame on another site may not even read window.top
  }
}

if (typeof window !== 'undefined' && isFramed(window)) { // (tests run without a window)
  document.body.replaceChildren(Object.assign(document.createElement('p'), {
    textContent: 'Tilde works only in its own browser tab. Open it directly: ' + location.origin + location.pathname,
  }));
  throw new Error('Tilde was opened inside a frame on another page, so it did not start.');
}
