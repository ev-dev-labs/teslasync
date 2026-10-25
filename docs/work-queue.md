# Work queue — branch `fix/post-merge-followups` (PR #202, draft)

Master status file per `docs/agent-playbook.md` section 1. Status values:
`not started | in progress | done | blocked (reason)`. Freshness rule and
kept twins (`vehicle-twin`, `digital-twin-mini`) apply to every part.

## Continuation after `98e23bed33` (2026-10-25)

- The latest user clarification supersedes the historical handoff below:
  ordinary failing tests, commands and CI checks NEVER trigger stopping.
  Only two consecutive malformed/garbled tool calls trigger that rule.
  Continue debugging unattended; section 0b still governs usage exhaustion.
- Section 0 completed on the clean expected branch. Preserved IDE-owned
  Copilot, Playwright and TypeScript processes; no orphan runner found.
  At 20:17Z the graph was **16 fail / 181 pass / 2 pending / 3 skipped**,
  still incomplete (`r20-checks.json`). Unit shard 1 actually passed
  342 files / 5,726 tests (4 skipped), then artifact upload failed with
  CreateArtifact ECONNRESET. Do not change tests/workflows for that failure.
- Signal fixture WIP is now exercised: four signal/tire width/theme cases,
  four related charging-strategy cases, six negative/positive pressure guard
  cases and 75 affected widget unit cases pass; proxy escapes=0.
  The old guard incorrectly expected a tire observer on the intentional
  five-row LiveSignals redesign. It now proves all six actual telemetry
  observers and the two real pressure surfaces: latest diagram + history.
  Exact vehicle/window keys, full original wire fields/nulls/order, Pa
  equality and observation instant remain checked. The unchanged native
  observer walker is preserved. Native geometry exposed zero-width pressure
  values on narrow cards; bounded diagram width restores all four values
  without bringing back removed wheel labels. Evidence: `r19-unit`,
  `r19-category`, `r20-native` and paired native JSON artifacts.
- Energy's old order-dependent guard rejected the intended headline-before-
  chart hierarchy. The replacement measures the entire headline/stat group,
  accepts either nonoverlapping order and retains the original one-pixel
  tolerance; negative geometry tests reject overlapping allocations.
  This exposes a REAL SolarProduction clipping bug (226px), not a reason
  to weaken chart bounds. Its headline/chart allocation repair is in local
  verification. Native fleet content likewise replaces removed taxonomy/
  details with exact verified fraction, meter and definition rows; header
  checks exposed the real 28px Expand target against the existing 44px
  requirement. Its shared-grid fix is also in verification.
- Actual TypeScript, full unchanged lint and affected ESLint passed before
  the latest solar/grid edits; 75 solar/grid/shell unit cases pass afterward.
  **Next:** finish focused solar/fleet browser checks and shared header
  geometry, rerun final checks, commit/push this phase, then fix responsive
  7/9/10/11 and 50–58 roots from bounded logs. Downloaded responsive-13's
  exact artifact; no Windows baselines changed. All evidence is under
  `files/ci-rounds-20261025/` in the session directory.
- Verified phase gate (20:37Z): signal/tire 4/4, charging-strategy 4/4,
  fleet/energy 8/8 and seven native guard cases pass; every wrapper reports
  escapes=0. The original 44px Expand requirement and 8px peer gap are
  retained in the real shared-grid control. Header checks now inspect its
  actual in-header position, excluding only the target itself from peers
  and retaining rightmost freshness; hover first enters the widget normally.
  All eight header viewport/theme cases and all 121 widgets in each of six
  min/default/large view/edit configurations pass unchanged.
- Solar and wall-connector real headline/chart overflow is fixed without
  hiding content. The shared `viewportClassName` capability allows bounded
  energy plots to shrink while preserving auto-height defaults; its new
  regression failed before implementation. Four chart/energy suites pass
  87 cases, the solar/grid/shell group passes 75, and the final nine-suite
  receipt/chart/connector gate passes **7,781/7,781** (including all 7,728
  frozen cases). Actual TypeScript, six zero audit categories for each
  production source, all four hook domains, full unchanged lint and the
  hermetic build pass. Receipt generators verify unchanged translation
  calls and mechanically refresh only existing Grid/Energy checkpoints.
  All source line counts/sections are preserved; no baseline changes.
  Evidence: `r20-shared-header`, `r21-confirmed`, `r21-confirmed-unit`,
  `r21-final-lint`, `r21-*-audit`, `r21-checkpoint` and build logs.
  **Next after push:** inspect the new CI graph and the remaining exact
  responsive-7 telemetry precision, responsive-9/10 catalogue precision,
  responsive-11 vehicle request fixtures, and responsive-50–58 route-source
  failures; do not restart the completed signal WIP or update baselines.
- Next phase (21:08Z, WIP): `e53cd34633` is pushed. Exact redesigned
  analytics, automation, climate, location and extreme electrical readouts
  replace obsolete precision/drawer contracts without removing source
  proofs. Native climate checks retain both curves, full table values and
  all chart bounds while requiring its intentional zero visible Y axes.
  Totals/evidence/climate/maps and extreme checks are exercised; charging
  is still in verification. Its full numeric/unit tick wrap/clipping is
  repaired, exposing an obsolete full-timestamp axis expectation against
  the actual shared short-date formatter. Preserve original source instant,
  locale/vehicle-zone, native observer and tooltip/table proofs when
  adapting that contract. No ordinary failure is a stopping condition.
- Reviewed Windows 1/10 diff artifacts: changes are unintended header/body
  displacement from the 44px Expand target, NOT a palette change.
  Negative vertical margins preserve the original header allocation and
  the actual 44px target; all eight header cases and 121 widgets in each
  of six unchanged geometry configurations pass, escapes=0. No baselines
  updated. The other three current Windows failures are also dashboard
  variants (390/1440 light and forced colors); reevaluate after this fix.
  Latest incomplete graph: **9 fail / 119 pass / 69 pending / 3 skipped**.
  Source audits for Grid/ChargeHistory report six zero counts plus actual
  TypeScript pass; full unchanged lint passes. Existing Grid receipt
  generators ran successfully, but the attempted frozen selector selected
  only ChargeHistory's three tests; do NOT claim the frozen gate yet.
  **Exact next:** finish charge date-context proof, run the actual
  `src/i18n/` frozen suites, lint and commit/push this coherent phase.
  Then supply the typed `/mileage/daily` (366-day) and
  `/drive-dynamics/latest` vehicle sources for responsive 11/12, and
  continue route timezone roots. Evidence: `r22`–`r26` in the existing
  session CI directory.
- Precision/header phase gate (21:12Z): charging now passes **4/4** with
  zero escapes. Short axis/table days and full timestamp tooltips each
  derive from the original served instant, locale and vehicle zone. Added
  a real recent-charge observer proof retaining full source fields/nulls/
  order; the two other charging observers and original AC category/bar
  proofs remain. Totals, evidence, climate, maps and automation groups each
  pass 4/4; extreme telemetry passes 4/4 (150.0kW, 400V, 375A). All seven
  actual frozen suites pass **7,728/7,728**, affected six widget suites
  pass 93 cases, and actual source audits/TypeScript/full lint/affected
  ESLint and both API hook domains pass. Source lengths/sections unchanged:
  Grid 772/772, ChargeHistory 173/173, chart/panel counts 2/2 and 1/1.
  No baseline updates; Windows dashboard displacement is a code bug fixed
  by the preserved-height 44px target, not an intended snapshot change.
- Vehicle source WIP is separately preserved in
  `dashboardCatalogueVehicleFixtures.ts`: exact typed daily-mileage and
  live dynamics fixtures validate native vehicle/range/zone query keys.
  Its eight-case run now has **4 pass / 4 fail**, escapes=0: missing
  requests are resolved, exposing an obsolete wide VehicleHero `heading`
  assertion for Aurora. Finish that native contract before committing the
  fixture. Pre-push incomplete CI: **11 fail / 139 pass / 48 pending /
  3 skipped** (`r28-checks.json`). Continue semantic route timezone roots
  afterward. The historical Phase-48 methodology path in instructions is
  absent on this branch; no API/model/unit-definition change was made.
- Vehicle phase gate (21:24Z): the precision/header phase is pushed as
  `6d1e451863`; all five affected grid unit suites also pass **34/34**.
  Vehicle source WIP is now verified: **8/8** width/theme/motion cases,
  **63/63** hero/odometer/motor units, affected ESLint and actual
  TypeScript/source audit pass, escapes=0. Both newly supplied endpoints
  match the router and validate their exact native request parameters.
  The native hero contract uses the full name/model heading and existing
  single Details link, plus its actual 44px keyboard target, 72% meter,
  410km range, temperatures/access and normalized five-field trust count.
  It retains all original four-sample six-row/560px migration, two-column
  allocation, viewport containment and before/after screenshot-geometry
  equality assertions; removed preview navigation is not restored.
  No production hero or baseline change. **Exact next after push:** tackle
  the real home-energy local-hour model (tariff/departure/forecast + KPI),
  then the remaining timezone route roots. Shared numeric zoned parts and
  wall-time conversion already exist in `lib/dateFormat.ts` /
  `lib/dateConvert.ts`; reuse them, do not invent another parser.
  The latest `6d1e451863` graph is still registering (9 pending / 2 skip),
  not a completed graph or green. Evidence: `r28-grid-unit`,
  `r31-vehicle`, `r31-vehicle-unit`, `r31-fixture-audit`, `r31-eslint`.

- Home-energy WIP (21:37Z): `c1ceae7e71` is pushed. Eleven new pure
  selected-zone/DST regressions first failed against UTC production; all
  91 affected unit cases and five unchanged route guards now pass after
  using shared numeric zoned parts, wall-time conversion and civil-day
  helpers. Tariffs/departures and both historical/projected forecast
  clocks follow `useDateFormat()`; KPI bounds use the same setting, with
  exact Tokyo and Los Angeles DST/locale assertions. UTC wire instants,
  absolute slot durations/24-hour horizons and measured values remain.
  Persisted v1 numeric clock-hour assumptions retain their values and now
  follow the active display setting; there is no second stored zone or
  settings migration. Catalog/fallbacks are synchronized. Actual
  TypeScript, full unchanged lint, six zero directory audit categories,
  energy-hook routing and the hermetic build pass. **Exact next:** finish
  native supported browser contracts after adding explicit UTC arguments
  to their original seeded-clock expectations, run the new forecast-memo
  rerender regression/affected ESLint, then commit/push this coherent
  phase. Latest graph is 8 pending/2 skip, not green. No baseline changes.
