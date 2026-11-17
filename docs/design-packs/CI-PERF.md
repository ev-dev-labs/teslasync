# CI performance baseline — PR #259

## Local commit handoff

The owner's latest instruction is to commit these improvements locally;
the owner will push. This supersedes holding the local commit for a later
repair batch. No modified-layout workflow has been pushed or run, and the
existing Quality run has not been cancelled. Its remaining desktop WebKit
jobs are not classified as failed or stuck from elapsed time alone.

The orchestrator independently ran these final checks:

```text
node --test .github\scripts\ci_workflows.test.mjs: 10 passed, 0 failed
actionlint .github\workflows\frontend-quality.yml .github\workflows\ci.yml: exit 0
Affected browser-free harness contracts: 3 passed (844ms)
npm run lint: exit 0
npx tsc --noEmit: exit 0
npm run build: exit 0, including postbuild gates
npm run docs:build: exit 0, build complete in 22.06s
Changed harness-line grep counts: 0 static inline, raw HTML, direct libraries,
  old API imports, double prefixes, camelCase query parameters
Added suppression candidates against origin/main, including staged files: 0
git diff --cached --check: exit 0
```

Existing thresholded audit messages and bundler warnings remain visible;
these results are not a claim of warning-free output. No snapshot baseline,
application design, page, production hook or screenshot source was changed.
Post-change CI wall, queue, runner-minute and cold/warm-cache numbers remain
pending the first complete modified-layout run.

## Phases 2–4 implementation authorization and forecast

Recorded before workflow edits on 2026-11-17. The user authorized exact-key
dependency/browser caches, duration-balanced browser partitions, failure-only
heavy reports, always-retained small JSON/blob evidence, and mandatory merged
suite reports. The measured 52–73 minute eligible queues and 106 occupied
Quality jobs justify consolidating short accessibility/engine/Windows jobs;
desktop WebKit and Chromium shard 32 justify balancing individual test cases,
not merely adding file-based shards.

The owned helper is `.github/scripts/playwright-duration-shards.mjs`.
Application assertions, snapshots, deadlines, retries, worker capacity,
browser/width/theme/27-pack coverage, cancellation policy, and required summary
names remain unchanged. The full desktop/phone profile unions must contain
exactly 23/21 distinct cases; replay remains required exactly once per engine.

Planned counts: ordinary Chromium 4, heavy Chromium 12, accessibility 1,
performance 1, engine smoke 1 per engine, Windows visual 4, Firefox design 1
per profile, WebKit desktop 4 per profile and phone 2 per profile. That is
49 browser execution jobs rather than 99; report merging uses the existing
required summary jobs, not extra independent jobs. Duration estimates seed
deterministic longest-processing-time partitions; unknown tests remain in the
inventory with conservative fallback weights, never dropped.

**Expected, not achieved:** fewer setup/queue events and removal of the
single 159-minute Chromium shard / 199-minute WebKit desktop long poles.
At 20 simultaneously occupied runners, the latest observed 2,126.40 runner
minutes alone imply a 106.32-minute capacity lower bound before setup savings.
Twenty is observed, not a proven quota. A provisional 120–170-minute Quality
wall range assumes similar test work and scheduling; it is not a guarantee.
Validated model shard loads are recorded below.
Cache cold/warm timing and post-change workflow wall/runner/queue figures are
**PENDING: no modified workflow has been pushed or run**.

Phase 5 remains proposal-only: no merge-queue/subset/impact-analysis,
larger-runner, or custom-image implementation is authorized here.

### Implemented layout and cache/report contracts

- Both workflows cache `node_modules` with exact OS, runner architecture,
  resolved full Node version and lockfile hash keys. There are no restore
  keys. `npm ci --legacy-peer-deps` is omitted only for `cache-hit == 'true'`.
  The Playwright Noble container key is distinct from the host key. CI's docs
  installation has a separately keyed docs lockfile/path.
- Contract Chromium and Windows Chromium cache the effective browser directory
  with exact installed Playwright version keys; contract native OS dependency
  installation remains required. Edge caches `/opt/microsoft/msedge`, verifies
  its executable and recreates the system launch symlink. An empty
  `ms-playwright` directory is not treated as an Edge installation.
  Container Chromium/Firefox/WebKit remain preinstalled and are not reinstalled.
- The sole `e2e-app` build, Windows baseline platform, existing required summary
  names, strict all-success dependency guards, `fail-fast: false`, and
  `cancel-in-progress` expressions remain. Cheap existing CI lint/typecheck/
  unit jobs and Quality contracts remain independent of the shared build.
- Every browser execution partition emits native JSON and blob reports.
  The helper removes inline binary bodies from JSON **after execution**,
  retaining attachment name/type/path, SHA-256 and byte count. Original
  failed/flaky screenshot bytes remain in blobs. Successful binary payloads
  become digest/size metadata inside valid native blobs, as verified below.
  Screenshot sources and product assertions remain unchanged; only the
  intrinsically obsolete workflow-layout contract was adapted with approval.
  Existing retain-on-failure trace/video settings remain untouched.
  Shards do not generate full HTML. Heavy failure directories upload only
  on failure. Small JSON/plan/blob artifacts always upload with missing files
  treated as errors, not ignored.
  The previously unreported harness-contract run now retains its small native
  JSON on every outcome. The global discovery-only command explicitly uses
  the line reporter, avoiding configured HTML generation on successful lists.
- The existing Chromium, per-engine and Windows required summaries execute
  `playwright merge-reports` for every required suite/profile/replay group.
  Each merge checks all expected shard indexes, discovery identity agreement,
  exact selected-test multiset union, actual outcome presence for every test,
  result-to-selection equality and merged result-to-full-inventory equality.
  Discovery-only/empty-result reports cannot masquerade as executions.
  Missing or duplicate evidence fails.
  Merge errors are accumulated and rethrown, allowing the other required
  groups' failure reports to be produced without swallowing any failures.
  Combined JSON always uploads; combined HTML is generated/uploaded only for
  failures. An explicit merge root normalizes Windows blobs on Linux.
- Discovery uses Playwright's positive `--test-list` partitions, not ignore
  lists. Unknown/new cases are included with explicit fallback weights.
  Existing desktop WebKit 1 / phone WebKit 2 / Firefox 4 / ordinary Chromium 2 /
  design Chromium 4 / Windows 2 / accessibility 1 / performance 1 workers are
  preserved. Profiles assert a full registration of exactly 23 desktop or
  21 phone cases before partitioning. Replay is a separate required inventory
  executed once per engine, including when a preceding profile fails.

### Duration model, not post-change timing

`.github/scripts/playwright-test-durations.json` contains **3,412 full stable
identities and 10,221 historical observations** from the three sampled Quality
runs. Each weight is the median observed per-test elapsed seconds, including
all attempts; zero-attempt records are excluded. Keys are
`[project, relative file, ...nested describe path, title]`, preserving viewport,
theme and Unicode rather than collapsing leaf titles. The generated UTF-8
manifest is 512,007 bytes.

Every current suite has exact historical weights: **3,412/3,412 measured,
0 genuinely new/unmeasured cases**, including all 2,681 ordinary, 13
accessibility and 90 visual cases. Each plan records `measuredCases` and
an explicit `unmeasured` list with fallback seconds. Future unmatched cases
use clearly identified phase/class analogues, otherwise 120s for heavy files
or 10s for other cases; none currently relies on those fallbacks.
An intermediate Python inspection using Windows' default text encoding
misread Unicode and appeared to miss 452 cases; explicit UTF-8 and actual
Node identities establish the complete match above. No identity normalization
or lossy title substitution was introduced.

These are scheduling weights, not deadlines or assertions. Deterministic
longest-processing-time assignment balances measured work. Equal-load ties
prefer fewer assigned tests, so measured zero-duration cases do not create
empty partitions. The following **fully measured** model supersedes the
earlier class/fallback-only forecast:

| Partition family | Jobs | Current discovered cases | Estimated serial work per job | Ideal worker-adjusted estimate |
|---|---:|---:|---:|---:|
| Ordinary Chromium | 4 | 2,681 | 5,740.087–5,740.088s | 2,870.044s |
| Heavy Chromium | 12 | 221 | 3,781.396–3,784.897s | 945.349–1,207.555s |
| Accessibility | 1 | 13 | 63.134s | 63.134s |
| Performance | 1 | 9 | 23.576s | 23.576s |
| Windows visual | 4 | 90 | 86.931–87.161s | 43.465–43.581s |
| WebKit desktop profiles | 12 | 69 | 2,233.907–2,638.143s | unchanged: 1 worker |
| WebKit phone profiles | 6 | 63 | 2,749.332–3,059.633s | 1,374.666–1,529.817s |
| Firefox profiles | 6 | 132 | 2,409.831–4,119.058s | 602.458–1,029.764s |
| Firefox replay | no extra job | 57 | 646.200s | 161.550s |
| WebKit replay | no extra job | 57 | 1,474.365s | unchanged: 1 worker |

