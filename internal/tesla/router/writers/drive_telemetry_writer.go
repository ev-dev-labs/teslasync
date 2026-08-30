package writers

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// driveTelemetryColumnByField is the static field→column map for
// destination drive_telemetry. It mirrors routing.yaml entries with
// `dest: drive_telemetry`.
//
// The drive_telemetry writer composes the shared snapshotWriter helper
// from snapshot_base.go.
// The (vehicle_id, ts) PK upsert pattern works for the per-tick
// time-series table exactly as it does for the *_snapshots tables:
// two atomics for the same tick (e.g. VehicleSpeed + Gear at the same
// EmittedAt) coalesce into ONE row with both columns set, matching
// the table's ~1 Hz sampling contract documented at migration
// 000190_drive_telemetry_si.up.sql:45.
//
// The writer NEVER touches the drive_id column.
// migrations/000190_drive_telemetry_si.up.sql:22 declares drive_id
// nullable; the session tracker backfills it via a separate UPDATE
// after drive boundaries are detected. snapshotWriter's INSERT statement at
// internal/tesla/router/writers/snapshot_base.go:158 names only
// (vehicle_id, ts, <col>) so drive_id is naturally omitted from
// both the INSERT column list and the ON CONFLICT DO UPDATE SET
// clause — late-arriving drive_id UPDATEs are preserved across
// per-column re-deliveries because the upsert SET clause references
// only the routed column.
//
// This map is a static var, NOT a runtime read of
// routing.yaml: the routing layer's loader already validated every
// entry at process start, the per-payload hot path must not re-parse
// a 1000-line YAML file, and a compile-time declaration here lets
// the reflective coverage test catch any drift between routing.yaml
// and this file at CI time rather than at the first Write call.
//
// The codec.Atomic.Value type for each routed field is the type the
// codec emits for that proto field (per protomodel.SignalsByName):
//
//   - 9 ValueKindFloat fields → float64 (or float32 promoted by
//     normalize.toSI for unit-bearing values). bindSnapshotValue at
//     snapshot_base.go:194-209 binds these directly. Note that the
//     three *_mps / *_mps2 / *_wh columns inherit SI-canonical units
//     from normalize.toSI before reaching this writer; the column
//     suffix is the contract.
//
//   - 2 ValueKindBool fields → bool. Bound directly.
//
//   - 1 ValueKindEnum field (Gear → ftproto.ShiftState) → typed
//     int32 enum. snapshot_base.bindSnapshotValue rejects it because
//     the helper deliberately accepts only the four LOCKED scalar
//     types. The drive_telemetry writer therefore composes
//     snapshotWriter as a HYBRID: routed Field "Gear" is intercepted,
//     converted to its proto-cased String() form via fmt.Stringer,
//     and the resulting string is delegated to snapshotWriter for
//     the actual SQL composition. See coerceProtoEnumToText below.
//
//     Storage form: the proto-generated String() returns
//     "ShiftStateP" / "ShiftStateD" / etc. This writer stores the
//     full proto-cased form rather than stripping the "ShiftState"
//     prefix, mirroring the security_event writer's bindSecurityEventState
//     precedent at security_event_writer.go:337-342. Consumers
//     reading drive_telemetry.gear get the exact wire-format token,
//     which is unambiguous, lossless, and forward-compatible if
//     Tesla ever adds new ShiftState variants. The migration COMMENT
//     at migrations/000190_drive_telemetry_si.up.sql:58-59 documents
//     "(P, R, N, D)" illustratively; a future docs-only migration
//     may align that comment with the writer's storage form.
var driveTelemetryColumnByField = map[string]string{
	"BrakePedal":                "brake_pedal",
	"BrakePedalPos":             "brake_pedal_pos_pct",
	"CruiseSetSpeed":            "cruise_set_speed_mps",
	"DriveRail":                 "drive_rail",
	"Gear":                      "gear",
	"LateralAcceleration":       "lateral_acceleration_mps2",
	"LifetimeEnergyGainedRegen": "lifetime_energy_gained_regen_wh",
	"LifetimeEnergyUsedDrive":   "lifetime_energy_used_drive_wh",
	"LongitudinalAcceleration":  "longitudinal_acceleration_mps2",
	"PedalPosition":             "pedal_position_pct",
	"VehicleSpeed":              "speed_mps",
}

