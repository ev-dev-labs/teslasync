# Design packs wrap-up handoff

## Active investigation: 2026-11-17, head `788cdb3638`

Five workflows pass on this head: CI, Security, Ops Gate, SI Canonical Gate
and Auto Label. Quality run `43997247453` is on its one permitted failed-job
retry after twenty attempt-1 jobs had queued for 46 minutes. The active
`pr-watch-788-attempt2` monitor checks every 90 seconds plus API time.
Do not issue another unchanged retry if it hangs again.

The now-available interrupted logs show real WebKit desktop native-action
timeouts and Firefox custom-desktop previous-pack attributes. All ten
executed interrupted Chromium logs were also inspected: no independent
test failure was reported; responsive-14 completed 112 cases before its
cancellation cleanup. These native failures remain open FIXLIST work.

Prior browser replays used Node 24/ARM64/twenty visible CPUs and production
assets, unlike Node 26/x64 CI. The exact current CI `e2e-app` artifact is now
served by the task-only Vite helper on 50725. Task image
`teslasync-design-packs-browser:788-node26` reports Node 26.13.1. A four-CPU,
four-worker replay of the four original custom-desktop dashboard/drive-detail
phases reproduces the WebKit classic dashboard screenshot font wait:
**1 failed / 3 passed (6.3m)**. No deadlines, assertions or source were
changed. This is still ARM64, not full x64 parity.

The actual CI WebKit trace has no font network requests. A session-only
native Timeline probe identifies 3,024 transition dispatches and 5,322 style
recalculations during the failed screenshot. The global reduced-motion
0.01ms duration accidentally creates transitions on static descendants.
Commit `3128e15a53` uses zero duration/delay, preserving keyframe completion
and normal-motion appearance. The same capture drops from 9.210 to 2.370
seconds, with five recalculations and zero transition dispatches.

The strengthened existing accessibility case fails on old CI assets and
passes on repaired assets (10.0s). Full lint/types/browser build/scoped audit
pass; suppression diffs against both bases have zero matches. Four original
Firefox/WebKit phases pass with four workers/four CPUs: **4 passed (8.8m)**,
unchanged assertions, no retries, zero proxy errors. The one-core native
diagnostic completes all 27 packs: **1 passed (6.7m)**. Four other WebKit
failure phases continue independently; their acceptance is not assumed.

Docker 3120 now serves `teslasync-web:design-packs-v2-3128e15a53`,
running/healthy. Actual entry `/assets/index-Dr_SKJTB.js` contains the repair
SHA; production/postbuild gates pass with 399.2 KB startup JS. Root,
health/readiness/auth-mode return 200; shared Tesla aggregate status remains
503/no_token/closed breaker. Rollback is
`teslasync-design-packs-v2-rollback-before-3128e15a53`.
The verified repair and these receipts are the next shipping batch; new-head
CI acceptance remains mandatory.

Session receipts: `788-resource-repro.log`, `788-webkit-native-profile.log`,
`788-webkit-native-fixed.log`, `788-motion-replay.log`,
`788-motion-native-followup.log` and `3128-docker-build.log`.
The original Firefox artifact in `788-firefox-custom-attempt1` confirms the
requested `v4` PUT and GET were fulfilled promptly before the root assertion
stalled; no transport workaround was added. Helper 50725 and verified child
PID 10708 are stopped, with connection refusal verified. Stop repaired helper
50726 after its four dependent phases; keep Docker 3120 and unrelated shared
services intact.

## Latest CI follow-through: 2026-11-17

The published `a3285f3d30` batch exposed two failures immediately: discovery
matched the hidden-label optimization against a visible fixture, and
Security mistook an API-like filename/digest tuple for a credential.
`a0d22c505b` repairs both without changing assertions, source digests,
scanner configuration or allowlists. Exact browser reproduction passes
(34.6s), the ChartContainer/source-contract files pass 32/161 tests, full
lint/types/build pass, and the full pinned secret scan reports no leaks.
Other CI jobs continued during repairs; only those two failures were present
at the final batch check. Latest-head CI acceptance remains mandatory.

