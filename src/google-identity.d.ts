// Types for the small part of Google Identity Services that Tilde uses.
// The library itself is loaded by index.html from https://accounts.google.com/gsi/client.
declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    access_token: string;
    expires_in: number; // seconds
    scope: string;
    error?: string;
    error_description?: string;
  }

  interface TokenClient {
    requestAccessToken(override?: { prompt?: string }): void;
  }

  function initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type: string; message?: string }) => void;
  }): TokenClient;

  function hasGrantedAllScopes(response: TokenResponse, scope: string): boolean;

  function revoke(accessToken: string, done?: () => void): void;
}
