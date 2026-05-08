# Phase-48 — SI Canonical Mega-PR Methodology

> **Branch (in flight):** `refactor/signals-rewrite`
> **Predecessor commits:** `5b0598f4` (charging session_id backfill + power aggregates)
> **User mandate (verbatim):**
>   - "we need just the new one. and all must use the new one. no legacy"
>   - "one mega PR"
>   - "will go for all"
>
> **Discipline:** vertical slice per domain, commit per slice on the existing
> branch. Honest reporting of remaining work; no fabricated "all green" claims.

## What this phase deletes

The frontend `useSettings()` hook in `web/src/hooks/useSettings.ts` and the
`@deprecated` block in `web/src/lib/unitConversion.ts` expose legacy unit
converters (`convertDistance`, `convertSpeed`, `convertTemp`,
`convertEfficiency`, `convertPressure`, `fmtDistance`, `fmtSpeed`, ...,
`distanceUnit`, `speedUnit`, `tempUnit`, `efficiencyUnit`, `pressureUnit`,
`rangeType`). These wrappers assume the input value is already in the user's
display unit (mi/mph/°C/Wh-per-mi/bar). The new SI-floor surface in
`@/lib/unitConversion` (Phase-43 / Prompt 0013) and the `useUnits()` hook
assume the input is canonical SI (m/m·s⁻¹/°C/Wh-per-m/Pa).

Two known semantic bugs in the legacy hook (caught by audit):

1. `convertSpeed = (mph) => isMiles ? mph : milesToKm(mph)` — wrong helper
   (should be `mphToKmh`); produces 1.609× error on metric users' speed.
2. `convertEfficiency = (whPerMi) => isMiles ? whPerMi : kmToMiles(whPerMi)` —
   wrong direction (should be `whPerMi * milesToKm`); inverts metric users'
   Wh/km.

Mechanical replacement WITHOUT verifying each upstream API hook is SI-canonical
will silently produce 1609× errors — same failure pattern that caused recent
"600 mi range" / wrong odometer / wrong ideal range reports.

## Audit summary (locked into the SQL `legacy_converter_audit` table)

- 140 frontend caller files / 1,141 legacy converter call sites
- 16 domain buckets in priority order (drive-detail first because that is
  where user-reported bugs live)
- 104 Go struct fields with legacy unit suffixes across 32 files:
  - `_kwh` × 39 (energy)
  - `_km`  × 33 (distance — DEFERRED, see below)
  - `_min` × 20 (duration)
  - `_kw`  × 4
  - `_mi`  × 4
  - `_kmh` × 2 (DEFERRED)
  - `_wh_per_mi` × 2
- 1 OpenAPI spec at `docs/public/openapi.yaml`
- 6 grafana dashboards reading legacy field names

## Architecture decision: vertical slices, not horizontal layers

A horizontal-layer execution (rename ALL Go fields → rebuild → rename ALL TS
→ rebuild → migrate ALL FE consumers) leaves the codebase in a non-compiling
state for the entire middle of the work. A vertical slice (one domain at a
time, end-to-end across BE + TS + FE in a single commit) is safer because:

- Each commit is independently mergeable
- The branch never has a non-buildable HEAD
- Bugs caught mid-way affect one domain, not all of them
- The team can interrupt and ship a single slice if priorities change

Trade-off: total diff is larger because each slice repeats the BE→FE pattern.
Accepted given the user mandate.

## Rubber-duck-confirmed blocking risks

These were surfaced by the rubber-duck pass on the v1 plan. Mitigations are
baked into the slice-by-slice instructions below.

### R1. Write-path corruption (HIGH)

`DriveRepo.Complete(ctx, id, endTs, distanceMi, durationMin, endSocPct,
maxSpeedMph, avgPowerKw, insideTempAvgC, outsideTempAvgC)` accepts legacy
display units and converts to SI before the SQL UPDATE. If the helper
`completeArgsToSI()` is deleted before all 5 callers (`session_service.go:294,
340`, `telemetry_sessions_drive_tracking.go:1236`, `telemetry_sessions_recovery.go:430`,
plus `data_repair_handler.go` legacy patches) are migrated to pass SI
directly, the migrated callers will silently double-convert (mi → m → m/1609
= mi/1609, a 2.6 million times wrong distance).

**Mitigation:** in Slice 1, change the `Complete` / `CompleteWithTx`
signatures and update all 5 callers in the same commit. Go's compiler will
fail loudly on any missed caller (compile error, not runtime corruption).

### R2. `charge_rate_mph` misname (HIGH)

The `ChargeRateMilePerHour` proto field is metadata-typed
`UnitKindDistance` (meters), NOT `UnitKindSpeed`. Renaming the column to
`charge_rate_mps` would be semantically wrong because the SI canonical form
is meters of range added per second, not m/s. Verify the proto + units
metadata before naming.