- Home-energy phase gate (21:42Z): all **92/92** affected units now pass,
  including mounted tariff/departure and both forecast-memo zone-change
  regressions with unchanged scenario/source bytes and absolute instants.
  Native supported browser contracts pass **8/8** after explicitly threading
  their original seeded UTC clock through expectations; canonical exported
  plans retain the original shape. The unchanged responsive/timezone guard
  passes **5/5**, and both wrappers report zero proxy escapes. Final actual
  TypeScript and affected ESLint pass. Full unchanged lint, directory audit,
  energy-hook verification and build passed on the final production code.
  Source lengths/section counts remain intact: KPI 127/127, controls
  207/207, vehicle controls 125/125, hook 346/351, defaults 155/161,
  forecasts 218/218; the page still renders all ten original sections.
  **Exact next after push:** inspect current CI, then trace and fix the
  remaining signal-entropy/TCO/schema-description roots before the larger
  utilization/export/sleep/insurance/automation calendar models. Latest
  current-head CI is still queued (8 pending/2 skip); no green claim.
  Evidence: `r32-local-clock-red`, `r32-home-route`, `r32-home-audit`,
  `r32-lint`, `r33-home-supported`, `r33-eslint`, `r35-home-unit`,
  `r35-tsc`, `r35-eslint`. No Windows mirror or baseline changes.

## CI-until-green continuation (2026-10-25, after `3ca29a42ad`)

- Section 0: fetched/switched/pulled the expected branch; worktree clean.
  The existing CLI is this session's parent; preserved IDE-owned Copilot,
  Playwright test-server and TypeScript processes. No orphan runner found.
  The latest user request overrides the ten-fix stop below: checkpoint and
  push, but continue until every check passes.
- Initial current-head observation: 15 failing / 129 passing / 53 pending /
  3 skipped, still in flight. CI `40213226711`, quality `40213226800`.
  Exact evidence: `resume-3ca-checks.json`, `resume-ci-failed.log`,
  `resume-unit-3.log`, and `resume-responsive-*.log` in the existing CI
  continuation evidence directory.
- Grouped roots: dashboard redesign assertions plus real energy/battery
  chart clipping (largest group); a real ToastProvider timeout surviving
  unmount causes unit shard 3 and three dependent failures despite all its
  11,692 tests passing; obsolete date/zone drawer assertions across
  operations, notifications, seasonal driving and charge-advisor contracts;
  missing fleet-posture contract; live-signal sparkline horizontal overflow;
  remaining route timezone guards. Exact deduplicated widget evidence:
  `resume-root-summary.txt`.
- Round 0 is now complete: **32 failing / 168 passing / 3 skipped**.
  Bulk quality-log retrieval failed with HTTP/2 cancellation and HTTP/1
  unexpected EOF; bounded per-job log retrieval works and is the recovery
  path. Do not repeatedly download the full archive.
- Fix 1 verified subset: bounded EnergyStats/BatteryDegradation headline
  allocation repairs real clipping; DriveEfficiency retains its measured
  mean reference, numeric axis, exact source values and null rolling series.
  Four native mean-line proofs require y=241.37931034482762 and the exact
  Avg: 241.38 Wh/km label, palette token, full wire record and observer scope.
  Its static rolling key appears only with a measured rolling series.
  Updated exact dashboard counts, version metadata, healthy-service states,
  dynamics peaks and associated readout units instead of obsolete precision.
  Speed-heatmap binding requires the actual absent limit parameter, matching
  its existing request and explicit unit contract; no request
  or fixture changed and every full-wire/observer invariant remains.
- Verification: 55 chart unit tests, all 7,728 frozen receipt tests and actual
  final TypeScript/affected ESLint pass. All three source audits report six
  zero counts and TypeScript pass; energy hook paths match. Battery browser
  cases pass 4/4, system/telemetry/charging cases pass 12/12, escapes=0.
  Source lines 257->260 / 164->166 / 262->286; all three chart frames remain.
  Sanctioned generators refresh only verified receipts; no baseline change.
  Evidence: `r4-widget-final-unit`, `r4-final-frozen`, `r4-final-tsc`,
  `r4-final-eslint`, `r4-audit`, `r4-final-build`, `r4-system-confirmed` logs,
  and the four `drive-reference-native-contract.json` artifacts.
- The broader energy/driving groups are NOT passing yet: each still has
  four failing cases, with zero escapes. Newly exposed roots are CostForecast
  period-total/header allocation, speed-profile/regen readout precision,
  coach recommendation vs old score, and missing telemetry readout/geometry.
  The separate wide-dynamics distribution and motor-history cases also remain.
  Continue those precise widget and date-contract groups. Full-suite
  validation remains exclusively CI-owned; inspect the next pushed head.
- Fix 2: ToastProvider now owns dismissal timers in its effect lifetime,
  including dismissal, five-toast eviction and unmount cleanup. Absolute
  deadlines prevent newer toasts extending existing lifetimes and survive
  StrictMode effect replay. Three new lifecycle assertions fail before
  the fix; all 41 Toast/actual admin BackupRestore tests now pass.
  Actual TypeScript and the entire existing lint chain pass. The source
  audit honestly reports the two unchanged pre-existing raw buttons and
  zero in its other five violation categories; no markup was changed.
  Source lines 238->244, no panel/chart/API/hook/baseline changes.
  Evidence: `r5-toast-red`, `r5-toast-page-unit`, `r5-toast-audit`, `r5-lint`.
  Next step: restore real compact drive telemetry and wide distribution,
  bound CostForecast's chart, then fix the remaining exact readout/date
  contracts. At 6092735f15 CI is still in flight: 0 fail/14 pass/176 pending/
  3 skipped; do not count pending jobs as an improvement from round 0.
- Fix 3: CostForecast now reserves content-sized headline height and bounds
  its chart allocation. The exact browser headline binds $250.00 to the
  complete two-month horizon (120+130), not the obsolete first-month $120.
  All nine existing unit cases and all four energy adoption cases pass,
  including unchanged allocation/Y-axis guards and zero proxy escapes.
  Actual TypeScript, affected ESLint and all six source-audit counts pass.
  Source lines 236->238 and the chart frame is retained.
  Evidence: `r6-cost-unit`, `r6-cost-build`, `r6-cost-audit`, `r6-cost-eslint`,
  `r6-energy`. Related telemetry changes share the same adoption file and
  are being verified before the next coherent commit/push.
- Fixes 4-7 are verified:
  (4) DriveTelemetry has real latest speed/power, null/loading/error/recovery
  states and two numeric axes; preserves its interactive series control.
  (5) Wide dynamics restores the genuine independent source, correctly
  counting signed G magnitudes in 12 bins rather than treating raw G readings
  as counts. Narrow layouts keep that request disabled; refresh/recovery
  and retained samples stay independent of the measured style/peaks.
  (6) SpeedProfile restores measured SI-watt average power beside sample
  frequency, with null/signed/unit conversion, a true second axis/curve,
  exact 3.00/9.60 kW source rows and 20%/80% frequency rows. Existing catalog
  aria copy already promises both; the caption explicitly rejects an
  energy-efficiency inference. Preserve interactive series hiding, not
  a static-key waiver.
  (7) MotorHistory bounds both real curves and caption, includes torque in
  its accessible table/tooltips, retains torque-only history and calculates
  its temperature domain from numbers, never localized tick strings.
- Current browser evidence: driving 4/4, wide dynamics 4/4, motor 8/8 pass,
  plus two strict power-curve/table checks; every wrapper reports escapes=0.
  All 80 tests in six affected suites passed; the added telemetry loading
  case also passes in its final 9-test suite. All 7,728 frozen receipts pass.
  Four actual source audits show six zero counts and TypeScript pass; both
  driving and vehicle hook domains match registered routes.
  Native heatmap proof now reconciles all 168 accessible rows, 167 unknown
  speeds and the one exact 64.80 km/h (1 drive) SVG cell, preserving the
  deliberately caption-free design and the original complete wire record.
  Source lines/shells/charts: Cost 236->238/2->2/1->1;
  telemetry 275->304/2->2/1->1;
  dynamics 146->221/1->1/0->1; speed 321->361/2->2/1->1;
  motor 292->297/2->2/1->1. Nothing was removed or waived.
- Final gate passes: shared VisuallyHidden and real interactive legend/hide
  wiring satisfy the unchanged guards. The entire existing lint chain,
  18 final telemetry/speed unit cases, 7,728 frozen tests and rebuilt hermetic
  mock bundle pass. The two final wide driving browser cases also pass,
  with exact measured power/table/axis proofs and zero proxy escapes.
  Both final source audits report all six counts zero and actual TypeScript
  pass. No guard, suppression, tolerance or baseline changed.
  Evidence: `r8-final-gate`, `r8-final-driving`, `r8-final-telemetry-audit`,
  `r8-final-speed-audit`, `r8-final-widget-unit`,
  `r8-source-audits`, `r8-receipts-build`, `r8-driving`, `r8-wide-dynamics`,
  `r8-motor`, `r8-power-source`, `r8-shared-loading-validation`.
- Head 3206414200 at 18:25Z: **27 failing / 171 passing / 1 pending /
  3 skipped**; frontend coverage merge passes. This graph is not final and
  does not include the unpushed chart phase.
- That head's completed graph is **28 failing / 172 passing / 3 skipped**,
  versus round 0's 32 failing / 168 passing / 3 skipped. The chart phase
  above has not yet been evaluated by CI. Exact graph:
  `r8-final-prepush-checks.json`.
- Chart phase pushed as `2d7cd8f906`; its CI graph is newly in flight.
- Fix 8: operations drawers require the exact localized successful-import
  timestamp `Aug 5, 2026, 07:00:00 AM` and reject its raw ISO text/title.
  All eight focused service-report and real eight-day catalog-age cases
  pass across both widths/themes. Source trust, official-period controls,
  freshness/retention and recovery contracts remain intact.
