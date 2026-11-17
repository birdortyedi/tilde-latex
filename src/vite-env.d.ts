// Settings Vite reads from .env.local (only names starting with VITE_ reach the app).
interface ImportMetaEnv {
  readonly VITE_GOOGLE_API_KEY?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

// The unpacked size of the TeX engine's data in bytes, or 0 (set in vite.config.ts).
declare const __ENGINE_DATA_BYTES__: number;
