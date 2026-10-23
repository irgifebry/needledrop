# Task 1 lint follow-up

- Removed the unused `serializeGeneratorDraft` import from `components/generator.tsx`; draft serialization remains encapsulated by `storeGeneratorDraft`.
- Deferred auth callback restoration to a cancellable timer so state updates no longer occur synchronously inside the effect. `draftRestored` is set only after all saved snapshot fields are queued, preserving the existing guard against the draft-persistence effect overwriting the OAuth snapshot.
- Behavior tests cover serialization, parsing, and synchronous storage of the draft snapshot, but the `react-hooks/set-state-in-effect` lint constraint is static and cannot be represented meaningfully as a behavior test.
- Verification: `npx vitest run tests/unit/generator-flow.test.ts` passed (5 tests); `npx eslint components/generator.tsx --max-warnings=0` passed.

## Integration review: demo CTA safety

- Root cause: `getSaveCta()` returned `demo` for unconfigured/non-live API mode, while the CTA click handler only intercepted `sign-in`; demo therefore fell through into `runCreate()` and could POST `/api/playlist`.
- Added a pure `getSaveCtaAction()` decision helper and regression test. The test failed first because the helper was missing, then passed after implementation. CTA precedence also now classifies all non-live API cases as demo/export, even when OAuth itself is not configured; unavailable applies to live API without OAuth setup.
- Demo CTA now locally completes an explicitly labelled demo preview only (no playlist API call), requires at least one selected track, and offers the existing export options. CTA and helper copy state demo cannot save to YouTube. Live create and OAuth/draft-restore paths are preserved.
- Verification: `npx vitest run tests/unit/generator-flow.test.ts` passed (6 tests); `npm run typecheck` passed; `npx eslint components/generator.tsx lib/generator-flow.ts tests/unit/generator-flow.test.ts --max-warnings=0` passed.