The five engine/replay inventories are separately required; engine smoke uses
three jobs and replay uses two existing profile runners. Replay adds work to
those two runners, not two additional jobs.
Worker-adjusted estimates take the maximum of total estimated work / workers
and the longest atomic case; they omit setup, scheduling and contention.
Historical Firefox reports in the
baseline used one actual worker while the inherited current workflow already
requested four: retaining that current setting is **not evidence of 4×
scaling**. This heterogeneity further limits forecasts.

| Measure | Before | Implemented/static verification | Achieved post-change CI |
|---|---|---|---|
| Browser execution jobs | 99 | 49, exact matrix/contract check | PENDING |
| Required profile union | 23 desktop / 21 phone | Same inventory, disjoint partitions | PENDING execution |
| Quality median wall | 3:31:25 | Provisional 120–170 min scenario, not a promise | PENDING |
| Quality median runner minutes | 1,998.98 | Fewer setup events; no measured new total | PENDING |
| Largest eligible queue | 73:23 | Fewer queued tiny jobs; no quota assumption | PENDING |
| Cache miss/hit setup | Baseline costs below | Exact-key behavior contracted | PENDING cold/warm runs |
| Combined report merging | Separate shard reports | Native fixture and required helper merges verified | PENDING full CI payloads |

**Ownership blocker resolved with explicit approval:** only the existing
workflow-layout contract block in `web/e2e/harness.contract.spec.ts` was
updated. Its old 32/24/8/13/32/3 assertions demonstrably failed against the
new layout; the corrected contract preserves single-build, managed-preview,
exact partition, no-snapshot-update, full profile/replay, worker, strict
summary and wrapper behavior protections. No other web file was edited.

### Always-available blobs are not failure-only artifacts

Native Playwright 1.63 blobs include successful screenshots as inline base64
in `onAttach`, and file attachments as ZIP resources. Merely making HTML
failure-only does **not** make successful uploads small.

The helper now streams the native ZIP/JSONL in two passes using the pinned
Playwright ZIP utilities. Only tests whose every recorded attempt actually
passed with expected status `passed` and no errors qualify for binary
compaction. Successful image/video/ZIP/binary/HTML attachments become small
native JSON attachments containing original name/type/path, SHA-256 and byte
count. Small JSON/text evidence remains intact. Combined compact JSON exposes
the successful binary metadata as `successEvidence`.

Failed, flaky, unexpected-pass, timed-out and skipped/interrupted outcomes
never qualify, nor do tests without a completed successful outcome.
Their attachment events/resources remain unchanged.
Resources shared with a failed test are retained; deletion applies only to
success candidates with no surviving stream references. Test IDs, registration,
outcomes, durations, errors, annotations, assertion steps and all other native
events remain untouched. Malformed JSONL or a missing `onEnd` fails packaging;
missing/invalid actual outcomes fail required merging rather than becoming
successful summaries. Packaging errors are not swallowed.

**Blobs plus small JSON always upload**, including on shard failures, because
the existing required summaries need those blobs for native merging.
Full HTML and heavy failure directories remain failure-only. Rewriting is
packaging after assertions, not a change to screenshot sources or product
behavior. No assertion, timeout, retry, worker count or test inventory changes.

A session-only browser-free reporter fixture attaches real noisy PNGs both
inline and by file, with success-only, failed and shared resources. It runs one
passing case alone, then one pass plus one intentional failure. Actual native
`merge-reports` JSON and failure HTML generation were exercised. All non-attach
events and failed attachment/resource bytes were compared exactly, plus
registered/full-result identities and JSON results/errors/assertion steps:

```text
Blob compacted: 4 successful binary attachments / 3153700 original bytes; failed/flaky resources unchanged
PASS success: ZIP 3159254 -> 2252 bytes; 1 exact test identities; native merge exits 0/0; results/errors/assertion steps unchanged; failed/shared resources byte-identical
PASS required success merge: exit 0; exact actual-results/full-registration union; successful compact blob accepted
Blob compacted: 4 successful binary attachments / 3153700 original bytes; failed/flaky resources unchanged
PASS mixed: ZIP 6323733 -> 3166913 bytes; 2 exact test identities; native merge exits 0/0; results/errors/assertion steps unchanged; failed/shared resources byte-identical
PASS required mixed merge: exit 1; exact actual-results/full-registration union; failure HTML retained; failed results reject summary
```

These are **fixture byte counts**, not measured production artifact savings.
The fixture and driver are only in the approved session evidence directory:
`node <evidence>\validate-blob-compaction.mjs`.
Native merge itself exits zero even with failed tests, so the helper explicitly
rejects unexpected results/report errors **after producing failure HTML**;
the existing always-run dependency guards also reject failed/cancelled/skipped
jobs. Executing those exact source Python guards with every required dependency
in each bad state verified all 33 negative/success combinations.

### Exact before/after inventory

| Inventory | Before | After |
|---|---:|---:|
| Ordinary Chromium partitions / cases | 24 / 2,681 | 4 / 2,681 |
| Heavy Chromium partitions / cases | 8 / 221 | 12 / 221 |
| Accessibility partitions / cases | 13 / 13 | 1 / 13 |
| Performance partitions / cases | 1 / 9 | 1 / 9 |
| Engine smoke jobs / cases | 9 / 20 | 3 / 20 |
| Windows visual partitions / cases | 32 / 90 | 4 / 90 |
| Firefox profile jobs / cases | 6 / 132 | 6 / 132 |
| WebKit profile jobs / cases | 6 / 132 | 18 / 132 |
| Replay per engine / cases | once / 57 each | once / 57 each |
| Browser execution jobs | 99 | 49 |
| Unique full product test identities | 3,412 | 3,412 |
| Full harness contract registration | 97 | 97 |

Both desktop engines retain exactly 23 cases per theme; phone profiles retain
21. All three themes and all 27 packs remain covered by unchanged product
tests. The complete historical manifest key set equals the current full
inventory; actual selected `npx --list` reports also prove all 22 disjoint
suite/profile multiset unions. Source contract registration remains unchanged;
its exact before/after discovery is checked separately below.

### Implementation validation — exact commands and terminal output

Run from the repository root:

```powershell
node --test .github\scripts\ci_workflows.test.mjs
& 'C:\Users\AtulM\go\bin\actionlint.exe' .github\workflows\frontend-quality.yml .github\workflows\ci.yml
node --check .github\scripts\playwright-duration-shards.mjs
node --check .github\scripts\ci_workflows.test.mjs
git --no-pager diff --check
```

Final contract output:

```text
✔ unit shard matrices match strict merge counts and never fail-fast (1.4714ms)
✔ existing required summary names and complete dependency gates remain strict after report merging (0.1819ms)
✔ cheap validations and unit tests start independently of the shared browser build (0.1323ms)
✔ node_modules caches require exact OS, architecture, resolved Node and lockfile keys, without fallbacks (0.3412ms)
✔ browser caches use actual Playwright versions and Edge caches its real system executable (0.4722ms)
✔ 49 execution jobs reuse the sole build while balancing heavy cases and consolidating tiny shards (0.4387ms)
✔ full engine/width/theme profiles and replay have exact partitions with unchanged capacity workers (0.4968ms)
✔ summary jobs require every suite blob merge and publish combined failure HTML only on failure (0.4645ms)
✔ duration balancing uses every full test identity once and rejects missing or duplicated cases (7.0751ms)
✔ parallelization introduces no additional nonblocking test exceptions (0.2145ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 209.8005
actionlint exit: 0
helper syntax exit: 0
workflow contracts syntax exit: 0
diff --check exit: 0
```

Discovery artifacts/scripts are under the approved evidence directory,
`C:\Users\AtulM\.copilot\session-state\42ddcb78-0f3e-497f-9ba5-dd5ef37ea894\files\ci-perf-baseline`.
The validation driver derives the 49 execution partitions directly from
workflow matrices and adds the two replay inventories. It invokes helper
`plan` (actual installed Playwright CLI full and selected discovery), then
independently invokes **actual `npx` discovery for every partition**, from
`web`, without a preview process or test execution:

```powershell
& "$evidence\validate-npx-discovery.ps1"
# The script's exact per-partition invocation:
& npx --no-install playwright test @listArgs > (Join-Path $directory.FullName 'actual-npx-list.json')
# listArgs = plan.settings.args plus --test-list=<that partition's tests.txt>, --list, --reporter=json
# Independent full quality inventory:
& npx --no-install playwright test '--project=chromium-*-*' '--project=chromium-smoke' --list --reporter=json
```