- Fix 9: seasonal coverage requires the real included-row metric (1), no
  duplicate timezone metric, and exact first/last included dates formatted
  in UTC from the fixture source. The drawer retains its UTC source scope,
  metric label and all published values. All four cases pass, preserving
  excluded/unknown/model-fit accounting, exact uncapped 1,000-row request,
  focus restoration and geometry. The first diagnosis exposed one obsolete
  prose caption; it is replaced by the actual row label plus exact count,
  not by an unbound presence assertion.
  Both test files pass affected ESLint; every browser wrapper reports zero
  escapes. No production date, API, storage, i18n or baseline changed.
  Evidence: `r9-catalog-date`, `r9-seasonal-final`, `r9-date-eslint`.
- Date-contract fixes 8/9 pushed as `f943f3cde4`.
- Fix 10: day-ledger interval provenance was genuinely absent. A narrow
  optional analysisPeriod prop threads through the existing brief/narrative
  composition to CalculationDetails' native Analysis period row. It now
  shows exact localized authoritative half-open bounds, explicitly end
  exclusive, or the existing unavailable-bounds message. No legacy API,
  raw ISO or duplicate timezone caption is restored.
  Three new assertions failed before production repair; all 54 day-summary
  and shared brief/narrative/calculation tests pass, including a 23-hour
  Los Angeles DST day with unchanged UTC wire instants.
- All 28 focused day-ledger source/refresh/loading/retry/navigation cases
  and all eight header layout cases pass, escapes=0. Native Analysis period
  definitions require exact bounds and reject raw ISO. Header cases retain
  geometry/focus/copy checks and now additionally require exact vehicle 7,
  Buenos Aires timezone and day parameters through navigation/manual/today
  requests instead of a removed duplicate zone badge. API fixture payloads
  are unchanged; only expected display constants are localized.
  Full unchanged lint, rebuilt mock bundle, 7,728 frozen tests, all three
  six-zero-count production audits and actual TypeScript pass. The existing
  day-log hook matches router.go. Canonical translations are unchanged; the
  sanctioned split/usage generators expose two existing keys. None of the
  three changed production files is in the frozen producer manifest.
  Lines/panels: Brief 375->377/1->1; NarrativeDetails 246->249/0->0;
  DaySummary 116->122/1->1, no chart removed. Evidence: `r10-day-bounds-red`,
  `r10-day-bounds-final-unit`, `r10-day-gate`, `r10-day-contract`,
  `r10-day-header`, `r10-frozen`, `r10-*-audit`, `r10-day-hooks`.
- Corrected diagnosis: responsive 49 contains 115 route samples, all with
  tzIso/tzZones/tzDupes=0. Its failures are day-ledger contracts, not a
  remaining route-zone violation; do not change those passing guards.
- At 18:55Z, pushed head f943f3cde4 has **1 failing / 97 passing /
  99 pending / 3 skipped**, not a final graph. First current failure:
  responsive-26, run `40222371592`, job `121257103490`. The day-ledger phase
  has not yet been evaluated by CI. This ten-fix checkpoint must be pushed,
  then continue unattended.
- Day-ledger fix 10 pushed as `55fe6605c6`.
- Fix 11: the actual responsive-26 root is the strict cost-forecast source
  query, not notifications. Its established hook now resolves the saved
  timezone; the contract requires exactly months=6, vehicle_id=7 and
  timezone=UTC. No request keys are ignored. All three focused mixed/null/
  measured-zero cost browser cases pass, retaining exact free-session,
  unknown-vs-zero, cost/energy, source-ledger and drawer proofs; escapes=0.
  Affected ESLint passes; no production code or fixture response changed.
  Evidence: `r11-responsive26`, `r11-cost`.
- Fix 11 committed as `f6ab2f3f2b`; it will accompany the next coherent push.
- Fix 12: the advisor directory really still rendered raw business-day
  keys. It now uses the shared formatDayKey boundary without changing its
  seven local dates, weekdays, daily assumptions, projections or ranking.
  Both LA/Tokyo regressions fail before production repair; all 58 page
  tests now pass after allowing the real entry animation to settle.
  Existing exact-date assertions are localized, not removed.
  Supported browser contracts require the entire exact Dec 5, 2025 –
  Jun 2, 2026 history-window caption, reject raw date keys/redundant UTC,
  and verify all seven exact projected dates alongside their actual SoC
  values. All eight supported-history/live-zero/stale/recovery/reserve-floor
  cases pass, escapes=0. Full unchanged lint, actual TypeScript/six-zero
  source audit, 7,728 frozen tests and rebuilt mock bundle pass.
  Source 75->77 lines, section 1->1, no charts/API/storage/catalog or
  baseline changed. Evidence: `r12-advisor-date-red`, `r12-advisor-final-unit`,
  `r12-advisor-gate`, `r12-advisor-audit`, `r12-advisor`, `r12-frozen`.
- Head 55fe6605c6 at 19:09Z is **0 failing / 73 passing / 120 pending /
  3 skipped**. It has not evaluated fixes 11/12; this is NOT a completed
  improvement from the last final 28-failure graph.
- Fix 12 pushed as `fd3c156153`, together with cost-query fix 11.
- Fix 13: notification activity now retains its exact requested half-open
  interval in the existing native Analysis period row, separately from its
  compact calendar scope. Both bounds use the shared selected-zone
  formatter; end-exclusive semantics and actual UTC request parameters
  remain unchanged, including when the report is unavailable.
  Three regressions fail before production repair; all 16 report unit
  cases pass, including the 23-hour Los Angeles DST window. All eight
  focused loaded/unavailable browser cases pass with zero proxy escapes,
  exact request-bound displays, unknown metrics and source shells intact.
  Actual TypeScript, affected ESLint, full unchanged lint chain and
  hermetic build pass; the production audit reports six zero counts and
  the notification hook URLs match registered routes.
  Source 174->178 lines; all nine panel/chart/brief sites remain.
  One canonical English bounds key and its generated split/usage entries
  are added. Sanctioned generators update seven catalog-size/hash receipts
  mechanically; all 7,728 frozen tests pass without removed assertions,
  handwritten hashes, suppressions, guard or baseline changes.
  Evidence: `r13-notification-red`, `r13-notification-unit`,
  `r13-notification-audit`, `r13-notification-hooks`,
  `r13-notification-gate`, `r13-notification-browser`, `r13-frozen`.
- Head fd3c156153 at 19:20Z is **0 failing / 50 passing / 142 pending /
  3 skipped**, still incomplete. Do not compare this with the completed
  28-failure graph as a final improvement.
- Fix 13 pushed as `bc841f3b79`.
- Fix 14: a real history failure was rendering its entire retry panel in
  the fixed 56/80px sparkline track. Recovery and retained-history warnings
  now span the whole row; the trend icon stays in its own first-row track.
  Current measurements, error detail, retry actions and retained curves are
  preserved, not clipped or hidden. Both compact/wide new regressions fail
  before production repair; all 30 signal widget unit cases pass.
  The unchanged browser guard reproduced exactly four 688/678px overflows.
  After repair all 121 widgets pass all six min/default/large view/edit
  configurations, with no missing widgets, header failures, overflow or
  proxy escapes. This is one related browser spec, not a local full suite.
  Actual TypeScript, six-zero-count audit, complete unchanged lint,
  hermetic rebuild, both hook-domain route verifiers and all 7,728 frozen
  contracts pass. Source 276->281 lines, shell and plot sites 2->2.
  No translation, receipt, tolerance, guard or baseline changes.
  Evidence: `r14-overflow-before`, `r14-overflow-unit-red`,
  `r14-overflow-unit`, `r14-overflow-audit`, `r14-overflow-gate`,
  `r14-signal-hooks`, `r14-frozen`, `r14-overflow-final`.
- At 19:34Z, bc841f3b79 is **0 failing / 79 passing / 115 pending /
  3 skipped**, still incomplete rather than green.
- Fix 14 committed as `b4c9429ef2`.
- Fix 15: the dashboard layout contract still selected the removed
  fixed FleetOperationsBrief/taxonomy instead of the redesigned widget.
  Both widths now require the real fleet-posture widget, exact verified
  1/1 headline, native 100% meter bounds/text, Aurora's native definition
  row and live-state/active labels, and its exact polite announcement.
  The old fixed brief, taxonomy and workflow chrome must remain absent.
  The browser clock is tied to the fixture batch's own `now`, not today's
  wall clock: the fixed August observation correctly becomes unverified
  in October otherwise. No response payload or production trust logic was
  changed. Both 390/1440px cases and affected ESLint pass; proxy escapes=0.
  Evidence: `r15-fleet-browser`, `r15-fleet-final-browser` diagnostic
  logs, `r15-fleet-native-browser` and `r15-fleet-eslint`.
- Fixes 14/15 pushed through `7fbfb8a4cc`.

### Required consecutive-failure handoff (2026-10-25 19:41Z)

- The latest user's stop condition fired: two consecutive bounded browser
  tool calls failed (`355` signal catalogue, `356` workspace catalogue).
  Stopped starting implementation work; preserve the incomplete fixture
  repair in an explicitly named WIP commit, update state, push and hand off
  under section 0b. This is not a completed fix or an all-green claim.
- Last verified implementation head is `7fbfb8a4cc`, including notification
  interval provenance, full-row signal history recovery and the native
  fleet layout contracts described above.
- **WIP, verify first:** `web/e2e/dashboardCatalogueRemainingFixtures.ts`.
  The related signal/tire group originally failed all four width/theme
  cases because five actual one-hour history requests were unmatched:
  BatteryLevel, ACChargingPower, InsideTemp, OutsideTemp and RatedRange.
  The WIP supplies those precise typed SI sources, exact hours=1 request
  checks, matching current/available values, and native value/curve
  assertions. It preserves Soc and charging-schedule settings. No generic
  unmatched-request exemption or production API change was added.
  A missing catalogueWire import caused the first repair attempt to fail;
  that import is now corrected. Affected ESLint and actual frontend
  TypeScript pass, but TypeScript does not cover these browser-only files.
- The subsequent single 390px/light signal case now stops at the unchanged
  `dashboardCatalogueChargeHistory.ts:152` source-observer guard:
  `Exactly one source component must own the exact charge observer key`,
  expected one binding, got zero. Wrapper proxy escapes=0. Diagnose the
  exact observer owner/key and saved native artifacts; do not remove the
  guard, ignore request parameters or count this case as passing.
  Evidence: `r16-signals-before`, `r16-signals-final` (missing-import
  diagnosis), `r16-signals-focused` and their isolated result directories,
  plus `r16-signals-eslint` and `r16-tsc`.
