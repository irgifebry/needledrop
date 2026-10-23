# Cross-page UX consistency design

## Intent

Make Needledrop's logged-out, logged-in, demo, and error experiences consistent across every user-facing page. Users should be able to explore, curate, export, and use visitor-level settings without Google sign-in; Google sign-in is only for YouTube-account features.

## Goals

- Explain clearly when a real YouTube playlist can and cannot be saved.
- Preserve a user's generator draft over the Google OAuth round-trip.
- Make login/session, permission, loading, error, retry, and destructive-action states understandable and recoverable.
- Align landing/FAQ/privacy copy with verified application behavior.
- Improve navigation/accessibility without changing the visual identity or introducing unnecessary dependencies.
- Keep Settings, export, and anonymous-data deletion usable while logged out.

## Non-goals

- Redesigning the site or changing its brand, palette, typography, or content architecture.
- Changing YouTube quota algorithms, playlist-write semantics, OAuth scopes, or data retention policy without evidence.
- Adding offline/PWA support, a service worker, or new persistent user accounts.
- Changing SEO/indexation policy absent an explicit product decision.

## User flows

### Logged out

1. Search/select a seed; tune discovery; inspect, preview, and curate tracks.
2. Export the tracklist at any point in Build/Done.
3. Use Settings for visitor API key, quota, presets, blocks, and anonymous-data controls.
4. Library explains that Google sign-in is required. Choosing Save in a live, configured environment starts OAuth, preserves the draft, and returns the user to an explicit Continue saving action.
5. In demo or unconfigured OAuth mode, explain the limitation and offer export rather than implying that sign-in will create a real playlist.

### Logged in

1. All logged-out capabilities remain available.
2. Library comparison is offered only after the library index loads successfully; errors distinguish expired session, missing permission, and retryable failures.
3. Save/manage YouTube playlists only when the session and service are ready. After mutations, provide visible and screen-reader-accessible status.
4. Logout is shown contextually and updates the UI; anonymous-data deletion remains separate and available regardless of login.

## Cross-page design rules

- Treat auth status as `loading | signedOut | signedIn | unavailable/error`; a cookie's presence alone is not proof that the session is valid.
- Treat service readiness separately from auth: demo, OAuth unconfigured, live but signed out, and live signed in are distinct states.
- Do not erase a generator draft during OAuth. Store only a versioned, validated, non-secret snapshot in `sessionStorage`; clear it after successful restore and never automatically create a playlist after callback.
- Export remains independent of login and network writes.
- Explain quota estimates as estimates, separating discovery and playlist-write cost. Do not promise fixed calls/costs or zero partial writes.
- Privacy deletion copy describes exactly the anonymous app data deleted, the selected store, and exclusions (YouTube playlists, Google session, separate API key).
- Keep public/unlisted/private changes explicit and confirm a public write before mutation.
- Async and error feedback must be visible, non-duplicative, and announced appropriately to assistive technology.
- Preserve existing design and use local Next.js 16 documentation before changing Next-specific APIs.

## Accepted corrections from audit

- Correct FAQ/API-key location, quota explanation, partial playlist behavior, demo limitations, and public-visibility confirmation claims based on code.
- Improve Settings retry and empty-preset behavior; avoid representing `{}` as a usable configuration.
- Improve Library/editor recovery, return navigation, pending mutation protection, and status announcements.
- Improve Privacy logout/delete contextual states and truthful delete result messaging.
- Improve mobile navigation keyboard handling and global cross-page feedback only where current use requires it.
- Verify rather than assume suspected tag-loss, SEO canonical, sitemap timestamp, PWA, and visual fixed-header issues; only change them when tests/evidence establish a defect or the current policy is explicit.

## Constraints and decisions

- Existing stack only: Next.js 16 App Router, React 19, TypeScript, Tailwind 4, Vitest. Do not add dependencies for this work.
- Use TDD for behavior changes: add a test, observe the intended failure, implement the smallest fix, then rerun focused and full checks.
- Keep changes separated by subsystem and avoid concurrent edits to shared files. The integration owner coordinates implementation and review.
- The audit is static source inspection; browser-level visual/keyboard checks remain required where interaction cannot be demonstrated by existing Node-only tests.

## Success criteria

- Users can distinguish export, demo, and real YouTube save paths before committing.
- OAuth does not discard the in-progress generator draft and callback status is surfaced.
- All user-facing pages have truthful login/session/error states, with no unnecessary login gate on visitor features.
- Verified copy contradictions are corrected; uncertain findings are either proven and fixed or explicitly left unchanged.
- Focused tests, full Vitest suite, typecheck, lint, and production build pass; manual browser checks are reported separately.
