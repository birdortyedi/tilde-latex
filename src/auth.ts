import { GOOGLE_CLIENT_ID } from './config';

// drive.file lets Tilde see only the files it created or the user picked.
// Never ask for a wider scope (see "Hard rules" in CLAUDE.md).
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

// The token is also kept in this tab's sessionStorage, so a page reload does
// not sign the user out. sessionStorage is cleared when the tab is closed.
const STORAGE_KEY = 'tilde.token';

let token: { value: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;

// Thrown when Drive needs a fresh token. Google only hands one out after a
// click by the user (browsers block its window otherwise), so the app shows
// a "Sign in" button instead of asking for one on its own.
export class SignInNeededError extends Error {
  constructor() {
    super('Your Google sign-in has expired. Sign in again to keep saving.');
  }
}

const isValid = (t: typeof token): t is { value: string; expiresAt: number } =>
  t !== null && Date.now() < t.expiresAt - 60_000;

// Returns the access token for Drive calls. Tokens last about an hour.
export function getAccessToken(): Promise<string> {
  return isValid(token) ? Promise.resolve(token.value) : Promise.reject(new SignInNeededError());
}

// Picks up the token from before a page reload. Returns true if it is still valid.
export function restoreSignIn(): boolean {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as typeof token;
    if (isValid(saved)) token = saved;
  } catch {
    // Storage blocked or unreadable: the user just signs in again.
  }
  return isValid(token);
}

// Opens Google's sign-in window. Call it only from a click handler.
export function signIn(): Promise<string> {
  return requestToken();
}

// Drive rejected the token (for example, access was withdrawn in the Google account).
export function forgetToken(): void {
  token = null;
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* nothing to clean up */ }
}

// Withdraws Tilde's access, so the next sign-in asks the user again.
export function signOut(): void {
  if (token) google.accounts.oauth2.revoke(token.value);
  forgetToken();
}

function requestToken(): Promise<string> {
  if (pending) return pending; // a sign-in popup is already open
  if (!GOOGLE_CLIENT_ID) {
    return Promise.reject(new Error('No Google client ID yet. Add it to src/config.ts (see docs/google-setup.md).'));
  }
  if (typeof google === 'undefined') {
    return Promise.reject(new Error('Google sign-in has not loaded. Check your connection and reload the page.'));
  }

  pending = new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description ?? response.error));
        } else if (!google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE)) {
          // Google lets people untick the Drive permission on the consent screen.
          reject(new Error('Tilde needs access to the files it creates in your Drive. Sign in again and tick that box.'));
        } else {
          token = { value: response.access_token, expiresAt: Date.now() + response.expires_in * 1000 };
          try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(token)); } catch { /* reload will ask again */ }
          resolve(response.access_token);
        }
      },
      error_callback: (error) => {
        const messages: Record<string, string> = {
          popup_closed: 'The Google sign-in window was closed.',
          popup_failed_to_open: 'The browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
        };
        reject(new Error(messages[error.type] ?? error.message ?? error.type));
      },
    });
    // prompt '' = only ask for permission if the user has not agreed before.
    client.requestAccessToken({ prompt: '' });
  }).finally(() => { pending = null; });
  return pending;
}