- The separately diagnosed 390px/light workspace case still requires an
  obsolete Verified listitem in `assertRemainingContent`'s fleet-posture
  branch. The actual widget uses WidgetBigNumber and a native definition
  list, as proved by the passing fix-15 layout cases. Update that contract
  to require the exact native verified fraction, coverage and real vehicle
  evidence, rather than restoring the deleted taxonomy/listitem chrome.
  Evidence: `r17-workspace-before`; escapes=0, case is NOT passing.
- Pre-handoff-push graph for `7fbfb8a4cc` at 19:41Z:
  **0 failing / 26 passing / 164 pending / 3 skipped**. It is incomplete,
  not an improvement from the last completed 28-failure graph and not
  green. `r17-handoff-checks.json` preserves the exact observation; the
  WIP/documentation push will have a new graph.
- All owned Bash/browser/build commands are completed; no running helper
  or created worktree remains. IDE-owned tools were preserved. Windows
  mirror/baselines, workflows and tolerances are unchanged.
- Exact next step: verify/fix the WIP signal source-observer binding first,
  then replace the workspace catalogue's obsolete native selectors.
  Run the four signal/tire and four workspace cases with retries=0,
  timeout 20m and zero proxy escapes; also check the charging-strategy
  consumers of the shared signal fixture. Reuse the existing hermetic
  build unless production changes. Resume fresh PR checks, address actual
  remaining sleep/home-energy/CI roots and continue until green.

## Mandatory ten-fix handoff (2026-10-25 16:43Z)

- Ten fixes are complete in this continuation; stop here per section 0b.
  Latest implementation commit: `f57f163381`. The final documentation
  checkpoint accompanies `065314d27c`, `664b02a0c8` and `f57f163381`
  in the final push bundle.
  PR #202 is **not green**; full-suite validation remains CI-owned.
- Fix 10 formats Locations scope and both Parking scope/methodology bounds
  through the existing selected-zone date layer. API UTC instants, range
  arithmetic, inclusive/exclusive semantics and source coverage are unchanged.
  Three new regressions failed before the production change; all four
  affected suites now pass 77/77, covering Los Angeles, Tokyo and saved
  German/Berlin formatting plus unchanged request bounds and source summaries.
  The existing Berlin assertion now requires both exact localized boundaries
  and rejects raw ISO instead of demanding the old raw timestamp.
- Final verification: actual TypeScript and the complete existing lint/audit
  chain exit 0. All three seven-category production audits report six zero
  violation counts and TypeScript pass; Locations/Driving hook URLs match
  registered routes. Both unchanged 1280px route guards pass with
  tzIso/tzZones/tzDupes=0 and wrapper proxy escapes=0. Seven existing frozen
  receipt suites pass 7,728/7,728 after serial sanctioned generators and mock
  rebuild. Source lines 549->549, 127->129, 124->124; panel/chart section
  counts stay 1/1/0. No translations, API contracts or baselines changed
  in this tenth fix.
- Evidence remains in the CI continuation directory below:
  `fix-10-window-red.log`, `fix-10-window-unit.log`, `fix-10-tsc.log`,
  `fix-10-eslint.log`, `fix-10-audits.log`, `fix-10-full-lint.log`,
  `fix-10-frozen-unit.log`, `fix-10-mock-build.log`,
  `fix-10-route-guard.log`, and both `fix-10-*-hooks.log` files.
- Latest graph for the previously pushed `bfecead853`: **8 failing /
  134 passing / 53 pending / 3 skipped**, still in flight, not a completed
  improvement from round 0's 42 failures. Failures: responsive shards
  9/12/13/26/27/31/32/47. CI `40211130150` and quality `40211129921`
  describe that older head; discover the new head's runs after this push.
  `round-3-handoff-checks.json` and `round-3-handoff-workflows.json` preserve
  the exact observation. Completed-job logs can be captured while the parent
  workflow is running using `gh api --allow-escape-sequences
  repos/ev-dev-labs/teslasync/actions/jobs/<job-id>/logs > <session-log>`;
  strip ANSI only when reading bounded summaries. The ordinary full-run
  `gh run view --log-failed` is unavailable until that workflow completes.
- **Exact next step:** start section 0, inspect the newest head's
  `gh pr checks 202`, then group its completed failures using bounded logs.
  A concrete remaining root in responsive-32 is four operations-brief cases
  in `e2e/operationalbrief-contracts/operations.smoke.spec.ts` (lines 290/380):
  the service-report/catalog-age drawer locator still demands the raw title
  `2026-08-05T07:00:00.000Z`. Inspect the real shared date output and preserve
  exact source-age/recovery semantics when repairing the contract; do not
  weaken it to substring or presence-only checks. Evidence:
  `round-3-responsive-32.log`. Continue the remaining semantic timezone and
  dashboard-acceptance roots listed below, targeted locally, full suite in CI.
  Do not rerun a local replica or count this incomplete graph as green.
- Windows baseline work is complete: the same six reviewed shards were
  regenerated once and verified read-only (10/10); the mirror is clean.
  Do not regenerate those baselines again. Handoff preflight confirms every
  tracked shell command completed and no preview listens on port 4301;
  IDE-owned processes were preserved. The documentation commit/push is the
  only remaining operation before the final WSL clean-tree confirmation.

## CI-driven continuation (2026-10-25, after `ec53fca3b5`)

- User strategy override is now reflected in playbook section 3: local
  TypeScript/lint and related unit/E2E specs ONLY; CI owns full validation.
  No full local quality suite or replica. Timeouts require inspection and
  smaller runs, not another identical run or an early stop.
- Section 0: expected branch fetched/pulled; clean at `ec53fca3b5`.
  Removed an empty stale `.git/index.lock` only after confirming no git
  process owned it. Existing CLI is this session's parent; IDE-owned
  headless Copilot and Playwright test-server remain user tooling.
- Round 0: **42 failing / 158 passing / 3 skipped** checks at `ec53fca3b5`.
  CI run `40198967208`: one stale statistics source assertion causes unit
  shard 1/8, coverage and aggregate failures. CodeQL reports two test-only
  incomplete-escaping/sanitization patterns. Quality run `40198967056`:
  dashboard acceptance/design mismatches, real cost-chart clipping,
  timezone violations on 23 routes, and six failing Windows visual shards
  (1,5,10,14,39,56 out of 64). No baseline update has run.
- Evidence:
  `/home/atul/.copilot/session-state/d279d214-3d92-4a65-b124-08c71e983561/files/ci-rounds-20261025/`.
  `round-0-checks.json`, `ci-failed.log`, `quality-failed.log`,
  `quality-failure-summary.json`, `codeql-check.json`,
  `codeql-annotations.json`. Read bounded summaries, not entire logs.
- Fixes 1-3 verified: cost breakdown's full-height headline no longer takes
  the chart's allocated height (wrapped in a content-sized, non-shrinking
  flex item); added containment regression. All eight signed/eight-decimal
  axis geometry scenarios pass unchanged, wrapper proxy escapes=0.
  Updated the statistics source contract to require the canonical shared
  efficiency conversion already used by production, not inline legacy
  multiplication. Removed CodeQL-triggering incomplete regex escaping in
  the pair-table test using exact accessible names, and strengthened the
  watch privacy assertion with case-insensitive matching and no script DOM.
  Five targeted suites: 121/121 tests. Actual seven-category production
  audit: six counts 0, TypeScript passes; complete lint chain exits 0.
  Evidence: `fix-1-3-unit.log`, `fix-1-axis-browser.log`,
  `fix-1-audit.log`, `fix-1-3-lint.log`.
- Fixes 4-5 verified: departure forecast now consumes the shared selected
  display zone rather than forcing vehicle mode; user/fixed/vehicle
  provenance stays truthful and model weekday/evidence agree in conflicting
  Tokyo/Los Angeles cases. Charge-departure source history bounds/counts
  move into the existing Review details drawer; identical bounds render
  once, and retained-source recovery links remain usable there.
  Departure/model tests pass 61/61. Related/frozen run initially passed
  8,001 tests with one stale card-face assertion failing; the corrected
  drawer/recovery suite then passed 9/9. All frozen catalog suites passed.
  Actual TypeScript and affected ESLint exit 0. Both unchanged 1280px route
  guard cases pass, tzIso/tzZones/tzDupes=0, wrapper proxy escapes=0.
  Mock build initially failed its catalog check while generators were
  updating inputs; serial catalog check and rebuild both exit 0 afterward.
  Source line counts 190->198, 303->308, 126->126, 119->119, 78->83;
  panel/chart reference counts unchanged (0/3/0/3/0). Driving and charging
  hook paths all match router registrations. Sanctioned generators also
  refresh the CostBreakdown producer receipt missed in the first commit.
  Evidence: `fix-4-departure-unit.log`, `fix-4-5-targeted-unit.log`,
  `fix-5-alignment-final.log`, `fix-4-5-mock-final.log`,
  `fix-4-5-tsc.log`, `fix-4-5-eslint.log`, `fix-4-5-browser.log`.
  All five actual seven-category production audits report six counts 0
  and TypeScript pass; full existing lint/audit chain exits 0
  (`fix-4-5-audits.log`, `fix-4-5-full-lint.log`).
- Round 1 at `2f6aba7b3d` is IN FLIGHT: 1 fail / 43 pass / 146 pending /
  3 skipped, not a final reduction from round 0. First observed failure:
  Windows visual shard 1/64; no snapshots changed yet.
- Windows mirror again confirmed clean; downloaded ONLY failing visual
  artifacts (1,5,10,14,39,56/64). All six old/new pairs reviewed: dashboard
  shards 1/5/10/14/56 differ only in the intended compact quick-navigation
  tiles (including forced colors); shard 39 differs only in semantic
  battery-bar palette. Approved for one-time targeted regeneration.
- Fixes 4-5 pushed at `d2c6d9f212`; round 2 has begun (first observation
  36 pending / 4 pass / 2 skipped; incomplete job graph, not a final count).
- Fix 6: exact charge observer contracts now require the production
  20-session chart key/request rather than the obsolete 10-session key.
  Kept all same-widget/boundary/vehicle/list/full-wire invariants and every
  negative mutation test; real native observer suite passes 13/13 with
  proxy escapes=0. Affected ESLint and actual TypeScript exit 0.
  Evidence: `fix-6-query-binding.log`, `fix-6-eslint.log`, `fix-6-tsc.log`.
