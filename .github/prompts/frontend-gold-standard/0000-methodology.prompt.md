---
description: "TeslaSync Frontend Gold-Standard Rewrite — Mission (methodology)"
---

# TeslaSync Frontend Gold-Standard Rewrite — MISSION

> Same rigor/structure as the proven EVNest MUI-parity loop (personas, fleet
> parallelism, evidence-based gates, sharded manifests, self-healing audits,
> banned phrases, a hard stop condition) — adapted to TeslaSync's actual
> goal. This is **not** a new-framework parity rewrite in a side-by-side
> folder. TeslaSync's existing stack (React 19, Vite, TanStack Query,
> Tailwind) was already assessed as near-gold-standard; the mission is an
> **in-place modernization** of `web/` across 9 dependency-ordered programs.
> Branch: `refactor/frontend-gold-standard-rewrite`.

## GROUND TRUTH (verified this session — trust this, not any prior doc)

- App: `web/` (React 19.2 + Compiler, TS 5.4, Vite 5, React Router 7,
  Tailwind v4, TanStack Query, recharts→visx/uPlot in progress,
  react-leaflet→MapLibre GL in progress). Runs on :5173 (`npm run dev`).
- **164 pages** across **20 feature domains** — source of truth:
  `web/src/features/*/pages/*.tsx`.
- **~198 shared components** across 9 categories — source of truth:
  `web/src/components/{ui,charts,data-display,layout,feedback,forms,maps,motion,vehicles}/`.
- Commands (run from `web/`): `npm run dev` (:5173); `npm run build` (tsc &&
  vite build); `npm run lint` (eslint + i18n + ~28 custom audits); `npm test`
  (vitest). Gate: `bash scripts/frontend-gate.sh <files...>` (per-unit) or
  `bash scripts/frontend-gate.sh --full` (phase-boundary).
- Prompts: `.github/prompts/frontend-gold-standard/{p0..p8}-*/`. Runner:
  `.github/prompts/frontend-gold-standard/run-prompts.sh` (parallel
  worktrees — the fleet mechanism). Driver:
  `apps/tools/frontend-rewrite/frontend-loop.sh`. Generator:
  `apps/tools/frontend-rewrite/gen-frontend-prompts.mjs`.
- **599 prompts total**, tracked in `.github/prompts/frontend-gold-standard/logs/done.txt`
  and mirrored in the SQL `todos`/`todo_deps` tables (9 phase-level rows).

## WHY THIS NEEDS THE SAME RIGOR AS THE EVNEST LOOP

A real, critical bug was found and fixed THIS session, proving the point:
**`pp_integration_is_clean()` used `git diff --quiet`, which returned dirty
on a 100%-fresh checkout** because 6 tracked files had mixed CRLF/LF bytes
baked into their git blobs despite `.gitattributes` declaring `eol=lf`.
Every parallel merge attempt was at risk of falling through to
`integration worktree unrecoverable — merge skipped`, silently discarding
real, gate-passed work. Two units (`react-compiler-setup`,
`react-router-v7-upgrade`) were lost this way and had to be manually
recovered via `git cherry-pick` from their orphaned `auto/<runid>/<slot>`
branches. **Fixed at the root** (commit `60f264b1a`) by normalizing the
affected files. This is exactly the class of failure the gates below exist
to catch automatically, going forward, without a human having to notice.

## BANNED PHRASES (using any = the unit is NOT done, full stop)

"already polished", "verified systemically", "spot-checked N", "should be
fine", "no regressions so I left it", "looks the same", "diff not needed
here", "0 violations found" (without pasted grep/audit output), "tests
pass" (without pasted raw output), "TypeScript compiles clean" (without
`npx tsc --noEmit` output pasted), "waiting on human input", "paused for
review" — there is no human-in-the-loop step anywhere in Phases 0–8.

## PERSONAS

- **ORCHESTRATOR** (`frontend-loop.sh`, single conductor): owns the
  dependency-ordered phase sequence, the merge/integration mechanism, the
  self-healing audit, and manifest reconciliation. Writes no page/component
  code itself.
- **Persona 1 — Implementer** (baked into every generated prompt): does the
  migration work for exactly the unit's scope. No partial coverage.
- **Persona 2 — Gold-Standard Reviewer** (baked into every generated
  prompt, distinct hat from Persona 1): checks mobile-friendliness,
  best-in-class UI polish, LTS-safety, and full (non-partial) coverage
  before allowing a commit.
- **ANTI-PATTERN CRITIC** = `scripts/frontend-gate.sh`'s forbidden-pattern
  scan, enforcing this repo's own ⛔ PROHIBITED PATTERNS list (inline
  styles, raw HTML instead of shared components, direct `recharts`/
  `react-leaflet`/`react-router-dom` imports outside the wrapper layer,
  hardcoded strings, `{data && ...}` gating, `any`, stubs/TODOs).
