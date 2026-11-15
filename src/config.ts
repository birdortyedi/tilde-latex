// The OAuth client ID from Google Cloud Console (see docs/google-setup.md).
// It is public by design (anyone can read it in the page source), so it is
// safe to commit. It looks like "1234-abcd.apps.googleusercontent.com".
// Someone running their own copy can use their own with VITE_GOOGLE_CLIENT_ID
// in the file .env.local.
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID
  || '108924248717-e88b8llno4pkou1o3bn5asb4os299p3d.apps.googleusercontent.com';

// For the Google Picker (see docs/google-picker-setup.md). The API key is
// not kept in the repository: it comes from the file .env.local on this
// computer, which Git ignores. Without it, everything but the Picker works.
export const GOOGLE_API_KEY: string = import.meta.env.VITE_GOOGLE_API_KEY ?? '';

// The Google Cloud project number: the number the client ID starts with.
export const GOOGLE_PROJECT_NUMBER = GOOGLE_CLIENT_ID.split('-')[0];