- Windows mirror synced cleanly to pushed `d2c6d9f212`. Its build passes
  using native `npm.cmd` (plain `npm` resolves to a PowerShell script blocked
  by the machine's existing execution policy; no policy changed and no
  dependencies installed). Reviewed-shard regeneration is next.
- Fix 7: weekly loading/retention/retry/recovery assertions now require the
  exact redesigned distance AND km unit, instead of obsolete two-decimal
  substrings; initial/error states also reject the actual zero/value format.
  All eight theme/viewport/state cases pass, including keyboard retry and
  real 42->84 recovery; proxy escapes=0, affected lint and TypeScript exit 0.
  The first anchored title filter selected no tests; the corrected
  fully-qualified-title filter ran all eight. No case was skipped/deleted.
  Evidence: `fix-7-weekly-final.log`, `fix-7-eslint.log`, `fix-7-tsc.log`.
- All six reviewed Windows shards regenerated ONCE, serially (1/5/10/14/
  39/56 out of 64): 10 tests pass, every wrapper proxy escape count 0.
  Only the six approved PNG files changed and were copied back; mirror
  snapshot tree restored clean. Three new files are byte-identical to the
  reviewed CI actual; the other three differ by only 4/13/4 decoded pixels,
  with no additional content/layout change. Old/new and generated pairs
  reviewed. No tolerance/configuration change.
  Native dependency inspection found pre-existing invalid zod@3.25.76
  against the synchronized lockfile. Run the permitted single native
  `npm.cmd ci --legacy-peer-deps`, rebuild, and verify those same shards
  WITHOUT update-snapshots after syncing the committed images.
- Then-next step (at seven fixes): commit/push the reviewed images, restore native
  dependencies as above, then verify them without regenerating; repair
  remaining exact dashboard readout contracts and semantic timezone roots.
  Unknown-charger binding now passes; next observed assertion is obsolete
  detail-energy precision, followed by removed aggregate KPI expectations.
  Completed fixes this session: 7; final native baseline verification pending.
- Fix 8 final proof: the one permitted native dependency restore and rebuild
  both exit 0; `npm.cmd ls --depth=0` now exits 0. All SAME six committed
  Windows shards pass again WITHOUT `--update-snapshots` (10/10 tests,
  six proxy-escape counts 0). Mirror `git.exe status --short` is empty.
  Baselines are committed/pushed at `bfecead853`; evidence
  `windows-restored-dependency-build.log`, `windows-dependencies-final.json`,
  `windows-verified-{1,5,10,14,39,56}.log`.
- Fix 9 verified: exact redesigned detail readings expose a REAL wide-card
  overflow (SVG bottom 568.75 exceeds card bound 552.75). Shared
  WidgetChartSummary now reserves non-shrinking caption/legend/stat height
  and gives its chart a bounded flexible slot; no geometry threshold changed.
  Regression plus both charging-widget suites pass 113/113; all seven
  sanctioned frozen receipt suites pass 7,728/7,728. Full signed/8-decimal
  axis matrix and all four Unknown-source cases pass 12/12, escapes=0.
  Unknown assertions retain full native wire/scope checks and now require
  exact 42.0 + associated kWh, the single accessible 42-kWh source row and
  real tooltip/bar, rather than aggregate tiles absent from the redesign.
  Actual seven-category shared-source audit: six counts 0, TypeScript pass;
  affected ESLint passes. Shared source 152->153 lines; all three axis/legend
  branches remain. No request or hook changed. Evidence: `fix-9-chart-unit`,
  `fix-9-frozen-unit`, `fix-9-contained-browser`, `fix-9-audit`,
  `fix-9-source-eslint`, `fix-9-mock-build` logs.
- Then-next step (at nine fixes): remove raw requested-window instants from
  Locations/Parking display using the selected-zone formatter, with unchanged
  API bounds; verify, commit/push, then hand off at ten completed fixes.
  Full CI for `bfecead853` is queued, not green (CI `40211130150`, Frontend
  Quality Gates `40211129921`); the small currently registered graph is
  not full-suite acceptance. Latest observation: 4 failures / 46 passes /
  142 pending / 3 skipped, still in flight. Completed fixes this session: 9.

## Resume verification (2026-10-25, after `354deb1c1f`)

- Section 0: fetched/pulled the expected branch; working tree clean. Stopped
  the idle CLI from the clean prior handoff; the IDE-owned Playwright test
  server is user tooling and was not stopped. Windows mirror confirmation:
  `git.exe -C D:/repos/teslasync status --short` returned no output.
- Completed result 1: removed redundant zone-name captions from both
  ClimateControlPage charts and vehicle-detail RecentDrivesSection. Actual
  dates still use the selected zone through the existing shared formatter;
  no hooks, API contracts, storage, sections, or calculations changed.
  Regression tests failed before (2 failures/100 tests), then passed
  (100/100). TypeScript, focused ESLint and both seven-category audits pass
  (six violation counts each: 0). Source lines 1602 -> 1600 and 131 -> 130;
  panel/chart counts unchanged at 14 and 1. Mock build rebuilt; actual
  `/climate`, `/climate-control`, `/vehicles/7` guard runs at 1280px pass
  3/3, each with tzIso/tzZones/tzDupes=0; wrapper proxy escapes=0.
- Evidence for this resume:
  `/home/atul/.copilot/session-state/d279d214-3d92-4a65-b124-08c71e983561/files/`.
  Caption regression/build/audit/browser logs use `timezone-*` and
  `e2e-build-caption.log`.
- Completed result 2: startup closure reduced from 413,843 to 409,084 gzip
  bytes (404.1 -> 399.5 KB; unchanged 400 KB budget). Extracted the unchanged
  repair-scoped query, fleet-setup keys and signal-kind normalizer into
  synchronous leaf modules; shell consumers no longer pull route-only
  useDataRepair/useFleetSetup/useSignals implementations. Re-exported
  existing public names; no request/response contract or timing changed.
  Private-map production build and the ENTIRE strict `npm run perf:check`
  exit 0; source maps confirm the three domain hooks leave startup.
  Five existing focused suites pass 204/204. Changed request-bearing hooks
  match registered routes (21/2/5/19/5 patterns; extracted helper: zero).
  Regenerated split catalogs with the sanctioned generator: dataRepair now
  lives only in the lazy system bundle, not shell plus a duplicate fallback.
  Catalog-locality suite passes 132/132, including the new exact locality
  regression. Full lint/audit chain and TypeScript exit 0. Evidence:
  `startup-final-*`, `startup-hooks-contract.log`, `catalog-locality-final.log`.
- Completed result 3: reconciled hero E2E against the already committed
  compact redesign (one meaningful battery meter, textual range/temperature
  chips, Details navigation). No production readings/actions were removed.
  Added named accessible groups and explicit Unknown descriptions for
  missing/non-finite range/temperature readings in BOTH hero surfaces, and
  a real 44px hit target for the widget Details link. Added six fail-before/
  pass-after unit regressions; complete hero suites pass 53/53.
  E2E retains every unknown/zero/regen case, theme and viewport; validates
  actual SI-derived numbers and signed power on the shared card (compact
  dashboard intentionally has no power chip), rejects invented meters/
  obsolete quick actions, and now activates Details by keyboard and checks
  the rendered destination. Complete matrix passes 34/34, proxy escapes=0.
  Explicit null/empty detail-endpoint fixtures preserve strict API matching
  during the newly tested navigation; no matcher was loosened.
  TypeScript, focused ESLint, both seven-category audits and full lint pass.
  Source lines 417 -> 430 and 310 -> 314; shell/panel counts unchanged.
  Reviewed both surfaces' 320px dark and 1440px light screenshots. Windows
  baselines remain untouched. Evidence: `hero-*` logs and browser screenshots
  in `web/test-results/` (not committed; later runs may replace them).
- Completed results 4-8 (section 3 checks):
  route registry/template freshness, route/scenario contracts and discovery
  exit 0 (harness 24/24; discovery 2,094 tests in 89 files);
  Go build and complete `go test -race ./...` exit 0;
  accessibility 13/13 and Firefox/WebKit 6/6 pass;
  browser performance exits 0 with 7 passed and 2 flaky (drives/FSD passed
  on retry). Successful browser wrappers each report zero proxy escapes.
  TypeScript and split-catalog check also exit 0. Logs:
  `replica-contracts.log`, `go-build.log`, `go-test-race.log`,
  `replica-a11y.log`, `replica-performance.log`, `replica-cross-browser.log`.
- Completed result 9 (INCOMPLETE validation, not a suite pass): bounded
  full Vitest attempt with four workers was stopped for handoff after
  approximately 13 minutes. Its last captured completion markers cover
  423 files / 21,508 tests with no completed-file failure markers; there
  is NO final full-suite summary. See `full-vitest.log` and
  `replica-partial-summary.json`. Do not treat this as full coverage.
- Completed result 10 (INCOMPLETE validation, not a quality gate pass):
  parallel local quality replica attempts hit repeated 240s operational
  timeboxes. Shards 1,2,5,6,9,10,13,14 timed out (124); shards 3,7,11,15
  were safely stopped; 4,8,12,16 never started. No shard completed its
  wrapper proxy check; NONE is counted passing. All partial logs and
  isolated artifacts are `quality-N.log` / `quality-N-results/` in the
  evidence directory.
- **Section 0b handoff at the requested ten-result boundary and repeated
  replica-timeout stop condition.** Three verified source repair commits
  are persisted. No worktrees were created. All session-owned Vitest/
  Playwright/preview processes were stopped and checked absent; the
  IDE-owned Playwright test-server remains user tooling. No Windows
  baselines were regenerated. Full replica remains incomplete, so this
  handoff push is NOT a successful part/phase gate.
- Last observed checks before this handoff push (old `354deb1c1f` HEAD):
  155 pass / 45 fail / 3 skipped. PR #202 is NOT green. After pulling this
  handoff, inspect checks for the pushed repair HEAD rather than those
  historical checks.
