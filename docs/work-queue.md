# Work queue — branch `fix/post-202-polish` (this branch's draft PR)

Master status file per `docs/agent-playbook.md` section 1. Status values:
`not started | in progress | done | blocked (reason)`.

## Bug 3: Drive evidence, presentation and app-wide card layout

- Status: in progress; branch `fix/post-202-polish`, draft PR #223.
- Part A roots confirmed before changes: `SignalLogReader.RegenEnergy` treats
  the fraction of negative-current change events as a fraction of elapsed time.
  Fleet Telemetry is a sparse change feed, so this overweights frequently
  changing regen samples. `DriveAggregates` separately averages voltage and
  current instead of pairing their time-aligned observations; the power chart
  also averages emitted rows without duration weights. Completion applies
  `Abs` to mean power, masking rather than resolving sign inconsistencies.
  Ingest preserves current sign; no normalizer sign inversion was found.
  Fixes must retain positive draw/negative regen and integrate elapsed time,
  not clamp recovery or force every drive's net power positive.
- Additional Part A root found during integration: `StateReader.Timeline`
  correctly seeds prevailing values but emits only change-event timestamps.
  The drive API omits the leading boundary state; a long initial draw interval
  can therefore disappear from the frontend mean even after duration weighting.
  Both telemetry endpoints need a derived start-boundary row from the canonical
  state reader, without inventing unknown values or duplicating a real start row.
- Climate roots confirmed: the drive telemetry projection never includes
  canonical boolean `HvacPower` or `is_climate_on`, although the frontend expects
  the latter. The codec also stores fan status as text, while the frontend
  requires numeric fan readings; the projection now explicitly parses finite
  nonnegative speeds, preserving null and measured zero.
  A fan observation above zero can establish activity when the explicit
  HVAC state is unavailable; a temperature request alone cannot.
- Independent-field audit so far: codec/normalizer preserve field identity;
  range mappings use `IdealBatteryRange` and `RatedRange` separately; tire
  mappings use all four distinct `TpmsPressure*` signals; the shared timeline
  fold copies per-signal values, not one pointer into every output. Equal
  production readings alone do not prove copying. Add distinct-value and
  missing-field regressions rather than fabricate different readings.
  BUG 1 is a separate boundary-coordinate/geocoding repair problem.
- Part B: implemented and committed as `5ccba95dbb`. Shared precision,
  explicit average/start-end labels, fractional fan, unit-aware elevation,
  collapsed ranges, distinguishable coincident series, fitted pressure axes,
  neutral links and aligned tables/icons pass 405 affected unit tests.
  Two actual light/390 metric and dark/1280 imperial browser regressions pass
  with zero proxy escapes. All 74 shell/header references remain present;
  final combined-source browser/layout acceptance remains Part C's gate.
- Part C roots confirmed: grid stretch stops at animation wrappers, leaving
  enclosed cards short; chart-card title and embedded chart toolbar have
  separate owners, placing download actions below the title. Shared layout
  and card anatomy fixes plus precise route-guard regressions are in progress.
- Part C design refinement requested by the user: use one reusable, responsive
  card-layout mechanism with explicit header/summary/body/footer slots and
  declarative call sites. Do not scatter long DOM-depth-dependent Tailwind
  selector chains through `CardGrid`, chart cards, or page components.
  The first named-slot implementation passes 177 focused tests, actual
  TypeScript, full frontend lint and the hermetic build, but is NOT accepted:
  scrolled browser captures expose 198px/125px power/elevation cards whose
  canvases overlap following content. All four v1 matrix processes were stopped.
  Partial diagnostics also flag empty centering, gaps and offsets; they are not
  final coverage. Fix shared intrinsic chart/slot allocation and add an actual
  browser chart-fit regression before another consolidated acceptance run.
  The retained worker's v4 production source is now frozen. Root corrections
  remove containment at borrowed subgrid boundaries, distinguish transparent
  relays from true row owners, propagate natural stretch through Card and
  GlassPanel, allocate fluid plots alongside their headings and unify chart
  actions under one header. Shared EvidencePanel columns and local empty-state
  allocation participate without dropping sections or changing hook URLs.
  Actual bounded receipts show 284 unit tests, six chart-fit/fullscreen cases
  and 22 sampled routes passing; all eleven screenshot pairs were inspected.
  The old chart-overflow images remain rejected evidence, not current captures.
  The broader sample still had 14 unmatched synthetic requests; the worker is
  correcting exact typed fixtures and running a 277-route 1280/dark preflight
  before the final eight-variant matrix. No complete-matrix pass is claimed.
