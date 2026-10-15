# Frontend finish progress (Phase 6 → Phase 7)

Resume file for the finishing session. Updated after every completed group.

## Setup

- Work happens in worktree `.claude/worktrees/phase6-finish` on branch
  `fix/dashboard-followups-finish`, branched from `fix/dashboard-followups`
  @ `cc13feb90b` plus the uncommitted worker changes carried over.
- `web/node_modules` is a directory junction to the main checkout's
  `web/node_modules` (no package changes).
- Item status lives in the main checkout's `.runner/state.json` (gitignored).
  Finishing notes are appended as `FINISH: <status> | <note>`.

## Step 0 — cleanup

- [x] `git reset` in the main checkout (all files unstaged, kept on disk).
- [x] Deleted unreferenced one-off configs/scripts from `web/`:
  `destination-profile-item.vitest.config.mts`, `redaction-browser-check.mjs`,
  `redaction-verification.config.mts`, `redis-signals-verification.config.mts`,
  `regen-methodology.verify.config.mts`, `weekly-digest-verification.config.mjs`,
  `src/features/driving/components/fsd-insights/FsdMethodologyNotes.vitest.config.mts`
  (`wait-oracle-f07.temp.config.mts` was already gone from disk).
- [x] Test infra: `split-i18n-catalog --check` took ~2m15s because
  `validateManifest` re-ran every bundle check once per catalog namespace; it
  also ran as a Vite `buildStart` plugin on every Vitest start. That 2+ minute
  silent startup is why earlier workers saw "vitest produced no output" stalls.
  Fixed (check now ~12s, skipped under Vitest; Vitest starts in ~2s).
- [ ] Review uncommitted change groups (in progress).
- Not carried over / left alone: `apps/mobile/android/gradle/wrapper/gradle-wrapper.properties`
  (unrelated Gradle 9 bump from local tooling), `tools/claude.ps1`,
  `tools/run-workers.ps1` (local runner scripts).

## Step 1 — Phase 6 items

Not started.

## Step 2 — Phase 7 gates

Not started.

## Step 3 — close out

Not started.
