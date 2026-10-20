# CI handoff — PR #198 (ui/simplification)

## Major-release decision and current candidate — 2026-10-20 00:15 UTC
- User explicitly requested a **MAJOR** release for this comprehensive workspace/navigation/dashboard and source-evidence contract migration. PR remains draft and must not be merged by this agent.
- Actual release mechanism: `.github/workflows/release.yml`, `Determine version bump`, reads **commit subjects** with `git log --oneline` and matches `^[a-f0-9]+ (feat!|BREAKING)`. It does not inspect PR labels or commit footers; scoped `feat(ui)!:` alone does not match. Use an **unscoped `feat!:` PR title and committed release-intent subject**, plus an explanatory `BREAKING CHANGE:` footer. This preserves the signal with merge/rebase and the repository's `COMMIT_OR_PR_TITLE` squash setting. No version-workflow or safety-gate changes are needed.
- `.github/release-drafter.yml` additionally resolves `major` or `breaking` labels to major. Apply the configured `major` label (creating it if absent); this supplements, not replaces, the commit-subject mechanism. Latest local stable tag is `v2.17.1`, so the existing computation yields **v3.0.0**. Final release uses whatever latest stable tag exists at merge time. Do not publish a release/tag or manually change package/Helm versions: the release workflow injects its computed version into builds/packages.
- PR metadata updated: unscoped `feat!:` title, comprehensive template-preserving body, configured `major` label created/applied, draft verified true. Executed the release workflow's actual version-computation block in the official Linux container against the committed release-intent subject: `Latest tag: v2.17.1` and `Computed BASE_VERSION=3.0.0`. No publication/signing/tagging stages executed. No release or CI workflow edits.
- PR template inspected before edits. Preserve headings, HTML comments and checklist order; describe all branch-wide changes, not just this takeover's CI fixes. Mark all-suite validation pending and retain draft status. Existing-head quality39344056391 currently80 SUCCESS /2 FAILURE /1 IN_PROGRESS /3 SKIPPED; failures are responsive-4 overflow/proxy and WebKit proxy. No green claim.
- Docker Linux reproduction is now available using official Playwright1.63.0-noble, isolated Linux dependencies, read-only sources and exact CI Node26.12.0. Original guard reproduces14px body overflow; diagnostics isolate transformed Review details tooltip layout boxes. Working physical-left placement passes29/29 tooltip units, TypeScript and e2e build; full unchanged native Linux guard running. Proxy gate remains unresolved after rejected experiments were removed. No workflow/tolerance/assertion weakening; followup plan remains incomplete.

### Tooltip verification — 00:26 UTC
- Full original Linux widget guard now **1 passed (2.0m)**: every121 widget in all six configurations passes, with zero not-rendered/violations. Before the physical-left fix, the same native setup reproduced multiple14px overflows. Retained original sampling/assertions and added nested/pseudo diagnostics only. Preview still emits API proxy escapes; this is geometry success, **not hermetic success**.
- Fresh actual Windows visual matrix **49 passed /41 existing profile skips (2.0m)**, no new snapshot updates. Tooltip units29/29; full shell/i18n/trio20 files/8110 passed. TypeScript, full lint/audits, strict catalogue freshness, production build/postbuild and browser bundle all exit0. No source checkpoint changes needed.
- Explicit reviewed implementation commit list: Tooltip.tsx, Tooltip.test.tsx, dashboard-widget-overflow.smoke.spec.ts. Continue resolving the independent genuine network escapes; latest prior-run evidence has108 passing responsive-4 assertions followed by the intact failing proxy postcheck. Do not treat green browser assertions as full job success.