- Exact resume: first collect fresh PR failures; then repair the semantic
  timezone roots listed in "Exact next step" below and any genuine
  remaining unit/browser roots. Finish the full unit run and all 16
  quality shards with adequate bounded per-shard time (the 240s attempt
  here was insufficient; do not change test timeouts/guards). Reuse
  verified ancillary results only if no intervening changes affect them.
  Run the section 3 gate, push, then use the CLEAN Windows mirror under
  section 4 for reviewed old/new comparisons and ONE intended baseline
  update. Continue until PR #202 green or the next required handoff.
- Next: repair sleep/departure/energy-orchestrator timezone semantics and
  charge-departure duplicate timestamps. Full replica remains incomplete;
  the once-only reviewed Windows baseline update has NOT run.

## Merge-then-fix execution (2026-10-25)

- Prep: recovered the existing Zod 4.6.7 manifest/lockfile upgrade for the
  Security Scan finding (Zod 3.25.76; fixed version reported as 4.6.6).
  Adapted geofence lazy localized validation to Zod 4 error callbacks and
  preserved the alert place-ID validation message. TypeScript, focused
  schemas (82/82), ESLint, and split-catalog check pass. Full replica is
  deferred to the combined validation phase requested for this operation.
- Shared merge: `origin/feat/shared-patterns` at `c2d4ae5cb2` merged without
  conflicts. Combined/catalog checkpoint and split generators ran against
  the merged LF sources; all seven frozen suites pass (7,728/7,728).
  `npx tsc --noEmit` exits 0. Shared modules are retained.
- Shared merge committed and pushed as `b235484463`.
- Palette merge: `origin/feat/chart-palette` at `96ad7e99d1` integrated
  after shared patterns. One DriveStatCards conflict resolved with the
  shared energy conversion AND new `COLOR.GOOD` token. Preserved both
  branches' behavior. Aligned 12 case-only fallback discrepancies to the
  catalog; verified and regenerated 13 producer checkpoints, combined and
  catalog fingerprints. Extended the catalog generator to verify and
  regenerate the canonical fixture digest when approved copy changes;
  updated the neon-help copy fixture to the intended palette wording.
  No hash was hand-edited. TypeScript exits 0; eight palette/frozen suites
  pass (7,782/7,782).
- Palette merge committed and pushed as `11d3fd570c`.
- Cleanup done: GitHub automatically marked #205 MERGED into this branch
  after pushing its merge commit (therefore `gh pr close 205` refused);
  #204 was already CLOSED. Posted the requested exact comment to both.
  Both shared/colors worktrees had empty porcelain status and zero commits
  ahead of their origin branches; verified both branches ancestor-merged,
  then removed both worktrees without force. The pre-existing detached
  `/tmp/teslasync-palette-base` worktree was not created here and is retained.
- Combined validation so far: full frontend lint/audit chain exits 0;
  actual seven-category violations audit reports all six pattern counts 0
  and TypeScript passes; backend `go build ./...` and `go test -race ./...`
  exit 0. Route registry/template checks pass for 266 actual routes;
  E2E route/scenario contracts pass, harness contracts 24/24 pass,
  discovery lists 2,087 tests in 88 files before the new scanner contracts.
  Full Vitest was interrupted at the command time limit (exit 130); it
  did not produce a passing full-suite result.
- Windows baseline update BLOCKED: mirror status is
  `?? docs/widget-redesign/`. Section 4 forbids syncing a dirty mirror;
  no files there were modified and no baselines regenerated. Use Windows
  CI artifacts until the mirror is clean.
- New confirmed failure group: Lighthouse startup closure is 404.1 KB,
  above the unchanged 400 KB budget. Reproduced on merged production build;
  public AND private-map production builds exit 0; strict private-map
  performance check fails only that budget (273/432 startup icons; 13
  feature modules). No budget or threshold changed.
- Unit conversion worker replaced 17 guarded factors plus one elevation
  conversion across 16 source files; 78 focused tests passed, including
  17 new regressions. Five coupled stale palette assertions fixed to
  explicit shared tokens; affected suites 26/26 pass. Parent verification
  and generator-only fingerprint regeneration complete; committed as
  `0f45d02e08`.
- Complete CI unit failure inventory collected from all eight shards:
  69 files / 145 failing assertions, grouped into intended palette
  expectation changes, deleted production contracts, and shared-format
  expectations. Full raw logs and file/assertion inventory are in the
  session evidence directory below; all three disjoint test workers have
  finished and released their files.
- Production palette regression fixes: restore InsightsEngine up/down
  trend glyph records using canonical GOOD/BAD colors (previously only
  neutral remained, causing runtime crashes); restore TimeMarker's public
  canonical severityTokens re-export; replace duplicate blue signal-series
  colors with six distinct canonical teal/violet/amber/green/blue/rose
  tokens. Original behavioral assertions retained.
- E2E attribution used a real pre-merge build at `a2308886c3`, not
  unchanged-source inference. All six representative hero/route cases
  fail there too; this does NOT establish attribution for every case.
  Fixed competing dashboard init-script seeding, unknown battery meter
  semantics, and a timezone scanner visibility bug: descendants of a
  clipped accessible chart table were falsely treated as visible.
  New scanner checks real ancestor clipping, including forced-colors
  overrides; no class allowlist, skip, or tolerance changes. Focused
  browser proof 12/12, hero unit tests 40/40; parent timezone switch and
  scanner contracts 9/9, preview proxy escapes 0.
- Remaining E2E roots (not declared fixed): compact/full hero contracts
  disagree with old four-gauge/three-action E2E expectations; real visible
  UTC captions remain on climate, vehicle recent drives, sleep efficiency,
  departure forecast and energy-orchestrator; charge-departure-alignment
  repeats two visible friendly timestamps. Full 266-route TZ-5 sweep and
  16 quality shards still required after repairing these causes.
- Security Scan on merged PR run now SUCCESS (observed, not assumed).
- Evidence directory:
  `/home/atul/.copilot/session-state/da9135b7-c9ba-4ad9-a198-fd85558513da/files/`.
  Start with `combined-unit-failures.json`, `e2e-root-cause/report.json`,
  `merged-private-perf.log`, and the final handoff entry below.
- Verified repair commits: `0f45d02e08` canonical conversion adoption,
  `725355f7f6` visibility-aware timezone scanning/dashboard seeding/battery
  semantics, and `54a115d1f0` production palette contracts plus exact
  intended palette/copy expectations. No Windows baselines changed.
- Parent combined verification: 81/81 test files and 9,210/9,210 tests
  pass, covering every collected CI unit failure, changed regression
  tests and seven frozen i18n suites. Existing changed test/spec assertion
  calls increased from 4,894 to 4,915; no per-file assertion reductions or
  new skips. These are targeted results, NOT a passing full Vitest suite.
  Final actual audit reports six pattern counts of zero and TypeScript
  passing; full `npm run lint` including all registered audits exits 0.
  Evidence: `batch-all-affected.log`, `batch-final-audit.log`,
  `batch-final-lint.log`.
- Handoff at the requested completed-result/context boundary: repair
  commits are persisted serially; push this batch and resume in a fresh
  session. Last observed checks on pre-repair `11d3fd570c`: 124 success,
  31 failure, 20 in progress, 24 queued, 3 skipped. PR #202 is NOT green.
- Exact next steps: inspect checks on the new pushed HEAD; rebuild
  `E2E_MOCKS=1 npm run e2e:build` after the final palette source fix, then
  fix the unresolved hero behavior/contract mismatch without removing
  coverage. Repair visible timezone/duplicate-time roots listed above
  (exact file evidence in `e2e-root-cause/report.json`), then run the full
  TZ-5 route sweep and TZ-6/7 plus section 3 local replica. Reduce the
  actual 404.1 KB startup closure below the unchanged 400 KB budget.
  Full Vitest still required; use a bounded runner and preserve partial
  output if its command reaches the playbook limit. For visual work,
  recheck the dirty Windows mirror without changing its unrelated files;
  use CI artifacts if it remains unavailable. Review old/new visuals and
  update Windows baselines ONCE only after causes and intended changes
  have been reconciled; then loop PR checks until green.
- Combined failure groups to investigate after merging: branch-only
  vehicle-hero-readings/route-layout regressions (~53 reported; attribution
  must be re-established rather than trusting the branch handoff), remaining
  inline feature conversions (18 reported), existing responsive/timezone
  failures, Security Scan, Windows visual diffs, and any new merge failures.
- Shared-pattern call sites marked `pending` in
  `docs/shared-patterns-state.md` remain a separate later adoption task.
- No Windows baselines have been regenerated in this session.

Last updated: 2026-10-25 by Copilot merge-then-fix session.
Latest repair commit: `54a115d1f0` (followed by this handoff documentation).
Both requested branches are merged in order. The removed shared/colors
worktrees are absent. The pre-existing detached
`/tmp/teslasync-palette-base` remains untouched. All five batch workers
are idle/released; no batch-owned preview/test process remains.

## Parts overview

| Part | Name | Status | Last commit / note | Next step |
|---|---|---|---|---|
| 1 | Time zone: follow setting everywhere, remove duplicates — TRACK A (`fix/post-merge-followups`) | in progress | `e71d532ee7` removes climate/vehicle captions; `54ade03061` restores startup to 399.5 KB; other semantic roots remain | Sleep/departure/orchestrator semantic repairs, duplicate instants, full 266-route TZ-5 sweep |
| 2 | Dashboard widget redesign (119 widgets) — one active branch | done | Widget redesign merged at `248c9d13d5`; Track B worktree removed; Phase 4 dashboard scope repaired and verified. Recovery commits `823c8802c8`, `16bf49ebd1`, and `7b3fabbe7a` pushed. | Dashboard suite green; collect remaining PR/TZ failures and continue the one-track fix list |
| 3 | Shared-pattern consolidation (whole codebase) | in progress | Shared modules merged via `b235484463`; remaining feature conversions adopted via `0f45d02e08` | Call sites marked `pending` in `docs/shared-patterns-state.md` remain a separate later task |
| 4 | Remaining: product items (A) + security re-check (B) | in progress (verify) | branch commits `e0196914cd..f84aad0ce7` cover A1-A7 + security; A8 owner-decision recorded | Audit plan-vs-branch after Part 3; B re-run audits |
| 5 | CI green on PR #202 | in progress | Not green; hero matrix 34/34 and strict startup perf pass after current repairs; full replica in progress | Finish bounded replica inventory, preserve repairs, then remaining timezone roots and once-only reviewed Windows baselines |
| 6 | Tailwind v3 -> v4 (`chore/tailwind-v4`, separate PR) | not started | 4 local commits, unpushed (pre-existing) | Only after Part 5 green |

