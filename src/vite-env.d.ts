// Settings Vite reads from .env.local (only names starting with VITE_ reach the app).
interface ImportMetaEnv {
  readonly VITE_GOOGLE_API_KEY?: string;
}
