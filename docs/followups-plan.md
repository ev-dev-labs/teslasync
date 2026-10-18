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
- H integrated (`345feddafc` + re-pin `ac98aa74ab`): 15 pre-existing fixed (admin
  tri-state, StatusHero a11y prod fix, watch units, weekly_digest localization prod
  fix + catalog regen, quiet-hours label, DataTable copy) + ChargingForensics flake
  hardened (reduced-motion pin; 10x + 6 shuffles 29/29). The new catalog key broke
  16 pinned i18n assertions; re-pinned via `i18n-trio-checkpoint.mjs
  --typed --checkpoint-catalog` (generator) — back to exactly the 11 legitimate reds.
  `HelixEvidenceTrail.tsx` keeps a pre-existing dynamic key, so it stays (by design)
  outside the source-checkpoint set.
- A integrated (`e0fac90924`): CommandDeck 31/35 migrated at equal strictness
  (expects 160→206, no skips/deletes) + 1 shell prod fix (persist effect no longer
  clobbers the saved deck view while its section late-loads). 4 left red BY DESIGN:
  icon-only collapsed secondary rail ×2, directional ltr/rtl entrances ×2 (verified
  absent from the new deck; no successor contract).
- F integrated (`26f7bd6`): 6/8 (signalCorrelation -0→+0 prod fix; deadband stale
  pins refreshed to exact delta-MAD outputs; TripReplay map-height + null-efficiency
  hide-missing pins). 2 left red for OWNER DECISION (see list).
- D integrated (`5ec32bc835`): 7/8 (dateFormat `<=0` guard restored + 2 regression-
  ratifying pins corrected; 6h i18nKey moved to `date.preset.last6h` + catalog key;
  workspaceScope + WorkspaceHeader pins; mobile.viewport migrated). The branch's
  additions-list registration was replaced at pick time with the step-2b/H
  convention (split regen + `--checkpoint-catalog` fold; predecessor now 32947).
  1 left red BY DESIGN: phase6 mobile-drawer fanout (drawer scope block removed by
  sidenav merge, no `drawer` concept left in workspaceScope).
- G integrated (`c9164c98d6`): 30/31 pre-existing hooks (DLQ string ring ids + 500
  cap export; guardWriteOptions fail-closed pins; AbortSignal, envelope/array-shape
  mocks; gas-price poll chain + 2 new tests; camelCaseKeys aliases; governance
  prefix key; simulate fail-closed prod fix; isRefetching tracked-props; mediaHistory
  short-key prod fix). Expects 997→1005, renames only, no deletes. 1 left red BY
  DESIGN: useVehicleVinFilter stale-VIN removal (d2cb6396ac deliberately replaced
  cleanup with retain + scopeReady gating).
- C integrated (`b22ccc53c1` + re-pin): copy-owner 3 + final-four 1 fixed via the
  blessed route — the child EXTENDED `i18n-trio-checkpoint --checkpoint-catalog` to
  the two forgotten suites (original five byte-identical) and regen'd; HistoryPrompt
  gating migrated to reviewed noVehicle-first precedence (verified against
  CommandHistoryPage + page-test oracle); RegexTester Title-Case fallback aligned.
  shell-preservation 0/7 BLOCKED (see decision list).
- Step 5 close: 143 resolved, 24 blocked/by-design (E9 + A4 + F2 + D1 + G1 + C7);
  143+24=167 reconciles the inventory exactly. Both known flakes hardened
  (ChargingForensics here, JourneyAssurance in step 4). All worktrees removed.

### Step 5 decision list (needs owner)
- E1–E9 ChargeAdvisor scenario gate (9 tests listed in inventory): scenarios require
  `coverageEstablished` via `coveredLocalDates`, which no caller provides. Options:
  (a) provide coverage from the history calendar; (b) relax the gate for
  single-source scenarios; (c) accept scenarios hidden until coverage exists (then
  update tests to the hidden contract).