// driveTelemetryEnumFields is the static set of routed Field names
// whose codec.Atomic.Value carries a typed proto enum (per
// protomodel.SignalsByName.ValueKindEnum) and therefore needs the
// fmt.Stringer pre-conversion before the value can be bound through
// snapshotWriter's bindSnapshotValue at snapshot_base.go:194-209.
//
// Today this is exactly one entry: Gear → ftproto.ShiftState. The
// reflective TestDriveTelemetryWriter_EnumFieldsMatchProtomodel test
// asserts the set is symmetric to protomodel.SignalsByName entries
// where ValueKind == ValueKindEnum AND the Field is routed to
// drive_telemetry — so a future routing addition that lands a new
// enum-typed field on this destination fails CI until the set is
// extended.
//
// Dispatch keys on Field (the producer-side proto name) rather than
// the column because protomodel.SignalsByName is the authoritative
// source for ValueKindEnum and is keyed on Field. The trade-off
// versus tire_pressure_writer's column-keyed dispatch is documented
// in coerceProtoEnumToText.
var driveTelemetryEnumFields = map[string]struct{}{
	"Gear": {},
}

// driveTelemetryColumnFor is the columnFor callback supplied to
// snapshotWriter. It closes over driveTelemetryColumnByField so the
// snapshot helper has a single
// source-of-truth lookup; ok=false is returned for any field NOT
// routed here (the snapshot helper then errors out loudly per its
// drop-loud contract — see snapshot_base.go's columnFor godoc).
func driveTelemetryColumnFor(field string) (string, bool) {
	col, ok := driveTelemetryColumnByField[field]
	return col, ok
}

// driveTelemetryWriter is the router.Writer for destination
// drive_telemetry. It composes snapshotWriter for all 11 routed columns;
// the lone enum-typed field (Gear) is pre-converted to a string via
// fmt.Stringer before
// delegation so snapshotWriter's bindSnapshotValue (which accepts
// only float64/int64/bool/string) has a bindable value.
//
// Concurrency: holds only an immutable *snapshotWriter after
// construction. snapshotWriter has its own no-mutable-state
// guarantee. Safe for concurrent Write calls across the pipeline
// goroutines.
type driveTelemetryWriter struct {
	snap *snapshotWriter
}

// Compile-time assertion that *driveTelemetryWriter satisfies the
// router.Writer interface. A signature drift in router.Writer would
// fail the build here rather than the first integration test.
var _ router.Writer = (*driveTelemetryWriter)(nil)
var _ router.BatchWriter = (*driveTelemetryWriter)(nil)

// Write implements router.Writer for destination drive_telemetry.
//
// Dispatch:
//
//   - Field is in driveTelemetryEnumFields → pre-convert atom.Value
//     via coerceProtoEnumToText (fmt.Stringer.String() / string
//     idempotent / nothing else accepted), substitute the resulting
//     string back into atom.Value, then delegate to the embedded
//     snapshotWriter so the SQL composition / VIN resolution / ON
//     CONFLICT upsert / PII-clean RowsAffected==0 message all match
//     the rest of the snapshot family byte-for-byte.
//
//   - Field is NOT in driveTelemetryEnumFields → delegate directly to
//     snapshotWriter (binds float64/int64/bool/string scalars).
//
//   - Field is NOT routed to drive_telemetry at all → snapshotWriter
//     emits "no column mapping for field" via its columnFor lookup
//     (delegated through driveTelemetryColumnFor). Same loud-drop
//     semantics as every other snapshot family writer.
//
// The writer never names the drive_id column on insert. drive_id is
// backfilled by the session tracker via a separate UPDATE; if the writer
// accidentally included drive_id in the column list it would either
// (a) write SQL NULL on insert, OR (b) overwrite a previously-set
// drive_id on re-delivery via the ON CONFLICT DO UPDATE SET clause —
// both are silent corruptions of the FK relationship into drives.
// snapshotWriter's INSERT statement at snapshot_base.go:158 names
// only (vehicle_id, ts, <col>) so the FK is naturally untouched;
// TestDriveTelemetryWriter_DriveIDNotTouched pins this against
// every routed field to defend against future regressions.
func (w *driveTelemetryWriter) Write(ctx context.Context, atom codec.Atomic, dst router.Entry) error {
	if _, isEnum := driveTelemetryEnumFields[atom.Field]; isEnum {
		s, err := coerceProtoEnumToText(atom.Value)
		if err != nil {
			return fmt.Errorf("snapshotWriter[drive_telemetry].%s: %w", atom.Field, err)
		}
		atom.Value = s
	}
	return w.snap.Write(ctx, atom, dst)
}

