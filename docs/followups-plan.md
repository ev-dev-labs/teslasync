# Post-redesign follow-ups — plan

Branch: `fix/post-redesign-followups` (from `ui/simplification` at the sidenav merge `f6150b0715`). Push only this branch.

## Baseline

Full suite alone on `fix/post-redesign-followups` (sidenav merge tip): **56,831 passed / 168 failed**, 36 red files. Report: `web/.runner/gates/vitest-followups-baseline.json` (local only).

Composition: 79 previously-known (trio-class 6: copy-owner 3, shell-preservation 2, final-four 1; pre-existing 50; stable blocks 22: battery 14, telemetry 5, TripReplay 3; flake 1 ChargingForensics) + **89 sidenav-merge interactions**: CommandDeck.test 35, Layout.test 24, BottomTabBar.test 21 (shell suites assert the pre-redesign navigation), shell-preservation +5 (frozen hashes vs new shell bytes), workspaceScope 3 (drawer/route-capability titles), mobile.viewport 1. The 89 join step 5 as group 5a (sidenav test migration, same rules: no weakening).

## 1. Security

TBD.

## 2. Data bugs

TBD (a–f with root causes + regression tests).

## 3. Performance (dashboard 60s re-render)

TBD.

## 4. JourneyAssurance flake

TBD.

## 5. Remaining 80 failures

TBD (trio-class 6, blocked 22, pre-existing 52).

## 6. Phase 6 items (284 failed)

TBD.

## Decisions

- Sidenav merge verified on `ui/simplification` before branching (tsc, lint, catalog, build, trio 7672/0, sidenav unit 42/42, sidenav e2e 10/10); the merge commit rides along on this branch, which is the only branch pushed.

## Results

TBD.

## Final summary

TBD.
