import { getAccessToken } from './auth';
import { GOOGLE_API_KEY, GOOGLE_PROJECT_NUMBER } from './config';

// The Google Picker: Google's own window for choosing files in Drive. With
// the drive.file permission, picking a file there is what lets Tilde read it.

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
}

let loading: Promise<void> | null = null;

function loadPicker(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const failed = () => {
      loading = null;
      reject(new Error('Could not load the Google Picker. Check your connection and try again.'));
    };
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = () => gapi.load('picker', { callback: resolve, onerror: failed });
    script.onerror = failed;
    document.head.append(script);
  });
  return loading;
}

// Opens the Picker and resolves with the chosen files (none if cancelled).
// With `inFolder`, it opens in that Drive folder.
export async function pickDriveFiles(title: string, inFolder?: string): Promise<PickedFile[]> {
  return openPicker(title, true, (view) => {
    const configured = view
      .setIncludeFolders(true) // to browse into folders
      .setSelectFolderEnabled(false); // picking a folder would not give access to its files
    return inFolder ? configured.setParent(inFolder) : configured;
  });
}

// Opens the Picker for choosing one folder, e.g. where the projects live.
export async function pickDriveFolder(title: string): Promise<PickedFile | null> {
  const [folder] = await openPicker(title, false, (view) => view
    .setIncludeFolders(true)
    .setSelectFolderEnabled(true)
    .setMimeTypes('application/vnd.google-apps.folder'));
  return folder ?? null;
}

async function openPicker(title: string, several: boolean, configure: (view: google.picker.DocsView) => google.picker.DocsView): Promise<PickedFile[]> {
  if (!GOOGLE_API_KEY) throw new Error('No Google API key yet. Put it in the file .env.local and restart npm run dev (see docs/google-picker-setup.md).');
  const token = await getAccessToken();
  await loadPicker();
  return new Promise((resolve) => {
    let picker: google.picker.Picker | null = null;
    // Close the Picker first, then hand over the files on the next turn, so
    // whatever Tilde asks next is not hidden behind it.
    const finish = (files: PickedFile[]) => {
      picker?.setVisible(false);
      picker?.dispose();
      setTimeout(() => resolve(files), 0);
    };
    const view = configure(new google.picker.DocsView(google.picker.ViewId.DOCS).setMode(google.picker.DocsViewMode.LIST));
    let builder = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setAppId(GOOGLE_PROJECT_NUMBER)
      .setTitle(title)
      .setCallback((response) => {
        if (response.action === 'picked') finish(response.docs ?? []);
        if (response.action === 'cancel') finish([]);
      });
    if (several) builder = builder.enableFeature(google.picker.Feature.MULTISELECT_ENABLED);
    picker = builder.build();
    picker.setVisible(true);
  });
}

// Google Docs, Sheets and so on have no file content Tilde could use.
export const isGoogleDoc = (file: PickedFile): boolean =>
  file.mimeType.startsWith('application/vnd.google-apps.');
