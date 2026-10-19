# CI handoff — PR #198 (ui/simplification)

## Head
- Branch: `ui/simplification`
- Latest pushed: `2b88cf8551` (wip: intelligence-packs migration unfinished)
- Remote verified: `git ls-remote` shows refs/heads/ui/simplification at 2b88cf8551.

## Latest CI (STALE — all on 935eb8478b, before this push)
Fresh runs for 2b88cf8551 were triggered by the push; read those first.
- Run 39275505547 (frontend): Frontend tests (3/8) FAIL; log tail shows slow
  tests plus `Error: [vitest] There was an error when mocking a module`
  (vi.mock hoisting). Merge frontend coverage FAIL. Backend jobs PASS.
- Run 39275505600 (responsive/visual): responsive shards 3,4,5,6,9,10,11,13,
  14,15,16 FAIL; Windows visual snapshots (3,5,6,7,8,9,10 /10) FAIL;
  deliberate-visual-gate FAIL. Per-test errors NOT enumerated (runs predate
  the push; enumerate from the fresh runs).
- Run 39275505462: Lighthouse CI FAIL (known-blocked: CLS 0.1488/0.1496).

## Fixed this session (pushed)
- 034a4ecdcf vehicles contracts 56/56. Root cause of twin loading-gate
  failure: status-bar HonestyMeterSegment fetches GET /vehicles/states and
  useFleetStates seeds the single-vehicle cache, so the brief had batch data
  while the 3 single sources were gated. Test gates/fails the batch too.
- 7683373782 responsive: SystemStatusPage masonry xl:columns-3->2xl:columns-3
  (Telemetry perchar on /system-status + /admin redirect); FavoritesBar +
  CollapsibleCommandGroup breakpoint step-downs (/commands 181-198px cards);
  ClimateControlPage container-grid step-ups (/climate, /climate-control);
  CycleStress grids xl:4->2xl:4. Edge guard chunks 0/1 @768+1280, 2 @1280
  and sidenav-redesign light 1280/1920 galleries: 7/7 green.
- 3bc550f46c refreshed nav-motion + sidenav-polish evidence PNGs (evidence
  only, no assertions consume them).
- 849acc67f4 science contracts 24/24 (withhold + drawer-text migration).
- 2b88cf8551 WIP: intelligence-packs migration started, NOT green.

## In progress (stopped here)
Intelligence-packs migration: Expand-row substring match done, expectRun +
reviewRun drawer-text migration done (runContext helper). Next: run the file
(`chromium-smoke`, CI=true TZ=UTC, :4173) and triage residuals from 0/16
baseline. Responsive narrow/perchar work is DONE and verified.

## Remaining
- intelligence-packs (16), fleet-ops (8), operations (3), supported files
  (battery/advisor/stress/retention/diagnostics/home-energy/resale/preconditioning)
- Responsive r16 specs + r5/r15 leftovers (drives-grid, settings top-level,
  grid-footer, layout-guard) if fresh CI still flags them
- Full gates (tsc/lint/catalog/build/trio/suites), push, watch CI to green

## Follow-ups plan (docs/followups-plan.md) status
- Step 1 security: done, blocked items recorded. Step 2 data bugs: see plan
  (no closeout line found). Steps 3-4: done. Step 5: close claimed but
  contracts follow-through continued after. Step 6: partial (decision list
  exists). Step 7: not done (CI red).

## Local repro
- Preview: `npm run e2e:build` in web/, serve :4173 (chromium-smoke);
  :3102 was the Edge nav-motion server (may be stale — restart if used).
- Contracts: `CI=true TZ=UTC E2E_BASE_URL=http://127.0.0.1:4173 npx playwright
  test e2e/operationalbrief-contracts/<file> --project=chromium-smoke
  --reporter=line --retries=0` from web/.
- Guard: `npx playwright test --config=playwright.nav-motion.config.ts -g
  "<chunk>"` (Edge). Suite takes ~1.3h; filter to failed chunks.
- NEVER rebuild e2e:build while any suite runs (shared dist goes
  inconsistent ~60s and fails in-flight requests — this caused the
  chunk2@1280 LOAD ERRORs).
- Known: twin retryable brief flaps failed/loading on ~6s cadence (test
  catches quiet windows); batch endpoint read only at desktop widths.

## Next agent must NOT
- Weaken/skip/delete tests; loosen workflows or coverage; hand-edit hashes
  (use split-i18n-catalog / trio checkpoint / repin-shell-preservation).
- Merge fix/dashboard-followups or main; push only ui/simplification.
- Commit logs/reports/temp files or zz-probe specs (none in tree now).
- npm install except the step-1 security flow (one package at a time).