The task-owned Docker preview on 3120 is healthy on
`teslasync-web:design-packs-v2-a0d22c505b`. Entry
`/assets/index-CFmuNir9.js` contains the exact repair SHA; health/readiness/
auth-mode return 200. Startup JavaScript is 399.2 KB under the unchanged
400 KB cap. Rollback: `teslasync-design-packs-v2-rollback-before-a0d22c505b`.
Both temporary Vite helpers are stopped. Fresh main ancestry at the repair
commit is `255 0`; both added-line suppression scans report zero matches.
PR #259 remains main-based, ready and unmerged.

## Current continuation: 2026-11-17

The verified local repair batch is ready for latest-head CI acceptance:
`103f6ded2c` after `2cd9c273d0` and `5cd8e01e49`. The latest main fetch
showed `252 0` before that new repair commit. The PR is main-based, ready,
mergeable and unmerged.
Quality run 43968015395 attempt 2 is now cancelled after repeated 46.5-minute
jobs were inspected; all fifteen interrupted logs were saved and reviewed.
CI remains failed on the old source guards; Ops, SI Canonical, Auto Label
and Security passed. The old-head monitor is stopped ahead of the shipping
batch; start the new-head monitor immediately after pushing.

The failed viewport-crop experiments are removed. Original native captures
inside the existing running-clock boundary pass four exact Firefox/WebKit
dashboard/charging phases (9.2m), with all assertions retained. The shared
`e2e/observationClock.ts` also wraps affected details/core capture boundaries.
Ten existing WebKit follow-up phases passed (30.0m), four workers, no
retries, zero proxy errors; receipt `413-second-attempt-followup.log`.
The newly audited root `/healthz` fixture passes all 85 existing changed-file
harness contracts. Chromium light-phone accessibility also passes. The
transport acknowledgement failed and is removed, together with all temporary
profiling instrumentation. Native traces isolate costly layout of hidden
chart-alternative tables, not lost preference delivery.

A nonvisual CSS repair removes redundant generated cell labels only
while those complete accessible tables are clipped in normal colors.
Forced-colors presentation is unchanged. The longest measured initial
Layout drops from 6.349 to 3.099 seconds; exact four-worker Chromium
regressions pass **4 cases (8.7m)**, no retries, zero proxy errors; receipt
`413-hidden-label-regression.log`. The existing ChartContainer file
passes 32 tests; scoped lint, TypeScript, full lint and production build
exit 0. The scoped audit reports zero violations; added-line suppression
scans against both main and `feature/app-design-themes` report zero matches.

No screenshots or historical baselines changed. Docker 3120 now serves
`teslasync-web:design-packs-v2-103f6ded2c`; its actual entry
`/assets/index-4blmuSGL.js` contains that commit. Root, health, readiness and
auth-mode return 200. Its Docker build passes with 399.2 KB startup JavaScript
under the unchanged 400 KB cap. The stopped rollback container is
`teslasync-design-packs-v2-rollback-before-103f6ded2c`.
Both static helpers on 50723
and 50724 are stopped (verified child PIDs 24044 and 15848 terminated and
direct connections refused). Keep Docker and unrelated shared services intact.

## Current continuation: 2026-11-16

Latest pushed head is still `413631d463`; locally, `5cd8e01e49` fixes three
nonvisual record identities and `2cd9c273d0` commits the verified fixture,
source-receipt and navigation repairs. Neither follow-up commit is pushed yet.
The last main fetch showed `252 0` at local `2cd9c273d0`; the PR is ready,
mergeable and unmerged, but CI is not green.
Current runs: CI 43968015239 (old source-contract failures), Frontend Quality
Gates 43968015395 attempt 2 (one mandated rerun after the 45-minute queue
threshold); Ops, SI Canonical, Auto Label and Security pass. The 131-file
local run passed 130 files/12,444 cases; its sole timeout was repaired and
its eight-case file passes separately, as do 145 selector-helper consumers.
The 97 harness contracts and three earlier exact WebKit phases also pass.
Newly accessible cancelled-job logs are active FIXLIST work, with bounded
browser reproductions underway; no new suites, baselines or suppressions.