**Mitigation:** Slice 2 has a precondition prompt that audits
`internal/tesla/units` + writes a unit test pinning the unit kind. Decide
canonical name (`charge_rate_m_per_s`? `range_added_m_per_s`?
`charge_rate_w`? — depends on what the value actually is) before renaming
the column.

### R3. Public API contract (MED)

`/api/v1/*` is a documented public contract. The OpenAPI spec at
`docs/public/openapi.yaml` is committed and served by
`internal/api/openapi_handler.go`. Renaming `distance_mi` → `distance_m` IS
a breaking change for any external consumer (e.g., user scripts, Grafana
panels, third-party integrations).

**Mitigation:** every slice updates the OpenAPI spec in the same commit as
the BE rename. The mega-PR description must include a CHANGELOG entry +
migration note for external consumers.

### R4. `camelCaseKeys()` dual-shape (MED)

The frontend `request<T>()` client in `web/src/api/client.ts` runs
`camelCaseKeys()` on every JSON response. This produces both `distance_mi`
AND `distanceMi` at runtime (the original snake_case key + the camelCase
duplicate). FE consumers can read either form. Pure tsc grep misses
bracket-string reads (`obj['distance_mi']`), `any`-typed variables, and
chart `dataKey={'distance_mi'}` props.

**Mitigation:** every FE migration grep MUST search BOTH snake and camel
forms. The Slice 6 final-gate audit script greps for any remaining
literals.

### R5. `useSettings` does more than units (LOW)

`useSettings.ts` also exposes:
- `costPerKwh`, `currencySymbol`
- `formatEnergyCost(kwh)`
- `formatCurrency(amount, d)`
- `costPerDistanceUnit(kwh, distanceMi)`
- `estimateGasCost(distanceMi)`

These are NOT legacy unit converters. They are user-preference-aware
formatting helpers that happen to live in the same file. The mega-PR must
move them to a new `useFormatting` hook (or keep them on `useSettings`
under a renamed export name) BEFORE deleting the legacy converter block.

**Mitigation:** Slice 5 has an explicit "extract non-unit helpers first"
step before the deletion.

## Slice-by-slice scope (commit one per slice)

### Slice 1 — Drive core

**Backend:**
- `internal/models/drive.go` — rename Drive struct fields:
  - `DistanceMi` → `DistanceM` (db `distance_m`, json `distance_m`)
  - `DurationMin` → `DurationS` (db `duration_s`, json `duration_s`)
  - `AvgSpeedMph` → `AvgSpeedMps`
  - `MaxSpeedMph` → `MaxSpeedMps`
  - `EnergyUsedKwh` → `EnergyUsedWh`
  - `RegenKwh` → `RegenEnergyWh`
  - `AvgPowerKw` → `AvgPowerW`
  - Update header comment from "ADR-005: distance/speed are stored in miles"
    to reflect SI canonical reality (Phase-42 migration 000185 already SI)
- `internal/database/drive_repo.go` — drop SI↔legacy conversion:
  - `scanDrive()` assigns SI values directly to renamed model fields
  - `Complete()` / `CompleteWithTx()` change signature to take SI
  - Delete `completeArgsToSI`, `mpsPtrToMphPtr`, `wPtrToKwPtr`,
    `whPtrToKwhPtr`, `metersPerMile`, `mpsPerMph`, `secsPerMin`
  - Delete `translatePartialFieldsToSI` (no translation needed)
  - `drivePartialAllowed` keeps SI-only column whitelist
- 5 producer files: `service/session_service.go`,
  `api/telemetry_sessions_drive_tracking.go`,
  `api/telemetry_sessions_recovery.go`, `api/data_repair_handler.go`
- 8 consumer files: `api/analytics_handler_queries.go`,
  `api/drive_handler_detail.go`, `api/export_handler.go`,
  `api/import_handler.go`, `api/share_handler.go`,
  `api/year_review_handler.go`, `export/processor.go`,
  `export/import.go`, `export/analytics.go`
- Tests: `models/models_test.go`, `database/drive_repo_test.go`,
  `api/drive_handler_test.go`, `api/telemetry_sessions_recovery_test.go`

**OpenAPI:** Drive schema (~7 fields)

**TS types:** `web/src/api/types.ts` Drive + DriveDetail + DriveTelemetry,
`web/src/types/driving.ts`

**TS hook:** `web/src/api/hooks/useDriving.ts`

**TS consumers:** drive-detail (11 files), driving-pages (9), driving-dynamics
(7), drivetrain-health (9), drive-related dashboard widgets, drive-related
shared components

**Verify:** `go build && go vet && go test ./internal/database/ ./internal/api/`,
`npx tsc --noEmit`, browser smoke-test drive list + drive detail

**Commit:** `refactor: rename Drive aggregate fields to SI canonical (distance_m, duration_s, …_mps, …_w, …_wh)`

### Slice 2 — Charging

