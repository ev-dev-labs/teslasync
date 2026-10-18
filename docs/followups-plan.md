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
- web/source-map-js HIGH (transitive via postcss/jsdom/magicast): 1.2.1 → 1.2.2 via `npm update` (lockfile only, parent `^` ranges allow). Gates: tsc, lint, catalog, build green.
- web/handlebars CRITICAL (transitive via eslint-plugin-boundaries): 4.7.9 → 4.7.10 via `overrides` pin (plugin 7.2.0 already latest; audit's "5.4.0" fix-data is stale). Cleared all 3 criticals (handlebars + 2 rollups). Gates: eslint spot + full lint, tsc, catalog, build green.
- web/serialize-javascript LOW (transitive via terser): 7.1.1 → 7.1.2 via `npm update` (parent `^7.0.3` allows). Gates: tsc, lint, build green.

- docs/source-map-js HIGH (transitive): → 1.2.2 via `npm update`. docs/dompurify LOW: → 3.4.17. Remaining: 2 LOW (mermaid/katex). Gate note: `docs:build` fails identically at baseline (`ui-simplification-task.md` raw `<title>` parsed as Vue tag) — pre-existing, unrelated to upgrades; left for docs-content work.
- mobile: 7 → 0 via `overrides` (tar 6.2.1→7.5.22 CRITICAL, sharp 0.32.6→0.35.5 HIGH, uuid 7.0.3→11.1.1 MOD; @capacitor/assets 3.0.5 is latest so no upgrade path). Verified: audit 0, `capacitor-assets --version`, `cap --version`, sharp in-memory resize, uuid v4 + xcode require all ok.
- desktop: 19 → 0 (electron 33.4.11→44.9.0 MAJOR, electron-builder 25→26.15.3 MAJOR, http-cache-semantics HIGH via update, @electron/get 3.1.0→5.1.0 via `overrides`). Verified: audit 0, unit tests 4/4, electron binary runs v44.9.0, builder CLI ok. No code changes needed (shell uses stable main-process APIs).
- Go: 12 stdlib + x/net fixed (toolchain go1.27.1→go1.27.2, x/net v0.58.0→v0.60.0, x/crypto→v0.58.0 latest + x/sys/x/text companions). `go build` + `go test ./...` green; govulncheck: 0 affecting. Remaining: GO-2026-5932 in x/crypto v0.58.0 (latest, Fixed N/A, uncalled by our code) — no upstream fix.

### Blocked (with reasons)

- docs/mermaid+katex LOW: fix needs mermaid 11→12 major, but vitepress-plugin-mermaid (latest 2.0.17) peers `mermaid: 10 || 11` — no compatible plugin exists. Reverted the spec bump; lockfile restored to 11.17.2.

- web/tailwindcss HIGH + chokidar HIGH + fast-glob HIGH + postcss-nested MOD + postcss-selector-parser MOD: only fix is tailwind v3→v4 framework migration (322-line CSS-var-backed config + custom variant plugin + @tailwindcss/postcss swap + preflight re-verification across 277 routes/gallery) — multi-hour, exceeds the 45-min box. Build-time DoS on own inputs only; negligible exploitability. No small bump exists (postcss-nested 6.2.0 is the last 6.x; parser fix is the 7.x major, unsafe to force under nested 6).
- web/braces HIGH + micromatch HIGH (via boundaries + tailwind): NO upstream fix (braces 3.0.3 is latest). Dev/build-time only; patterns come from own configs. Constrain-if-needed later by replacing micromatch usage, out of scope here.
- web/eslint-plugin-boundaries + @boundaries/elements rollups: plugin 7.2.0 already latest; remaining via-chain entries are the braces/micromatch items above.

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
