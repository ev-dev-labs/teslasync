# PR CI performance

## Measurement and baseline

Source: Actions API, retrieved 2026-11-17. All times below are minutes.
`wall` is workflow creation to the last job completion; `runner` is the sum
of started-to-completed executed jobs, without billing multipliers or rounding
each job up. `queue` is **job creation to job start**, excluding time waiting
for dependencies before GitHub creates the job. Queue sums are not wall time.
Skipped jobs consume no measured runner time.

Setup includes checkout, toolchains, dependency/container initialization,
caches, artifact transfers and post-job cleanup. Execution includes tests,
lint, builds, validation and report merging; it is **not** exclusively test
body time. Unclassified/gap time is retained as Other, never folded into
test execution. Native per-test JSON durations are used separately for shard
balancing. Raw per-job queue/setup/execution totals: [baseline-jobs.csv](./baseline-jobs.csv).
Reproduce using `.github/scripts/ci-perf.mjs OUTPUT_DIRECTORY RUN_ID...`.
That command preserves raw run/job/step JSON alongside the CSV and summary.

| Run | Workflow | Result | Jobs (+ skipped) | Wall | Runner | Queue sum | Queue max | Setup | Execution | Other |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| [44175378266](https://github.com/ev-dev-labs/teslasync/actions/runs/44175378266) | #259 browser | success | 56 (+1) | 117.53 | 1650.08 | 1133.78 | 66.58 | 112.48 | 1530.68 | 6.92 |
| [44175378477](https://github.com/ev-dev-labs/teslasync/actions/runs/44175378477) | #259 CI | success | 38 | 39.25 | 193.47 | 77.60 | 17.40 | 51.40 | 139.10 | 2.97 |
| [42844688965](https://github.com/ev-dev-labs/teslasync/actions/runs/42844688965) | main browser | success | 94 (+1) | 37.38 | 338.65 | 1203.55 | 24.10 | 99.78 | 224.08 | 14.78 |
| [42772532579](https://github.com/ev-dev-labs/teslasync/actions/runs/42772532579) | main browser | success | 94 (+1) | 31.78 | 318.83 | 761.57 | 16.88 | 87.30 | 218.03 | 13.50 |
| [42687900000](https://github.com/ev-dev-labs/teslasync/actions/runs/42687900000) | main browser | success | 94 (+1) | 32.43 | 323.30 | 993.27 | 21.35 | 89.77 | 219.35 | 14.18 |
| [42844688982](https://github.com/ev-dev-labs/teslasync/actions/runs/42844688982) | main CI | success | 38 | 24.98 | 163.35 | 65.83 | 8.37 | 23.97 | 136.10 | 3.28 |
| [42772532057](https://github.com/ev-dev-labs/teslasync/actions/runs/42772532057) | main CI | failure | 38 | 19.23 | 141.18 | 74.07 | 8.20 | 21.70 | 116.62 | 2.87 |
| [42687899893](https://github.com/ev-dev-labs/teslasync/actions/runs/42687899893) | main CI | success | 38 | 22.12 | 132.23 | 81.20 | 8.62 | 21.63 | 106.93 | 3.67 |

These are the last three **completed** main runs of each workflow at task
start; the #259 merge push was still running. They predate the expanded
design acceptance and are not an equivalent-workload speed comparison.
The failed main CI sample includes backend race shard 4 and frontend shard 8,
with dependent coverage/summary failures; it is not silently discarded.

The supplied #259 estimate of 122 minutes is 117.53 by API timestamps.
Its 57 jobs include one deliberately skipped production smoke.
The two #259 workflows total **1843.55 runner-minutes**, implying a 92.18-minute
compute floor at 20 slots, before other workflows and scheduling constraints.
Firefox/WebKit application designs alone account for approximately 1023
runner-minutes. Moving those to merge queue is necessary; simply adding shards
cannot make that PR workload fit into 45 minutes.

## New layout and coverage

| Work | PR | Merge group / nightly / manual |
| --- | --- | --- |
| Shared hermetic build + route/discovery contract | 2 jobs | same |
| Chromium quality | 20 jobs, 4 workers each; 2,902 exact test identities | same |
| Accessibility / performance | 13 / 9 tests, separate 1-worker processes on jobs 1 / 2 | same |
| Firefox / WebKit / Edge critical smoke | 3 jobs, 8 / 8 / 4 tests | same |
| Windows visual baselines | 4 jobs, 90 tests | same |
| Firefox application profiles | deferred | 6 jobs, 4 workers |
| WebKit application profiles | deferred | 12 desktop jobs at 1 worker; 6 phone jobs at 2 workers |
| Engine replay | deferred | original Firefox / WebKit dark-desktop shard, 57 tests per engine |
| Browser report summaries | 5 jobs | same names, full profile evidence required |
| Backend CI | relevant paths only; all frontend CI unchanged | all backend CI on merge groups and main pushes |

The 24 application-profile jobs preserve 264 profile tests plus 114 engine
replay tests, all before merge. No tests, profiles, thresholds, retries,
timeouts or assertions are removed or weakened. The full browser inventory
and separate contract/visual inventories are checked as multisets, not counts.

All Chromium identities now use the last green #259 measurements. The
worker-tail-aware model predicts 22.56 minutes of test execution per Chromium
job, before setup/report overhead. This is a **prediction, not a measured
after result**. Existing Firefox/WebKit duration entries are unchanged.

## After measurements

Not yet measured: the branch has not been pushed. The complete after-run
wall/runner/queue figures will be recorded with the corresponding measured
calibration or correction, not a docs-only commit.

## Required checks: owner configuration

Keep the existing exact contexts in the main ruleset:

- `Backend (lint + test + build)`
- `Frontend (lint + test + build)`
- `Docker · api`
- `Docker · notification-worker`
- `Docker · export-worker`
- `CI (all checks)`

Add these exact contexts to the main ruleset so they are also enforced on
merge-group commits:

- `Chromium responsive, a11y, keyboard, and performance`
- `Deliberate visual snapshot gate (Windows baseline)`
- `firefox critical smoke`
- `webkit critical smoke`
- `edge critical smoke`

Keep the CodeQL code-scanning requirement; Security now runs on merge groups.
Do not require individual profile/shard names: their strict summary owns their
complete report inventory. Do not merge this change with queue bypass, since
the deferred cross-engine profiles are intentionally a pre-merge queue gate.

**Existing ruleset limitation:** its merge-queue check-response timeout is
60 minutes. The unchanged WebKit desktop/replay job alone measured 66.25
minutes, and the full pre-merge workload still has a compute floor above
60 minutes. This task does not raise timeouts. Thus sub-45-minute **PR**
feedback does not imply a sub-60-minute queue run; the owner must resolve that
queue policy/capacity constraint before enabling a blocking queue under this
unchanged timeout. No repository rule has been silently modified.

## Local validation

Exact commands and raw results are recorded in the PR description and task
terminal. Required checks: actionlint on every changed workflow,
`node --test .github/scripts/ci_workflows.test.mjs`, and
`node .github/scripts/playwright-duration-shards.mjs verify-layout --out=...`.
The latter executes Playwright `test --list --reporter=json` for each suite
and each exact selected shard, then compares their multiset unions.
