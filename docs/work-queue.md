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
- Part B: in progress, shared precision/range/chart/table presentation fixes.
- Part C roots confirmed: grid stretch stops at animation wrappers, leaving
  enclosed cards short; chart-card title and embedded chart toolbar have
  separate owners, placing download actions below the title. Shared layout
  and card anatomy fixes plus precise route-guard regressions are in progress.
- Part A implementation: paired state-reader timelines feed signed elapsed-time
  power integration. Both normal completion and restart recovery preserve the
  mean's sign and real zero, never substitute peak power, and write SI watts
  exactly once. Frontend fallback estimates use actual bounded instants, stop
  at unknown samples, and do not extrapolate uncovered intervals.
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
- Final verification pending: full lint/audits, consolidated hermetic browsers,
  route matrix and reviewed committed before/after screenshots, per-part
  commits/push and current-head draft PR checks. No success is claimed yet.
- Next step: persist Part A, complete the 2,216-route-variant card guard and
  targeted drive/browser checks, review after screenshots, commit B/C and push,
  then fix actual current-head CI failures until green.

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