`discovery/partition-*/plan.json` retains every exact argument, fully-qualified
test identity and selected-test list. The verifier compares selected identities
both to the current balancing implementation and actual `npx` discovery, then
compares every suite/profile's **multiset**, not a deduplicated set.
After switching to the exact per-test manifest, all 51 plans and actual
`npx --list` partitions were regenerated and verified against the current
balancer. Every plan reports zero unmeasured cases. No product browser scenario
or server was run. The separately authorized browser-free contracts and native
reporter/merge fixture were executed.
Node 26 emitted experimental `localStorage` warnings during discovery; they
were not suppressed and all discovery commands exited zero.

```text
UNION ordinary: 4 partitions; 2681 cases; no lost/duplicated tests
UNION design: 12 partitions; 221 cases; no lost/duplicated tests
UNION a11y: 1 partitions; 13 cases; no lost/duplicated tests
UNION performance: 1 partitions; 9 cases; no lost/duplicated tests
UNION engine-firefox: 1 partitions; 8 cases; no lost/duplicated tests
UNION engine-webkit: 1 partitions; 8 cases; no lost/duplicated tests
UNION engine-edge: 1 partitions; 4 cases; no lost/duplicated tests
UNION profile-firefox-1440-dark: 1 partitions; 23 cases; no lost/duplicated tests
UNION profile-firefox-1440-light: 1 partitions; 23 cases; no lost/duplicated tests
UNION profile-firefox-1440-custom: 1 partitions; 23 cases; no lost/duplicated tests
UNION profile-firefox-390-dark: 1 partitions; 21 cases; no lost/duplicated tests
UNION profile-firefox-390-light: 1 partitions; 21 cases; no lost/duplicated tests
UNION profile-firefox-390-custom: 1 partitions; 21 cases; no lost/duplicated tests
UNION profile-webkit-1440-dark: 4 partitions; 23 cases; no lost/duplicated tests
UNION profile-webkit-1440-light: 4 partitions; 23 cases; no lost/duplicated tests
UNION profile-webkit-1440-custom: 4 partitions; 23 cases; no lost/duplicated tests
UNION profile-webkit-390-dark: 2 partitions; 21 cases; no lost/duplicated tests
UNION profile-webkit-390-light: 2 partitions; 21 cases; no lost/duplicated tests
UNION profile-webkit-390-custom: 2 partitions; 21 cases; no lost/duplicated tests
UNION visual: 4 partitions; 90 cases; no lost/duplicated tests
UNION replay-firefox: 1 partitions; 57 cases; no lost/duplicated tests
UNION replay-webkit: 1 partitions; 57 cases; no lost/duplicated tests
PASS: actual Playwright --list for 51 partitions; 22 exact suite/profile multiset unions; ordinary+design equals the complete unfiltered quality inventory.
PASS: actual npx Playwright discovery for 51 partitions; 22 exact multiset unions; 2902 unfiltered quality tests; no lost or duplicated tests.
```

The originally anchored `--grep` matched no tests; removing the invalid
full-title anchors selected exactly the intended pre-change contract and
reproduced its 32-versus-4 failure. Post-change, only the three directly related
browser-free tests were run:

```powershell
cd web
npx --no-install playwright test --config=playwright.contract.config.ts --grep='CI shares one hermetic build and gives each browser shard one managed preview|authenticated smoke records only sanitized aggregate status|local suite wrapper separates build time from preview readiness' --workers=1 --reporter=line,json "--output=$evidence\layout-contract-after"
```

`PLAYWRIGHT_JSON_OUTPUT_NAME` was set to the session's
`layout-contract-after.json` for execution, then cleared before full `--list`
stdout capture. An initial capture that retained this variable produced a
listing rather than stdout JSON; the corrected capture and comparison passed:

```text
Running 3 tests using 1 worker
  3 passed (645ms)
Selected browser-free contracts exit: 0
PASS full harness registration: 97 before / 97 after; exact identity multiset unchanged
PASS exact historical/current product inventory: 3412 before / 3412 after; 3412 measured; 0 fallbacks
All seven owned files (including untracked helper/manifest/report): no trailing whitespace; final newlines present.
PASS chromium-quality: actual source gate accepts all-success and rejects every failed/cancelled/skipped dependency (10 cases)
PASS cross-browser: actual source gate accepts all-success and rejects every failed/cancelled/skipped dependency (13 cases)
PASS visual: actual source gate accepts all-success and rejects every failed/cancelled/skipped dependency (10 cases)
PASS required-summary negative gate checks: 33 actual Python executions
TypeScript exit: 0
Existing audit script exit: 0 (script excludes spec files; direct changed-line checks follow)
Changed contract block inline_styles: 0
Changed contract block raw_html: 0
Changed contract block direct_libraries: 0
Changed contract block old_api: 0
Changed contract block double_api_prefix: 0
Changed contract block camel_query_params: 0
Changed contract block suppressions: 0
```

Audit command: existing `.github\skills\audit-violations\audit.sh` with only
`web\e2e\harness.contract.spec.ts` as target, via Git Bash path conversion.
It runs `npx tsc --noEmit`, which passed (also independently run with exit 0).
Because the existing script excludes spec files, the additional actual
`rg --count-matches --regexp <rule>` invocations consumed only added lines from
`git diff --unified=0 -- web/e2e/harness.contract.spec.ts`; no new exclusion or
suppression was added. Those direct counts, not the excluded-file audit alone,
cover the approved contract changes.

Application builds, hook audits, page line/section comparisons, full harness
execution and local product browser suites were not run: no application/
page/hook/snapshot was edited and only relevant browser-free selection was
authorized. All requested implementation requirements are present; full CI
payload/timing and cold/warm cache effects remain unverified. Phase 5 remains
proposal-only. No commit/push/cancel/rerun/server operations were performed.

## Scope and evidence

Measured on 2026-11-17 for `design-packs-v2`, independently of failure fixing.
The historical baseline below was collected as **Phase 1 measurement and
Phase 5 proposals only**, before the separately authorized Phases 2–4 changes
above. Baseline collection made no workflow, source, test, snapshot,
dependency, runner, concurrency, or approval-gate changes. Neither phase
commits, pushes, cancels/reruns workflows, runs local browser suites, or
operates servers.

All six samples are completed, non-cancelled **PR-branch** runs, attempt 1.
There was no scarcity and **no branch/repository scope expansion**. Failed
completed workflows are included; they are not passing-performance baselines.
In-flight Quality run **44147086805**, head
`c287aad7c571678f7184448e3968029726dd83c4`, is excluded. Its discovery response
reported `queued`; this does not make it a completed sample.

Branch discovery returned this actual output:

```text
quality total 46 returned 46 eligible 6 selected [(43854216444, 1, 'pull_request'), (43794679184, 1, 'pull_request'), (43750981325, 1, 'pull_request')]
ci total 46 returned 46 eligible 32 selected [(44130431512, 1, 'pull_request'), (44099225363, 1, 'pull_request'), (44074313491, 1, 'pull_request')]
```

Evidence and measurement scripts are retained exclusively under:

```text
C:\Users\AtulM\.copilot\session-state\42ddcb78-0f3e-497f-9ba5-dd5ef37ea894\files\ci-perf-baseline
```

The directory contains workflow/run/job/artifact API responses, historical
workflow definitions for all six SHAs, `measure.py`, `metrics.json`,
`jobs-measured.csv`, and `steps-measured.csv`. The CSVs retain all **432
executed jobs** and their individual step timestamps; three additionally
listed optional production-smoke jobs were skipped. Per-job elapsed time,
checkout, npm installation, browser installation, artifact download, timed
test steps, dispatch delay, dependency wait, and eligible queue are separate
fields. Latest-sample per-job figures are reproduced below.

### Exact read-only API collection

Commands were run from PowerShell; redirection targets are in the evidence
directory, not the repository. `gh api` requests below are GETs. The branch
filters use `--method GET` because `-f` otherwise changes the method.

```powershell
$a='C:\Users\AtulM\.copilot\session-state\42ddcb78-0f3e-497f-9ba5-dd5ef37ea894\files\ci-perf-baseline'
gh api repos/ev-dev-labs/teslasync/actions/workflows/frontend-quality.yml/runs --paginate -f branch=design-packs-v2 -f per_page=100 --method GET > "$a\quality-runs.json"
gh api repos/ev-dev-labs/teslasync/actions/workflows/ci.yml/runs --paginate -f branch=design-packs-v2 -f per_page=100 --method GET > "$a\ci-runs.json"
$ids=43854216444,43794679184,43750981325,44130431512,44099225363,44074313491
foreach($id in $ids) {
  gh api "repos/ev-dev-labs/teslasync/actions/runs/$id" > "$a\run-$id.json"
  gh api "repos/ev-dev-labs/teslasync/actions/runs/$id/jobs?per_page=100" --paginate > "$a\jobs-$id.json"
  gh api "repos/ev-dev-labs/teslasync/actions/runs/$id/artifacts?per_page=100" --paginate > "$a\artifacts-$id.json"
}
```