- F1 driving TripReplay NaN-chart (`never feeds NaN ... first ts is unparseable`):
  demands finite chart times anchored on first parseable row, but the trips
  TripReplayPage deliberately feeds NaN for unknown timestamps ("without inventing
  a time", pinned passing at `trips/.../TripReplayPage.test.tsx:381`). Options:
  (a) driving adopts the trips NaN contract (update driving test); (b) trips adopts
  finite-anchor (change trips page + its passing pin).
- F2 gap-detector isStale (`retains observations ... during a stale response`):
  expects `retained=true` for plain react-query `isStale` with data, but shared
  `deriveDataState` deliberately ignores `isStale` (rules 1–8; staleness-flag ≠
  stale evidence) so the page computes `retained=false`. Options: (a) wire isStale
  into the shared retained derivation (broad: every deriveDataState consumer);
  (b) accept isStale≠retained and adjust the case to the shared contract.
- C1–C7 shell-preservation byte-pins (Layout, CommandPalette, ThemeQuickSwitcher
  current-source hashes + 4 cascade fragment errors): pins predate the trio + sidenav
  redesigns; the shell files changed legitimately (behaviorally verified: Layout
  98/98, BottomTabBar 24/24, CommandDeck 32/36, sidenav e2e). No repo generator
  covers these pins, and hand-editing hashes is forbidden. Options: (a) owner
  reviews the new shell bytes and blesses new pins (+ deltas table); (b) owner
  authorizes writing a blessed re-pin generator for this suite.
- By-design reds needing no decision, only records: A4 (collapsed-icon secondary
  rail ×2, directional entrances ×2 — absent from the new deck), D1 (mobile-drawer
  fanout — drawer scope removed by sidenav merge), G1 (stale-VIN removal —
  deliberately replaced by retain + scopeReady in d2cb6396ac).

## 6. Phase 6 items (284 failed)

Method: every item was re-checked against current code. Items whose verify
file passes clean AND whose current test titles match the item's demanded
behavior were accepted in bulk (16/16 spot-check sample, all matching, then
full acceptance of the score>=5 green group). The remaining items got direct
code+test review; genuinely missing behavior was fixed with regression
tests; ambiguous/product-choice items went to the decision list. Workbook
(scratch, not committed): `D:/tmp/phase6-evidence.json` (per-item evidence),
`D:/tmp/phase6-classes.json` (per-item class + fixing commit).

Counts per class (284 total):
- already fixed by later work (done): 264 — 121 individually verified
  against their verify files + 143 bulk-accepted (verify file fully green,
  test titles match the demanded behavior).
- obsolete / excluded: 0 with that exact label — the redesign did not
  replace any of these items outright; the by-design reds are recorded
  under step 5 instead (A4, D1, G1).
- still relevant and fixed in this step: 12 (all with regression tests;
  suites re-run green, tsc/eslint clean):
  - th06 history UTC half-open bounds (`ad1e9818a9`)
  - ctt-s01 thermal adapter (`ad1e9818a9`)
  - ss10 status-announcer plurals (`ad1e9818a9`)
  - as-05 session-toast namespace alignment (`ad1e9818a9`)
  - as-02 unknown-activity names (`54e3315ece`)
  - privacy-02 consent preview copy (`54e3315ece`)
  - tl08 tariff enum labels (`54e3315ece`)
  - sd-12 grouped count localization (`54e3315ece`)
  - tu09 API-usage bucket plurals (`54e3315ece`)
  - ss-011 status-hero headlines (`54e3315ece`)
  - sc-f01 SmartCharge live-mode write gating (`63a6c2b05d`)
  - ex05 exports delete-failure localization (`63a6c2b05d`)
- needs owner decision: 8 (below).

### Step 6 decision list (needs owner)
1. Vehicle-cost page: keep its own 1/7/30/90-day picker, or migrate to the
   shared header date range with server-side filtering? Options: (a) keep
   the local picker as-is (close the item); (b) migrate to the shared range
   (page + hook + server work).
2. Energy-flow page: same question — local trailing-range picker vs shared
   header instants through hook/cache/handler/service. Options: (a) keep
   local; (b) migrate to shared instants.
3. Science-lab page: same question for 5 sources — local 7/30-day picker
   (30-day max, legacy URLs) vs shared header range. Options: (a) keep
   local; (b) register for the shared range and thread instants through.
4. Charge-advisor analysis dates: same question — independent
   tomorrow-first planning dates vs shared header instants through typed
   history requests. Options: (a) keep independent dates; (b) thread the
   shared instants (joins the E1–E9 coverage gate question).
5. Cost-analysis charger labels: the category helper returns raw server
   names; where should translation live? Options: (a) client-side label map
   at the render boundary; (b) backend returns stable keys; (c) close as-is
   (server owns the names).
6. Anomaly timeline explanations: the backend returns English prose; the
   item wants structured facts+limits. Options: (a) backend adds structured
   explanation fields (contract change); (b) keep localizing the prose
   presentation only; (c) close as-is.
7. Automations list: the Duplicate/Export card actions have no contracts to
   wire (dead buttons). Options: (a) specify the contracts and wire them;
   (b) hide the buttons until specified; (c) leave as-is.
8. Insurance page "0..60" contract: the item demands alignment to a "0..60
   contract", but no such contract exists in the page or backend (form is
   localized; rejection/draft lifecycle fully pinned). Options: (a) accept
   as done under that reading; (b) tell me what 0..60 refers to and I fix
   it.