## Part 1 steps (playbook items 1-8 + tests)

| Step | Status | Last commit | Next step / note |
|---|---|---|---|
| TZ-1 core resolver + range helper + unit tests | done | `cf1d4d79c7` | — |
| TZ-2 zone suffix / duplicate ISO removal (~36 sites + batch) | done | `cf1d4d79c7` | duplicates logged in `docs/followups-plan.md` |
| TZ-3a prose/duplicate migration + en.json sync + push | done | `0d90f894fc`, `9c3586d103` | — |
| TZ-3b direct-formatter migration (shared layer) | done | `d4653c5517` src + `86bb6e735d` tests + `330fb6052d` i18n | Full suite 2724/57248 green |
| Calendar values unshifted (LA + Kiritimati tests) | done | `d4653c5517` + `86bb6e735d` | `formatMonthYear` day-rollover validation; `dateFormat.test.ts` 82 green |
| `useConversionTimezone` + `resolveRawTimezone` (conversion boundaries) | done | `d4653c5517` + `86bb6e735d` | RateForm + JourneyAssurancePage converted; `timezone.test.ts` extended |
| TZ-4 API `timezone` sends + backend zone params + Go tests | done | `284851a318..147f180cf3` (7, pushed) | Vitest 2727/57276 + tsc + Go green at push; PR202 run in progress |
| TZ-5 guard (lint/audit) + ALL-routes (277) sweep | in progress | `e24583d253` timeline fix + Codex calibration 2026-10-22 | Guard done (R1-R5, 3725 green); sweep spec + 12-route calibration done; timeline zoned bucketing done; waitoracle panel calibration 2/2 pass (/charging + /tesla-charging-sessions @1280, tzIso/zones/dupes 0). Full 277-route sweep pending (timeboxed; run at TZ-7 gate or via CI smoke). |
| TZ-5c marker-free migration (user update) | done | `2fbe414e..edf280bfeb` (4 + docs + Analytics pin) | `tz-computation` 72->0 verified 0 in web/src, all other `tz-*` 0 (1 absence test kept); playbook no-suppression rule present |
| WaitOracle backend zone param + useCharging + panel (wip handoff fix) | done | `66eda8c6d5` wip + `a09dc6ec15` fix | Backend `?timezone=` (400/UTC default), store AT TIME ZONE $3, Predict(loc); hook sends effective tz; panel best_hour + no UTC; Go + 43 panel + 43 trips + tsc + split + trio + audit green |
| TZ-6 e2e spec (UTC browser, LA then Tokyo) | done | TZ-6 spec (this change) | `web/e2e/timezone-display.smoke.spec.ts` 4/4 green (chromium-smoke, mock build reuse); TZ=UTC browser, `tz_display_default=user` + `timezone_user` LA/Tokyo; drive times + Quick-view drawer, timeline daily bucket (Mar 8 LA / Mar 9 Tokyo) + Review-details range drawer (end-inclusive, no Mar 10) + Inspect drawer; no raw ISO / zone names; tsc + split-check green; audit unaffected (specs excluded by design); no markers added. |
| Freshness-header CORRECTION (owner override: `f6d6be4106` KEPT) | done | `b7c55d6ab2` revert-of-revert + `b3f0ba6272` docs + `658e6563fc` verify | `f6d6be4106` (one shared FreshnessDot per widget, top-right corner, header icons directly left) restored; only `c8aad38605` + `dc22ed9bfb` stay reverted. Header guard (`dashboard-widget-headers` + overflow + unit ownership) STAYS PASSING — never SKIPPED/DROPPED. i18n pins regen via sanctioned `--typed --checkpoint-catalog`; FreshnessDot back, 14 calls, shell/edit-chrome shas + dashboardTokens entry restored; combined 68/68. Vitest dash scope + tsc + split-check green; TZ-6 e2e 4/4. Followups-plan SKIPPED-task wording corrected this change. |
| TZ-7 i18n regen, full local replica, commit, push, PR green | not started | — | Section 3 replica, then push once |

## Part 2 summary mirror (updated after every task once started)

Phase 0 gate PASS. Phase 1 Gate 1 PASS (see below). Phase 2 pilots 9/9 done and GATE 2 PASS (pushed 462bde401e): wave1 288598cf28 climate, cde879bcbf onboarding, 357162dda0 recent-drives, ef09f6e589 battery-gauge, ac254eaf53 vehicle-hero; wave2 df582bf4b4 charge-status, 928a3ed11f security-status, e65b7f3136 quick-nav, 11d794a694 fleet-posture. After captures 18 PNGs (light+dark) in docs/widget-redesign/after/ (untracked), self-reviewed: exactly one FreshnessDot top-right per widget, no Live/2m-ago. Gate fixes: 012af5e74b typography tokens (audit 0), aab39c80be i18n keys (checklist.progressDone, widget.batteryGauge.*, widget.verifiedFields, dashboard.fleetPosture.*) + sanctioned re-pins (QuickNav/RecentDrives checkpointed), 7762911dcc hero footer + catalog fallbacks, 462bde401e preservation tests updated to After whole-percent precision. Gate checks: dashboard scope 222 files/4654 green, tsc 0, TZ audit 3726/0, typography 0, i18n 8110/8110, split OK. Deviations/data gaps logged in state.md + data-gaps.md (charge-status charger-type/added-kWh omitted, never fabricated). Phase 1 detail:
workflow; commits 7d81146653..7f68554fce + gap 1b9f1e9470 on
`feat/widget-redesign`). Review fixes: 8bc591fbec (status-grid `relative`
hook; RouteEfficiency bar test → After spec), 900d526fe5 (GMT-offset caption
removed from WidgetChartSummary; guard R6 restricts offset helpers to .ts
tick/timeline helpers; 2 new guard tests), dbf279d573 (i18n regen via
sanctioned generators incl. new key widget.comparison.previousLabel).
Review follow-up: rank numerals restored in `WidgetRankedList` after the
first full suite found 1 failure in `shared-library-completion` (caller-ranked
identity; route-efficiency After preview confirms numerals). Branch pushed,
tracking `origin/feat/widget-redesign` (never pull/push
`fix/post-merge-followups` from the worktree). Gate 1 checks: tsc 0, eslint 0,
TZ audit 0 (3726 files), guard tests 18/18, i18n 8110/8110, split-check OK,
dashboard scope 222 files green, first full suite 57382/57387 (1 ranked
failure, now fixed); final full-suite re-run pending. Carry-overs recorded in
state.md (TimelineItem density, FlowArrow.label adoption, dead barColor
props). Every Phase 2 pilot task row in state.md is annotated with the TZ
rule line; the same line goes into every worker prompt. Next: Phase 2 pilots
(9) via rolling workflow.

## Part 3 counts (once started)

Shared modules and branch state were merged in `b235484463`. Remaining
call-site adoption is tracked in `docs/shared-patterns-state.md`; rows
marked `pending` are explicitly deferred to a separate task. No aggregate
adoption percentage is claimed.

## Decisions log

- Startup-budget fix (Lighthouse red: startup 401.6KB > 400KB; main 398.6KB):
  TZ-3b..TZ-5c date-layer growth (+636 lines in `dateFormat.ts`, +88 in
  `timezone.ts`) landed in the shell's startup closure. Fix by moving
  route-only code out of the entry (real bytes, no suppression, no behavior
  change): new `web/src/lib/dateConvert.ts` (zone/wall conversions, ISO/GMT
  helpers, durations, chart labels, conversion-zone hook) + new
  `web/src/hooks/useDateLabels.ts` (month/weekday/relative-day labels bound
  to settings) split off `useDateFormat`; `timezone.ts` keeps display
  resolution only. Updated the TZ guard (`SHARED_DATE_MODULES`,
  `KNOWN_FORMATTERS`, exempt files, fix hints) and its 16 tests. Moved lib
  tests keep asserting identical behavior from the new paths; one widget
  test gained a parallel `useDateLabels` mock (same convention). Result:
  399.6KB, `perf:check` strict green. NO API CONTRACT change (internal SPA
  modules only); DATA STORAGE untouched. Duplication note: `dateConvert`
  carries local `browserTimezone`/`isTzMode` copies (5-line probe + predicate)
  to stay free of value imports from the widely-mocked `@/lib/timezone`,
  same documented pattern as the existing `dateFormat.browserTimeZone` copy.