**PRECONDITION:** verify `ChargeRateMilePerHour` semantics. Audit
`internal/tesla/units` + run a unit test. Rename only after verifying.

**Backend:** `internal/models/charging.go`, `internal/database/charging_repo.go`,
`internal/api/charging_handler.go`, telemetry sessions for charging,
signal field mappings

**Tests + OpenAPI + TS types + 8 charging FE files**

**Commit:** `refactor: rename Charging aggregates and telemetry fields to SI canonical`

### Slice 3 — Range / Battery / Energy / Mileage

**Backend handlers:** `range_projection_handler_dtos.go`, `battery_*_handler.go`,
`energy_service.go`, `mileage_handler.go`

**Tests + TS types + 5 battery + 5 vehicle + 17 analytics + 48 dashboard-widgets FE files**

**Commit:** `refactor: rename Range/Battery/Energy/Mileage DTOs to SI canonical`

### Slice 4 — Trips / Sharing / Export / Import

**Backend:** trip planner, trips detail, share handler, export processor

**Tests + TS types + 5 trips + 1 sharing FE files + export CSV schemas**

**Commit:** `refactor: rename Trip/Share/Export DTOs to SI canonical`

### Slice 5 — Delete legacy frontend helpers

- Move currency/cost helpers from `useSettings.ts` to new `useFormatting` hook
- Delete `convert*/fmt*/*Unit/rangeType` block from `useSettings.ts`
- Delete `@deprecated` block from `web/src/lib/unitConversion.ts`
- `npx tsc --noEmit` clean
- **Commit:** `refactor: delete legacy unit converters from useSettings + unitConversion`

### Slice 6 — Final gates + docs

- Update `docs/public/openapi.yaml` (any remaining drift)
- Update `README.md` + VitePress + `CHANGELOG.md`
- Grep for any remaining legacy field names; document in CHANGELOG
- All audits + tests
- **Commit:** `docs: update OpenAPI spec + CHANGELOG for SI canonical fields`

## Deferred (separate later phase)

- `_km`/`_kmh` rename (33 fields) — some DB columns ARE actually `_km`
  (e.g. `daily_mileage.distance_km`); needs a separate DB migration
  coordinated with the rename so the column + the model + the FE all
  flip in lockstep. Not in scope for Phase-48.
- `internal/database/signal_history_writer_flush.go:144` legacy column-name
  writer (Phase-42 follow-up)
- `internal/api/telemetry_sessions_recovery.go::completeRecoveredDrive` latent
  C6/C7 SI bugs from Phase-41 v3.4 (separate fix)

## Execution log location

Each slice commit message references this methodology document. The
session-state plan at
`~/.copilot/session-state/<id>/plan.md` carries detailed in-flight notes
(audit table, remaining files, etc.) and is durable across sessions.

---

## Pre-execution decisions (locked, "you decide" defaults)

These were left open at methodology authoring time. The user delegated
the call. Defaults below are the canonical answer for all subsequent
slices — do not re-litigate without an explicit user override.

1. **Public CSV export column rename.** Rename `distance` → `distance_m`,
   `duration_min` → `duration_s`, `avg_speed_mph` → `avg_speed_mps`,
   `max_speed_mph` → `max_speed_mps`, `energy_used_kwh` → `energy_used_wh`,
   `regen_kwh` → `regen_energy_wh`, `avg_power_kw` → `avg_power_w` in
   `internal/export/processor.go`. Bump the export filename suffix to
   `-v2.csv` (e.g. `drives-v2.csv`, `charging-v2.csv`) so external scripts
   that hard-code the old filename keep getting the old shape via the
   legacy endpoint until it is removed in Slice 6. If no legacy endpoint
   exists, document the breaking change in the Slice 4 commit body.

2. **`ChargeRateMilePerHour` semantics.** Audit
   `internal/tesla/units` + `api/proto/tesla/*` to confirm the proto
   `UnitKindDistance` annotation. If confirmed it is meters (distance
   added per second of charging), rename to `range_added_m_per_s` in
   Slice 2 and add a regression test in `internal/tesla/units` pinning
   the unit-kind to prevent silent re-introduction of the speed
   misnomer. If the annotation actually means a power/charge-rate value,
   rename to `charge_rate_w` and document the discovery in the Slice 2
   commit body.

3. **`/share/{token}` public API.** Slice 1 fixes the latent bug —
   `share_handler.go` will read SI from the renamed Drive struct and
   convert to true kilometres for the existing `distance_km` /
   `duration_min` / `max_speed_kmh` field names. Numbers in newly issued
   share links will jump by a factor of ~1.609× compared to old links,
   which is the correct behaviour (old links were silently miles). Slice
   4 then renames the JSON keys to `distance_m` / `duration_s` /
   `max_speed_mps` and bumps the share-payload `version` field. Old
   tokens remain redeemable; the SPA share-view page must read both
   shapes for one release before the legacy keys are removed.