### Named CI39347637266 unit failures — locally reproduced and corrected, 01:32 UTC
- Root errors: shard3 HelpTooltip left/right placement assertions and ChargingReconciliation signed-variance test; shard6 Tooltip.boundary allocated surface and CommandDeck icon-only right-side tooltips. Coverage merge repeats the same five failed assertions; no evidence of a separate threshold failure, and no thresholds changed.
- Corrected consumers to assert physical `left` geometry with mocked actual trigger/viewport widths (including distinct left/right offsets), preserve wrapping and zero horizontal translation, and inspect only actual width-bearing share bars. Exact100%/0% widths, two-bar count, severity and signed/tolerance assertions retained. Restore placement mocks between tests and wrap real focus in Reactact; no test skips or assertion deletions.
- Baseline copies came exclusively from `git archive HEAD` in isolated official Playwright1.63.0-noble/Linux, no checkout/stash/reset or mutation of working sources. Exact CI Node26.12.0, CI=true/TZ=UTC, NODE_OPTIONS=--no-experimental-webstorage, Linux dependencies from the isolated npmci volume.
- Reproduced all five cases red from committedc9 runtime. Workflow-equivalent full coverage commands before any new push: `npx vitest run --shard=3/8 --maxWorkers=2 --coverage --coverage.reporter=json --coverage.reportOnFailure --reporter=default --reporter=blob` → **340 files /11806 passed,550.05s**; shard6 same flags → **340 files /6270 passed,537.99s**. These full runs included the uncommitted document-cancellation candidate.
- Additionally copied **only the four reviewed consumer test files** over committedc9 (no cancellation implementation) and ran their full files with the same coverage/reporters: **4 files /105 passed,28.93s**, confirming the unit fix is independent of experimental browser work. Keep the cancellation implementation uncommitted until its complete responsive wrapper is green; local API probe success alone is insufficient.

## Takeover validation — 2026-10-19
- Checkout verified on `ui/simplification`, head `6f838a5da5`; 65 pre-existing uncommitted files preserved. Codex process exists but its checkout session ended with `task_complete`; no active test runner found before edits. Existing preview processes were not started by this agent.
- First real frontend shard-2 error in run `39303008716`: `TypeError: queries is not iterable`, at `pickWorstQuery` in PageContainer. Pending Codex change discriminates arrays with `Array.isArray` and includes a regression for optional `isError`; changed unit suites passed 409/409.
- Local compile failure reproduced: `Layout.tsx(1331,59): error TS2339: Property 'managed' does not exist on type 'WorkspaceRouteScope'`. Fixed Layout's mobile-control gate to inspect route capabilities; `managed` belongs to context, not the route descriptor. Layout suite 99/99.
- `npx tsc --noEmit`: exit 0; catalog check: 57 bundles, 181 fallbacks, 1273 shell keys, 0 known-missing; full lint/audits exit 0; production build/postbuild exit 0.
- Updated reviewed shell fragment to match the capability gate; hashes generated exclusively by `repin-shell-preservation.mts` and exported `checkpointSources` (typed audit). Full i18n folder: 20 files / 8110 tests passed after checkpoint.
- Drive pricing: added unit coverage for initial settings failure (unknown) distinct from loaded unset rate (No rate configured). Canonical power fixtures corrected from kW to watts and exact ChartSummary definitions retained (19, -4, 4.74). Full drive-detail suite now 24/24; replay 8/8; notification 2/2.
- Visual workflow is explicitly `windows-latest`, not Linux. Snapshot template omits OS (`{testDir}/.snapshots/{projectName}/{testFilePath}/{arg}{ext}`); Linux Docker generation would overwrite Windows baselines and is intentionally not performed. No workflow/tolerance/assertion weakening.
- Changed-browser batch: 224/268 passed; migrated retained drawer evidence, portaled export menus, actual SVG stroke clicks and strict scoped fixtures. Focused batch 66/68, then diagnostics 4/4 and physics 1/1 after explicit unknown-confidence and responsive card/table corrections. Preconditioning 16/16, resale 3/3, shared table 34/34 and drives 26/26 in focused runs. All browser runs CI=true, TZ=UTC, en-US, workers=2, retries=0.
- Windows baseline generation and separate verification each 49 passed / 41 pre-existing profile skips. Eighteen mobile baseline files explicitly staged and committed; no tolerance/workflow changes. Full lint/audits and TypeScript rerun exit 0.
- Pushed initial logical commits `84c9da1527`, `2ad07fefec`, `ee8e1d1eff`, `035395b212`, `c658ec4430`, `f43b848148`, `87ec274d9c`, followed by the reviewed fixes below through `28aa0e8558`. All include the requested coauthor. Only ui/simplification pushed; no merge.
- Prior-head runs: CI https://github.com/ev-dev-labs/teslasync/actions/runs/39327622924 ; quality https://github.com/ev-dev-labs/teslasync/actions/runs/39327623156 . Actual gh output confirms all eight frontend unit shards, merged frontend/backend coverage, all ten Windows visual shards and deliberate visual gate SUCCESS on 87ec274d9c. Responsive shards 3/4/8/14/16 failed; no final green claim.
- Full exact eight-shard units / sixteen-shard browsers have not yet been reproduced locally. Follow-up plan work remains deferred until required CI is green. No servers started; initial existing preview servers left untouched. Own test-results-* output directories must be removed before final clean-worktree claim.

