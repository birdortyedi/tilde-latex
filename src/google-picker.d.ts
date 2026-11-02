// Types for the small part of the Google Picker that Tilde uses. The library
// itself is loaded by picker.ts from https://apis.google.com/js/api.js.
declare namespace google.picker {
  const ViewId: { DOCS: string; FOLDERS: string };
  const DocsViewMode: { LIST: string };
  const Feature: { MULTISELECT_ENABLED: string };

  class DocsView {
    constructor(viewId?: string);
    setIncludeFolders(include: boolean): DocsView;
    setSelectFolderEnabled(enabled: boolean): DocsView;
    setMode(mode: string): DocsView;
    setMimeTypes(mimeTypes: string): DocsView;
  }

  interface Picker {
    setVisible(visible: boolean): void;
    dispose(): void;
  }

  interface PickerResponse {
    action: string; // "picked", "cancel" or "loaded"
    docs?: { id: string; name: string; mimeType: string }[];
  }

  class PickerBuilder {
    addView(view: DocsView): PickerBuilder;
    enableFeature(feature: string): PickerBuilder;
    setOAuthToken(token: string): PickerBuilder;
    setDeveloperKey(key: string): PickerBuilder;
    setAppId(projectNumber: string): PickerBuilder;
    setTitle(title: string): PickerBuilder;
    setCallback(callback: (response: PickerResponse) => void): PickerBuilder;
    build(): Picker;
  }
}

declare const gapi: {
  load(library: string, options: { callback: () => void; onerror?: () => void }): void;
};
