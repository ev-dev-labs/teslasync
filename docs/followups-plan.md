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

### 2d. Negative "Age: -1.00 s" in trip replay sources — FIXED
- Root cause: position and telemetry streams carry independent
  timestamps; nearest-row alignment (with the intentional later-row tie
  break) can attach a newer telemetry row to an older GPS frame, so
  `positionTs − sourceTs` goes negative. The code even documented this
  as deliberate ("must not appear age zero").
- Fix (`TripReplayPage.tsx` sources drawer): clamp displayed age at
  zero — age must never be negative. The source timestamp beside it
  still shows when a reading is newer than the frame. Alignment and
  tie-break untouched (test mandates retaining them).
- Regression test: renamed to "clamps future telemetry to zero age";
  stash round-trip proved fail-before ('Age: -10.00 s' rendered) and
  pass-after ('Age: 0.00 s'); tie-break assertions (later row wins)
  unchanged. Trips suites 62/62; driving replay suite (same component)
  16 passed + baseline-only TripReplay 3. No i18n changes; trio 7672/0;
  tsc/lint/build green.

### 2e. "Charge home now" with empty price options — FIXED
- Root cause (backend): `nextcharge.Decide` falls through to
  `charge_home_now` when `Preview()` fails (unknown rate plan, bad
  ready-by, no feasible window, …) and no Supercharger quote exists —
  with all cost pointers nil (`decide.go` lines 123-127). The strip
  rendered the badge + empty "Charging options" metrics.
- Fix (frontend, at the recommendation surface): the strip suppresses
  the verdict badge + body and shows `nextCharge.notEnoughPriceData`
  ("Not enough price data", with the Autopilot CTA for configuring
  inputs) whenever energy is still needed (`kwh_needed > 0`) but all
  three price options are empty. `enough` (0 kWh) legitimately carries
  no prices and still renders. Backend enum left untouched (contract
  ripple across API consumers; display gate is sufficient and robust to
  any future unevidenced verdict).
- Regression tests: fail-before showed badge "Charge home now" + "No
  metric values are available yet"; pass-after shows the message with
  no badge/body. Guards: priced charge-home-now still recommends;
  priceless `enough` still renders. Strip suite 26/26.
- Catalog: 1 new key, regen + trio re-pin (42,199 keys) → 7672/0.
  tsc/lint/build green.

### 2f. Small-amount precision ("$0.1/km", "Monthly est. $0.1") — FIXED
- Root cause: every currency path honoured the raw user/metric/global
  precision, so a 1-decimal (or 0-decimal) precision rendered $0.04 and
  $0.14 alike as "$0.1" (or "$0"). The $/km metric additionally ignored
  the metric precision entirely, using the injected display default.
- Fix: new `currencyDecimals(amount, requested)` helper
  (`numberFormat.ts`) floors sub-unit amounts at 2 decimals, wired into
  all five currency paths — `formatCurrency`, `formatEnergyCost`,
  `<Currency>`, the efficiency cost/km metric formatter (now also honours
  the metric precision + locale from the pipeline), and `formatMetric`'s
  currency branch (one-line digits floor, covers drawer evidence).
  Amounts ≥ 1 unit and non-currency formats keep the requested precision.
- Regression tests: 5 fail-before (all showed '$0.1') / pass-after
  across numberFormat, useFormatting (×2), Currency, metrics, and
  formatMetric; precision-3 provenance ('$0.024 /km') unchanged.
  Target files 245/245; wide formatting trees 3205 + 3 baseline-only.
  No i18n changes; trio 7672/0; tsc/lint/build green.

## 3. Performance (dashboard 60s re-render)

Done (commit `2e7c0657b1`, pushed).
- Root cause: `DashboardPage` held a 60s `setTick` that re-rendered the
  whole grid; every widget body re-executed on each tick.
- Fix: new shared 30s `useTicker` (`web/src/hooks/useTicker.ts`,
  one timer process-wide); `FreshnessDot` migrated to it; `VehicleHero`
  memoized with a `ChargeDoneAt` ticker leaf; `FleetOperationsBrief` and
  `AnomalyDetectorWidget` memoized, subscribing as text-only units;
  page `setTick` removed; grid callbacks stabilized; `DashboardGrid`
  memoized. Fingerprints re-pinned via
  `i18n-trio-checkpoint.mjs --typed --checkpoint-sources` (generator).
- Proof: `useTicker` 2/2; `DashboardGrid.ticker` 2/2 (single shared
  timer; bodies render once across 3 ticks; memo skip with control);
  `DashboardPage` ticker-isolation guard; dashboard tree 4575/0;
  trio 7672/0; tsc/lint/build green.
- Browser verification (temp spec, deleted after the run): on a preview
  build with mocked `vehicles/states`, created the Operations Desk
  layout via the gallery, fast-forwarded the clock 125s, and the
  fleet-brief "Oldest reading" age label advanced with no fixture
  churn. (Playwright CDN unreachable, so the run used installed MS Edge
  via a temp config; both temp files deleted. Not committed.)
