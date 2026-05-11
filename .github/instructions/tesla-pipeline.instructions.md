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

## ⛔ 11. DUPLICATING THE PROTO-ENUM CONVERSION

The codec is the **single conversion point** for proto enum →
internal-representation translation in the entire pipeline. The
generator (`cmd/protogen-tesla/emit.go`) emits, for every typed proto
enum, a default-case branch that calls
`strings.TrimPrefix(x.<Field>.String(), "<LCP>")` so the value lands
in `signal.Store` as a **canonical short string** (e.g. `"D"`, `"P"`,
`"R"`, `"N"`, `"Charging"`, `"Complete"`, `"Disconnected"`,
`"Kilometers"`, `"Miles"`, `"Fahrenheit"`, `"Celsius"`, `"Psi"`,
`"Bar"`, `"Distance"`, `"Percent"`).

No downstream code — FSM, sessions, alerts, router writers,
`signal.Store`, `internal/tesla/normalize` observers, REST handlers,
SSE, `signal_log` writer, Redis cache reader — is permitted to:

```
❌ type-assert against ftproto.* enum values:
     v, ok := raw.(ftproto.ShiftState)               // forbidden
     u, ok := value.(ftproto.DistanceUnit)           // forbidden

❌ add a new "ParseFooEnum" / "stringerName" / "stripPrefix" helper
   that re-runs the codec's prefix-trim:
     func ParseGear(raw string) string { ... }       // forbidden
     func chargeStateName(s string) string { ... }   // forbidden

❌ accept BOTH long-form and canonical short form in a switch:
     switch v {                                       // forbidden
     case "ShiftStateD", "Drive", "D":                //   pick ONE form
       return GearDrive                               //   (the canonical
     }                                                //    short form)
```

Instead:

```
✅ Compare canonical short strings directly via store.GetString:
     g, ok := store.GetString(vehicleID, signalmeta.SigShiftState)
     if ok && g == "D" { ... }

✅ Trust the canonical-string contract — if a field value is missing
   from the codec's set, fix it by extending
   cmd/protogen-tesla/emit.go's longestCommonPrefix mapping so the
   codec emits the right short form. Then re-run
   `go generate ./internal/tesla/protomodel/...`.

✅ Read the contract: see the doc comment on
   `internal/tesla/protomodel.DecodeValue` and the per-enum LCP outputs
   in `cmd/protogen-tesla/emit.go`.
```

**Code-review block:** any new file under `internal/{fsm,signal,api,
alerts,automation,tesla/normalize,tesla/router}/` that imports
`api/proto/tesla/...` solely to type-assert against an enum value, OR
re-implements per-enum prefix-stripping, is rejected. The codec
already did the work.

**Permitted exceptions:**
- `cmd/pub-test-signal/` and other wire-format producers — they
  encode payloads, so typed `ftproto.*` enums on the **outgoing**
  side are correct.
- `cmd/protogen-tesla/` itself — it owns the contract.
- Codec test files — wire-format inputs use typed enums, only the
  decoded outputs assert canonical short strings.



## ⛔ 12. NARROWING signal.Value.Raw TO A SPECIFIC NUMERIC TYPE

`internal/signal/coerce.go` exposes the **single canonical converter**
for any signal-derived value to a Go `float64`:

```go
signal.Float64(v any) (float64, bool)         // primary entry; mirrors codec value-kind surface
signal.Float64Value(v *signal.Value) (float64, bool)   // nil-safe wrapper for *signal.Value
```

The converter covers every numeric kind the Phase-42 codec emits
(float64, float32, int, int8, int16, int32, int64, uint and unsigned
counterparts) plus the JSON-decode artefacts (`json.Number`, numeric
strings parsed via `strconv.ParseFloat`, bool 1/0 — legacy envelope
only) and the legacy `{invalid,value}` envelope unwrap.

No downstream code — service layer, API handlers, FSM adapters,
session trackers, snapshot writers — is permitted to:

```
❌ narrow signal.Value.Raw with a single-type assertion:
     if f, ok := v.Raw.(float64); ok { ... }       // forbidden
     if i, ok := v.Raw.(int); ok { ... }           // forbidden

❌ duplicate the type switch with a fresh helper (snapFloat,
   coerceFloat, asFloat64, etc.) that re-implements coverage:
     func snapFloat(...) (float64, bool) {
         switch n := v.(type) {
         case float64: ...
         case float32: ...     // forbidden — call signal.Float64
         }
     }

❌ assume Float5 codec fields land as float64 in signal.Store —
   the codec stores them as **float32**, and Int3/Int4 as **int32**.
   A `.(float64)` assertion silently drops every codec value.
```

```
✅ Use the canonical converter at every callsite:
     if f, ok := signal.Float64Value(all["RatedRange"]); ok {
         state.RatedRange = f
     }

✅ For nested map members (e.g. composite Location.latitude),
   call signal.Float64 on the unwrapped element:
     if lat, ok := signal.Float64(loc["latitude"]); ok { ... }

✅ Extending the codec with a new numeric value-kind? Update
   internal/signal/coerce.go ONCE; every consumer inherits the
   coverage automatically.
```

**Why this rule exists:** every post-Phase-42 dashboard regression
discovered during the panel-by-panel UI audit (commits b3cdd51eb,
30bd16a1) traced to a fresh `Raw.(float64)` narrowing assertion that
silently dropped float32 codec values. The user explicitly forbids
"creating multiple logics for signals conversions" — the canonical
converter is the enforcement point.

**Code-review block:** any new file under `internal/{api,service,fsm,
alerts,automation,tesla/normalize,tesla/router}/` that contains
`v.Raw.(float64)` or `v.Raw.(int)` (or any other single-numeric-type
assertion against a signal-derived value) is rejected. Use
`signal.Float64Value` / `signal.Float64`.

**Permitted exceptions:**
- `internal/signal/coerce.go` — the converter itself.
- `internal/signal/store.go:GetFloat` — the boundary that owns the
  `protomodel.SignalsByName` ValueKind meta check before delegating
  primitive conversion to `Float64`.
- `internal/tesla/codec/` — owns the wire-format → typed Go conversion;
  may use typed assertions on `ftproto.Value_*` variants.
- Test files asserting raw codec output shape.