## Decisions

- Sidenav merge verified on `ui/simplification` before branching (tsc, lint, catalog, build, trio 7672/0, sidenav unit 42/42, sidenav e2e 10/10); the merge commit rides along on this branch, which is the only branch pushed.

## Results

Step 7 final gates (branch tip `b9caf3a1af` + this doc commit):
- Full suite alone: **57,050 passed / 24 failed / 4 skipped**, 7 red files.
  The 24 reconcile exactly with the known blocked/by-design inventory
  (E1–E9: 9, C1–C7: 7, A4: 4, D1/F1/F2/G1: 1 each) — zero unexpected reds.
- tsc clean; `npm run lint` (eslint + all audits + release-identity) green;
  catalog `--check` green (32,971 keys); `npm run build` green;
  `go build ./...` + `go test ./...` green (no FAIL/panic);
  i18n folder 8,123/7 (the 7 are C1–C7).
- Route-layout guard on 12 main routes
  (/, /action-center, /explore, /live, /timeline, /vehicles, /drives,
  /trips, /charging, /battery, /settings, /digital-twin) at
  375/768/1280/1920: **12/12 passed** (Edge, preview server, GUARD_RUN_ID
  step7-final). First attempt failed environmentally (preview server died
  on a truncated pipe — known quirk); clean restart passed.

## Final summary

What was fixed per item:
- Security (§1): fixed npm web 4 (sharp, source-map-js, handlebars
  criticals, serialize-javascript), docs 2, mobile 7→0, desktop 19→0,
  Go 12→0. Blocked with reasons: tailwind v3→v4 migration, braces/
  micromatch (no upstream fix), mermaid major, x/crypto GO-2026-5932
  (uncalled, no fix).