- Decision: profiler-based memo proof abandoned (Profiler counts
  commits, not executions); execution counting at grid level instead.

## 4. JourneyAssurance flake

Done (commit `4d23694bc1`, pushed).
- Root cause of the REAL defect found: `JourneyAssurancePage.departureZone.test.tsx`
  asserted a divergent host zone (`America/Los_Angeles`) but relied on ambient TZ —
  14/14 fail on any other host zone (reproduced fail-before under `TZ=UTC` and
  `TZ=America/New_York`). Fix: pin `process.env.TZ = 'America/Los_Angeles'` at the
  top of the file (repo precedent: `AdvancedIntelligencePages.test.tsx`,
  `SmartChargePage.test.tsx`); the beforeEach guards verify the pin. Probed that
  each test file runs in its own worker process, so the pin cannot leak to other
  files. No assertions changed.
- No shared-state leak found in `JourneyAssurancePage.test.tsx`: zombie
  paused-mutation resume disproven by probe (0 calls after 250ms; `client.clear()`
  drops paused mutations); fixture mutation disproven (27/27 with deep-frozen
  `journey`); no module formatter caches in the hooks used; drawer close is
  synchronous. Historical in-suite red was the pre-wave-2 brief contract, fixed by
  `f73d90792e` (both files green in reports c/d; dependency cone byte-identical
  since). The suite-F transient had no recorded signature on identical code.
- Proof: file 1 20/20 + 12 shuffle seeds green; file 2 20/20 under ambient UTC +
  14 shuffle seeds green; file 2 also 14/14 under ambient NY after the pin.
- Follow-ups for later steps: `EvidencePanel.datePreferences.test.tsx` and
  `AnalysisBrief.datePreferences.test.tsx` assert the LA zone with no pin — same
  ambient-TZ dependence (step 5 / PR #198 CI-UTC candidates). Bare 1s RTL `waitFor`
  defaults under full-suite contention remain the likeliest explanation for the
  signature-less suite-F transient; not changed (assertions out of scope).

## 5. Remaining failures

Inventory on current tree (`D:/tmp/vitest-step5.json`, local only): **56,859 passed /
167 failed, 35 red files** (baseline was 56,831/168 in 36 files; delta = +1 flake-passed
ChargingForensics + 27 new passing tests from steps 2–4, 0 new failures).

Groups (8 parallel children, isolated sibling worktrees `D:/repos/teslasync-step5{a..h}`
on branches `fix/step5-{a..h}`, node_modules junctions, `--maxWorkers=2`):
- A sidenav shell 35: CommandDeck.test.
- B sidenav shell 45: Layout.test 24 + BottomTabBar.test 21.
- C i18n 11: shell-preservation 7 (5 sidenav + 2 trio-class, one worker) + copy-owner 3 + final-four 1 (trio rule + generators).
- D shell-adjacent + lib 8: workspaceScope 3 + mobile.viewport 1 + WorkspaceHeader 2 + datePresets 1 + dateFormat.duration 1 (known `<=`→`<` culprit 2a1cea45ff).
- E battery block 14: ChargeAdvisorPage (recorded: raw-NaN overwrite since 5fb15a0609 + gate drift since d2cb6396ac).
- F telemetry+trips blocks 8: SignalDeadband 3 (stale pins) + signalCorrelation 1 (`-0`) + SignalGapDetector 1 (isStale) + TripReplay 3 (`NaN.toFixed(3)` calc).
- G hooks pre-existing 31: useDLQ 11 + useGuard 8 + 11 files ×1–2.
- H misc 15 + flake hardening: admin 5 + StatusHero 5 + TestWatchFace 2 + AIDigest 1 + AIQuietHours 1 + DataTable 1 + ChargingForensics isolation proof.

Results:
- B integrated (`23e4741d02`): Layout 24 + BottomTabBar 21 migrated to the redesigned
  sidenav contract, test-only, 122/122 green, expects up 401→420, no skips/deletes.
- E integrated (`c6a26b002d`): ChargeAdvisorPage live-window overwrite now sanitized
  with exported `validSoc` (+ regression tests); 5 fixed (invalid-percentage NaN/±Inf/
  out-of-range), 9 scenario-gate failures remain BLOCKED (coverageEstablished via
  coveredLocalDates, no caller provides it — owner decision).
- A, C, D, F, G, H running.

## 6. Phase 6 items (284 failed)

TBD.

## Decisions

- Sidenav merge verified on `ui/simplification` before branching (tsc, lint, catalog, build, trio 7672/0, sidenav unit 42/42, sidenav e2e 10/10); the merge commit rides along on this branch, which is the only branch pushed.

## Results

TBD.

## Final summary

TBD.
