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

## Codex continuation - 2026-10-19
- Setup: fetched and fast-forward checked out ui/simplification at 3955a4b3b7; gh authenticated. No active test runner or Muse CLI found; two orphan preview processes existed (3100/3101), and unrelated desktop/terminal hosts were left alone. Restarted branch previews on 4173/3102.
- Installed package versions match package-lock; omitted entries are optional non-Windows binaries. No npm install/ci performed.
- Workflow repro: Node 26 (local 26.8.1), Go from go.mod (local 1.27.2), npm ci --legacy-peer-deps in CI; Vitest 8 shards/maxWorkers=2 with --no-experimental-webstorage; browser 16 shards/workers=2, en-US/UTC, CI=true. release.yml is main/manual only. Local browser runs use CI=true/TZ=UTC/no retries.
- Responsive confirmation DONE: Edge guard 15/15, all six repaired routes at 375/414/768/1280/1920. No narrow cards, per-character wrapping or overflow.
- Previous CI shell failure is already fixed by Muse's generator commit: current authorized-shell-preservation 139/139, LF source and pins. Mock module stderr was intentional chunk-failure coverage, not the failed assertion.
- Intelligence packs: migrating remaining eyebrow disclosure into drawer; retained trust grant now explicitly asserts the stale label and source error instead of the pre-redesign label. Full confirmation running. Fleet/operations confirmation running separately with isolated output.
- Current CI 39298421822 / 39298421948 / 39298422225 on 3955a4b3b7 still being harvested. Exact confirmed failures: visual long-content battery/settings and Lighthouse vehicles CLS 0.1447505715 / analytics 0.1496217179. No workflow changes.

### Verified production fixes (Codex)
- Fleet contracts 36/36 and intelligence-packs 16/16 now pass locally under CI=true/TZ=UTC, no retries. Trust decisions were persisted without audit entries: usePackActions now records a translated trust-decision event. The envelope identity test still gates the actual install commit (rather than the newly added earlier trust audit).
- Page-level Refresh now refreshes every query declared by the page; its status badge still describes the worst source. Regression test asserts each source is called once. Source-specific retry buttons remain independent. Reservation footer wraps at narrow widths; chart export uses shared viewport-clamped Popover so shell chrome cannot cover SVG downloads. Chart tests retain outside-pointer, Escape, action and download coverage.
- Lighthouse root cause: large recovery panels inserted above usable content. Analytics now discloses the full source recovery panel behind a persistent compact failure summary; fleet uses compact QueryError and a service-attention disclosure. Both retain recovery controls. Cold plain-browser production measurements: vehicles total CLS 0.08809; analytics 0.07486 (existing budget 0.1 unchanged). CI confirmation still required.
- Gates: production npm run build + postbuild passed; npm run lint + audits passed; affected units 210/210 plus focused 91/91 and vehicle/analytics 109/109; i18n folder 8110/8110 after generator-driven LF checkpoints. Catalog split regenerated; Arabic/Hebrew preserved, 42182 known translation keys verified. No workflow changes, no install.
- Remaining local work: operations smoke migration (72/92 combined run: all 20 failures in operations; mobile selection mode, SR-only checkbox keyboard interaction, drawer-only timestamps/context, withheld metric explanations, page-refresh count expectations). Supported contracts rerun after migrating cycle/sleep/diagnostics/home/resale and exact preconditioning date-window wire assertions.
- Visual baseline regeneration completed 49 passed / 41 existing profile skips, no test or assertion changes. Baselines are held for diff review and a separate commit.