- **QA AUDITOR** = Chromatic (visual regression, scaffolded in
  `p1-tooling/0002-chromatic-ci-wiring`) + Playwright (interaction smoke
  test, scaffolded in `p1-tooling/0003-playwright-scaffold`), both **fan-out
  by page in Phase 7/8** so every one of the 164 pages gets real evidence,
  not a sample.
- **SELF-HEALING AUDITOR** = `frontend-loop.sh`'s periodic audit (below) —
  fully autonomous, never pauses the fleet.

## FLEET PARALLELIZATION MODEL

- Phase 0 (foundation) and Phase 1 (tooling) are **sequential, single-threaded**
  — shared foundation, everything else depends on them. **DONE** this
  session (commits `a766b358a`..`052f3041a`).
- Phase 2 (Radix primitives, 15 components), Phase 3/5 (chart/map shared
  building blocks, 12+5), Phase 7 (Storybook stories, 239 components):
  **fan-out one agent per component** — conflict-free (one file each).
- Phase 4/6 (chart/map consuming pages, 152+15) and Phase 8 (E2E, 153
  pages): **fan-out one agent per page**, grouped into waves by the runner's
  `--jobs N` parallel-worktree mechanism (this IS the fleet).
- Concurrency default: `JOBS=4` (this machine: 20 cores, but each job runs a
  real `npm install`/`tsc`/`build` — conservative beats resource-starved).
- Shared-file contention (barrels: `components/ui/index.ts`,
  `components/charts/index.ts`, `components/maps/index.ts`) is resolved by
  the integration-branch merge mechanism in `run-prompts.sh`, never by a
  cell hand-editing another cell's files.

## GATES (every unit, no exceptions)

1. `bash scripts/frontend-gate.sh <target files>` → `GATE=PASS` (target-scoped
   tsc + eslint + forbidden-pattern/revert-to-old-stack scan).
2. For component-library units (Phase 2/3/5): the component's Storybook
   story (once Phase 7 reaches it) must render in all documented states.
3. For page units (Phase 4/6/8): Playwright spec passes on both
   `desktop-chrome` and `mobile-safari` projects; zero console errors.
4. Every 25 fleet-wide completions: automated self-healing audit (below).
5. Phase boundary: `bash scripts/frontend-gate.sh --full` (whole-repo
   lint+tsc+test) must pass before the next phase starts. Verified clean
   after Phase 0+1 this session (2 pre-existing, unrelated test failures
   only: `featureCatalog.test.ts`, `lazyRoutes.smoke.test.ts`).

## AUTOMATED SELF-HEALING AUDIT (fully autonomous — no human, no pause)

Every 25 completed prompts (fleet-wide), `frontend-loop.sh` runs
`apps/tools/frontend-rewrite/self-heal-audit.mjs`, which:
- Recomputes `pending_for` per program and the global done/total ratio.
- Scans the last 25 `done.txt` entries' commits for gate-failure patterns
  (re-running `--full` gate) and for the specific integration-merge failure
  class that caused today's incident (`git diff --quiet` non-zero on a
  fresh checkout of HEAD).
- If a systemic pattern is detected (>15% of the last 25 fleet-wide units
  hit the same failure signature), it AUTONOMOUSLY remediates: for a CRLF/
  blob-hygiene regression, re-runs the normalization sweep; for a shared-
  component regression, reverts the suspect shared file and re-queues the
  dependent units; for a merge-mechanism failure, cleans/prunes stale
  parallel worktrees and branches. It never pauses for approval — it logs
  the diagnosis + remediation to
  `.github/prompts/frontend-gold-standard/logs/self-heal-*.log` and
  continues the loop immediately.

## MANIFEST

Per-phase shard `.github/prompts/frontend-gold-standard/manifest/<phase>.md`:
one row per prompt: `unit | status(pending/done/blocked) | commit | gate |
notes`. Master `.github/prompts/frontend-gold-standard/manifest/_master.md`
(generated, never hand-edited) reconciles all 9 shards against the 599-prompt
count. Regenerated by `apps/tools/frontend-rewrite/gen-manifest.mjs` from
`done.txt` + git log — never edited by hand, never touched by a cell
directly.

## STOP CONDITION (only exit)

`web/` boots on :5173; master manifest shows 599/599 prompts done (or
explicitly `blocked` with a documented, human-reviewable reason — never
silently dropped); zero `grep -rE "from '(recharts|react-leaflet|react-router-dom)'"
web/src/features` hits outside the wrapper layer; Chromatic baseline exists
for all 239 components; Playwright suite green for all 164 pages on both
projects; global `npm run build && npm run lint && npm test` green (raw
output pasted); all self-healing audit logs retained in
`.github/prompts/frontend-gold-standard/logs/`. `web/` never stops serving
traffic during the loop (in-place modernization, not a parallel rewrite —
there is no "old app" to keep running side-by-side).

## STATUS AT TIME OF WRITING

Phase 0 (foundation) + Phase 1 scaffolding: **4/4 + tooling scaffolds done**,
verified with full gate green. Phases 2–8 (595 remaining prompts): queued,
loop was paused this session to fix the integration-merge bug above and is
being resumed now under this mission.
