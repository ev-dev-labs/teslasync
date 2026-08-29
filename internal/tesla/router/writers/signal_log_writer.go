package writers

import (
	"context"
	"fmt"
	"reflect"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel/attribute"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// signalLogValueKind constants mirror migration 000186_signal_log.up.sql
// lines 79-88 (which itself mirrors protomodel.ValueKind in
// internal/tesla/protomodel/types.go). They are declared locally rather
// than imported from protomodel because the writer treats value
// classification as a Go-runtime-type discrimination — the codec emits
// typed scalars and typed proto enums per codec/types.go:46-48 and the
// writer dispatches on the Go runtime type, not on a per-Field protomodel
// lookup. Decoupling here keeps the writer independent of the protomodel
// signal_metadata table and avoids the field-name → ValueKind round-trip
// on the hot path.
//
// The 8 active kinds cover every value type the codec.DecodeValue function
// can emit. ValueKindUnknown (0), ValueKindCompound (8), and
// ValueKindInvalid (10) are intentionally absent: compound atomics are
// flattened into scalar children at the codec boundary so the writer
// never sees them, and the unknown / invalid kinds are dropped upstream
// per protomodel/datum_decoder_gen.go:33-47.
const (
	// signalLogNormalizationVersion identifies rows written after the
	// field-specific Tesla wire-unit rules have been applied. Legacy writers
	// omit the nullable column added by migration 000232, leaving NULL.
	signalLogNormalizationVersion int16 = 1

	signalLogKindString int16 = 1
	signalLogKindBool   int16 = 2
	signalLogKindInt32  int16 = 3
	signalLogKindInt64  int16 = 4
	signalLogKindFloat  int16 = 5
	signalLogKindDouble int16 = 6
	signalLogKindEnum   int16 = 7
	signalLogKindTime   int16 = 9
)

// signalLogPool is the minimal subset of *pgxpool.Pool that
// signalLogWriter depends on. Mirrors snapshot_base.go's pgxPool —
// Exec only — because the cold-path writer has no slow-path
// disambiguation (RowsAffected==0 is unambiguously "vehicle not
// registered", not "duplicate skip", because the typed columns of the
// new row would differ from any prior row even if the (vehicle, ts,
// field) key collided).
type signalLogPool interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Compile-time assertion that *pgxpool.Pool satisfies signalLogPool.
// A signature drift in pgxpool would fail the build here rather than
// at the first NewSignalLogWriter call.
var _ signalLogPool = (*pgxpool.Pool)(nil)

// signalLogInsertSQL is the cold-path INSERT statement for destination
// signal_log.
//
// All five typed columns are bound on every write — exactly one is
// non-nil (dictated by value_kind), the other four are SQL NULL. This
// shape defends the migration's invariant that "exactly one of the
// typed columns is non-null per row" (000186_signal_log.up.sql:76-77)
// at the writer boundary — the table itself has no CHECK constraint
// enforcing it. The static SQL also avoids per-write fmt.Sprintf
// allocation that a column-name-templated form would incur.
//
// VIN→numeric vehicle_id resolution happens INSIDE the INSERT:
// codec.Atomic.VehicleID is the Payload-level Vin string
// (codec/types.go:57-59), and signal_log.vehicle_id is BIGINT NOT NULL
// (000186_signal_log.up.sql:99) so the writer must resolve VIN→id
// against the unique-indexed vehicles.vin column.
//
// ON CONFLICT DO UPDATE always overwrites every typed column from
// EXCLUDED so a same-(vehicle, ts, field) re-delivery cannot leave a
// stale value in a now-NULL typed column (e.g. an earlier
// value_kind=3 write of int_value=42 followed by a value_kind=1 write
// of str_value='x' yields {value_kind=1, str_value='x'} with
// int_value back to NULL — not {value_kind=1, str_value='x', int_value=42}).
// Per the migration's invariant the same Field's value_kind should
// not change at runtime, so this defence is for routing/codec drift
// caught at the writer boundary rather than expected behaviour.
//
// $1 = VIN (string), $2 = ts (time.Time), $3 = field (string),
// $4 = value_kind (int16), $5 = str_value (any/nil), $6 = bool_value
// (any/nil), $7 = int_value (any/nil), $8 = float_value (any/nil),
// $9 = time_value (any/nil), $10 = normalization_version (int16).
const signalLogInsertSQL = `INSERT INTO signal_log (
	vehicle_id, ts, field, value_kind,
	str_value, bool_value, int_value, float_value, time_value,
	normalization_version, normalization_write_token
)
SELECT v.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE
FROM vehicles v
WHERE v.vin = $1
ON CONFLICT (vehicle_id, ts, field) DO UPDATE SET
	value_kind            = EXCLUDED.value_kind,
	str_value             = EXCLUDED.str_value,
	bool_value            = EXCLUDED.bool_value,
	int_value             = EXCLUDED.int_value,
	float_value           = EXCLUDED.float_value,
	time_value            = EXCLUDED.time_value,
	normalization_version = EXCLUDED.normalization_version,
	normalization_write_token = NOT COALESCE(
		signal_log.normalization_write_token,
		FALSE
	)`

// signalLogWriter is the bespoke router.Writer for destination
// signal_log. It is NOT composed from snapshotWriter because signal_log
// carries one of five typed columns per row dictated by value_kind,
// which doesn't fit snapshot_base.go's single-column-per-write model.
// This writer handles both `dest: signal_log` (primary) and
// `also_signal_log: true` (dual-write); the router orchestrates the
// dual-write by invoking this writer in addition to the primary writer when
// `also_signal_log: true`. The writer itself doesn't need to know.
//
// Concurrency: a *signalLogWriter holds no per-Write mutable state
// (db is set at construction and read-only thereafter), so the value
// is safe for concurrent use across the pipeline's goroutines.
type signalLogWriter struct {
	db signalLogPool
}

// Compile-time assertion that *signalLogWriter satisfies router.Writer.
// A signature drift in router.Writer would fail the build here rather
// than the first integration test.
var _ router.Writer = (*signalLogWriter)(nil)

// NewSignalLogWriter constructs the production cold-path writer for
// destination signal_log.
//
// A nil pool is a wiring bug and panics at process start so the
// failure is surfaced before any payload is processed. Same panic
// pattern as NewClimateWriter / NewMotorWriter / NewMediaWriter /
// NewSafetyWriter / NewLocationWriter / NewSecurityEventWriter /
// NewChargingTelemetryWriter / NewTirePressureWriter /
// NewPositionsWriter.
func NewSignalLogWriter(pool *pgxpool.Pool) router.Writer {
	if pool == nil {
		panic("NewSignalLogWriter: pool must be non-nil")
	}
	return &signalLogWriter{db: pool}
}

// Write implements router.Writer for destination signal_log.
//
// Algorithm:
//
//  1. Classify atom.Value via signalLogClassify. The eight LOCKED kinds
//     (string, bool, int32, int64, float32, float64, time.Time, typed
//     proto enum) cover every value type codec.DecodeValue can emit per
//     codec/types.go:46-48. nil and any other type return an error so
//     a producer/codec contract drift surfaces loudly per the writer's
//     drop-loud contract.
//
//  2. Normalise atom.EmittedAt to UTC with the monotonic clock stripped
//     so two atomics carrying the same Payload.CreatedAt always
//     key-equal. Mirrors positions_writer.go:284 and
//     security_event_writer.go:257.
//
//  3. Issue signalLogInsertSQL. RowsAffected==1 is the steady-state
//     happy path and returns nil. RowsAffected==0 means the
//     VIN→vehicle_id SELECT yielded zero rows (the VIN is not
//     registered) — return a typed error WITHOUT the VIN in the
//     message (PII).
//
// dst is part of the Writer interface contract but the signal_log
// writer deliberately does NOT consult dst.Column — routing.yaml
// entries with `dest: signal_log` do not declare a `column:` (per
// types.go:139-141 the Column field is empty for cold-path
// destinations) and the typed column the writer chooses is sourced
// from the Go runtime type of atom.Value via signalLogClassify.
//
// Failure modes (per ADR-004 #8 these are surfaced to the router
// caller — they MUST NOT propagate to MQTT redelivery):
//
//   - atom.Value is nil or a type outside the eight LOCKED kinds:
//     producer/codec contract drift, returns error.
//
//   - db.Exec returns an error: backend transient or schema drift,
//     wrapped with the signalLogWriter.<field> prefix so the router's
//     classifyError tag set picks up timeouts / cancellations from the
//     wrapped chain.
//
//   - tag.RowsAffected() == 0: the VIN is not registered in vehicles.
//     Returns a typed error WITHOUT the VIN in the message (PII; the
//     upstream subscriber log already records vehicle context).
func (w *signalLogWriter) Write(ctx context.Context, atom codec.Atomic, dst router.Entry) error {
	_ = dst // see godoc above — typed column is sourced from atom.Value, not dst.

	ctx, span, end := startWriterSpan(ctx, "signal_log", atom.Field)
	var err error
	defer func() { end(err) }()

	bound, err := signalLogClassify(atom.Value)
	if err != nil {
		return fmt.Errorf("signalLogWriter.%s: %w", atom.Field, err)
	}
	span.SetAttributes(attribute.Int("value_kind", int(bound.kind)))

	ts := atom.EmittedAt.UTC().Round(0)

	tag, err := w.db.Exec(
		ctx,
		signalLogInsertSQL,
		atom.VehicleID,
		ts,
		atom.Field,
		bound.kind,
		bound.str,
		bound.boolean,
		bound.integer,
		bound.float,
		bound.timeVal,
		signalLogNormalizationVersion,
	)
	if err != nil {
		return fmt.Errorf("signalLogWriter.%s: %w", atom.Field, err)
	}
	span.SetAttributes(attribute.Int64("rows_affected", tag.RowsAffected()))
	if tag.RowsAffected() == 0 {
		// VIN deliberately not in the message — it is PII. The
		// router's writer_failures_total{dest=signal_log,
		// reason="other"} counter increments on this path; the
		// upstream MQTT subscriber log already records the
		// (topic, vehicle) context if forensic correlation is needed.
		err = fmt.Errorf("signalLogWriter.%s: vehicle not registered", atom.Field)
		return err
	}
	return nil
}

// signalLogBound is the typed-column payload returned by
// signalLogClassify. Exactly one of {str, boolean, integer, float,
// timeVal} is non-nil per row dictated by `kind`; the other four are
// nil so the static signalLogInsertSQL binds them as SQL NULL. This
// preserves the migration's "exactly one typed column non-null"
// invariant (000186_signal_log.up.sql:76-77) at the writer boundary.
//
// The fields are typed as `any` rather than the underlying Go scalar
// type so a nil interface binds to SQL NULL via pgx's standard
// any→NULL conversion. Using *string / *bool / *int64 / *float64 /
// *time.Time would also work but doubles allocation overhead per
// write for no benefit at this layer.
type signalLogBound struct {
	kind    int16
	str     any // nil unless kind == signalLogKindString
	boolean any // nil unless kind == signalLogKindBool
	integer any // nil unless kind == signalLogKindInt32 / Int64 / Enum
	float   any // nil unless kind == signalLogKindFloat / Double
	timeVal any // nil unless kind == signalLogKindTime
}

// signalLogClassify narrows codec.Atomic.Value to one of the eight
// LOCKED kinds and returns the typed-column payload to bind. Returns
// a non-nil error for nil values and for any type outside the LOCKED
// set; the caller wraps the error with the signalLogWriter.<field>
// prefix and surfaces it to the router as a writer failure.
//
// Type mapping per migration 000186_signal_log.up.sql:79-88:
//
//   - string                       → kind=1, str_value
//   - bool                         → kind=2, bool_value
//   - int32                        → kind=3, int_value (widened to int64)
//   - int64                        → kind=4, int_value
//   - float32                      → kind=5, float_value (widened to float64)
//   - float64                      → kind=6, float_value
//   - typed proto enum (int32-based) → kind=7, int_value (enum number)
//   - time.Time                    → kind=9, time_value (UTC-canonicalised)
//
// Proto enum detection note: every proto3 enum is generated as
// `type X int32` with auto-generated String(), Number(), Descriptor()
// methods (e.g. ftproto.ShiftState, ftproto.SentryModeState in the
// vendored Tesla protos). This writer detects them via
// reflect.ValueOf(v).Kind() == reflect.Int32 in the default arm —
// the explicit `case int32` above already filtered out the bare
// int32 type so anything reaching the default arm with Int32 kind
// must be a named int32 type (proto enum or future codec
// extension that follows the same shape). This avoids importing
// google.golang.org/protobuf/reflect/protoreflect (currently an
// indirect go.mod dependency) which would require widening the
// allowed-files list to include go.mod.
//
// Trade-off explicitly accepted: a hypothetical future codec change
// that emits a non-enum named int32 type would be misclassified as
// kind=7 (Enum) instead of kind=3 (Int32). The integer value itself
// is preserved exactly in either case, so downstream readers get the
// correct number; only the kind label differs. Per the codec contract
// at codec/types.go:46-48 this can't happen today, and the
// signalLogClassify_EnumDispatch test pins the current behaviour.
func signalLogClassify(v any) (signalLogBound, error) {
	switch t := v.(type) {
	case string:
		return signalLogBound{kind: signalLogKindString, str: t}, nil
	case bool:
		return signalLogBound{kind: signalLogKindBool, boolean: t}, nil
	case int32:
		return signalLogBound{kind: signalLogKindInt32, integer: int64(t)}, nil
	case int64:
		return signalLogBound{kind: signalLogKindInt64, integer: t}, nil
	case float32:
		return signalLogBound{kind: signalLogKindFloat, float: float64(t)}, nil
	case float64:
		return signalLogBound{kind: signalLogKindDouble, float: t}, nil
	case time.Time:
		return signalLogBound{kind: signalLogKindTime, timeVal: t.UTC()}, nil
	case nil:
		return signalLogBound{}, fmt.Errorf("nil value not allowed in signal_log write")
	default:
		// See "Proto enum detection note" in the godoc above.
		rv := reflect.ValueOf(v)
		if rv.IsValid() && rv.Kind() == reflect.Int32 {
			return signalLogBound{kind: signalLogKindEnum, integer: rv.Int()}, nil
		}
		return signalLogBound{}, fmt.Errorf("unsupported value type %T (signal_log accepts string, bool, int32, int64, float32, float64, time.Time, or a typed proto enum)", v)
	}
}
