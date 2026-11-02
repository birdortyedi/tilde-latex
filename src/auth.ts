import { GOOGLE_CLIENT_ID } from './config';

// drive.file lets Tilde see only the files it created or the user picked.
// Never ask for a wider scope (see "Hard rules" in CLAUDE.md).
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

let token: { value: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;

// Returns a valid access token for Drive calls. Tokens last about an hour;
// when one is about to expire, Google is asked for a new one. That usually
// happens without any question to the user, since they agreed before.
export function getAccessToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt - 60_000) return Promise.resolve(token.value);
  return requestToken();
}

export function signIn(): Promise<string> {
  return requestToken();
}

// Withdraws Tilde's access, so the next sign-in asks the user again.
export function signOut(): void {
  if (token) google.accounts.oauth2.revoke(token.value);
  token = null;
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
    // prompt '' = do not ask again if the user already agreed.
    client.requestAccessToken(token ? { prompt: '' } : {});
  }).finally(() => { pending = null; });
  return pending;
}
