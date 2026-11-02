# Setting up Google sign-in

Tilde needs an OAuth client ID from Google so that people can sign in and
store projects in their own Drive. You do this once. It is free, and no
client secret or API key is needed.

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
   accounts can sign in. That is fine until Milestone 6.

## 4. Create the client ID

1. Open **Clients** (older consoles: **APIs & Services → Credentials →
   Create credentials → OAuth client ID**).
2. Application type: **Web application**. Name: `Tilde`.
3. **Authorized JavaScript origins:** add `http://localhost:5173`.
   This must match the address in your browser exactly, including the port.
   (If `npm run dev` ever says it uses another port such as 5174, either stop
   the other dev server or add that address here too.)
   Leave **Authorized redirect URIs** empty.
4. Click **Create**. Copy the **Client ID**. It ends in
   `.apps.googleusercontent.com`. You do not need the client secret; do not
   put it anywhere in the repository.

## 5. Put the client ID into Tilde

Open `src/config.ts` and paste it between the quotes:

```ts
export const GOOGLE_CLIENT_ID = '1234-abcd.apps.googleusercontent.com';
```

The client ID is public by design, so committing it is fine.

Changes to origins can take a few minutes to work at Google. If sign-in says
`origin_mismatch` or `invalid_client`, wait five minutes and try again.

## Later (Milestone 6)

When the site is on GitHub Pages, add its address (for example
`https://birdortyedi.github.io`) as another Authorized JavaScript origin, and
submit the app for verification.
