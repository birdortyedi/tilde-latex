// The OAuth client ID from Google Cloud Console (see docs/google-setup.md).
// It is public by design (anyone can read it in the page source), so it is
// safe to commit. It looks like "1234-abcd.apps.googleusercontent.com".
export const GOOGLE_CLIENT_ID = '1028852536505-ev0lg2ibjhmrd3mtofr7gl829m7b0jsq.apps.googleusercontent.com';

// For the Google Picker (see docs/google-picker-setup.md). The API key is
// not kept in the repository: it comes from the file .env.local on this
// computer, which Git ignores (and in Milestone 6 from a GitHub secret).
// The project number is the number the client ID starts with.
export const GOOGLE_API_KEY: string = import.meta.env.VITE_GOOGLE_API_KEY ?? '';
export const GOOGLE_PROJECT_NUMBER = '1028852536505';