Docker 3120 is healthy on `teslasync-web:design-packs-v2-5cd8e01e49`;
entry `/assets/index-BXHnTkVI.js` contains that commit. Its predecessor is
preserved as `teslasync-design-packs-v2-rollback-before-5cd8e01e49`.
A task-only CI-equivalent static preview of those assets currently runs on
50723 for the bounded browser cases. Stop it and verify connection refusal
after those checks; no unrelated shared service was changed.

Work has resumed. This section supersedes the stopped-session record below.
PR #259 still targets main, is ready/non-draft, mergeable and unmerged.
Refreshed main integration is `249 0` at `c572eedc0d`.
`FIXLIST.md` is the current issue tracker; the prior follow-up deferrals are
not accepted as impossible.

Repair commit `5e23bbb1ca` closes the deterministic Firefox Material
320px and Ambient 768px scaled-gauge overflows. Exact existing browser phases
pass: three phone themes (14.8m) and desktop/light (12.0m), zero proxy errors.
Existing Firefox/WebKit desktop isolation/restoration cases also pass with
four workers (4 cases, 1.8m). The existing CI commands now use that capacity;
no profile, phase, replay, threshold or assertion was removed.

The batch also repairs 26 invalid React-grid spreads in 23 consumers,
BroadcastChannel listener fanout, observed test lifecycle boundaries, actual
chart-fixture geometry, gas-gradient keys and the AtlasPanel JSX diagnostic.
Historical source fingerprints and all screenshots remain unchanged in
this batch. Bounded affected batches include 2,004 tests with coverage,
1,393 chart/lifecycle/sidebar cases and a final nine-file 305-case pass.
The full lint gate passes; the changed source audits and TypeScript pass.
See DECISIONS.md for failed intermediate experiments and exact scope.

Quality run 43944846908 attempt 2 on `cc80591ddb` reports the same
Material/Ambient containment failures in all six Firefox profiles and
Chromium responsive-28/30/31. All six existing Chromium containment
variants now pass locally: phone themes 3 passed (7.3m), custom desktop
1 passed (7.6m), and light/dark desktop 2 passed (6.6m), zero proxy errors.
`c572eedc0d` also gives the existing Chromium design partition four workers;
ordinary/performance commands are unchanged. The shipping batch still
requires every workflow to pass on its new head; the task is not complete.
Temporary previews on 50719 and 50723 are stopped. Vite PID 23604 was
explicitly stopped and direct port-50723 connections verified unavailable.

Pushed `f2a7691240` fixes five packs' phone stat-card units, real
Blueprint/Observatory patterned-text contrast, the radial Verified-label
overlap, light chart ticks, the ElevationProfile grid and identical-value
chart/heatmap token adoption. It preserves historical source receipts with
exact inverse proofs rather than changing baselines. Production build,
TypeScript, scoped lint/audits, affected unit tests and actual browser checks
passed. See DECISIONS.md for raw counts and measured contrast evidence.
Ten existing repaired dashboard images were replaced; no other shot changed.

CI is still being monitored, not declared green. `cc80591ddb` repairs
`f2a7691240`'s stale one-worker assertion and direct token-history inverse
without changing coverage or historical fingerprints. Latest-head CI
frontend lint, shard 2 and generated freshness pass. The same commit exposes
quota-module failures through the existing reporter and completes an
unawaited backup test transition.
Seven affected files pass 831 tests with CI coverage options; full lint,
TypeScript and the private-map strict bundle gate pass (399.4 KB startup).
Quality run 43923744808 was
cancelled/rerun once after over-age checks; its log exposed serial execution,
not a deadlock. The batch enables two workers without removing any cases.
Four existing all-pack phone cases passed in pinned Linux Firefox/WebKit in
parallel, with zero loopback proxy errors. No full local unit shard run was
performed in this continuation.

The existing saved-layout popup/native-progress case now passes all 27 packs.
The reviewed contrast nodes and shared token gaps have measured evidence;
the strict desktop restoration comparison still requires the latest CI result.
REVIEW finding families are reconciled in DECISIONS.md. The exact existing
custom/1440 WebKit dashboard and mixed-pack phases pass against deployed
`cc80591ddb` assets: 2 passed (3.0m), no retries/skips, zero proxy errors.
No tolerance, font-wait behavior or baseline changed. Remaining work: obtain
the full current CI result, publish the template-preserving PR description
and obtain a final all-green receipt after documentation changes.
Current CI runs: CI 43944846750, Frontend Quality Gates 43944846908.