- Part C continuation: v7's shared table placement assigns
  actions to the card header and search/provenance to its summary track, with
  ordinary inline fallback outside participating cards. The debugger adopts
  this shared API without page-specific sizing; rebuilt browsers confirm its
  real 132px offset is zero at all eight required variants. All 303 affected
  worker-run tests pass with unchanged geometry thresholds and no route
  exemptions. Its page retains 12 surfaces and 1118 -> 1120 lines; including
  direct components, 23 surfaces and 2645 -> 2647 lines. The parent expanded
  exact typed fixtures, including downstream reads exposed by populated
  responses. Unknown endpoints still fail.
  The earlier fixture-only diagnostic recorded 277 route names but had 25
  unmatched signatures and 16 readiness/navigation errors; closed-page records
  are not successful rendering coverage. Those 25 signatures now have explicit
  responses; the real guard's bounded chunks must verify them on the new build.
  Per-route guard receipts now also reject console/ErrorBoundary, uncaught
  runtime, resource and failed-data errors.
  The v7 consolidated mock build passes (50.55 seconds), as do actual
  app/guard TypeScript, full frontend lint and scoped fixture/guard lint;
  that build is now stale because actual browser findings require more fixes.
  The coherent RUL nominal-distance fixture passes all four affected browser
  cases with zero proxy escapes.
  The real bounded preflight produced 275 unique records: 256 passed and 19
  had actual findings. A widget-only 366-day assertion threw on the legitimate
  90-day mileage request, losing `/mileage` and `/signal-deadband`; it was not
  an established memory failure. Six chart-fit/fullscreen cases pass, but all
  eight debugger variants fail existing timestamp checks, not geometry.
  The remaining geometry/sizing roots were fixed in the v8 continuation below.
  Parent fixture corrections use actual certificate envelopes, maintenance
  schedules, independent unavailable charge-ledger/telemetry contracts and an
  exact guard-owned mileage resolver; the original widget assertion remains.
  Public share `date` is a calendar value per `share/handler.go`, not the ISO
  instant mistakenly supplied by the new fixture; no production share change
  is warranted. Five real display regressions fail before fixes and pass after:
  frozen clock formatting, redundant comfort/site timezone suffixes, hazard
  timestamp precision and second-precision physics boundaries. Existing source
  instants, selected-zone reactivity, zero and missing-value behavior remain.
  All six affected parent suites pass 330 tests (214 fixture contracts);
  strict fixture TypeScript and scoped ESLint pass.
  V8 source is frozen and rebuilt (58.37 seconds). Shared FormSection surface
  ownership, preserved bounded API-browser scrolling, SchemaCatalogCard slots,
  HVAC header/summary delegation, container-responsive MetricGrid adoption and
  FlowGrid orientation resolve the inventoried allocation/narrow roots.
  All 277 unique real preflight records now pass, with no missing/duplicate
  routes, layout/runtime/unmatched/escape findings or wrapper failures.
  The actual debugger passes all 12 existing width/theme variants, and six
  real chart-fit/fullscreen/restore cases pass: 18 tests, zero proxy escapes.
  Worker suites pass 649 consumer tests and 92 adapter tests (overlapping
  groups); parent suites pass 361 tests. Three changed frozen producers have
  all 231 translation calls verified before sanctioned receipt generation;
  all 7,728 frozen contracts then pass. No translation keys or tests were
  weakened. Full frontend lint, actual app TypeScript and strict guard/fixture
  TypeScript pass. Whole-source audit still reports 35 pre-existing findings
  in 21 files unchanged since before BUG 3; no new finding belongs to this work.
  The earlier eleven-file count came from truncated audit stdout; complete
  untruncated grep and byte comparisons establish 21, without changing the
  35-finding total.
  Eleven AFTER images were refreshed from the frozen build; all eleven
  capture cases pass with zero escapes. All eleven pairs were visually
  inspected with no new shared-layout regression observed. All eleven BEFORE
  hashes and 34 frozen source hashes remain unchanged; ten measured feature
  scopes preserve their sections/surfaces and exceed the 70% line minimum.
  The first required-matrix batch exposes additional width-specific roots:
  three shards pass 32 cases each; the fourth passes 26 and fails six.
  Ingest X-ray has a 40px mobile plot spill and raw mobile timestamps;
  vehicle detail has 25px/17px sibling body offsets at 1920px. These are
  real findings, not tolerated exceptions. The fifth shard was stopped;
  no complete-matrix pass is claimed. The retained shared-layout worker
  owns the bounded v9 fixes. The four dark-theme diagnostic shards now
  contain all 831 expected unique 390/768/1920px records: 814 passing,
  17 violating across 14 routes, no missing/duplicate/unexpected records,
  runtime errors, unmatched mocks or proxy escapes. The remaining roots
  are shared chart containment/header/body anatomy and six 195px passport
  metric cells; thresholds are unchanged. The exact 17 failed browser
  cases have a separate discovered red/green selector.
  Additional populated-dashboard BEFORE evidence passes with eight
  canonical owner widgets, existing catalogue sources and the real
  auto-arrange control at 1280x1600. Console/page/API diagnostics and an
  explicit unmocked-outbound fallback are clean; its AFTER image awaits
  v9. The original eleven BEFORE files and frozen route fixtures remain
  unchanged. Owned preview processes and temporary capture specs stopped.
  V9 bounded checkpoint passes 404 tests in 17 suites, app TypeScript
  and scoped ESLint. Seven measured feature scopes preserve their
  sections/tables and at least 70% of original lines. Its frozen build
  completes in 49.88 seconds. The exact browser replay now passes nine
  cases and fails eight (71 unique route records, 63 passing), proxy
  escapes zero. Vehicles, ingest, score, drive detail, advisor and all
  three parking variants are genuinely clean. Two motor chart surfaces
  still spill 20px; the other formerly failing dynamics plots are clean.
  The retained worker owns a bounded v10 continuation for these motor
  surfaces and the seven remaining route variants, not a threshold change.
  V10 resolves all seventeen original failing browser cases: all 71 unique
  target/neighbor records pass, with zero escapes. The deduplicated affected
  run passes 43 suites / 1,317 tests; verified producer generation restores
  all 7,728 frozen contracts. Visual review nevertheless rejects a detached
  shared legend: actual glyphs sit 155px from their markers despite clean
  containment. A new real-browser regression fails on V10; the shared fix
  retains its responsive grid but centers intrinsic marker/label groups.
  V11 gives 12px gaps for both elevation series at 390/1280 in both themes;
  all six chart-fit/fullscreen cases and 59 focused chart tests pass.
  Full lint, actual app TypeScript and targeted guard/fixture/chart TypeScript
  pass. The broad existing E2E project still has legacy library/declaration
  configuration and unmodified caller errors; it is not claimed clean.
  The corrected mock build completes in 48.11 seconds. Its 123 changed
  source/fixture files, built index and twelve BEFORE images are hashed;
  all 2,216 required variants now run under a fresh V11 receipt prefix.
  All twelve AFTER captures pass; all 24 PNGs were reviewed with no new
  shared-layout regression, within their documented synthetic/crop limits.
  Final V11 inventory verification passes all 2,216 unique expected records:
  every one of 277 routes at four required widths in both themes. Missing,
  unexpected, duplicate and finding arrays are empty; all sixteen bounded
  wrappers pass 512 browser cases with zero proxy escapes. Source and
  protected-image hashes remain unchanged; owned preview processes and
  temporary capture specs are stopped/removed.
  Next: commit exact verified paths, push and validate the new head's PR
  checks, including the native mirror baseline gate. Current-source CI
  success is not claimed.
