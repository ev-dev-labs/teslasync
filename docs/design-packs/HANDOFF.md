# Design packs wrap-up handoff
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
