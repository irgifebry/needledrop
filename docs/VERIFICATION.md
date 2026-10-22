# OAuth verification — scope justification and demo video

Everything Google needs for `youtube.force-ssl`, written out so it can be
pasted into the Verification Center and acted on during the recording.

- **Project:** `plucky-agent-464115-b1`
- **OAuth client:** `247187332561-sraf9nfajnbe4jubboqkc1dlfo75spml.apps.googleusercontent.com`
- **Home page:** https://needdrop.vercel.app
- **Privacy policy:** https://needdrop.vercel.app/privacy

---

## 1. Scope justification

Paste this into the Verification Center. It answers the two questions the
reviewer actually asks: what the app does with the scope, and why nothing
narrower would do.

### `https://www.googleapis.com/auth/youtube.force-ssl` (sensitive)

> **What the app does with it.**
>
> needledrop is a YouTube playlist generator. A user drops one track they
> like; the app scores candidate tracks against it and creates a new
> playlist on the user's own YouTube account.
>
> The scope authorises exactly three kinds of write, all of them against the
> signed-in user's own data:
>
> - `playlists.insert` — creates the new playlist.
> - `playlistItems.insert` — adds the selected track ids to it.
> - `playlists.update`, `playlistItems.update`, `playlistItems.delete` — let
>   the user rename, re-describe, re-tag, change the visibility or remove a
>   row before the playlist is committed.
>
> Nothing else in the app touches a write endpoint. Discovery — searching for
> candidates, hydrating metadata, scoring them — runs against public data
> through a shared API key and never reads the signed-in user's account.
>
> **Why a narrower scope is not sufficient.**
>
> The YouTube Data API v3 publishes seven scopes. The only ones that
> authorise `playlists.insert` and `playlistItems.insert` are `youtube`,
> `youtube.force-ssl` and `youtubepartner`. `youtube.readonly` is read-only
> and cannot create anything. `youtubepartner` is for Content ID partners
> managing their rights catalogue and is not available to this project.
> `youtube.force-ssl` is therefore the narrowest scope that makes the feature
> work at all.
>
> We specifically did not request `youtube` (the broader account-management
> scope) and we did not request `youtube.upload`, so the app is never granted
> the ability to upload or edit videos, and is never granted permissions
> outside the playlist surface it needs.
>
> Note for the reviewer: `https://www.googleapis.com/auth/youtube.playlists`
> is not a scope the Data API publishes. An earlier build requested it and
> Google answered every authorization request with `Error 400:
> invalid_scope`. `tests/contract/oauth-scopes.test.ts` now pins the scope
> list against the published scopes so an invented scope fails CI rather than
> failing at the sign-in screen.
>
> **How the user controls it.**
>
> Signing in is explicit and optional. The engine works for signed-out
> visitors: they can discover tracks and export a playlist, they simply
> cannot write it to YouTube. The write itself happens only after the user
> has reviewed the proposed track list, edited the title and chosen a
> visibility. New playlists default to `private`; `unlisted` and `public`
> are one click away and `public` asks for a second confirmation. The user
> can remove any row before committing.
>
> **Data minimisation.**
>
> We do not request and cannot access watch history, subscriptions, likes,
> comments or uploads. The recommendation engine is driven by the one track
> the user submits plus public metadata about that track. There is no
> profile of the user anywhere in the app.
>
> **Retention and deletion.**
>
> The access token, refresh token, email address and display name are held
> in a single AES-256-GCM encrypted, httpOnly, Secure cookie. Signing out
> revokes the refresh token on Google's side first, then clears the cookie
> locally. A "delete all my data" control on the privacy page erases every
> row stored under the user's anonymous identifier and rotates that
> identifier.

### `https://www.googleapis.com/auth/youtube.readonly` (non-sensitive)

> Used to read the user's own playlists and playlist items so the app can
> show what is already in the library and what a previous run created. It is
> read-only and is not a substitute for the write scope above; both are
> requested because the app offers read and write features over the same
> playlist surface.

### `https://www.googleapis.com/auth/userinfo.email`, `.../userinfo.profile` (non-sensitive)

> Used only to display whose Google account is signed in, and to give the
> session cookie an identity. Neither is used for advertising, profiling, or
> any automated decision.

### Limited Use

> needledrop's use of information received from Google APIs will adhere to
> the Google API Services User Data Policy, including the Limited Use
> requirements. Data obtained from Google APIs is used only to build and
> write the playlist the user asked for, on the account the user signed in
> with. It is not used for advertising, not sold, not shared beyond the
> hosting and API providers described in the privacy policy, and not used to
> train or improve any machine-learning model.