One initial jobs request returned HTTP 502; it was successfully replaced by:

```powershell
gh api 'repos/ev-dev-labs/teslasync/actions/runs/43854216444/jobs?per_page=100' --paginate --slurp > "$a\jobs-43854216444.json"
gh api repos/ev-dev-labs/teslasync/check-runs/133255001561 > "$a\check-run-133255001561.json"
gh api 'repos/ev-dev-labs/teslasync/contents/.github/workflows/frontend-quality.yml?ref=c49504c576f64ce61cfd0ea8f0bcc4360b2eef2e' > "$a\quality-workflow-content.json"
gh api 'repos/ev-dev-labs/teslasync/contents/.github/workflows/ci.yml?ref=8658d427f1367c60bfe6c6ed025e3461510885b0' > "$a\ci-workflow-content.json"
```

The same contents GET was also executed for:

| Workflow path | Historical ref |
|---|---|
| `.github/workflows/frontend-quality.yml` | `46871c6b8a9e37361372d82200241c611a091d6c` |
| `.github/workflows/frontend-quality.yml` | `23e0cf85c9a01f6e8415e3b3e2ec8d87c6aa26ec` |
| `.github/workflows/ci.yml` | `fc7d10a6d14ff95ed8ca7f23a279c8062b9ab13f` |
| `.github/workflows/ci.yml` | `8c85d7f51b5bcc821a34f0044df7b1402cb8127e` |

Those additional requests expanded to:

```powershell
gh api 'repos/ev-dev-labs/teslasync/contents/.github/workflows/frontend-quality.yml?ref=46871c6b8a9e37361372d82200241c611a091d6c'
gh api 'repos/ev-dev-labs/teslasync/contents/.github/workflows/frontend-quality.yml?ref=23e0cf85c9a01f6e8415e3b3e2ec8d87c6aa26ec'
gh api 'repos/ev-dev-labs/teslasync/contents/.github/workflows/ci.yml?ref=fc7d10a6d14ff95ed8ca7f23a279c8062b9ab13f'
gh api 'repos/ev-dev-labs/teslasync/contents/.github/workflows/ci.yml?ref=8c85d7f51b5bcc821a34f0044df7b1402cb8127e'
```

All sampled workflow dependency graphs matched the measurement mapping.
Pagination was decoded as multiple JSON documents, or a slurped page array:
each Quality run had **107 jobs across two pages**, not just the first 100;
each CI run had 38 jobs. Artifact manifests were complete at 99/99 for each
Quality sample and 23/23 for each CI sample.

## Definitions and limitations

- **Workflow wall:** run `updated_at − created_at` on a completed run. Also
  retain execution span, from first actual job start to last job completion.
  Final run-record bookkeeping is included in wall time.
- **Runner minutes:** sum of non-skipped jobs' `completed_at − started_at`,
  divided by 60. These are elapsed occupied-job minutes, **not billed minutes**:
  no OS billing multipliers or per-job billing rounding are applied.
- **Dependency waiting:** a job cannot run before the last required predecessor
  completes. Dependencies come from the workflow at the sampled SHA, including
  all members of matrix jobs.
- **Eligible queue:** job `started_at − max(created_at, required predecessors'
  completed_at)`. In these samples creation was at/after dependency readiness,
  so it equals job creation-to-start. This is observed eligible scheduling/
  runner wait, not time spent waiting for `needs`. It cannot separate runner
  allocation, provisioning, or scheduler policies, and does not establish an
  organization's runner quota. Pre-creation dispatch delay is separate.
- **Test time:** sum of executed test-step timestamp intervals. Includes the
  command's harness/server startup, reporting, and existing retries; mixed
  architecture/regression test steps also include their associated checks.
  Builds, lint-only steps, coverage merging, and registration-only discovery
  are not relabelled as test execution. Per-test reporter durations below
  provide a different, finer-grained measurement; overlapping workers mean
  they must not be added to workflow wall time.
- **Critical path:** trace backwards from the last completing job, choosing
  the last completing required predecessor at each join. Report dispatch,
  eligible queue, execution, and final bookkeeping separately. This is the
  *observed* bottleneck, not an assurance the same branch remains critical
  after an optimization.

Check-run timestamps corroborated a sampled job exactly:

```text
check-run corroboration 133255001561 2026-11-16T11:04:35Z 2026-11-16T11:08:44Z completed success
```

No timestamp was fabricated for job creation, workflow completion, or an
organization-level queue event unavailable from these APIs.

## Before figures: completed runs

Rows are newest first within each workflow. Times are `h:mm:ss` or `m:ss`.
Each run ID links to its original evidence.