- Display uses sanitized `resolveTimezone` (invalid -> browser -> UTC,

- Display uses sanitized `resolveTimezone` (invalid -> browser -> UTC,
  never throws); business-instant conversion uses new unsanitized
  `resolveRawTimezone` so invalid saved zones throw -> form validation
  error instead of silently converting in a guessed zone (RateForm;
  same class audit ongoing for journey/schedule forms).
- `formatDateRange`: half-open `[start, endExclusive)` minus 1ms via
  `formatRange`; non-midnight exclusive ends show the civil day of the
  last included instant (pinned by ThermalPanels fr-FR/Tokyo test).
- `useDateFormat().tz` is the single resolved display value (settings
  `tz_display_default` + override + vehicle, browser fallback).
- Freshness (CORRECTED 2026-10-22, owner override): `f6d6be4106` (one shared
  dot per widget, top-right corner, header icons directly left) is KEPT and
  the header guard stays passing — the 2026-10-21 "SKIPPED/frozen, revert
  everything" directive is void; only `c8aad38605` + `dc22ed9bfb` stay
  reverted. Uncommitted tree verified (2026-10-21) to contain zero
  freshness-dot diffs.
- 2026-10-21 docs-only push (playbook + this file) without the section-3
  replica: two markdown files cannot affect code checks; full replica
  runs at the Part 1 gate (TZ-7) as scheduled.
- TopParkingLocations zone-label assertion was stale (fails on HEAD
  too) and contradicts spec section 3: flipped to assert absence; the
  no-shift assertions (the test's actual subject) pass unchanged.
- Intermediate pushes (TZ-3b batch) go without the section-3 replica:
  full Vitest + tsc gate them, CI gives the early e2e/visual signal,
  and the full local replica runs once at the TZ-7 Part 1 gate.
- TZ-4: backend `?timezone=` validates IANA (400) and defaults UTC;
  omitted hook zones resolve to `useDateFormat().tz` (Auckland
  fail-before/pass-after tests). Rolling stats, caller-less legacy
  getters, the AI cost port (UTC), journey drive-vehicle frame, and
  automation schedule zones intentionally unchanged (see plan file).
- TZ-5 resume: pre-compaction triage dump was partly stale
  (MobileChartTooltip, ErrorBoundary, utils/date.ts don't exist in this
  tree; counts verified fresh: 83 Intl + 27 toLocale + 5 timeZoneName
  in non-test source). Trust files over handoff notes.
- Dev server `npm run dev -- --host` (PIDs 69812/45664, started 10/21
  12:55 PM, owner unclear) left running; revisit at the TZ-7 replica.
  Codex runtime node processes are the user's tooling, untouched.
- TZ-5 guard: `{/* */}` markers for JSX-children positions, `//` for JS
  and JSX-attribute positions (TS accepts `//` between attributes);
  attribute-position ISO hoisted to marked consts in 3 files.
- TZ-5 finding -> Part 3: `formatDateTime(period.start)` shifts date-only
  boundaries by zone (mileage label fixed via `formatDayKey`; generic
  StatPeriod renderer + producers need a shared boundary helper).
- TimestampTool keeps raw ISO rows (`tz-tool-subject`: the converter's
  subject is the format itself); daylog keeps GMT offsets
  (`tz-dst-offset`: fall-back disambiguation, same class as
  `formatChartInstant`); quiet-hours per-window zones stay
  (`tz-schedule-data`, same class as automation schedules).
  SUPERSEDED by TZ-5c: all `tz-*` markers removed via shared API
  (toIsoString/formatGmtOffset/supportedTimeZones); same behaviors kept.
- TZ-5c shared API: `browserTimeZone()` added to `dateFormat.ts`
  (mock-safe leaf; `timezone.ts` keeps its own for hook-adjacent code
  because 40+ tests mock that module); validity results cached in
  `safeTimeZone` (bucketing calls it per row); `zonedDateParts`
  normalizes h23 midnight 24->0 for all callers.
- TZ-5c parity calls: seasonal/hvac canonical-case readback dropped
  (unpinned; real inputs are canonical IANA ids); midnight hour-24
  rows now bucket at hour 0 instead of 24/null/crash (chargeAdvisor,
  drivingRhythm, hvacCycling latent crash, EnergyPage evening-bucket,
  QuietHoursSummary leg); invalid zone/NaN paths still throw RangeError
  where the old Intl code threw (daylog keeps its RangeError->ISO catch
  for bad locales too, pinned by test).
- TZ-5c guard: R2 stays syntactic (flags ALL toLocale*, dates and
  numbers) instead of a typechecker program — a full TS program in lint
  would cost minutes per run, and the shared number layer
  (@/lib/numberFormat) exists precisely so numbers never format
  directly either. R4 narrowed: skips `<time dateTime>`, TimeStamp/
  DateTime props, ISO nested in shared-formatter calls
  (import-aware + known names); still flags direct, chained
  (`.slice`), and non-shared (`String(...)`) ISO in JSX.
- TZ-5c certificate bug: `tz-number-format` markers sat INSIDE the
  print-document template string and leaked into certificates; removed
  with the fmtInt migration + regression test.
- Other markers verdict (user review): `relative-time:` (17),
  `flow-cta:` (10), `not-destructive` (4) belong to the FROZEN
  freshness audit — cannot touch (playbook global). `no-action:`
  (754) belongs to audit-empty-state-cta — each documents a product
  decision (no meaningful recovery action); removal needs 754 product
  re-reviews or deleting a workflow gate. All kept; both audits green.
- i18n: trio regen covers 7 touched producers + pre-existing stale
  SecretRotationOperationalBrief (stale since `eccca4cdc1`, fixed via
  the sanctioned generator, translations verified clean).
- Wip handoff fix (Codex 2026-10-22): `66eda8c6d5` added waitoracle `?timezone=` (400/UTC default), store AT TIME ZONE $3, Predict(loc), journey plumbing (UTC-preserving per TZ-4 intentionally-unchanged), useCharging effective-tz send; but renamed backend JSON `best_hour_utc`->`best_hour` without updating panel/test/en.json, breaking tsc + Lighthouse. Fixed by `a09dc6ec15`: panel/test use `best_hour`, dropped all UTC suffixes per Part 1 rule 3 (subtitle/bestHour/chart title/col), title fallback aligned to catalog sentence case, i18n via sanctioned generators (split + trio producer/combined + catalog pins).
- API CONTRACT `best_hour_utc`->`best_hour` (waitoracle forecast): all in-repo dependents fixed in same change (hook type, panel, panel test, en.json + split/trio/pins, Go forecast + handler + tests). Repo-wide grep: old name remains only in handler absence-assertion (contract test, intentional) + queue/progress history notes. No OpenAPI (`docs/public/openapi.yaml` has no waitoracle), no `docs/api-reference.md` entry, no generated clients, no e2e/mock harness refs, no scripts, ar/he have no `wait_oracle` keys. External readers: undocumented internal SPA API (only reader is `useCharging` in this repo); old UTC-suffixed name was factually wrong (hours are zone-framed) and violates Part 1 rule 5, so old field NOT kept (intentional breaking rename, pinned by absence test). DATA STORAGE: store uses `AT TIME ZONE $3` query-time only, no migration, stored values unchanged. NO SUPPRESSION: no new exception/marker/allowlist added.
- Pending user update verified done: `tz-computation` 0 in `web/src` (grep 0), all other `tz-*` 0 in src (1 absence-assertion test kept); playbook global no-suppression rule present (`docs/agent-playbook.md:126`).
- Queue reconciled 2026-10-22: TZ-5c commits `2fbe414e..edf280bfeb` done/pushed; `docs/widget-redesign/state.md` correctly absent (Part 2 not started; dir holds only inputs).
- AnalyticsPage `re-scopes and re-fetches` failure was PRE-EXISTING
  (reproduced on pristine base worktree `4fd5b3bd1c`) and zone-fragile:
  the test resolved `7d` in the local zone while the page re-resolves
  the scope preset in the UTC display zone, disagreeing by a day
  whenever local and UTC dates differ (red in PDT evenings, green in
  CI/UTC). Fixed by pinning both resolutions to UTC; 20/20 green in
  PDT, UTC, and Pacific/Kiritimati.

## Blockers

- PR202: run 39699895510 (TZ-4 push) responsive-14/-29/-34 + visual (1/64) red — triage at TZ-7 (likely intended display changes). Latest run 39715700018: only Lighthouse CI red, caused by wip `best_hour_utc` break (tsc); fixed by `a09dc6ec15`, pushing to verify. Visual/e2e diffs regen at TZ-7 after all display work. Not blocking TZ-5/6.
- :8080 serves the TeslaSync SPA (user's server via Docker; left running).
  Mock-preview proxy escapes would fail loudly (HTML vs JSON), not via
  ECONNREFUSED. Caveat recorded for the TZ-7 replica; revisit if escape
  anomalies appear.

## Exact next step

Use the newest resume/handoff section at the top, not the historical recovery
entries below. Current repairs: `e71d532ee7` (caption regressions),
`54ade03061` (startup 399.5 KB), `9c6fbb98ec` (hero unknown/zero/readings and
Details keyboard navigation, 34/34 E2E cases).

Remaining semantic timezone roots must NOT be fixed by hiding or simply
relabeling the UTC disclosures:
- `useEnergy.ts:useSleepEfficiency` currently sends date-only start/end
  without a timezone; SleepEfficiencyPage and its analysis clamp against
  inclusive UTC days. Reconcile request/query boundaries with the shared
  selected zone first, then fix RangeSourceCoverage/SleepMethodologyPanel
  copy and format calendar dates with the shared calendar formatter.
- `DepartureForecastPage` explicitly calls `useDateFormat('vehicle')`,
  overriding the user's selected display mode, and provenance prose still
  names UTC fallbacks. Model and display must share the selected effective
  zone; preserve truthful fallback provenance without raw zone labels.
- `home-energy/components/ScenarioControls.tsx` exposes peak hours as UTC.
  Reconcile actual tariff/simulation hour semantics before changing labels.
- `ChargeDepartureAlignmentPage` renders both source bounds (including
  identical first/last instants) and AlignmentPairs timestamps; inspect the
  guard's exact duplicate records. Keep evidence accessible once, through
  the existing details surface, rather than dropping accounting information.

Then rebuild mocks, finish TZ-5/6/7 and the full section 3 replica. Mirror was
confirmed clean but has NOT been synced or used; after pushing, compare
old/new Windows images and regenerate intended redesign/palette snapshots
ONCE per section 4. Do not regenerate in Linux. Continue PR #202 checks;
Parts 3-6 later adoption/migration work stays deferred as previously recorded.

## Recovery handoff (2026-10-23)

- Dashboard lint/typography/freshness repair commits: `47cec22796`,
  `d31e666484`, and `ab52bd2631` pushed. Worktree clean.
- Verified locally: dashboard 174 files / 3079 tests, focused chart tests
  111/111, freshness 71/71, TypeScript, chart-frame, chart-safety,
  chart-legend, typography, freshness, SI FE gate, and split i18n check.
- Production build passes with startup JS 399.6 KB.
- PR #202 fresh run `40060471218` failed first at generated split-i18n
  artifacts, then at dashboard source modernization tests and aggregates.
- The sanctioned split generator is now clean locally. Its two generated
  removals of obsolete Just-now keys remain to commit.
- Remaining blocker: 31 frozen i18n producer/checkpoint expectations now
  mismatch intentional source removals and shared absolute-time formatting.
  Re-pinned only through the repository trio generators/checkpoints; do not
  hand-edit hashes or catalog fingerprint counts.

- 2026-10-24 recovery: refreshed the 31 producer/checkpoint group through
  the sanctioned trio generators (no hash hand edits). Verified combined
  producers 96; known catalog calls 41,867; 29 source producer checkpoints
  refreshed; 7 frozen i18n suites pass 7,728/7,728; TypeScript and split
  catalog checks pass; dashboard code-guardian audit reports 200 files/0
  violations. Next: commit/push this batch, then collect and fix PR #202
  remaining failures by root cause.
  First PR unit batch: stale widget copy assertions and canonical
  RecentActivity duration fixtures updated; 125/125 focused tests pass.
