# CI performance decisions

## 2026-11-17: queue-aware PR layout

- Start from merged #259, `52effbc75459454403e166511cf27159f75a5a65`.
  The worktree was clean; branch is `ci-speedup`.
- Use completed Actions API timestamps, not the approximate supplied wall time.
  At measurement start the latest main push was still running. The last three
  completed main runs are older, pre-redesign workloads; retain them, including
  the failed CI sample, without presenting them as equivalent coverage.
- Move only the 24 Firefox/WebKit application-design jobs to `merge_group`,
  nightly (08:43 UTC), and manual runs. Keep every profile, shard, replay,
  worker count, assertion, timeout and retry setting. PR and push retain all
  three lightweight engine smokes. Existing `firefox critical smoke` and
  `webkit critical smoke` summaries require the complete profiles on queue
  events, and verify the explicit intentional skip on PR/push.
- Keep browser summaries available on every PR, including backend/docs PRs,
  by removing workflow-level PR path filtering. Otherwise requiring the
  browser summaries would leave unaffected PRs pending forever.
- Refresh Chromium estimates from actual merged JSON in the last green #259
  browser run, not the earlier design-pack estimates. Preserve other engines'
  existing duration entries and therefore their existing shard membership.
- Use 20 Chromium runners, each with four workers, combining ordinary routes
  and design acceptance. Fit long tests using simulated worker completion in
  actual discovery order: Playwright's test-list selects but does not reorder
  tests. Serial duration / workers alone missed long tail tests.
  Run accessibility and performance in their original isolated single-worker
  processes after shards 1 and 2, including on failure. Each retains its own
  report and exact-union merge. Four Windows visual and three engine smoke
  jobs are unchanged; one shared build remains.
- Do not add a per-workflow concurrency group that serializes CI and browser
  runs. The shared account's 20 slots are the limit, not a separate 20-slot
  entitlement per workflow. Short setup/unit jobs can drain while the browser
  build runs; required summaries must not wait behind deferred profiles on PRs.
- Classify backend changes with Git, not a truncated changed-files API.
  Only known frontend/docs paths avoid backend work on PRs; unknown inputs,
  Go files, migrations, Helm, backend Dockerfiles, shared scripts, and CI
  definitions fail closed. Push, merge queue and manual runs require all
  backend jobs. Deletions and both sides of renames participate.
- Retain required Docker check names as lightweight decision receipts when
  backend images are irrelevant. Their expensive setup/build steps do not run.
  Backend summary checks exact expected skips and a successful classifier;
  final `CI (all checks)` still requires all its dependencies to succeed.
- Existing CI/browser module caches already use exact lockfile, resolved Node,
  OS, architecture, and host/container keys. Retain them. Add the same caches
  and exact-version browser cache to the Performance PR workflow. Bundled
  Chromium/Firefox/WebKit engines are never installed in container jobs.
  Edge is not bundled in the Playwright image: retain its separately cached
  system installation, installing it only on a cache miss.
- The main ruleset already requires CI summaries and three backend Docker
  contexts; CI already handles merge groups. Security's CodeQL is also a
  ruleset requirement, so add its missing merge-group trigger. Do not edit
  the ruleset remotely. Owner changes and a queue-timeout limitation are
  recorded in CI-PERF.
- Local discovery validates every actual test-list shard against full
  discovery and validates the global multiset, including contract and visual
  configs. Only the existing harness layout test changes; app and design-pack
  implementation/tests are not rewritten.
- Publish only after local validation. Await all workflows completely before
  another push; collect every failed job before fixing. Any measured regression
  must be reverted rather than explained away. Record subsequent measurements
  with the code/calibration they justify, never in docs-only commits.
- First local validation passed: actionlint on all four changed workflows;
  14/14 Node workflow contracts; full discovery union of 3,322 browser,
  97 contract and 90 visual tests; the existing harness layout test; targeted
  ESLint; `npx tsc --noEmit`; docs build and asset validation; whitespace check.
  The docs build retained its existing large-chunk warning. Changed-line UI
  pattern checks each found zero matches; the harness stayed at 3,022 lines.
- Wait for the already-running main CI, browser, Security and Release runs
  to finish before the first branch push, so the first timing sample is not
  deliberately contaminated by #259's full design queue.
