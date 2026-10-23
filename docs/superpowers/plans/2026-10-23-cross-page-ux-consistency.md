# Cross-page UX consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align login/logout, demo, export, error recovery, accessibility feedback, and factual copy across all Needledrop user-facing pages.

**Architecture:** Keep the existing route and component architecture. Make localized UI/helper changes with tests, preserving current API contracts unless a failing contract test proves a change is necessary. Sequence shared layout/header work after page-level feedback decisions to avoid overlapping edits.

**Tech Stack:** Next.js 16.4.2 App Router, React 19.3.1, TypeScript 6, Tailwind CSS 4, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-23-cross-page-ux-consistency-design.md`

## Global Constraints

- No new dependencies.
- Google sign-in is not required for search, discovery, curation, export, Settings, or anonymous-data deletion.
- YouTube-account features require a valid Google session and relevant permission.
- Demo mode must never imply that a real YouTube playlist was created.
- Do not automatically create a playlist after OAuth; require an explicit user action.
- Preserve the existing design system and API contracts unless tests establish a necessary correction.
- Before changing any Next.js-specific API or convention, read the relevant guide under `node_modules/next/dist/docs/`.
- Behavior changes follow TDD: test first, observe failure, implement, verify.

## Review Focus

- OAuth return with valid, missing, malformed, or stale draft data must not lose the user's current work or trigger a write automatically.
- Demo mode, OAuth-unconfigured, signed-out, signed-in, expired-session, and permission-denied states must not be conflated.
- Privacy deletion via memory fallback must not claim persisted database rows were deleted.
- A metadata-only playlist update must not erase existing tags unless tag changes are explicit.
- Repeated clicks during async destructive or reorder operations must not issue duplicate mutations.

---

## File structure / ownership

- `components/generator.tsx` and generator-specific tests: OAuth draft restore, auth/demo readiness, public confirmation, accessible errors.
- `components/settings/*` and their tests: Settings retry, preset policy, pending/error behavior.
- `components/library/*` and library/editor tests: retry/recovery, back navigation, mutation lock, status accessibility. `lib/youtube/playlist-lifecycle.ts` only if a contract test proves tag preservation is defective.
- `components/privacy/data-controls.tsx`, `app/privacy/page.tsx` and tests: contextual logout and accurate deletion outcome.
- `components/sections/faq.tsx` and copy tests: factual copy corrections.
- `components/site-header.tsx`, `app/globals.css`, header tests: keyboard and anchor navigation only where verified. Shared `app/layout.tsx` changes are a final, separate integration task.
- `app/robots.ts`, `app/sitemap.ts`, `app/manifest.ts`, canonical metadata: verify and document current policy; modify only after evidence/product policy identifies a defect.

### Task 1: Generator auth/demo flow and OAuth draft recovery

**Files:**
- Modify: `components/generator.tsx`
- Create: focused draft/auth tests under `tests/unit/`
- Optional only if required: a small pure helper under `lib/` and matching test

**Interfaces:** use existing `/api/auth/session` fields (`signedIn`, `configured`, `liveApi`) and `/api/quota` demo state; retain callback query contract `auth=ok|failed`.

- [ ] Add failing tests for CTA states (loading, signed out live, signed in live, demo, OAuth unavailable) and versioned draft serialization/restore (valid, malformed/unknown version).
- [ ] Run focused tests and verify failures are caused by missing behavior.
- [ ] Implement the smallest validated `sessionStorage` snapshot and restore flow; do not persist credentials or auto-submit create.
- [ ] Add visible auth callback success/failure and preserve the draft on failed OAuth.
- [ ] Add an explicit confirmation before creating a public playlist and accessible error/status announcements.
- [ ] Run focused tests, then `npm test`, `npm run typecheck`, and `npm run lint`.

### Task 2: Settings behavior and recovery

**Files:**
- Modify as needed: `components/settings/presets-panel.tsx`, `blocks-panel.tsx`, `quota-panel.tsx`, `api-key-panel.tsx`, `data-panel.tsx`
- Create focused Settings tests under `tests/unit/`

**Decision:** Settings must not save an empty `{}` preset as a usable configuration. Keep preset creation in the generator, and make Settings manage existing presets only; if no presets exist, direct users to save a real configuration from Tune.

- [ ] Add failing tests for retry after failed panel load, empty preset state/no empty save, and pending state preventing duplicate delete actions.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement retry controls for failed initial loads and pending guards for destructive actions; preserve current inline feedback pattern.
- [ ] Explain quota units in user-facing terms and distinguish shared deployment budget from a visitor's own API key where current data supports that distinction.
- [ ] Run focused tests, then full tests/typecheck/lint.

### Task 3: Library/editor safety and recovery

**Files:**
- Modify: `components/library/library-view.tsx`, `components/library/playlist-editor.tsx`, `app/library/[playlistId]/page.tsx` only if appropriate
- Test: `tests/contract/playlist-write.test.ts` and new focused component/source tests
- Modify `lib/youtube/playlist-lifecycle.ts` only if contract test demonstrates loss of tags

- [ ] Add a failing contract test proving whether a title-only PATCH preserves existing tags; inspect `updatePlaylist` behavior and upstream request body.
- [ ] Add failing tests for retryable load errors, explicit 401/403 recovery, Back to library link, accessible status, and duplicate mutation suppression.
- [ ] Run focused tests and confirm expected failures.
- [ ] Fix only proven tag-loss; add clear back navigation, retry where appropriate, differentiated auth/permission guidance, pending locks, and live status announcements.
- [ ] Run focused and full tests/typecheck/lint.

### Task 4: Privacy and deletion/logout accuracy

**Files:**
- Modify: `components/privacy/data-controls.tsx`, `app/privacy/page.tsx`
- Create: focused tests under `tests/unit/`

- [ ] Add failing tests for signed-out logout visibility, logout pending/error handling, delete cancellation, and displaying actual `{deleted, store}` result.
- [ ] Run focused tests and confirm expected failures.
- [ ] Make logout contextual while keeping anonymous-data deletion available to all; use precise delete language and report the returned store/counts without claiming a fallback memory delete purged unavailable Postgres rows.
- [ ] Preserve the existing logout redirect contract and local session clearing semantics.
- [ ] Run focused and full tests/typecheck/lint.

### Task 5: Landing copy and public claims

**Files:**
- Modify: `components/sections/faq.tsx`, `components/sections/features.tsx`, `components/hero.tsx` only where needed
- Create: `tests/unit/landing-copy.test.ts`

- [ ] Add failing tests for truthful API-key location/use, discovery-vs-write estimate, partial playlist behavior, demo limitation, public confirmation, and metadata-only statement.
- [ ] Run focused tests and confirm expected failures.
- [ ] Correct copy using verified code behavior; avoid hardcoding a universal total where estimates vary.
- [ ] Run focused and full tests/typecheck/lint.

### Task 6: Header/navigation/accessibility and cross-page feedback

**Files:**
- Modify if verified: `components/site-header.tsx`, `app/globals.css`, `components/toaster.tsx`, page-level toaster mounts
- Tests: extend `tests/unit/site-header.test.ts`; add focused navigation/toaster tests where testable

- [ ] Add failing tests for anchor targets/offset, Escape closing the mobile menu, menu link close behavior, and single global toaster if actions outside Home/Privacy require it.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement only behavior supported by tests; if moving toaster, mount one instance in the shared shell and remove page duplicates.
- [ ] Check mobile/desktop keyboard flow and cross-route anchor behavior in a browser; record manual results.
- [ ] Run focused and full tests/typecheck/lint.

### Task 7: SEO/PWA/metadata verification and final validation

**Files:**
- Inspect and modify only when proven necessary: `app/layout.tsx`, `app/not-found.tsx`, `app/library/[playlistId]/page.tsx`, `app/robots.ts`, `app/sitemap.ts`, `app/manifest.ts`
- Add focused route metadata tests only for behavior changed.

- [ ] Verify generated `robots.txt`, sitemap, manifest, page metadata/canonical, and 404 status using a local production build; do not change indexation or canonical policy based on speculation.
- [ ] Correct only demonstrated inaccuracies; do not add service worker/offline claims.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- [ ] Manually verify key flows at mobile and desktop sizes: logged out, logged in, expired/denied session, demo/unconfigured service, OAuth return, export, and playlist editor.
- [ ] Report any environment-dependent browser/OAuth cases that cannot be exercised locally.

## Verification commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Manual browser verification is required for visual layout, focus movement, anchor offsets, and OAuth round-trip; these are not established by the existing Node-only Vitest configuration.