- Part A implementation: paired state-reader timelines feed signed elapsed-time
  power integration. Both normal completion and restart recovery preserve the
  mean's sign and real zero, never substitute peak power, and write SI watts
  exactly once. Frontend fallback estimates use actual bounded instants, stop
  at unknown samples, and do not extrapolate uncovered intervals.
  Both drive telemetry endpoints now share a start-boundary projection from
  canonical state, preserving the leading held interval without duplicating
  an exact-start event, fabricating unknown observations, or losing zero/false.
- Repair boundary: extended the existing dry-run-first operator command only;
  never execute against production. Reconstruct only from retained original
  signals; absent/corrupted original telemetry cannot be recovered by guessing.
  Energy repair deliberately targets one completed drive at a time:
  `go run ./cmd/drive-address-repair -energy -drive-id 555 -dry-run`.
  Review against an isolated copy before `-dry-run=false`. Missing/incomplete
  paired history is logged as unrepairable; original energy counters and raw
  range/tire observations remain unchanged. Unit tests execute dry run first,
  apply once, then prove a second apply writes nothing. No repair was run
  against production. The available local read-only `/drives/555` returns 404;
  original production range/tire observations were not available to establish
  whether their equal values were already equal at the vehicle.
- Part A actual red receipt: sparse 60-second SQL fixture returned -2.788 kW
  and 0.0738 kWh recovered before the fix, versus time-aligned +13.404 kW
  and 0.0126 kWh. All missing-climate cases failed before projection changes.
  Corrected isolated PostgreSQL race regression passes; affected signal,
  drives, telemetry and repair race suites and `go build ./...` pass.
  Four frontend interval regressions pass; actual `npx tsc --noEmit`,
  scoped ESLint, all six audit counts (zero), and driving hook-route checks pass.
  Follow-up red receipt: both HTTP endpoints omitted a 52-second initial draw
  interval and returned only the final regen row. The endpoint regression,
  five boundary/null/zero/error cases, affected race suites and full Go build
  now pass. CI explicitly runs the sparse-power PostgreSQL regression against
  its isolated test service; workflow actionlint passes.