### Latest reviewed fixes — awaiting new-head CI
- New logical commits: `2ee49e91c0` (disabled FSD query is not a perpetual section load), `3d54ce23a2` (native narrow editing/drop surface, reachable downward layout menu, header collision space, driving gauge density, intrinsic Twin height, canonical catalogue contracts), `b194c47f8a` (portable native source-bound age font/markers), `07f9006ba5` (responsive source retention, calendar panel ownership and accessible controls). Each explicitly stages reviewed files and includes the requested coauthor.
- Actual final focused browser output: `1 skipped; 45 passed (2.2m)` across drag/drop, kiosk, layout gallery/restore, native age positive/negative controls, Unknown charger, eight day-log widths/themes and FSD empty fixture. The skip is pre-existing; no test skip was added.
- Both independent dashboard/FSD Windows visual rechecks: `20 passed`, final 42.9s. No further baseline changes needed. Visuals remain Windows-owned; Linux baseline regeneration intentionally avoided.
- Broader catalogue/workspace/calendar/sleep verification: `143 passed; 1 failed (11.2m)`. Sole remaining failure was Supercharger min/view body `345/330px`; full independent unchanged 121-widget six-configuration guard then `1 passed (1.6m)`. Added offending-descendant diagnostics; intermittent source remains unproven and must be watched in new CI rather than called resolved.
- Thermal numeric retention `8/8`; Digital-twin retention `4/4`; driving/vehicle catalogue geometry `12/12`; all five grid unit files `34/34`; FSD page `32/32`; LayoutSwitcher `28/28`. New Twin intrinsic-height regression passes both sizes and exact native auto-fit browser passed separately (15.1s).
- Latest `npx tsc --noEmit`, catalog check, full lint/audits, build/postbuild and browser harness build: exit 0. Full i18n/shell/trio rerun: `Test Files 20 passed (20); Tests 8110 passed (8110)`. LayoutSwitcher presentation-only checkpoint generated using exported repository `checkpointSources`, after explicit LF-only assertion and translation verification; no hand-edited hashes.
- No workflow, tolerance, coverage, architecture ratchet, strict i18n, race or SI gate changes. No installs with npm, stash/reset, discarded Codex work, extra branch or merge. A Python font-subsetting tool was used to generate a renamed, embedded OFL fixture with its full license; browser/CI has no new runtime download or dependency.
- Remaining work: push these reviewed commits plus handoff, harvest new-head required checks, investigate any repeat overflow with recorded geometry, then required-CI-only follow-ups. Followups plan completion and final clean/green status are **not** claimed.

### Current CI loop — 23:06 UTC
- Head `28aa0e8558` runs: CI https://github.com/ev-dev-labs/teslasync/actions/runs/39336968067 ; quality https://github.com/ev-dev-labs/teslasync/actions/runs/39336968238 . Real latest check aggregate: 80 SUCCESS / 1 FAILURE / 2 IN_PROGRESS / 3 SKIPPED. Responsive-4/15 still running. Responsive-16's 107 tests passed, but intact proxy gate failed: `E2E preview emitted a proxy/network escape error`, first `/api/v1/vehicles/states?vehicle_ids=7&limit=500` during Tesla fixture loops.
- Reviewed `26cc83c56c` disposes old mounted/polling pages via about:blank before removing API routes; owned preview verification 3/3 with no proxy log errors, then owned preview stopped. Same commit fixes canonical Show tours selector; settings all32 viewport/theme/text-scale cases pass unchanged geometry.
- Reviewed `fb524effa0` fixes vehicle title collapse beside dense desktop actions: zero flex basis squashed Aurora to30px and five lines at1280. Use intrinsic auto basis consistently in PageContainer (actual PageLayout adapter) and PageHeader. Unit42/42; focused native route guard5/5; all90 unchanged Windows visual cases pass. Full shell/trio/i18n8110 passed fresh. No new hashes, snapshots, thresholds or workflows changed.
- Next push includes both reviewed commits and this handoff. Fresh TypeScript, lint/audits, catalog and production build/postbuild all exit0 (session210). Actual final output: `[pwa-contract] OK — source + build contracts satisfied`; `[source-maps] OK — no publicly reachable source maps, serving path denies .map`. Continue watching required checks; no final green claim and no unrelated followup implementation.

