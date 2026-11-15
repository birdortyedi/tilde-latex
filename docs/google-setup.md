# Setting up Google sign-in

Tilde needs an OAuth client ID from Google so that people can sign in and
store projects in their own Drive. Tilde comes with one, so **you only need
this guide if you want your own** (for example for a changed copy of Tilde).
You do this once. It is free, and no client secret or API key is needed.

## 1. Create a Google Cloud project

1. Open https://console.cloud.google.com and sign in with your Google account.
2. In the project menu at the top, choose **New project**. Name it `Tilde`
   and create it. Make sure it is selected afterwards.

## 2. Turn on the Google Drive API

1. Open **APIs & Services → Library**.
2. Search for **Google Drive API**, open it and click **Enable**.

## 3. Describe the app (consent screen)

Open **Google Auth Platform** (older consoles call it **OAuth consent screen**)
and click **Get started** if asked.

1. **App information:** App name `Tilde · LaTeX editor`. If Google rejects the
   middle dot, use `Tilde LaTeX Editor`. Choose your email as support email.
2. **Audience:** **External**.
3. **Contact information:** your email. Accept the policy and create.
4. **Data access → Add or remove scopes:** tick only
   `https://www.googleapis.com/auth/drive.file`
   ("See, edit, create and delete only the specific Google Drive files you use
   with this app"). Save. Do not add any other Drive scope.
5. **Audience → Test users:** add your own Google account (and any other
   account you test with). While the app is in "Testing" status, only these
   accounts can sign in. That is fine for yourself; step 6 lets everyone sign in.

## 4. Create the client ID

1. Open **Clients** (older consoles: **APIs & Services → Credentials →
   Create credentials → OAuth client ID**).
2. Application type: **Web application**. Name: `Tilde`.
3. **Authorized JavaScript origins:** add `http://localhost:5173`.
   This must match the address in your browser exactly, including the port.
   (`npm run dev` always uses port 5173, and stops if something else has it.)
   Leave **Authorized redirect URIs** empty.
4. Click **Create**. Copy the **Client ID**. It ends in
   `.apps.googleusercontent.com`. You do not need the client secret; do not
   put it anywhere in the repository.

## 5. Put the client ID into Tilde

Create a file named `.env.local` in the `tilde-latex` folder (next to
`package.json`), or add to it, this line, then restart `npm run dev`:

```
VITE_GOOGLE_CLIENT_ID=1234-abcd.apps.googleusercontent.com
```

The client ID is public by design, but keeping it in `.env.local` lets you
pull updates of Tilde without changing any of its files. (Tilde's own client
ID is the default in `src/config.ts`.)

Changes to origins can take a few minutes to work at Google. If sign-in says
`origin_mismatch` or `invalid_client`, wait five minutes and try again.

## 6. Let other people sign in

While the app is in "Testing" status, only the test users from step 3 can
sign in. To let anyone who runs Tilde sign in:

1. Open **Google Auth Platform → Audience**.
2. Under **Publishing status**, click **Publish app** and confirm. The status
   becomes **In production**.

Tilde asks only for `drive.file`, which Google counts as a non-sensitive
permission, so publishing does not need Google's review. If the page says
otherwise, read what it asks for before going on.

## Later: a public website

When Tilde is on GitHub Pages, add its address (for example
`https://birdortyedi.github.io`) as another Authorized JavaScript origin, and
fill in the app's home page and privacy policy on the consent screen.
