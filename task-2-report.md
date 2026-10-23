# Task 2: Settings panel retry recovery

## Scope

Updated only the presets, blocks, API-key, and quota settings panels, plus `tests/unit/settings-panels.test.ts`.

## Findings and changes

All four loader effects were triggered again when `loadAttempt` changed, but they retained the previous `loading` and `error` state. As a result, retry could leave the old error UI visible and would not immediately indicate that a new fetch was running. Each effect now sets loading to `true` and clears its old error before starting the request. Existing success handling renders fetched state; existing failure handling keeps the error/retry UI available.

Added focused source checks for the retry reset sequence and the success/failure/retry state handling for each panel.

## Verification

- Regression test red before the component changes: 4 cases failed (one per affected panel).
- Focused settings-panel test after component changes: 9 passed.
- Full test suite: 36 files and 456 tests passed.
- Typecheck: `npm run typecheck` passed.
- Settings lint: ESLint passed on the four panels and focused test.
- Diff whitespace check: `git diff --check` passed.
