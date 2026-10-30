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
- Final verification pending: full lint/audits, consolidated hermetic browsers,
  route matrix and reviewed committed before/after screenshots, per-part
  commits/push and current-head draft PR checks. No success is claimed yet.
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
  Browser validation of the final combined source remains pending.
  The current graph has 173 successes, 26 failures, one queued and one
  conditional skip; this is not green. Reviewed Windows dashboard pixels show
  the intended flattened Quick navigation links versus the old nested borders.
  Baseline regeneration remains blocked because the designated Windows mirror
  has unrelated uncommitted work; never clean it or generate Windows baselines
  on Linux.
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