Docker 3120 now serves `teslasync-web:design-packs-v2-5e23bbb1ca`, verified
running/healthy with the actual entry asset identity and HTTP 200 on index,
auth-mode, liveness and readiness. Rollback container:
`teslasync-design-packs-v2-rollback-before-5e23bbb1ca`. Other users' services
remain untouched. The shared backend's missing live Tesla authorization is
proved in FOLLOWUPS.md; it is not a frontend regression or a weakened check.

## Historical stopped-session record

Stopped at user request on 2026-11-16; resume only when requested.
Branch: `design-packs-v2`; PR #259: https://github.com/ev-dev-labs/teslasync/pull/259 ; base: `main`; open, non-draft, unmerged.
Repair head: `8edd91f9377e725d72a762bcb2c4fdb2db4b6b90`; the following documentation-only handoff commit is the current head (`git rev-parse HEAD`).
The local native shard 8/8 runner and watcher were killed. Port 50657 no longer responds. No replacement run was started.
## Wrap-up steps 1-8
1 DONE: retargeted to main, integrated main at `b79759f9cc454857a6bb5807f6cbf9f96a350dbe`, resolved conflicts and built successfully.
2 IN PROGRESS: Twin/Pixel, Firefox axes, freshness and earlier CI repairs verified; newest phone layout-popup and energy-fixture repairs await completed browser verification.
3 DONE: FOLLOWUPS.md records the 0.5px desktop difference, incomplete contrast nodes, unfinished 19-pack matrix and remaining token coverage.
4 DONE: ran the full frontend unit suite once; nine failed files later passed focused repairs/reruns. Do not repeat the full suite.
5 DONE: committed design screenshots remain unchanged during these final repairs; they are historical mixed-build evidence.
6 PARTIAL: Docker 3120 contains main, Pixel/Twin and the tooltip repair; rebuilding it with the newest popup fix is NOT STARTED.
7 IN PROGRESS: repair commits pushed; latest-head CI is not verified. Final title/template-based description publication (7k) is NOT STARTED; PR is already ready/non-draft.
8 NOT STARTED: no final all-green handoff to the user; do not merge.
## Failures and exact reproduction commands
At capture, repair-head CI had no reported failed checks yet: Auto Label passed; CI, Security, Frontend Quality Gates, Ops Gate and SI Canonical Gate were pending/running. The handoff push triggers another cohort; require all six on its exact SHA.
Last completed failing cohort: `c49504c576`, Frontend Quality Gates run `43854216444`; Chromium responsive 5,17,22,26,27,28,29,30,31,32 and its dependent aggregate failed. Other five workflows passed that old head only.
Ordinary failures 5/17/22: geometry unload telemetry, pricing recovery race, unstable period-tooltip identity. Reproduce in `web`: `$n=5; npm run e2e:quality -- --shard="$n/24" '--grep-invert=widget-design-packs\.(app|energy|native)\.spec\.ts' --config=playwright.finish.local.config.ts --workers=1` (substitute 17 or 22). Repaired: 112/112/111 passed, proxy errors zero.
Native failures 26-32 map to shards 2-8: unprepared full navigations escaped mocks. Reproduce: `$n=8; npm run e2e:quality -- --shard="$n/8" '--grep=widget-design-packs\.(app|energy|native)\.spec\.ts' --config=playwright.finish.local.config.ts --workers=2 --trace=retain-on-failure` (substitute 2-7). Shards 2/4/5/6 passed 24 each; 7 passed 27, proxy errors zero. Aggregate has no separate reproduction; it requires those jobs.
Local native8 additionally failed: energy phone initial-error still loading; Retry removed by polling; Analog phone saved-layout popup outside viewport. Guarded reloads, real-click recovery and phone-only popup width are implemented. The replacement 26-case command above was stopped at case 15 with no reported failure, NOT a completed pass.
The first energy repair rerun failed preference equality on two harness-owned unload keys; only those exact keys are now excluded, with strict telemetry validation retained. Same native8 command covers all four energy source-state cases.
Local header-tooltip first attempt expected opacity 0 after pointer exit but received 1; no production fix was made. Existing retry ran; no final passing selection receipt. Reproduce: `npm run e2e:quality -- widget-design-packs.energy.spec.ts '--grep=Energy mobile header tooltips' --config=playwright.finish.local.config.ts --workers=1 --trace=retain-on-failure`.
Untraced native3 failed phone accessibility timing; custom-phone charging also stalled. Reproduce native command with `$n=3` and `--trace=off`; charging: `$n=7`, `--trace=off`. Deferred measurement, fallback width and containment experiments failed and were fully reverted. Both focused original cases passed unchanged with CI tracing (2 passed); untraced Edge performance is NOT claimed repaired.
Single full unit command: `$env:NODE_OPTIONS='--no-experimental-webstorage'; npm test -- --maxWorkers=4` returned 2941 passed/9 failed files; all nine subsequently passed focused reruns. This is not a full-suite passing receipt.
Latest completed receipts: `npx tsc --noEmit`, `npm run lint`, changed-file ESLint, component audit passed; `npx vitest run src\features\dashboard\components\LayoutSwitcher.test.tsx --maxWorkers=2`: 55 passed; `npm run e2e:build`: passed; `npm run e2e:contract -- --workers=1` with `DESIGN_PACK_BROWSER_CHANNEL=msedge`: 96 passed.
## Processes the next session must start
For local browser work: `Set-Location D:\repos\teslasync\web; $env:CI='true'; $env:E2E_MOCKS='1'; $env:E2E_REUSE_BUILD='1'; $env:E2E_PORT='50657'; $env:NODE_OPTIONS='--no-experimental-webstorage'; Remove-Item Env:E2E_BASE_URL -ErrorAction SilentlyContinue`.
Run `npm run e2e:build` after source edits, then the native8 reproduction command above. Its wrapper starts/stops its own preview on 127.0.0.1:50657; do not start a competing server or rebuild assets during a run.
Restart CI monitoring yourself: `gh pr checks 259 --repo github.com/ev-dev-labs/teslasync --watch --interval 90 --fail-fast`; on failure immediately run `gh run view <run-id> --repo github.com/ev-dev-labs/teslasync --log-failed`. Batch verified fixes and cancel only superseded active runs.
Docker `teslasync-design-packs-v2` remains running/healthy at http://localhost:3120 ; image `teslasync-web:design-packs-v2-ci-repairs` predates the popup fix. If stopped: `docker start teslasync-design-packs-v2`.
Pending Docker build, from repository root: `docker build -f Dockerfile.web --build-arg VITE_GIT_SHA=8edd91f937 -t teslasync-web:design-packs-v2-ci-repairs .`; replace only that preview container on 127.0.0.1:3120:80, network `teslasync_default`, restart `unless-stopped`; preserve rollback containers.
Shared Vite shell 2059/PID 53252 on 54872 was left alone; other previews 3119/3121/3130 are not ours to stop. No local validation watcher remains.
## Gotchas and evidence
Windows ARM64/Node 26: native pinned Chromium unavailable; checked-in optional `playwright.finish.local.config.ts` uses installed Edge without dropping projects. Keep actual CI `retain-on-failure` tracing; forcing it off changes timing. CI uses pinned Playwright 1.63.0 on Linux.
Use bounded browser concurrency; native8 is slow. Wait for page-load/network lifecycle before state assertions, but release held loading reads before the navigation validator. Never disable proxy, telemetry, viewport or distinctness gates.
Production tsc excludes unit-test fixture types. Do not restyle packs, alter APIs, weaken thresholds, launch new matrices, or regenerate committed screenshots. Full lint/build retain known warnings; do not claim warning-free output.
Artifacts: `$HOME\.copilot\session-state\3aee1cf9-c068-48af-a1bc-2e6272468c15\files`; see `finish-native8-popup-energy.log`, `finish-native-shard8-repaired.log`, `finish-energy-source-lifecycle.log`, `finish-popup-full-lint.log`, and `finish-pr-body.md` (unpublished template-preserving draft, needs final results).