func (w *driveTelemetryWriter) WriteBatch(ctx context.Context, items []router.RoutedAtomic) []error {
	results := make([]error, len(items))
	valid := make([]router.RoutedAtomic, 0, len(items))
	validIndexes := make([]int, 0, len(items))
	for i, item := range items {
		if _, isEnum := driveTelemetryEnumFields[item.Atomic.Field]; isEnum {
			value, err := coerceProtoEnumToText(item.Atomic.Value)
			if err != nil {
				results[i] = fmt.Errorf(
					"snapshotWriter[drive_telemetry].%s: %w",
					item.Atomic.Field,
					err,
				)
				continue
			}
			item.Atomic.Value = value
		}
		valid = append(valid, item)
		validIndexes = append(validIndexes, i)
	}
	for i, err := range w.snap.WriteBatch(ctx, valid) {
		results[validIndexes[i]] = err
	}
	return results
}

// coerceProtoEnumToText narrows codec.Atomic.Value to a textual
// representation suitable for the gear TEXT column. Accepts:
//
//   - fmt.Stringer: the codec returns proto-generated enum types
//     directly (e.g. ftproto.ShiftState for Gear per
//     protomodel/datum_decoder_gen.go:107-108). Every protobuf
//     generated enum has a String() method so the Stringer dispatch
//     handles ShiftState today and any future ValueKindEnum field
//     routed here without per-enum type assertions. An empty string
//     return is rejected loudly because it almost certainly indicates
//     a zero-valued enum that the producer never populated.
//
//   - string: defensive idempotency for a future codec change that
//     pre-stringifies enums at the codec boundary; an empty string
//     is rejected as above.
//
//   - everything else (nil, bool, numeric, time.Time, raw int32 with
//     no Stringer): rejected loudly. raw int32 deliberately does NOT
//     trigger the reflect-based enum-detection that signal_log_writer
//     uses because drive_telemetry.gear is TEXT and a numeric-without-
//     Stringer is a producer/codec contract drift, not a typed enum
//     missing its method set.
//
// Error wording mirrors snapshot_base.bindSnapshotValue's
// "unsupported value type %T" prefix so the router's classifyError
// tag set treats this branch identically to the snapshotWriter
// happy path.
func coerceProtoEnumToText(v any) (string, error) {
	switch t := v.(type) {
	case fmt.Stringer:
		s := t.String()
		if s == "" {
			return "", fmt.Errorf("Stringer %T returned empty string for enum text", t)
		}
		return s, nil
	case string:
		if t == "" {
			return "", fmt.Errorf("empty string not allowed for enum text")
		}
		return t, nil
	case nil:
		return "", fmt.Errorf("nil value not allowed for enum text")
	default:
		return "", fmt.Errorf("unsupported value type %T (drive_telemetry enum helper accepts fmt.Stringer or non-empty string)", v)
	}
}

// NewDriveTelemetryWriter constructs the production drive telemetry
// writer for destination drive_telemetry.
//
// Composes the unexported snapshotWriter from snapshot_base.go: the
// table is "drive_telemetry" (matches migration 000190) and the
// columnFor callback is driveTelemetryColumnFor above. All 11 routed
// fields resolve to a column; the compile-time map plus the
// reflective coverage test together guarantee routing.yaml ↔ writer
// alignment.
//
// drive_telemetry is the per-tick time-series table — NOT the
// session-aggregate drives table. drive_id is left NULL at insert
// time and backfilled by the session tracker observer.
//
// A nil pool is a wiring bug and panics at process start so the
// failure is surfaced before any payload is processed. Same panic
// pattern as NewChargingTelemetryWriter / NewClimateWriter /
// NewSafetyWriter / NewMediaWriter.
//
// snapshotWriter constructor errors are also fatal — they indicate
// a programmer typo in the table identifier or a nil columnFor —
// neither of which is a runtime-recoverable condition. The panic
// message includes the wrapped error so the operator can correlate.
func NewDriveTelemetryWriter(pool *pgxpool.Pool) router.Writer {
	if pool == nil {
		panic("NewDriveTelemetryWriter: pool must be non-nil")
	}
	w, err := newSnapshotWriter(pool, "drive_telemetry", driveTelemetryColumnFor)
	if err != nil {
		panic(fmt.Sprintf("NewDriveTelemetryWriter: %v", err))
	}
	return &driveTelemetryWriter{snap: w}
}