- Local final verification passes: full lint, app/affected harness TypeScript,
  affected units, frozen contracts, all 2,216 route variants and all twelve
  reviewed before/after pairs. The full audit retains 35 verified legacy
  findings, not a whole-tree zero. C commit/push and current-head draft PR
  checks remain; no CI success is claimed yet.
- Full `web/src` violations skill scan: static styles 0, raw controls 33,
  direct imports 2, old API imports 0, double prefix 0, camelCase parameters 0,
  TypeScript pass. All 35 findings' files are unchanged since the pre-BUG3
  `adc001fea8` baseline, verified separately; do not claim a whole-tree zero or
  expand this repair into unrelated controls. Full existing npm lint passes.
- Early current-head CI findings: Trivy flags transitive `go-jose/v4` 4.1.4
  (CVE-2026-116587; patched in 4.1.6). Its cloud-storage/backup consumer and
  full Go build pass with the targeted patch. The SI gate incorrectly rejects
  the newly vendored immutable `LifetimeDcChargeEnergyKwh` Tesla field; its
  hand-maintained whole-line exception list was stale and could also hide
  unrelated bad identifiers on the same line. The replacement recognizes exact
  authoritative proto field tokens while retaining strict application-field,
  JSON/storage-tag, unknown-name and same-line checks. Four focused regressions
  reproduce both failure classes before the fix and pass afterward; the actual
  branch diff has zero legacy application identifiers/deprecated callers.
  Both changed workflows pass actionlint. At `fbec5e010b`, Security Scan and
  both SI checks pass; no security check has been bypassed.
  Frontend unit shards reveal stale
  frozen i18n receipts (21 additional leaves and changed producer bytes)
  and consumer tests still querying the old column-menu role after the shared
  column control became a focus-managed dialog. Preserve the old catalog
  predecessor assertions and all interaction coverage while refreshing verified
  receipts with sanctioned generators and updating consumers to the dialog API.
  The physical catalog comparison against accepted `b4099b42e4` is reviewed:
  21 additions, no removals, and two intentional energy-method copy corrections.
  Typed verification passes for all six changed frozen producers and both
  shared controls. The sanctioned generators retain exact static assertions;
  all seven affected frozen test files plus drive/toolbar consumers pass
  7,791 tests. Global catalog verification reports 41,924 calls and 237 unresolved
  runtime expressions, not universal dynamic-key verification.
  Two actual missing keys in the shared More/Done controls now use the existing
  translated global keys instead of relying on English defaults. The separate
  SafetySettingsPage casing mismatch predates these fixes and is not checkpointed.
  Column-dialog, focus-restoration and keyboard compact-export coverage passes
  97 tests. Real CI also exposes a shared toolbar layout root: putting the
  full export-scope description inside the action flex row displaces headings
  and actions by 13–46 px. Move that description to its own shared toolbar row;
  retain compact More dialogs and update responsive consumers to actually open
  them, preserving every export, selection, column and geometry assertion.
  Final combined-source browser validation now passes 101 affected cases:
  32 drive/API-log, 59 FSD/shared-table and ten operational cases, all with
  zero proxy escapes. Compact consumers open the actual More dialog and
  dismiss search history before clicking underlying column filters; export
  selection/delete actions remain in their separate bulk bar.
  An earlier graph had 173 successes, 26 failures, one queued and one
  conditional skip; this is not green. Reviewed Windows dashboard pixels show
  the intended flattened Quick navigation links versus the old nested borders.
  Baseline regeneration remains blocked because the designated Windows mirror
  has unrelated uncommitted work; never clean it or generate Windows baselines
  on Linux.
  Verified translation/column-dialog repairs are pushed as `fc30372cad`.
  That head exposed a coupled generated-artifact omission: replacing the
  missing Done reference also requires regenerating the locale usage manifest.
  The generator now removes both nonexistent common.done/common.more references
  after the shared controls switch to real existing keys. Exact split-catalog
  verification passes (57 bundles, 182 fallbacks, 1,264 shell keys, no new
  known-missing keys). Actual combined-source TypeScript and full npm lint pass.
  Realistic min/max viewport query mocks retain mobile More-dialog export and
  density coverage rather than pretending every media query matches.
  All ten old-head Windows before/actual pairs from nine failing shards were
  inspected: flattened dashboard links, retained notification kind metadata
  and export-scope toolbar reflow are visible. These are diagnostic, not final
  C-source captures or permission to replace baselines from CI artifacts.
  At pushed `f52df66e9f`, all eight frontend unit shards, generated artifacts,
  frontend build, all backend race/database/build checks and Security Scan pass.
  The completed graph is 180 successes, 20 failures and one conditional skip:
  the remaining roots are nine responsive browser shards and nine Windows
  snapshot shards, plus their aggregate gates. Actual final v4 TypeScript,
  full npm lint and scoped browser-consumer ESLint pass. Seven frozen i18n
  contracts pass 7,728 tests. The full route-layout matrix is still pending
  exact mock-fixture closure and preflight; none of these bounded checks
  substitutes for that acceptance gate or current-head CI.
  Pushed `13d4e6dbc0` now has 192 successes, eight failures and one conditional
  skip: every responsive shard passes; seven Windows snapshot shards and their
  aggregate fail. This does not validate uncommitted v6 source. The mirror's
  full native status includes unrelated untracked `Claude outputs/`; tracked-only
  cleanliness is insufficient, so it remains untouched and baseline regeneration
  remains blocked under playbook section 4.