- Data bugs (§2): all 6 fixed with regression tests (recorded-cost
  preference + "No rate configured"; all-time skips prior comparison;
  missing≠zero at 4 sites; non-negative replay ages; "Not enough price
  data"; 2 decimals under $1).
- Performance (§3): ticker re-renders only age labels; render-count test
  + single-timer proof; browser-verified.
- Flake (§4): JourneyAssurance isolation fixed (20× + shuffle green).
- Failures (§5): 143 resolved; 24 blocked/by-design (decision list §5).
- Phase-6 items (§6): 264 already-fixed, 12 fixed here (th06, ctt-s01,
  ss10, as-05, as-02, privacy-02, tl08, sd-12, tu09, ss-011, sc-f01,
  ex05), 8 need decisions.

Security before/after: npm web 13→9 (0 critical; rest blocked), docs
4→2, mobile 7→0, desktop 19→0, Go 12 affecting→0.

Test totals vs baseline: 56,831/168 → **57,050/24** (pass count grew
with fixed + new regression tests; every remaining red is a recorded
blocked/by-design item).

Blocked: step-1 upgrades (tailwind, braces/micromatch, mermaid, x/crypto
advisory); step-5 E1–E9/F1/F2/C1–C7 + by-design A4/D1/G1.

Decision lists: step-5 list (§5: E1–E9 coverage gate, F1 NaN contract,
F2 isStale≠retained, C1–C7 pin blessing) and step-6 list (§6: 4
shared-range migrations, charger-label ownership, anomaly structured
facts, dead Duplicate/Export buttons, insurance "0..60").

## CI (PR #198: ui/simplification → main, draft)

Note: the task brief said "Frontend tests job in release.yml", but
release.yml runs only on main-push/workflow_dispatch. The failing
"Frontend tests (1–8/8)" jobs live in ci.yml (workflow "CI"). All
work below targets the actual failing checks.

How CI runs (recorded from workflow files):
- CI (ci.yml): ubuntu-latest, Node 26 (`npm ci --legacy-peer-deps` in
  web/), Go from go.mod. Frontend shards (8):
  `NODE_OPTIONS='--no-experimental-webstorage' npx vitest run
  --shard=N/8 --maxWorkers=2 --coverage --coverage.reporter=json
  --coverage.reportOnFailure --reporter=default --reporter=blob`.
  No TZ/LANG overrides (runner defaults). Backend: 8 race shards +
  coverage merge; lint via golangci-lint; frontend lint/build jobs.
- Frontend Quality Gates (frontend-quality.yml): route registry +
  test discovery, hermetic browser build, Chromium responsive ×16,
  a11y, performance, firefox/webkit smoke, Windows visual ×10.
- Others on this PR: SI Canonical Gate (new legacy unit-suffixed
  identifiers in merge-base...HEAD added lines), Security
  (supply-chain pins, ingress, govulncheck, trivy, gitleaks,
  CodeQL...), Performance (Lighthouse CI), AI Evaluation, Ops Gate,
  Auto Label.

Runs:
- Pre-merge baseline (08:18–08:37Z, head f6150b0715): CI Frontend
  tests 8/8 FAIL, Merge frontend coverage FAIL, Generated artifacts
  FAIL; Quality Gates route-registry + responsive 16/16 + a11y +
  perf + smoke + visual 10/10 FAIL; SI FAIL (43 violines); Security
  FAIL (gitleaks 66); Performance FAIL (Lighthouse). Backend, lint,
  build, Docker green.
- Merge: fast-forwarded follow-ups (d6928402a7) into ui/simplification
  (no conflicts — head had not moved) and pushed; new runs 3914698xxxx.

Fixes (each verified locally under CI conditions before push):
1. Security/gitleaks 66→0: all 66 confirmed false positives (SHA
   fingerprints, command transcripts, prose in PR-new audit/docs
   files; trio test pins must not change). Added targeted
   [[allowlists]] to .gitleaks.toml (audit-evidence dir + 5
   path+line entries). Local gitleaks 8.27.2 on pristine HEAD export:
   66→0; probe secret still detected.
2. CI/Generated-artifacts STALE→OK: slogen catalog gained a
   guard_config_availability SLO but artifacts were never regenerated.
   Ran `go run ./cmd/slogen generate recording/alerts/dashboards`,
   committed the 4 generator outputs. Freshness gate locally green
   (11/11, 279 paths byte-identical).
3. Quality/route-registry `e2e:list` FAIL→0: three stacked load errors,
   all reproduced locally. (a) advanced-intelligence.smoke.spec: the
   (320,light)+(1440,dark) test loop nested inside the outer
   theme×width loops, declaring 10 titles 4× each — moved the block
   to top level (git diff -w empty: pure move). (b) resilience.ts
   touched window/navigator at module scope — guarded (Node-safe,
   browser-neutral) + node-env regression test. (c) ThemeProvider
   read localStorage at module scope — defaults fallback. Full
   `playwright test --list`: 1764 tests/86 files, exit 0; affected
   suites 32/32; tsc/eslint clean.
4. Quality/visual snapshots: 4 routes had real pre-capture failures
   (same in CI): drives page calls GET /drives/score with no mock
   (added populated/empty fixtures); battery 'State of Health'
   renamed by redesign (assert 'Pack score'; error text now appears
   twice → first()); notifications region renamed ('Notification
   activity' → 'Inbox summary', metric marker → data-operational-value).
   Regenerated all 49 baselines via the sanctioned --update-snapshots
   flow on Windows (local Chrome channel — Playwright CDN unreachable
   for chromium; CI chromium is arbiter, 500px/0.1 tolerance).
   Full visual suite locally: 49 passed + 41 by-design skips, 0 failed.
   Note: killed 2 stale node PIDs on :4173 blocking CI-mode rerun.
5. Performance/perf:check BLOCKED (45-min box): `startup JS = 402.8 KB
   exceeds budget 400 KB` (entry 270.4 + vendor-react 132.4).
   Everything else in perf:check passes (precache, shell-closure,
   i18n-runtime via Chrome probe exit 0, dupes, sourcemaps in private
   mode). Entry audit: 555 modules, no pages, 14 feature modules all
   legitimate (12 onboarding host + 2 server gate); biggest mapped
   modules tailwind-merge/App/Layout/useVehicles/themePresets. No
   illegitimate leakage found; needs a deliberate >2.8KB startup diet
   (return pass).
6. CI Frontend tests CI-only failures (5, all reproduced locally):
   (a) 3 datePreferences tests hard-coded ambient America/Los_Angeles —
   dynamic non-collision guards + ambient-computed fallback expectation
   (same pins; 23/23 under UTC and local TZ). (b) DataTable.tableId
   30s timeout under CI load — skip files without the `<DataTable`
   literal before TS-parsing (semantics unchanged) + parsed>0 guard
   (7.9s→0.8s). (c) GDPR refresh-recovery asserted isSuccess
   synchronously — waitFor settled state (same assertions; 10× green
   + green under coverage). Merge had already turned shards 2/5/7 green.