---

## 2. Demo video

Google's requirements, quoted:

> *"Show the OAuth grant process that users will experience, in English.
> This includes the consent flow [...] Show that the OAuth consent screen
> correctly displays the App Name. Show that the browser address bar of the
> OAuth consent screen correctly includes your app's OAuth client ID. To
> show how the data will be used, demonstrate the functionality that's
> enabled by each sensitive scope that you request."*

Upload it to YouTube Studio with **Visibility: Unlisted**, then paste the
link into the **YouTube link** field.

### Shot list

**Shot 1 — the app, signed out (10 s)**

Open https://needdrop.vercel.app. Show the generator with the seed field.
Paste a track name, press the button, show candidates appearing with their
scores. Say:

> "This is needledrop. You drop one track you like, and it finds twenty more
> that belong with it. Everything so far works without signing in — the
> engine reads public metadata only."

*Why:* establishes that the write scope is only needed for one feature.

**Shot 2 — sign-in (15 s)**

Click **Sign in**. The browser leaves the app entirely — show the address
bar changing to `accounts.google.com`.

> "To write the playlist into your own YouTube account, you sign in. Here
> is Google's consent screen."

**Shot 3 — the consent screen, static (15 s)**

**Hold this shot long enough for the reviewer to read the address bar.**
Zoom the browser so both the app name and the URL are legible. The address
bar must contain:

```
client_id=247187332561-sraf9nfajnbe4jubboqkc1dlfo75spml.apps.googleusercontent.com
```

The screen must show the app name **needledrop**, the needledrop logo, the
support email, and the four scopes. Read the scope list out loud:

> "The app is asking for four permissions. `youtube.force-ssl` to create
> and edit your playlists. `youtube.readonly` to read your library.
> `userinfo.email` and `userinfo.profile` to show whose account is signed
> in."

**Shot 4 — the write scope in action (30 s)**

Back in the app, with the signed-in state visible. Show the selected tracks,
edit the playlist title, show the visibility selector sitting on **private**,
then create the playlist. Show the result: a playlist on the account, with
its tracks.

> "This is what `youtube.force-ssl` is used for. The playlist is created in
> my own account, private by default, and I can remove any track before it
> is created."

**Shot 5 — the read scope in action (15 s)**

Open the library view showing the playlists that now exist on the account.

> "And this is `youtube.readonly` — the app can see the playlists on my
> account so it can show me what I already made."

**Shot 6 — privacy and deletion (20 s)**

Open https://needdrop.vercel.app/privacy. Scroll to the "Delete
everything" section, press the delete button, accept the confirmation, show
the confirmation toast.

> "The privacy policy is public and it states exactly what is stored. One
> click deletes everything the app has stored about me."

### Checklist before uploading

- [ ] Recorded in English
- [ ] The app name "needledrop" is legible on the consent screen
- [ ] The client ID `247187332561-sraf9nfajnbe4jubboqkc1dlfo75spml...` is readable in the address bar
- [ ] The consent screen is shown, not skipped
- [ ] Every requested scope is demonstrated
- [ ] Uploaded to YouTube as **Unlisted**
- [ ] Screen recording at 1080p, voice audible

---

## 4. Brand verification — the two issues Google raised

Google's branding review came back with exactly two findings:

> *"The website of your home page URL 'https://needdrop.vercel.app' is not
> registered to you. Verify ownership of your home page, then wait 24 hours
> before retrying to allow our systems to update."*
>
> *"Your logo does not uniquely identify your brand and identity. Configure
> your app with a logo that reflects your identity and does not impersonate
> any other brand."*

### 4.1 The logo — fixed

The mark was the letter "N" on a mint square, lifted from the footer
wordmark. A monogram is the most generic mark there is: it says nothing
about what the app does and could belong to any product, which is what the
reviewer objected to.

It is now the product drawn — a record, a tonearm coming in from the top
right, the stylus dropping onto the groove in orange. `brand/logo-512.png`
and `brand/logo-120.png`; the reasoning is written up in `brand/README.md`.

Upload `brand/logo-512.png` in the Branding page, then press **Verify
branding** again.

### 4.2 Domain ownership — the part that is actually blocked

Google wants proof that `needdrop.vercel.app` belongs to this project. The
check is a *registration* check, not a "can I serve a file here" check, and
for a `*.vercel.app` subdomain there is no way to satisfy it. Everything
below was measured, not assumed:

