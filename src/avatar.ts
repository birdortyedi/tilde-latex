import { colorFor } from './live';

// A person's round face: their Google profile photo, or their initial on
// their colour (the colour of their cursor) when there is no photo or it
// cannot be loaded.
export function avatar(name: string, account: string, photo?: string): HTMLSpanElement {
  const face = document.createElement('span');
  face.className = 'avatar';
  face.setAttribute('aria-hidden', 'true');
  const initial = (): void => {
    face.replaceChildren((name.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase());
    face.style.background = colorFor(account);
  };
  if (photo) {
    const image = document.createElement('img');
    image.src = photo;
    image.alt = '';
    image.referrerPolicy = 'no-referrer'; // Google serves profile photos without knowing the page
    image.addEventListener('error', initial, { once: true });
    face.append(image);
  } else {
    initial();
  }
  return face;
}
