# Post-redesign follow-ups — plan

Branch: `fix/post-redesign-followups` (from `ui/simplification` at the sidenav merge `f6150b0715`). Push only this branch.

## Baseline

Full suite alone on `fix/post-redesign-followups` (sidenav merge tip): **56,831 passed / 168 failed**, 36 red files. Report: `web/.runner/gates/vitest-followups-baseline.json` (local only).

Composition: 79 previously-known (trio-class 6: copy-owner 3, shell-preservation 2, final-four 1; pre-existing 50; stable blocks 22: battery 14, telemetry 5, TripReplay 3; flake 1 ChargingForensics) + **89 sidenav-merge interactions**: CommandDeck.test 35, Layout.test 24, BottomTabBar.test 21 (shell suites assert the pre-redesign navigation), shell-preservation +5 (frozen hashes vs new shell bytes), workspaceScope 3 (drawer/route-capability titles), mobile.viewport 1. The 89 join step 5 as group 5a (sidenav test migration, same rules: no weakening).

## 1. Security

Inventory (2026-10-18):

web/ (npm audit, 13): sharp HIGH direct 0.35.4 fixed 0.35.5; source-map-js HIGH transitive (postcss/jsdom/magicast) 1.2.1 fixed 1.2.2; handlebars CRITICAL transitive (eslint-plugin-boundaries) 4.7.9 fixed 4.7.10 (needs overrides pin); tailwindcss HIGH direct 3.4.19 fixed 4.3.3 MAJOR (also fixes chokidar HIGH, fast-glob HIGH, postcss-nested MOD, postcss-selector-parser MOD transitives); braces HIGH + micromatch HIGH transitive — NO upstream fix (braces latest is 3.0.3); eslint-plugin-boundaries rollup — 7.2.0 already latest, audit fix-data stale; serialize-javascript LOW transitive (terser) fixed 7.1.2.
Dependabot (30 open, 4 lockfiles): web/ mirrors npm audit; docs/: source-map-js HIGH, dompurify LOW x2, katex LOW; apps/mobile: sharp HIGH x3, tar HIGH/MED x5, uuid MED; apps/desktop: electron HIGH x4 + MED, http-cache-semantics HIGH, extract-zip HIGH, sprintf-js MED.
Go (govulncheck, 12 stdlib + x/net): all fixed by toolchain go1.27.1→go1.27.2 + golang.org/x/net v0.58.0→v0.60.0.

Fix order: critical/high first (sharp, source-map-js, handlebars, tailwind attempt, docs/mobile/desktop highs, Go), then moderate/low. Time box 45 min each; revert + record blocked if unfixable.

### Fixes applied

- web/sharp HIGH (direct): 0.35.4 → 0.35.5 exact pin. Gates: tsc, lint, catalog, build green; `import('sharp')` loads. (npm needed a lockfile handle reset via copy-swap; content verified intact.)
- NOTE: repo convention is `^` ranges, but the exact pin stands (matches what npm wrote; avoids another lockfile cycle for zero behavior difference).

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