- Initial card guard runs exposed real layout findings and were stopped before
  acceptance when the user requested the shared-slot architecture refinement.
  Partial old-build logs are diagnostic only, never passing matrix evidence.
- Next step: finish the reusable shared card-slot mechanism, rebuild once,
  complete the 2,216-route-variant guard and targeted drive/browser checks,
  review after screenshots, commit C/verified CI repairs and push, then fix actual current-head
  CI failures until green.

## Bug 1: Drive detail shows same address for Start and Destination (non-round-trip)

- Status: done
- Example: production `/drives/555` — map route Canyon Park, Bothell → Redmond, but both Start and Destination show "19720 Bothell Everett Highway, Bothell". Positions correct; destination address wrong.
- Root cause (found): stored `end_place` resolved from the wrong fix at completion time, then stranded. Completion's boundary-snapshot fallback can persist the same fix into both endpoint pairs (documented in `internal/database/signal/reader_aggregations.go` `DriveEndpointCoordinates`), so the end label was geocoded from the start coordinates and written to `end_place`. Later corrections fix the stored/response coordinates (GPS track / `repairDriveEndpoints` in `internal/api/drives/detail.go`) but never re-resolve `end_place`. No live finder selects the stranded rows: `FindMissingAddresses` only selects empty labels, `FindStalePlaceLabels` only selects `place_label_version < 3` (affected rows carry the current version), and `RepairStalePlaceLabels` marks a drive current when only one endpoint resolves, stranding a failed end lookup. Checked and cleared: places cache is keyed by coordinates within 50 m (`internal/database/admin/places_cache_repo.go` `FindNearby`), providers geocode the coordinates they are handed (`internal/geocoding/`), and the frontend reads `startAddress`/`endAddress` independently (`JourneyDetailsPanel.tsx`, `web/src/types/driving.ts`) — the API returns the duplicated stored label. The drive detail response also had no guard against returning an end label identical to the start label while the endpoints are far apart.
- Next step: investigate Go drive end/address pipeline, reverse-geocoding/address cache, drive API response, and frontend drive detail fields.
- Fix: start/end addresses from own coordinates; suspect duplicate end label (equal labels, endpoints >0.5 km apart) is suppressed at read/API time so failed/pending end lookup shows unavailable/pending (and coordinates if existing pattern), never start address; partial repair no longer marks drives current.
- Tests: Go (different coords → different addresses; failed/pending end ≠ start; round trip same; cache key) + frontend (independent start/end rendering incl. unavailable).
- Data repair: done. `driveaddressrepair.Repairer.Repair` (`internal/driveaddressrepair/repair.go`, also invoked via `TelemetrySessionTracker.RepairDuplicateEndAddresses` at startup) finds drives via `DriveRepo.FindDuplicateEndAddresses` (end label == start label, endpoints >0.5 km apart), re-resolves only the end address from the end coordinates (places cache bypassed, `geocodeRateLimit` pacing, every change logged), is idempotent, and never touches genuine round trips. It also runs at startup from `BackfillAddresses`. Operator command: `go run ./cmd/drive-address-repair -dry-run` (default; lists affected drives and proposed end addresses, writes nothing), then `go run ./cmd/drive-address-repair -dry-run=false` to apply. Not run against production.
- Repair runbook: build/run the command with the service's config/database environment, run `-dry-run` first and review the logged `old_end`/`proposed_end` rows, then apply with `-dry-run=false`, then re-run `-dry-run` to confirm no affected drives remain.
- API contract change: none. No field renamed/removed/retyped; a suspect duplicate `end_address` is now returned as null (unavailable) instead of the start address, and the frontend already renders coordinates/unavailable for a null end address.

## Verification

- Status: done
- Done locally: `go build ./...`; `go test` for models/drive, database/drive, database/admin, api/drives, api/telemetry, geocoding; `go vet` + `gofmt` on touched packages; web `tsc --noEmit`; full web `npm run lint`; frontend tests (JourneyDetailsPanel 27/27, drive-detail + DriveDetailPage + driving types 555/555). DB-gated Go repair tests skip without a test DSN and run where one is configured.
- PR checks (head `cdf3cfb709`): Backend lint, Backend architecture, Backend race tests, Backend database, Go builds and Frontend lint pass. `Security Scan` fails on a pre-existing `github.com/go-jose/go-jose/v4` CVE-2026-116587 (HIGH, fixed in 4.1.6) in dependencies untouched by this branch — not addressed here. Remaining browser/visual shards were still pending at last check.
- Next step: none for Bug 1. Review remaining PR #223 browser shards when they finish; do not run the repair against production (dry run first, see above).