| Workflow / run | UTC created → updated | Result | Wall | Execution span | Runner min | Executed/listed jobs |
|---|---|---|---:|---:|---:|---:|
| Quality [43854216444](https://github.com/ev-dev-labs/teslasync/actions/runs/43854216444) | Nov 16 11:02:44 → 14:34:09 | failure | 3:31:25 | 3:29:33 | 2,126.40 | 106/107 |
| Quality [43794679184](https://github.com/ev-dev-labs/teslasync/actions/runs/43794679184) | Nov 16 02:51:41 → 06:06:51 | failure | 3:15:10 | 3:15:07 | 1,998.98 | 106/107 |
| Quality [43750981325](https://github.com/ev-dev-labs/teslasync/actions/runs/43750981325) | Nov 15 19:10:59 → 23:16:58 | failure | 4:05:59 | 4:05:02 | 1,991.55 | 106/107 |
| CI [44130431512](https://github.com/ev-dev-labs/teslasync/actions/runs/44130431512) | Nov 17 16:51:03 → 17:19:50 | success | 28:47 | 28:43 | 191.23 | 38/38 |
| CI [44099225363](https://github.com/ev-dev-labs/teslasync/actions/runs/44099225363) | Nov 17 14:04:55 → 14:26:17 | success | 21:22 | 21:18 | 191.67 | 38/38 |
| CI [44074313491](https://github.com/ev-dev-labs/teslasync/actions/runs/44074313491) | Nov 17 11:28:23 → 11:53:28 | success | 25:05 | 23:31 | 188.60 | 38/38 |

Median before values: **Quality 3:31:25 wall / 1,998.98 runner min**;
**CI 25:05 wall / 191.23 runner min**. Three heterogeneous commits per
workflow are an observational sample, not a statistically controlled trial.

### Aggregate setup and timed tests

All values below are **summed runner minutes**, not critical-path minutes.
Toolchain and runner/container setup remain separate from the four requested
setup costs. Artifact upload, builds, lint, merges and other work are not
silently treated as tests; residual job time is present in the raw step CSV.

| Run | Checkout | npm ci | Browser install | Artifact download | Toolchain setup | Runner/container setup | Timed tests |
|---|---:|---:|---:|---:|---:|---:|---:|
| 43854216444 | 100.15 | 20.98 | 9.42 | 2.65 | 19.00 | 28.60 | 1,929.97 |
| 43794679184 | 51.10 | 20.82 | 8.90 | 2.55 | 15.62 | 29.70 | 1,854.70 |
| 43750981325 | 51.92 | 20.27 | 9.22 | 2.57 | 15.87 | 29.25 | 1,847.63 |
| 44130431512 | 32.37 | 1.62 | 0.00 | 0.10 | 4.98 | 8.35 | 104.20 |
| 44099225363 | 32.50 | 1.58 | 0.00 | 0.05 | 4.92 | 8.93 | 103.65 |
| 44074313491 | 26.60 | 1.63 | 0.00 | 0.07 | 4.47 | 8.02 | 110.80 |

### Critical paths and slowest individual jobs

| Run | Observed critical dependency chain | Slowest individual job / elapsed | Queue on critical chain |
|---|---|---|---:|
| 43854216444 | Shared build → WebKit 1440/dark → **edge** critical-smoke aggregate | WebKit 1440/dark, 3:19:02 | 7:24 |
| 43794679184 | Shared build → Chromium responsive-32 → Chromium aggregate | WebKit 1440/dark, 3:06:46 (**not** critical) | 36:43 |
| 43750981325 | Shared build → WebKit 1440/dark → WebKit aggregate | WebKit 1440/dark, 3:55:13 | 8:27 |
| 44130431512 | Frontend tests 3/8 → merge frontend coverage → frontend aggregate → final CI gate | Frontend tests 3/8, 14:34 | 11:16 |
| 44099225363 | Frontend tests 1/8 → merge frontend coverage → frontend aggregate → final CI gate | Frontend tests 4/8, 15:19 (**not** critical) | 8:11 |
| 44074313491 | Frontend tests 5/8 → merge frontend coverage → frontend aggregate → final CI gate | Frontend tests 6/8, 15:20 (**not** critical) | 6:45 |

The engine aggregates depend on **all** application-design matrix jobs;
the edge-named aggregate can therefore be gated by WebKit. Naming does not
imply Edge browser execution caused that bottleneck.

Latest Quality critical timeline, all on 2026-11-16 UTC:

| Event | Actual timestamps | Elapsed |
|---|---|---:|
| Workflow creation → shared-build job creation | 11:02:44 → 11:04:18 | 1:34 dispatch, not assigned to runner queue |
| Shared-build eligible queue | 11:04:18 → 11:04:42 | 0:24 |
| Shared-build execution | 11:04:42 → 11:08:03 | 3:21 |
| WebKit 1440/dark eligible queue, **after build completed** | 11:08:03 → 11:15:01 | 6:58 |
| WebKit 1440/dark execution | 11:15:01 → 14:34:03 | 3:19:02 |
| Edge aggregate queue / execution | 14:34:03 → 14:34:05 / 14:34:05 → 14:34:08 | 0:02 / 0:03 |
| Workflow bookkeeping | 14:34:08 → 14:34:09 | 0:01 |

The latest Quality critical WebKit job contains **42s checkout, 8s npm ci,
0s browser install, 2s artifact download, 12s toolchain setup, 29s container/
runner setup, and 11,830s timed tests**. The build's corresponding checkout/
npm/toolchain costs are 78s/11s/9s. The bottleneck is not browser download.

Latest CI critical execution / eligible-queue seconds:

```text
Frontend tests (3/8)                  execution 874   queue 318
Merge frontend coverage              execution 169   queue 194
Frontend (lint + test + build)        execution   2   queue 114
CI (all checks)                      execution   4   queue  50
```

Including 1s initial dispatch and 1s final bookkeeping gives 1,727s = 28:47.
The 874s test-shard job includes 791s timed tests; coverage merging is separate
work. The shortest-running final gates still incur substantial scheduling
delay, so more test sharding alone would not eliminate CI's latency.

## Queue and observed concurrency

Summed queue minutes represent many jobs waiting concurrently: they are
**not** additional workflow wall or runner usage.

| Run | Eligible queue sum, min | Maximum eligible queue | Jobs queued >60s | Peak executing jobs | Peak Linux / Windows |
|---|---:|---:|---:|---:|---:|
| 43854216444 | 2,501.12 | 66:02 | 99/106 | 20 | 20 / 6 |
| 43794679184 | 2,744.72 | 73:23 | 99/106 | 20 | 20 / 7 |
| 43750981325 | 2,023.90 | 52:35 | 96/106 | 20 | 20 / 6 |
| 44130431512 | 92.70 | 8:39 | 22/38 | 18 | 18 / 0 |
| 44099225363 | 72.45 | 6:27 | 23/38 | 19 | 19 / 0 |
| 44074313491 | 56.50 | 5:52 | 19/38 | 19 | 19 / 0 |

Linux and Windows maxima need not occur simultaneously. Peaks are calculated
by sweeping actual non-skipped job start/end intervals, not counting queued
jobs or multiplying matrix dimensions. This is a lower bound on concurrent
use across the organization; other runs, repositories, private workloads,
runner pools, entitlements, and organization-wide usage were **not** queried.
**Do not turn the observed peak of 20 into a claimed organization quota.**

Examples of genuine post-dependency wait, rather than `needs` waiting:

| Run / job | Created / started UTC | Eligible wait |
|---|---|---:|
| 43854216444 / Chromium responsive-26 | Nov 16 11:08:03 / 12:14:05 | 66:02 |
| 43794679184 / Chromium responsive-10 | Nov 16 02:54:17 / 04:07:40 | 73:23 |
| 43750981325 / Chromium responsive-27 | Nov 15 19:14:23 / 20:06:58 | 52:35 |
| 44130431512 / Frontend tests 4/8 | Nov 17 16:51:04 / 16:59:43 | 8:39 |
| 44099225363 / Frontend build | Nov 17 14:04:56 / 14:11:23 | 6:27 |
| 44074313491 / Frontend tests 8/8 | Nov 17 11:29:55 / 11:35:47 | 5:52 |

Waits well over one minute together with repeated 20-job Quality plateaus
**suggest saturation/shared scheduling contention**. They do not prove which
limit is binding. For contrast, latest Quality shared-build dependency wait
is 5:19 from run creation to build completion; WebKit's additional 6:58 queue
starts **after** that completion. The latest CI frontend aggregate waits for
dependencies until 17:16:59, then queues 1:54: the entire preceding 25:56 is
not runner-queue time.

## Per-test artifact analysis

The downloader reads the 99 artifact-manifest entries per Quality run, GETs
`https://api.github.com/repos/ev-dev-labs/teslasync/actions/artifacts/{artifact_id}/zip`,
then follows GitHub's signed download location without forwarding API
credentials. Credentials stay in process memory, not evidence files. An
initial attempt at ZIP byte-range extraction encountered HTTP 200 instead of
206; the replacement downloads each archive fully and retains the original
JSON/report files and a ZIP entry inventory. No remote artifact is changed.

Reproduction commands (no browsers or tests are launched):

```powershell
python "$a\measure.py" reports
python "$a\measure.py" other-reports
python "$a\measure.py" metrics
python "$a\measure.py" tests > "$a\test-analysis.txt"
```

Application-design `app-design-results.json` and dark-profile
`app-design-replay-results.json`, plus every other browser shard's
`test-results/results.json`, are the duration sources. HTML reports were also
retained and their embedded ZIP JSON format checked; duplicate HTML/JSON
views are **not counted twice**. The registration-only JSON is not mistaken
for an executed test report.

All **297/297** published Playwright evidence archives were extracted, with
zero final extraction errors: 36 application-design profile JSONs, six replay
JSONs, and 261 other shard JSONs, **303 executed-test reports total**.

| Quality run | Report JSONs | Reported test records |
|---|---:|---:|
| 43854216444 | 101 | 3,412 |
| 43794679184 | 101 | 3,406 |
| 43750981325 | 101 | 3,403 |
| Total | 303 | 10,221 |

These are **records, not 10,221 executed passing tests**: reported outcomes are
10,051 expected, 22 flaky, 19 unexpected, and **129 skipped**. Thus 10,092
records are non-skipped. Existing reports contain 17 two-attempt and 24
three-attempt cases; no retries or skips were introduced or changed here.
There are 43 skipped records per sampled run. Reported skipped-case duration
is not assumed zero: it totals 86.340s, with a 1.453s maximum, and none enters
the top thirty.
Their presence must not be used as evidence that every registered case
executed or that all required coverage passed.

Across commits these represent **3,412 unique reported test identities**, preserving
nested suite paths so viewport/theme cases sharing a leaf title are not
mistakenly collapsed. Exact identity sets differ between commits; no assertion
that these are byte-identical suites or controlled performance replicates
is made.

### Thirty slowest unique tests

Ranked by the **largest observed total duration for one test execution across
the three sampled runs**, using `(project, source file, nested suite path,
title)` as identity.
Existing retries are summed within an execution, not across runs. In these
30 rows there is one attempt each and outcome `expected`, so total duration
equals longest-attempt duration. They are genuinely long successful cases,
not thirty timeout/retry duplicates. This does **not** make their enclosing
workflows green.

Source keys below expand to `widget-design-packs.app.spec.ts` (app),
`widget-design-packs.native.spec.ts` (native), and
`widget-design-packs.energy.spec.ts` (energy), under `web/e2e`.
For app rows, `1440/dark: core interactions` abbreviates the exact title
`Application design languages at 1440px in dark — phase core interactions`;
other phases/profiles expand identically. Native and energy titles are
reproduced in full. `W` = `app-design-webkit`; `C` = `chromium-smoke`.

| Rank | Project / file | Test title or app profile: phase | Seconds | Sample run |
|---:|---|---|---:|---|
| 1 | C / native | Native record-states real routes at 1440px in light | 1234.038 | 43750981325 |
| 2 | W / app | 1440/dark: core interactions | 1170.275 | 43750981325 |
| 3 | C / native | Native record-states real routes at 1440px in dark | 1160.396 | 43750981325 |
| 4 | W / app | 1440/dark: responsive 2560px | 1114.536 | 43750981325 |
| 5 | C / native | Native record-states real routes at 390px in dark | 1074.589 | 43750981325 |
| 6 | C / native | Native record-states real routes at 390px in light | 1066.703 | 43750981325 |
| 7 | W / app | 1440/dark: responsive 1920px | 1017.652 | 43750981325 |
| 8 | C / energy | Energy flow real source states at 1440px in light | 1014.576 | 43750981325 |
| 9 | W / app | 1440/custom: core interactions | 991.187 | 43854216444 |
| 10 | W / app | 1440/dark: responsive 768px | 991.134 | 43750981325 |
| 11 | W / app | 1440/custom: responsive 2560px | 964.053 | 43854216444 |
| 12 | W / app | 1440/dark: responsive 1024px | 964.051 | 43750981325 |
| 13 | W / app | 1440/dark: responsive 1440px | 952.304 | 43750981325 |
| 14 | W / app | 1440/light: core interactions | 949.740 | 43794679184 |
| 15 | W / app | 1440/dark: core accessibility-media-screens | 924.305 | 43750981325 |
| 16 | C / energy | Energy flow real source states at 1440px in dark | 917.139 | 43750981325 |
| 17 | W / app | 1440/custom: responsive 1920px | 908.739 | 43854216444 |
| 18 | W / app | 1440/dark: responsive 1280px | 906.586 | 43750981325 |
| 19 | W / app | 1440/light: responsive 2560px | 882.990 | 43794679184 |
| 20 | W / app | 1440/light: responsive 1920px | 875.414 | 43794679184 |
| 21 | C / energy | Energy flow real source states at 390px in light | 860.383 | 43750981325 |
| 22 | W / app | 1440/custom: responsive 768px | 854.268 | 43854216444 |
| 23 | W / app | 390/light: core interactions | 849.644 | 43854216444 |
| 24 | W / app | 1440/custom: responsive 1024px | 845.111 | 43854216444 |
| 25 | W / app | 1440/light: responsive 1440px | 823.916 | 43794679184 |
| 26 | C / energy | Energy flow real source states at 390px in dark | 822.868 | 43750981325 |
| 27 | W / app | 1440/custom: responsive 1440px | 806.874 | 43854216444 |
| 28 | W / app | 390/custom: core interactions | 806.777 | 43794679184 |
| 29 | C / native | Native progress-states real routes at 1440px in dark | 793.706 | 43794679184 |
| 30 | C / native | Native progress-states real routes at 1440px in light | 791.960 | 43750981325 |

Every `C` row above comes from `chromium-responsive-32-report`; each `W` row
comes from `app-design-webkit-{width}-{theme}-attempt-1` for the displayed
profile. Exact original titles, sample runs, source artifacts, outcomes,
attempt counts, total durations, and longest-attempt durations are retained
in `playwright-test-durations.csv` and `slowest-30.json`.

The concentration in Chromium shard 32 and desktop WebKit explains why
optimizing only WebKit cannot reliably shorten workflow wall time. Other
shards can be short while a small number of compound design/route tests
execute for 13–21 minutes individually.

### Missing evidence / limits

- The one-day-retention `e2e-app` build payload is absent from the three
  completed Quality artifact manifests. Its build/download **timing** is
  available in job steps; its expired bytes were not reconstructed.
- The route-contract/discovery job publishes no retained per-test Playwright
  JSON artifact in these manifests; its step durations are measured, but it
  is outside the per-test artifact ranking.
- CI's 23 artifacts per sample are Vitest/native-coverage, backend test, and
  Docker build evidence, not Playwright reports. There is no missing CI
  browser suite to invent. Its test times here are measured from job steps.
- Historical application-design envelopes lack the newer `runtime` field:
  no actual CPU count, CPU utilization, memory pressure, organization quota,
  or cost invoice was obtained. Configured Playwright worker count is not
  hardware capacity.
- All three Quality samples failed, and their existing failure/retry behavior
  contributes to totals outside the top-30 table. There is no completed green
  full-Quality sample among the selected last three; no clean-run speedup or
  larger-runner scaling result is claimed.

## Phase 5: ranked proposals only

No option below is implemented or authorized by this measurement report.
Any future change must retain the full required assertions, coverage,
snapshots, browsers, and complete before-merge evidence. No retries, timeouts,
thresholds, ignores, skips, or suppressions are proposed.

1. **Fast PR subset plus full merge-queue browser matrix.** Highest potential
   PR-feedback benefit. Keep an explicitly required, complete browser/design/
   visual matrix before merge; move expensive evidence, do not delete it.
   One illustrative subset retains contracts, shared build, ordinary Chromium
   responsive 1–24, accessibility, performance, engine smoke and all Windows
   visual jobs; full design jobs and Chromium responsive 25–32 remain required
   in the merge queue. Replaying only that subset at the *original observed
   start times* gives 69.33/84.72/82.42 min for oldest/middle/newest Quality
   samples, before replacement aggregate overhead: **110.45–176.65 min less
   PR-stage latency** than the observed full workflows. This is a conditional
   replay, not a measured optimized run or a guarantee. New queue competition,
   failures, and required-check wiring can change it. PR-stage occupied runner
   time in that replay is 321.33–381.97 min, versus 1,991.55–2,126.40 before.
   The full matrix still costs runner time and wall time before merge; running
   both stages can **increase total compute**. Existing CI already has a
   `merge_group` trigger, but Quality would need separately approved trigger,
   gate, artifact and branch-protection design. Nothing was changed here.
2. **Larger runners for WebKit, with a competing-Chromium control.** The slowest
   job is WebKit desktop/dark at 186.77–235.22 min, but WebKit is critical in
   only two of three samples. With every non-WebKit completion held fixed,
   even eliminating WebKit time entirely caps workflow savings at **49:40 /
   0:00 / 1:17** for oldest/middle/newest: Chromium responsive-32 becomes the
   floor. An illustrative 25–50% reduction in the slow WebKit job is about
   47–118 job-min saved, **not** equivalent workflow savings and **not a
   measured scaling factor**. Budget 0–49.67 min workflow benefit across these
   samples until an approved controlled comparison demonstrates CPU/rendering
   scalability; larger-runner billing and scheduling may negate savings.
   Do not assume failure/assertion waits disappear with more CPU or compensate
   by weakening assertions. Chromium's competing path must be measured too.
3. **Immutable custom image with Node, lockfile-keyed node_modules and browsers.**
   Existing Linux browser jobs already use the Playwright browser image, and
   the latest critical job installs no browser. Linux-only npm ci + browser
   install totals are 10.68–11.63 runner min; adding all Linux toolchain-setup
   time gives an optimistic **18.22–22.13 runner-min gross ceiling** per
   Quality run. Only about **33–40s** of npm/Node setup is on the observed
   critical chains. Expected net wall benefit is **0–40s**, potentially
   negative with a larger cold image; those ceilings assume all measured
   setup is removable, which it is not necessarily. Windows contributes
   another 18.12–18.80 min npm/browser setup and is **not** optimized by a
   Linux container. A future image needs lockfile/runtime provenance, security
   maintenance, invalidation, and cold/warm pull measurements. Checkout cost
   (51–100 runner min) remains; preinstalled dependencies do not fix it.
4. **Test-impact analysis with a mandatory full run before merge.** Highest
   uncertainty: no validated test-to-source dependency graph, false-negative
   rate, or historical replay exists in this evidence. Treat guaranteed
   savings as **0**. If it eventually selected exactly the illustrative subset
   above, that scenario's PR-stage 110–177 min latency range is an upper
   *scenario*, not an independent forecast or additional saving. Changes to
   shared styles, typography, widgets, routing, units, build tooling and test
   harnesses can invalidate broad design/browser coverage. Prove impact
   selection in shadow mode against full runs first; keep full before-merge
   coverage and no ignore lists. Combined PR+merge compute may still rise.

**Direction:** obtain reliable complete green samples alongside failure
fixing, then favor moving the intact slow matrix to a required merge-stage
with explicit PR-feedback scope. Do not start by adding shards against an
already queued runner pool or by assuming browser installation dominates.

## Validation and change boundary

During baseline collection this report was the only repository file authored
by the performance task. Subsequent authorized implementation owns only this
report, the two workflow files, `ci_workflows.test.mjs`, the new
`playwright-duration-shards.mjs` helper and measured
`playwright-test-durations.json` manifest, plus the explicitly approved
workflow-layout contract block in `web/e2e/harness.contract.spec.ts`.
Inherited edits in `CI-MAP.md`, `DECISIONS.md`, `FIXLIST.md`, and `HANDOFF.md`
were present before measurement and were not altered by this task.
Application builds, hook validation and local whole browser suites were
**not run**: no application source changed, and local whole-suite/shard
execution was explicitly out of scope. Implementation TypeScript/audit,
workflow contracts, browser-free selected contracts, discovery and the
authorized session-only reporter fixture are documented separately above.

Measurement verification command:

```powershell
python "$a\verify.py" reports
```

Actual final output:

```text
Frontend Quality Gates 43750981325: wall=14759s runner=1991.55min jobs=106 queue_max=3155s
Frontend Quality Gates 43794679184: wall=11710s runner=1998.98min jobs=106 queue_max=4403s
Frontend Quality Gates 43854216444: wall=12685s runner=2126.40min jobs=106 queue_max=3962s
CI 44074313491: wall=1505s runner=188.60min jobs=38 queue_max=352s
CI 44099225363: wall=1282s runner=191.67min jobs=38 queue_max=387s
CI 44130431512: wall=1727s runner=191.23min jobs=38 queue_max=519s
PASS: 6 completed non-cancelled branch runs; 432 measured jobs; paginated counts, elapsed sums, queues and critical-chain wall decompositions reconcile.
PASS: 297 expected Playwright artifacts; 303 JSON reports; 10221 test records; 30 unique slowest-test identities verified.
PASS: report has no trailing whitespace and ends with a newline.
PASS: 144 documented per-job rows match the measured API-derived CSV exactly.
PASS: 30 documented titles, source files, projects, durations, attempts and sample IDs match the complete artifact ranking.
```

`git diff --check -- docs\design-packs\CI-PERF.md` emitted no output, but does
not inspect an untracked file. The additional read-only
`git diff --no-index --check -- NUL docs\design-packs\CI-PERF.md` emitted no
whitespace diagnostics and returned 1 for the new-file difference; this is
not presented as a zero-exit check. The explicit report whitespace/newline
assertions above cover the actual untracked file.

## Appendix: latest completed per-job before figures

All numbers are seconds. `Elapsed` is occupied job execution; `Queue` excludes
dependency wait. Setup columns and timed tests are subsets of elapsed, not an
exhaustive decomposition. Zero tests means no classified test step, **not**
that a build/lint/coverage gate did no work. All three samples' per-job and
step-by-step records remain in the evidence CSVs.

### Quality 43854216444

| Job | Elapsed | Queue | Checkout | npm ci | Browser | Download | Tests |
|---|---:|---:|---:|---:|---:|---:|---:|
| firefox application designs (1440px/custom) | 5233 | 423 | 73 | 11 | 0 | 3 | 5092 |
| firefox application designs (1440px/dark) | 5573 | 87 | 56 | 11 | 0 | 1 | 5458 |
| firefox application designs (1440px/light) | 3966 | 517 | 56 | 8 | 0 | 2 | 3848 |
| firefox application designs (390px/custom) | 2922 | 406 | 54 | 8 | 0 | 1 | 2813 |
| firefox application designs (390px/dark) | 3608 | 236 | 57 | 10 | 0 | 1 | 3497 |
| firefox application designs (390px/light) | 2788 | 88 | 45 | 8 | 0 | 2 | 2682 |
| webkit application designs (1440px/custom) | 10864 | 70 | 62 | 8 | 0 | 2 | 10730 |
| webkit application designs (1440px/dark) | 11942 | 418 | 42 | 8 | 0 | 2 | 11830 |
| webkit application designs (1440px/light) | 9096 | 101 | 30 | 6 | 0 | 2 | 9006 |
| webkit application designs (390px/custom) | 6222 | 536 | 58 | 6 | 0 | 2 | 6109 |
| webkit application designs (390px/dark) | 5176 | 237 | 51 | 6 | 0 | 1 | 5073 |
| webkit application designs (390px/light) | 7277 | 442 | 37 | 12 | 0 | 1 | 7185 |
| Shared hermetic browser build | 201 | 24 | 78 | 11 | 0 | 0 | 0 |
| Chromium responsive, a11y, keyboard, and performance | 2 | 2 | 0 | 0 | 0 | 0 | 0 |
| Chromium accessibility | 112 | 2605 | 51 | 6 | 0 | 1 | 7 |
| Chromium accessibility-10 | 124 | 2330 | 57 | 9 | 0 | 2 | 6 |
| Chromium accessibility-11 | 118 | 2935 | 55 | 8 | 0 | 1 | 6 |
| Chromium accessibility-12 | 112 | 2821 | 59 | 11 | 0 | 1 | 8 |
| Chromium accessibility-13 | 116 | 2196 | 61 | 10 | 0 | 2 | 7 |
| Chromium accessibility-2 | 115 | 2315 | 58 | 9 | 0 | 2 | 9 |
| Chromium accessibility-3 | 121 | 2206 | 64 | 11 | 0 | 1 | 9 |
| Chromium accessibility-4 | 114 | 2704 | 56 | 11 | 0 | 1 | 10 |
| Chromium accessibility-5 | 128 | 2065 | 66 | 12 | 0 | 2 | 9 |
| Chromium accessibility-6 | 116 | 3056 | 57 | 12 | 0 | 1 | 12 |
| Chromium accessibility-7 | 104 | 3826 | 56 | 6 | 0 | 1 | 7 |
| Chromium accessibility-8 | 120 | 3250 | 60 | 11 | 0 | 2 | 10 |
| Chromium accessibility-9 | 113 | 3847 | 51 | 6 | 0 | 1 | 6 |
| Chromium performance | 132 | 3932 | 55 | 8 | 0 | 1 | 26 |
| Chromium responsive-1 | 360 | 1413 | 52 | 6 | 0 | 2 | 259 |
| Chromium responsive-10 | 469 | 2133 | 57 | 11 | 0 | 1 | 367 |
| Chromium responsive-11 | 423 | 1481 | 57 | 9 | 0 | 2 | 310 |
| Chromium responsive-12 | 441 | 1037 | 37 | 11 | 0 | 2 | 357 |
| Chromium responsive-13 | 347 | 1452 | 54 | 5 | 0 | 0 | 252 |
| Chromium responsive-14 | 492 | 3331 | 64 | 9 | 0 | 2 | 374 |
| Chromium responsive-15 | 439 | 3563 | 57 | 11 | 0 | 1 | 337 |
| Chromium responsive-16 | 843 | 1496 | 38 | 12 | 0 | 2 | 755 |
| Chromium responsive-17 | 1262 | 2432 | 64 | 11 | 0 | 1 | 1149 |
| Chromium responsive-18 | 900 | 1802 | 50 | 6 | 0 | 2 | 796 |
| Chromium responsive-19 | 880 | 1907 | 50 | 6 | 0 | 1 | 779 |
| Chromium responsive-2 | 441 | 3728 | 55 | 8 | 0 | 1 | 334 |
| Chromium responsive-20 | 929 | 3697 | 61 | 11 | 0 | 2 | 819 |
| Chromium responsive-21 | 846 | 2879 | 59 | 8 | 0 | 3 | 728 |
| Chromium responsive-22 | 1023 | 2224 | 56 | 8 | 0 | 1 | 909 |
| Chromium responsive-23 | 572 | 1138 | 57 | 10 | 0 | 2 | 468 |
| Chromium responsive-24 | 386 | 3174 | 61 | 10 | 0 | 1 | 279 |
| Chromium responsive-25 | 420 | 3373 | 57 | 8 | 0 | 2 | 306 |
| Chromium responsive-26 | 1637 | 3962 | 59 | 7 | 0 | 2 | 1519 |
| Chromium responsive-27 | 3354 | 2341 | 56 | 8 | 0 | 3 | 3236 |
| Chromium responsive-28 | 3913 | 2456 | 57 | 11 | 0 | 1 | 3799 |
| Chromium responsive-29 | 3700 | 2790 | 65 | 8 | 0 | 2 | 3571 |
| Chromium responsive-3 | 446 | 802 | 58 | 5 | 0 | 3 | 337 |
| Chromium responsive-30 | 3915 | 3796 | 55 | 8 | 0 | 1 | 3806 |
| Chromium responsive-31 | 3482 | 2337 | 77 | 9 | 0 | 3 | 3330 |
| Chromium responsive-32 | 9565 | 2719 | 58 | 9 | 0 | 1 | 9456 |
| Chromium responsive-4 | 662 | 1468 | 60 | 11 | 0 | 2 | 546 |
| Chromium responsive-5 | 875 | 1459 | 57 | 11 | 0 | 1 | 770 |
| Chromium responsive-6 | 387 | 940 | 51 | 5 | 0 | 2 | 285 |
| Chromium responsive-7 | 491 | 1713 | 58 | 11 | 0 | 2 | 382 |
| Chromium responsive-8 | 446 | 1775 | 57 | 8 | 0 | 1 | 335 |
| Chromium responsive-9 | 610 | 1452 | 57 | 11 | 0 | 2 | 507 |
| Route registry and test discovery | 249 | 17 | 68 | 5 | 31 | 0 | 113 |
| edge critical smoke | 3 | 2 | 0 | 0 | 0 | 0 | 0 |
| firefox critical smoke | 2 | 3 | 0 | 0 | 0 | 0 | 0 |
| webkit critical smoke | 3 | 2 | 0 | 0 | 0 | 0 | 0 |
| edge critical smoke (1/3) | 137 | 283 | 59 | 10 | 20 | 2 | 10 |
| edge critical smoke (2/3) | 139 | 422 | 46 | 9 | 21 | 2 | 9 |
| edge critical smoke (3/3) | 136 | 97 | 56 | 5 | 19 | 4 | 11 |
| firefox critical smoke (1/3) | 124 | 197 | 56 | 9 | 0 | 1 | 17 |
| firefox critical smoke (2/3) | 132 | 44 | 59 | 11 | 0 | 2 | 23 |
| firefox critical smoke (3/3) | 102 | 324 | 35 | 9 | 0 | 2 | 6 |
| webkit critical smoke (1/3) | 109 | 418 | 45 | 7 | 0 | 1 | 17 |
| webkit critical smoke (2/3) | 113 | 401 | 37 | 12 | 0 | 1 | 29 |
| webkit critical smoke (3/3) | 125 | 290 | 69 | 5 | 0 | 3 | 4 |
| Deliberate visual snapshot gate (Windows baseline) | 3 | 2512 | 0 | 0 | 0 | 0 | 0 |
| Windows visual snapshots (1/32) | 164 | 520 | 73 | 23 | 17 | 2 | 23 |
| Windows visual snapshots (10/32) | 97 | 1368 | 30 | 14 | 11 | 1 | 22 |
| Windows visual snapshots (11/32) | 156 | 576 | 70 | 19 | 15 | 1 | 28 |
| Windows visual snapshots (12/32) | 125 | 648 | 55 | 15 | 12 | 1 | 23 |
| Windows visual snapshots (13/32) | 154 | 1339 | 71 | 23 | 17 | 1 | 19 |
| Windows visual snapshots (14/32) | 138 | 842 | 67 | 18 | 12 | 1 | 20 |
| Windows visual snapshots (15/32) | 114 | 1251 | 54 | 15 | 11 | 1 | 14 |
| Windows visual snapshots (16/32) | 152 | 983 | 67 | 24 | 17 | 1 | 20 |
| Windows visual snapshots (17/32) | 104 | 1346 | 41 | 14 | 11 | 1 | 18 |
| Windows visual snapshots (18/32) | 162 | 735 | 68 | 24 | 17 | 2 | 14 |
| Windows visual snapshots (19/32) | 132 | 519 | 62 | 21 | 14 | 1 | 14 |
| Windows visual snapshots (2/32) | 150 | 563 | 62 | 20 | 12 | 2 | 25 |
| Windows visual snapshots (20/32) | 128 | 1322 | 63 | 14 | 12 | 1 | 18 |
| Windows visual snapshots (21/32) | 176 | 716 | 89 | 22 | 18 | 2 | 22 |
| Windows visual snapshots (22/32) | 160 | 959 | 70 | 23 | 16 | 3 | 21 |
| Windows visual snapshots (23/32) | 146 | 895 | 69 | 24 | 17 | 1 | 14 |
| Windows visual snapshots (24/32) | 135 | 1044 | 65 | 18 | 15 | 1 | 15 |
| Windows visual snapshots (25/32) | 135 | 1044 | 48 | 22 | 17 | 2 | 21 |
| Windows visual snapshots (26/32) | 126 | 1330 | 56 | 15 | 10 | 2 | 21 |
| Windows visual snapshots (27/32) | 198 | 1145 | 104 | 24 | 17 | 2 | 15 |
| Windows visual snapshots (28/32) | 134 | 687 | 49 | 18 | 13 | 1 | 29 |
| Windows visual snapshots (29/32) | 146 | 653 | 68 | 23 | 16 | 2 | 14 |
| Windows visual snapshots (3/32) | 195 | 322 | 83 | 32 | 27 | 1 | 27 |
| Windows visual snapshots (30/32) | 149 | 1187 | 68 | 24 | 17 | 1 | 14 |
| Windows visual snapshots (31/32) | 142 | 899 | 67 | 22 | 16 | 1 | 14 |
| Windows visual snapshots (32/32) | 110 | 776 | 42 | 21 | 12 | 1 | 14 |
| Windows visual snapshots (4/32) | 170 | 824 | 79 | 23 | 17 | 2 | 24 |
| Windows visual snapshots (5/32) | 279 | 161 | 181 | 23 | 17 | 2 | 26 |
| Windows visual snapshots (6/32) | 131 | 1122 | 64 | 15 | 10 | 1 | 22 |
| Windows visual snapshots (7/32) | 145 | 889 | 65 | 19 | 11 | 3 | 24 |
| Windows visual snapshots (8/32) | 137 | 1182 | 45 | 22 | 17 | 2 | 29 |
| Windows visual snapshots (9/32) | 146 | 1263 | 68 | 18 | 13 | 2 | 23 |

### CI 44130431512

| Job | Elapsed | Queue | Checkout | npm ci | Browser | Download | Tests |
|---|---:|---:|---:|---:|---:|---:|---:|
| Backend (lint + test + build) | 3 | 44 | 0 | 0 | 0 | 0 | 0 |
| Go build (export-worker) | 119 | 2 | 53 | 0 | 0 | 0 | 0 |
| Go build (notification-worker) | 97 | 2 | 54 | 0 | 0 | 0 | 0 |
| Go build (teslasync) | 169 | 4 | 67 | 0 | 0 | 0 | 0 |
| Backend architecture | 112 | 103 | 73 | 0 | 0 | 0 | 21 |
| Backend lint | 253 | 391 | 70 | 0 | 0 | 0 | 0 |
| Merge backend coverage | 106 | 5 | 70 | 0 | 0 | 2 | 0 |
| Backend database (replay) | 415 | 111 | 56 | 0 | 0 | 0 | 307 |
| Backend database (rollback) | 114 | 2 | 31 | 0 | 0 | 0 | 9 |
| Backend race tests (1/8) | 231 | 124 | 44 | 0 | 0 | 0 | 116 |
| Backend race tests (2/8) | 312 | 3 | 57 | 0 | 0 | 0 | 183 |
| Backend race tests (3/8) | 336 | 408 | 60 | 0 | 0 | 0 | 198 |
| Backend race tests (4/8) | 284 | 119 | 52 | 0 | 0 | 0 | 156 |
| Backend race tests (5/8) | 257 | 513 | 77 | 0 | 0 | 0 | 113 |
| Backend race tests (6/8) | 253 | 124 | 47 | 0 | 0 | 0 | 128 |
| Backend race tests (7/8) | 224 | 2 | 27 | 0 | 0 | 0 | 129 |
| Backend race tests (8/8) | 288 | 129 | 54 | 0 | 0 | 0 | 156 |
| CI (all checks) | 4 | 50 | 0 | 0 | 0 | 0 | 0 |
| Docker · api | 537 | 515 | 49 | 0 | 0 | 0 | 0 |
| Docker · export-worker | 428 | 67 | 49 | 0 | 0 | 0 | 0 |
| Docker · fleet-telemetry | 73 | 2 | 56 | 0 | 0 | 0 | 0 |
| Docker · notification-worker | 305 | 406 | 55 | 0 | 0 | 0 | 0 |
| Docker · web | 285 | 18 | 45 | 0 | 0 | 0 | 0 |
| Docs (build + asset validation) | 107 | 2 | 60 | 3 | 0 | 0 | 0 |
| Frontend (lint + test + build) | 2 | 114 | 0 | 0 | 0 | 0 | 0 |
| Frontend build | 179 | 4 | 49 | 5 | 0 | 0 | 0 |
| Frontend lint | 247 | 3 | 54 | 10 | 0 | 0 | 0 |
| Merge frontend coverage | 169 | 194 | 59 | 10 | 0 | 4 | 0 |
| Frontend tests (1/8) | 710 | 140 | 55 | 9 | 0 | 0 | 633 |
| Frontend tests (2/8) | 564 | 358 | 57 | 5 | 0 | 0 | 479 |
| Frontend tests (3/8) | 874 | 318 | 60 | 11 | 0 | 0 | 791 |
| Frontend tests (4/8) | 530 | 519 | 49 | 6 | 0 | 0 | 459 |
| Frontend tests (5/8) | 510 | 2 | 57 | 5 | 0 | 0 | 432 |
| Frontend tests (6/8) | 800 | 93 | 92 | 7 | 0 | 0 | 683 |
| Frontend tests (7/8) | 746 | 3 | 56 | 10 | 0 | 0 | 668 |
| Frontend tests (8/8) | 671 | 102 | 54 | 7 | 0 | 0 | 591 |
| Generated artifacts are current | 116 | 488 | 67 | 9 | 0 | 0 | 0 |
| GitHub Actions workflow lint | 44 | 78 | 27 | 0 | 0 | 0 | 0 |
