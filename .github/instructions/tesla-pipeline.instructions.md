---
applyTo: "internal/tesla/**,internal/enums/**,internal/mqtt/**,internal/signal/**,api/proto/tesla/**,cmd/protogen-tesla/**,cmd/unit-drift-validator/**,cmd/resubscribe/**"
---

# Tesla Fleet Telemetry Pipeline — Engineering Rules

Source of truth: ADR-004 in `.github/ARCHITECTURE.md`. Read it before making any change in scope.

## ⛔ PROHIBITED PATTERNS

```
❌ 1. HARDCODED WIRE-FORMAT UNITS
   Tesla's wire format for unit-bearing fields is DYNAMIC per vehicle dashboard
   preference. Looking up the active unit at the emission timestamp is REQUIRED.

   BAD:  speed_mps := mph * 0.44704
   BAD:  ToSI("VehicleSpeed", raw)             // 2-arg signature is forbidden
   GOOD: activeUnit, _ := unitHistory.At(ctx, vehicleID, "distance", emittedAt)
         siValue, err := units.ToSI("VehicleSpeed", raw, activeUnit)

❌ 2. HAND-WRITTEN SIGNAL METADATA
   All signal metadata, enum parsers, and datum decoders in
   internal/tesla/protomodel/ are GENERATED. Do not edit *_gen.go files.

   BAD:  edit internal/tesla/protomodel/signal_metadata_gen.go directly
   GOOD: edit api/proto/tesla/vehicle_data.proto + run `go generate ./internal/tesla/protomodel/...`

❌ 3. PARALLEL TRANSFORM PIPELINES
   There is exactly ONE pipeline: bytes → Datum → flatten → ToSI → atomic → router → write.
   Adding a "shortcut" path that skips routing or unit conversion is forbidden.

   BAD:  func directWriteSpeed(raw float64) { positions.Insert(speed_mps: raw) }
   GOOD: route every value through internal/tesla/normalize.Pipeline().

❌ 4. NESTED MAPS CROSSING THE INGEST BOUNDARY
   Compound types (DoorState, Doors, Location, TireLocation, Time) are flattened
   to typed atomic children at the codec boundary. Downstream consumers see
   only primitives.

   BAD:  signalStore.Set("DoorState", map[string]bool{"FrontLeft": true, ...})
   GOOD: signalStore.Set("DoorStateFrontLeft", true); ...

❌ 5. SKIPPING SETTING*UNIT SUBSCRIPTIONS
   All 4 Setting*Unit fields (SettingDistanceUnit, SettingTemperatureUnit,
   SettingTirePressureUnit, SettingChargeUnit) MUST be subscribed at
   interval_seconds=1 in every Fleet Telemetry config. They are REQUIRED
   ingest signals, not optional UI metadata.

❌ 6. SILENT FAILURES ON MISSING UNIT CONTEXT
   When a unit-bearing field arrives with no vehicle_unit_history row and
   no bootstrap snapshot, the value MUST be dropped with a logged warning
   and a Prometheus metric increment. Never store an interpreted value
   under an assumed unit.

   BAD:  if activeUnit == "" { activeUnit = "mi" } // assume miles
   GOOD: if activeUnit == "" {
           log.Warn().Str("field", field).Msg("no unit context, dropping value")
           metrics.UnitContextMissing.WithLabelValues(field).Inc()
           return ErrNoUnitContext
         }

❌ 7. ROUTING WITHOUT routing.yaml
   Field → table routing decisions live in internal/tesla/router/routing.yaml
   exclusively. Hardcoded switch statements in handlers are forbidden.

   BAD:  switch field { case "VehicleSpeed": writePositions(...) }
   GOOD: routing.yaml { VehicleSpeed: { table: positions, column: speed_mps } }
         router.Route(field, value)

❌ 8. STORING NON-SI VALUES
   Storage tables hold canonical SI values exclusively (m/s, m, Pa, °C, W, A, V).
   Frontend converts to display units via web/src/lib/units/.

   BAD:  CREATE TABLE positions (..., speed_mph REAL)
   GOOD: CREATE TABLE positions (..., speed_mps REAL)  // SI

❌ 9. APP SETTINGS UNIT SELECTORS INFLUENCING INGEST
   The frontend Settings page unit selectors and "Sync from Car" button are
   app-display-only. Ingest interpretation is governed by vehicle_unit_history.

   BAD:  use settings.UserDistanceUnit to convert raw VehicleSpeed
   GOOD: use vehicle_unit_history(vehicle_id, "distance", emittedAt)

❌ 10. RECREATING DELETED PRIMITIVES
   internal/telemetry/{normalize,flatten,transformers_stub,hot_catalog*,signal_alias}.go,
   internal/enums/signal_types.go, and internal/enums/parse_*.go are DELETED.
   Do not re-introduce them. Do not "port" old logic over — use the new pipeline.
```

## ✅ CONVENTIONS

- `internal/tesla/codec` decodes a Datum to a strict typed Go value. Honors `Value.invalid=true` by returning `ErrInvalid`.
- `internal/tesla/units.ToSI(field, rawValue, activeUnit)` is a pure function. No I/O. Tested by table-driven tests covering every unit-bearing field × every supported unit.
- `internal/tesla/unit_history.Repo` is the only writer of `vehicle_unit_history`. The lookup `repo.At(ctx, vehicleID, kind, t)` returns the most recent row with `effective_from <= t`. Cached via Redis with TTL=60s.
- `internal/tesla/bootstrap` reuses `internal/tesla/client_vehicle_data.go` for the REST `/vehicle_data` snapshot. Called once on first connect per vehicle.
- `internal/tesla/normalize.Pipeline` is the only public ingest entrypoint. Callers (mqtt, etc.) do NOT compose codec/units/router themselves.
- `internal/tesla/router/routing.yaml` is the single curated artifact. Format documented in `internal/tesla/router/routing.go`. Loaded once at startup.
- Generated code lives in files named `*_gen.go`. They have a header comment `// Code generated by cmd/protogen-tesla; DO NOT EDIT.` Editor agents must respect that header.

## When to update routing.yaml

- Tesla adds a new proto field → re-vendor proto, regen, add a routing entry.
- Existing field gets a new persistent home → update its routing entry. Old destination column gets a migration if persistence is changing.
- A field becomes obsolete → set `route: drop` in routing.yaml (do NOT remove the entry, so the coverage test stays green).

## Verification commands

- Codegen sync: `go generate ./internal/tesla/protomodel/... && git diff --exit-code internal/tesla/protomodel/`
- Routing coverage: `go test ./internal/tesla/router/ -run TestRoutingCoverage`
- Pipeline contract: `go test ./internal/tesla/normalize/`
- Unit conversions: `go test ./internal/tesla/units/`
- Drift detection: `go run ./cmd/unit-drift-validator/ --once`