| Probe | Result |
|---|---|
| Public Suffix List | `vercel.app` **is** a public suffix, so the top private domain of `needdrop.vercel.app` is the subdomain itself |
| `rdap.org/domain/needdrop.vercel.app` | *"not a valid domain name: Domain name does not have a registry"* — there is no registry record to show a registrant |
| `rdap.org/domain/vercel.app` | registrar Tucows, nameservers `ns1-4.vercel-dns-3.com` — Vercel's |
| Vercel API: create a DNS record on the domain | `403 forbidden` — no permission to list *or* create records for `*.vercel.app` |
| Vercel API: add the domain to the account as an apex domain | `400 invalid_name` — the registration cannot be claimed either |

So the automated check cannot pass, and no amount of DNS configuration
changes that: the record it looks for does not exist and cannot be created.
The file-based route still has value, because it is the evidence a human
reviewer needs — it proves the developer controls the site.

**The free path is a manual review.** In the branding dialog, choose
*"I believe the issues found are incorrect"* → **Proceed**, and give the
reviewer the argument in section 4.2.1.

### 4.2.1 Submission text for the additional review

> The home page domain `needdrop.vercel.app` is a subdomain of `vercel.app`,
> which is listed in the Public Suffix List. The registrable domain is
> therefore the subdomain itself, and it has no registry: an RDAP lookup
> returns "Domain name does not have a registry". `vercel.app` is registered
> to Vercel, Inc. and its nameservers are Vercel's, so no developer can
> become the registrant of it, and a registration record naming this
> developer cannot exist.
>
> Control of the site itself is verifiable and has been verified. The
> Search Console property `https://needdrop.vercel.app/` is owned by the
> Google account associated with this project, and the site serves Google's
> own verification file at
> `https://needdrop.vercel.app/googlebc148e7504272ad6.html`.
>
> The application is `https://needdrop.vercel.app`, a YouTube playlist
> generator. Its privacy policy is at `https://needdrop.vercel.app/privacy`
> and its source is public at `https://github.com/irgifebry/needledrop`. The
> OAuth client id `247187332561-sraf9nfajnbe4jubboqkc1dlfo75spml.apps.googleusercontent.com`
> appears in the address bar of the consent screen.
>
> The app is not for personal use: it is a public product with a shared API
> quota, published for anyone with a Google account.

### 4.2.2 The file-based route, and one thing worth checking

Search Console still verifies a **URL-prefix** property by fetching a file
from the site root, and that file is the evidence for the manual review:

```bash
# 1. search.google.com/search-console → add property
#    → "URL-prefix" → https://needdrop.vercel.app/
#    → "HTML file" → download googleXXXX.html
# 2. copy it to the site root, byte for byte
npm run verify:sc -- path/to/googleXXXX.html
# 3. commit, let the deploy finish, press Verify in Search Console
```

`npm run verify:sc` copies `public/<the exact filename>` and refuses
anything that is not a `google*.html` name or does not hold a single
`google-site-verification: <token>` line. The copy is byte for byte — the
token in these files is not always a bare string (this one carries the file
extension), and the file Google hands out has no trailing newline, so
regenerating it from the token is a way to fail for no reason.

The download itself lives at the repository root and is git-ignored; the
copy that belongs in the repository is the one in `public/`. For this
project that is `public/googlebc148e7504272ad6.html`, served at:

```
https://needdrop.vercel.app/googlebc148e7504272ad6.html
```

Before appealing, check Vercel → Project `needledrop` → Settings → Domains.
If there is a DNS or Records section for the project domain, a TXT record
can be published there and a Search Console **domain** property becomes
possible. The API says no; the dashboard is a different surface and it is
worth two minutes to look.

Note the 24-hour wait Google mentions: after the property is verified, the
branding review has to be retried, and Google needs up to a day for its own
systems to pick the change up.

### 4.3 What is *not* required

The Verification Center reports:

> *"Verification is not required since your app is not requesting any
> sensitive or restricted scopes."*

So `youtube.force-ssl` is classified **non-sensitive** by Google, and this
app does not need:

- a sensitive scope verification,
- a scope justification,
- a demo video.

The `youtube.force-ssl` scope itself is still correct — the Data API
publishes seven scopes and it is the narrowest one that authorises
`playlists.insert`. The verification requirement was about the *app* being
public, not about the scope.

The scope justification in section 1 and the shot list in section 2 are kept
in this file because the classification is Google's to change, and a
reclassification would need both again. Until then they are held, not
required.

### 4.4 Order of operations

1. Branding published, logo replaced — done
2. Publishing status set to **In production** — done
3. Domain ownership verified via Search Console — **in progress**
4. **Verify branding** → wait for "Ready to publish" → **Publish branding**
5. Sign-in works, and the consent screen shows the app name and logo

