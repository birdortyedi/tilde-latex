# Setting up the Google Picker

The Google Picker is Google's own "choose files from your Drive" window.
Tilde uses it to import files that Tilde did not create (with the
`drive.file` permission, Tilde can only open files you pick yourself).
It needs one more value from Google Cloud: an **API key**. Do this once, in the same Google Cloud project as the
client ID (see `docs/google-setup.md`).

## 1. Turn on the Picker API

1. Open https://console.cloud.google.com and select the `Tilde` project.
2. Open **APIs & Services → Library**, search for **Google Picker API**,
   open it and click **Enable**.

## 2. Create an API key, limited to Tilde

1. Open **APIs & Services → Credentials → Create credentials → API key**.
2. Click the new key to edit it. Name it `Tilde Picker`.
3. **Application restrictions:** leave at **None** for now. With
   **Websites** set to `http://localhost:5173/*`, the Picker refused the key
   ("The API developer key is invalid"), because Google checks it from its own
   Picker window, not from Tilde's page. To be revisited in Milestone 6.
4. **API restrictions:** choose **Restrict key** and tick only
   **Google Picker API**.
5. Save, and copy the key (it starts with `AIza`).

With the API restriction the key only works for the Picker, which is free. Like the client ID, it is visible in the page anyway,
so it may be committed. Do **not** link a billing account to this
Google Cloud project; the Picker is free and needs none.

## 3. Put the key into Tilde

In `src/config.ts`, paste the key between the quotes:

```ts
export const GOOGLE_API_KEY = 'AIza...';
```

`GOOGLE_PROJECT_NUMBER` is already filled in: it is the number your client
ID starts with. (You can check it on the Google Cloud **Dashboard**.)

Changes can take a few minutes to work at Google. If the Picker says
"The API developer key is invalid", wait five minutes and try again.
