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

Step 1 closeout: npm web 13→9 (0 critical; 7H+2M all blocked with reasons), docs 4→2 (2L blocked), mobile 7→0, desktop 19→0, Go 12 affecting→0 (1 uncalled, no upstream fix). Closing suite alone: 56,832/167 vs baseline 56,831/168 — 0 new (1 flake-passed delta). Dependabot alerts will close on next scan (no action needed).

## 2. Data bugs

### 2a. Drive cost "$0.0" vs "$2.4 savings" — FIXED
- Root cause: `useFormatting` resolved the electricity rate with
  `toFiniteNumber(rawRate, 0) ?? 0.12`. `??` only triggers on
  null/undefined, so a configured `$0/kWh` rate (non-nullable 0 from
  settings) passed through as `0`, and cost = energy × 0 = $0.0, while
  the savings panel computed gas cost normally → contradictory pair.
- Fix (`web/src/hooks/useFormatting.ts`): treat `<= 0`/NaN as
  unconfigured → `costPerKwh: null`. `CostSavingsPanel` and drive-detail
  `HeroGauges` fall back to the recorded session cost when available,
  else show the new `driveDetail.noRateConfigured` ("No rate
  configured") string; savings are hidden when no usable rate exists
  (never computed from a $0 rate).
- Regression tests: `CostSavingsPanel.test.tsx` (recorded-cost +
  no-rate cases) and drive-detail `HeroGauges.test.tsx` (no-rate case)
  failed before, pass after. Target files 30/30; rate-0 fallout files
  (CostBreakdownWidget, taskOnboardingReactivity, SettingsPage.pilot)
  62/62 green — no other consumer depends on the 0→fallback path.
- Catalog: 1 new key, regen via `split-i18n-catalog.mjs`; trio pins
  re-accepted with the repo generator
  (`i18n-trio-checkpoint.mjs --typed --checkpoint-catalog`, 42,194 keys
  verified, ar/he preserved) → trio 7672/0. tsc/lint/build green.
- Env note: the checkpoint script shells out to `rg`, which is not
  installed on this box; used official ripgrep 15.2.0 binary in D:/tmp
  (PATH-only, nothing committed) for that one invocation.

### 2b. "All time" nonsense prior window — FIXED
- Root cause: the All-time preset resolves to `2015-01-01 → today`
  (`datePresets.ts`), and `priorPeriod()` unconditionally mirrors an
  equal-length window before it → `Mar 16, 2003 – Dec 31, 2014`, rendered
  by both DrivesListPage ("No drives in prior period: …") and
  ChargingListPage ("Prior-period comparison unavailable: …"). It also
  dragged the drives fetch window back to 2003.
- Fix: new `isAllTimeRange(start, end, presetId?)` helper (persisted
  preset id preferred, `matchPresetId` fallback for deep links). Both
  pages set `priorRange = null` for All time, which also nulls
  `priorStats`/deltas and shrinks the fetch window. Skip messages with
  the reason: `drives.noPriorAllTime`,
  `charging.priorUnavailableAllTime`, plus a comparison-free scope
  sentence `drives.brief.overviewScopeNoComparison` (threaded as
  `isAllTime` through the drives controller into DrivesOverview).
- Regression tests: new all-time tests on both pages failed before
  (nonsense window visible in output) and pass after; full page files
  153/153; helper unit tests 3/3. `datePresets.test.ts` has 1 failure
  (`6h` preset i18nKey) identical in baseline → pre-existing, step 5.
- Catalog: 3 new keys, regen + trio re-pin (42,197 keys) → 7672/0.
  tsc/lint/build green.

### 2c. Missing data shown as zero — FIXED (4 sites)
- Root causes (each symptom traced separately; the shared formatting
  stack — lib formatters, format components, OperationalBrief pipeline,
  useVehicleState hook, LinearGauge/MetricBar/AnimatedNumber — already
  null-guards, so every symptom was an inline coercion or an ignored
  presence channel):
  - Temp "0.0°C" (LIVE): `batterycells` backend sends `0` for absent
    temp/voltage signals with presence in `signal_availability`
    (`handler.go` "presence is independent of value"); `BatteryCellsStats`
    trusted bare values for display (only health badges checked the
    flags). Fix: new `availableReading()` gates every displayed reading
    on its explicit flag (`=== false` → null; absent map/flag trusts the
    value per the backend's always-complete-map contract).
  - Battery "0.00%" (exported, currently unreached in prod nav):
    `TelemetryGrid` formatted via `fmtNumber` (safeNumber coerces
    missing → "0.00") and coloured missing as critical rose. Fix:
    unknown renders "—" muted; charger power same treatment.
  - Battery "0.00%" + range "0.0 km" (exported, currently unreached):
    `VehicleGauges` and `BatteryRangeCharts` coalesced to `?? 0`. Fix:
    null-through into the null-safe children (gauges/bars/viz/headlines
    render unknown); chart slices stay null with a null-safe table
    format; colours fall back to muted/gray.
  - Real measured zeros still render (proved by dedicated tests).
- Regression tests: new fail-before/pass-after tests per surface
  (cells temp fail-before showed 4× "0.00°C" tiles); three existing
  suites pinned the buggy strings and were updated to the mandated
  unknown rendering with intent preserved (no-throw, no undefined%,
  no-NaN, health-evidence distinction); drive-trend `?? 0` chart-series
  geometry intentionally untouched (charts need numbers; not a
  displayed reading).
- Wider blast radius checked: live vehicle surfaces (QuickStatsGrid,
  VehicleHero, Glance, FleetCompare, LiveTelemetry, EnergyFlow,
  ClimateSection, drive detail, ClimateControlPage, drivetrain-health)
  all null-guard; AnimatedNumber prop widened `number | null` (17/17).
  No new i18n keys. Trio: VehicleGauges frozen-producer bytes re-pinned
  via `--checkpoint-sources` → 7672/0. tsc/lint/build green.
- Recorded, NOT fixed (needs owner decision): Go `VehicleState` uses
  non-pointer numerics, so the state endpoint serializes unobserved
  fields as 0 (frontend can only distinguish via `verified_fields`,
  which most display components don't consult); legacy
  `api.getVehicleState` coerces `?? 0` (no production callers);
  TelemetryGrid speed-missing → "Parked" (adjacent, not a zero display).

### 2d–2f. TBD

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