### Current candidate loop — b61aba8fd4, 23:49 UTC
- Runs: CI https://github.com/ev-dev-labs/teslasync/actions/runs/39339640282 ; quality https://github.com/ev-dev-labs/teslasync/actions/runs/39339640292 . Actual latest aggregate79 SUCCESS /3 FAILURE /1 IN_PROGRESS /3 SKIPPED. Responsive-16 passed after polling-teardown fix. Responsive-15 remains in progress (suite started23:15:30). Responsive-4 fails body overflow and proxy gate; Windows visual7 and aggregate fail solely long-content/settings.
- Exact Windows visual reproduction:89059 different pixels (ratio0.07). Reviewed old/new images: intrinsic title basis lets the expanded localized settings heading stay readable on one line; search/action rail wraps below. Regenerated exactly one Windows PNG via Playwright, no threshold or assertion edit. Actual visual config full90 enumerated:49 passed/41 existing targeted-profile skips,2.0m. Earlier90/90 refers to separate routes.quality suite, not this visual config.
- Original full121-widget overflow guard plus entire route chunk0 at1280 both passed locally (2 passed,5.5m). Owned previews expose substantial API escapes despite passing assertions; proxy gate remains intact. API requests escaped from old / document with native HeadlessChrome UA, absent from mocked trace. Context-scoped mocks, fresh-page preload and document cancellation hypotheses did NOT eliminate escapes and were removed manually; original committed API code/tests and fixture coverage retained. Do not claim these experiments fixed CI.
- Retained only improved overflow diagnostics (client edge rather than outer border; CSS/body geometry), unchanged worst-of-three and all121×six-mode assertions. Linux repeatedly reports19px overflows across several widgets while local guard passes. Docker CLI exists but Linux daemon pipe absent; exact Linux reproduction not currently available.
- Fresh full lint/audits and hermetic browser rebuild passed after removing experiments (diagnostic-validation exit0). New push will carry only reviewed settings PNG, diagnostic code and live docs. No workflow, retry, skip, tolerance, coverage or architecture-gate changes. Followup implementation still deferred; required green and final clean/green status are not claimed.

## Historical continuation below (superseded by takeover status above)

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
- Visual review: compared old/new fleet degraded and battery long-content frames side by side; content/evidence are preserved, nav rail label/icon alignment matches the merged nav-motion UI. Refreshed 22 Windows Chromium baselines using the unchanged snapshot assertions (49 pass, 41 existing profile skips). No tolerance changes. Temporary comparison PNG remains outside the repo.
- Removed a stale zero-byte .git/index.lock (11:06:38, no running git.exe) before commit; no concurrent worktree edits observed. Production fixes pushed as 5d594e0040.

### Operations contracts closeout
- 40/40 verified under CI=true/TZ=UTC, retries=0: 36 cases in full run plus 4 export cases in final focused run. Retained exact counts/values/windows, source independence on retry, zero/missing distinction, privacy, clipboard/export/delete flows, keyboard focus and drawer geometry. Windows clipboard CRLF normalized to LF for logical text equality. Actual source timestamps and withheld-count disclosures are asserted in the real drawer.
- Shared mock harness now explicitly handles GET /vehicles/7 using its existing canonical vehicle fixture. Global refresh requested this real endpoint; strict harness previously returned 599. Unknown routes remain rejected.
- Runtime drive pricing follow-up in progress: failed initial settings must show unknown cost, while a successfully loaded unset rate still says No rate configured. Existing unit suite 23/23; browser confirmation running. No workflow changes.
