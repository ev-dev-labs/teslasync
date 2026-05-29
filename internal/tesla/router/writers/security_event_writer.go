package writers

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel/attribute"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// securityEventTypeByField is the static field→event_type token map for
// destination security_event. It mirrors routing.yaml entries with
// `dest: security_event` (3 routes today: Locked, SentryMode,
// ValetModeEnabled).
//
// The token values are the snake_case canonical names referenced by the
// security_events.event_type COMMENT (migration 000183 line 217:
// "Token identifying the transitioning field (e.g. sentry_mode, locked,
// airbag_deployed, crash_state)."). They are declared explicitly here
// rather than computed via runtime camelCase→snake_case so the reviewer
// can see exactly which token each field becomes; no surprises.
//
// The routing.yaml entries do NOT carry a `column:` declaration for
// these routes — security_event
// is an event-table destination not a hot-table column-routed one,
// so e.Column is empty for all three entries. The reflective coverage
// test in security_event_writer_test.go asserts this and ensures the
// writer's static map stays aligned with routing.yaml entry-for-entry.
//
// New routes are added by:
//
//  1. appending the entry to routing.yaml under `dest: security_event`,
//  2. adding the field→token mapping below in the same commit,
//  3. (optional) extending bindSecurityEventState if the new field's
//     codec value type is not already covered (bool, string, fmt.Stringer).
//
// The reflective coverage test will fail until step 2 lands, which is
// the intended check.
var securityEventTypeByField = map[string]string{
	"Locked":           "locked",
	"SentryMode":       "sentry_mode",
	"ValetModeEnabled": "valet_mode_enabled",
}

// securityEventTypeFor is the per-payload lookup wrapper that closes
// over securityEventTypeByField. ok=false is returned for any field
// NOT routed to security_event; the caller then errors out loudly per
// the writer's drop-loud contract (matches snapshotWriter's columnFor
// callback semantics in snapshot_base.go).
func securityEventTypeFor(field string) (string, bool) {
	t, ok := securityEventTypeByField[field]
	return t, ok
}

// secEventDB is the minimal subset of *pgxpool.Pool that
// securityEventWriter depends on. It is broader than snapshot_base.go's
// pgxPool because the security event writer needs QueryRow for the
// slow-path RowsAffected==0 disambiguation between "vehicle not
// registered" and "duplicate event".
//
// Production wiring passes a *pgxpool.Pool. The package's tests pass a
// recording fake declared inline in security_event_writer_test.go (the
// shared recorder in snapshot_base_test.go does NOT implement QueryRow,
// and this file cannot modify it).
type secEventDB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Compile-time assertion that *pgxpool.Pool satisfies secEventDB.
// A signature drift in pgxpool would fail the build here rather than
// at the first NewSecurityEventWriter call.
var _ secEventDB = (*pgxpool.Pool)(nil)

// securityEventInsertSQL is the per-event INSERT statement for
// destination security_event.
//
// The statement is a single INSERT...SELECT...WHERE NOT EXISTS that
// resolves the VIN→numeric vehicle_id INSIDE the INSERT and skips the
// row if a row with the same
// (vehicle_id, ts, event_type) already exists.
//
// The combination handles all three flavours of repeated delivery:
//
//   - Identical re-delivery of the same payload (MQTT QoS-1 redelivery
//     after a broker hiccup): RowsAffected==0, the writer treats it as
//     an idempotent skip.
//
//   - Two distinct event_types at the same instant (e.g. AirbagDeployed
//     and CrashState changing in the same payload): each routes to a
//     different event_type token, so each INSERT lands its own row —
//     the table's PK on (vehicle_id, ts, event_type) explicitly allows
//     this per migration 000183 line 193-195.
//
//   - The VIN is not (yet) registered in `vehicles`: RowsAffected==0
//     because the SELECT yields zero rows. Disambiguated from the
//     duplicate-skip case by the slow-path SELECT in Write below.
//
// Reconciliation note for reviewers: this SQL is a single statement
// that fuses the existence check into the INSERT's SELECT WHERE NOT
// EXISTS. That preserves "check before insert and skip if present"
// semantics as one atomic operation with no race window, while avoiding
// a redundant transaction round-trip.
//
// $1 = VIN (string), $2 = ts (time.Time), $3 = event_type (string),
// $4 = to_state (string).
//
// from_state is NOT computable from a single atomic;
// downstream consumers reconstruct transitions by walking the
// per-(vehicle_id, event_type) ordered series. details (JSONB) is
// also left NULL today; a future routing extension that wants to
// attach structured context (e.g. SentryMode trigger reason) would
// need a writer-side field-specific JSONB builder, deferred.
const securityEventInsertSQL = `INSERT INTO security_events (vehicle_id, ts, event_type, to_state)
SELECT v.id, $2, $3, $4 FROM vehicles v WHERE v.vin = $1
  AND NOT EXISTS (
    SELECT 1 FROM security_events se
    WHERE se.vehicle_id = v.id AND se.ts = $2 AND se.event_type = $3
  )`

// securityEventVehicleExistsSQL is the slow-path disambiguation query
// run only when securityEventInsertSQL returns RowsAffected==0. It
// answers a single boolean question — is the VIN registered? — and
// lets Write distinguish the "idempotent dup skip" outcome (success)
// from the "vehicle not registered" outcome (error).
//
// This query is on the slow path only:
// the steady-state hot path (RowsAffected==1) never executes it. A
// payload from a legitimate vehicle in steady-state telemetry costs
// exactly one Exec; only first-event-after-dup or unknown-VIN payloads
// pay the second round-trip.
const securityEventVehicleExistsSQL = `SELECT EXISTS(SELECT 1 FROM vehicles WHERE vin = $1)`

// securityEventWriter is the bespoke router.Writer for destination
// security_event. It is NOT composed from snapshotWriter because
// security_events is an append-only
// event-table not a per-(vehicle_id, ts) hot-snapshot, and its PK
// includes event_type so the snapshot helper's per-column upsert
// pattern under (vehicle_id, ts) does not apply.
//
// Concurrency: a *securityEventWriter holds no per-Write mutable state
// (db is set at construction and read-only thereafter), so the value
// is safe for concurrent use across the pipeline's goroutines.
type securityEventWriter struct {
	db secEventDB
}

// Compile-time assertion that *securityEventWriter satisfies
// router.Writer. A signature drift in router.Writer would fail the
// build here rather than the first integration test.
var _ router.Writer = (*securityEventWriter)(nil)

// NewSecurityEventWriter constructs the production security event
// writer for destination security_event.
//
// A nil pool is a wiring bug and panics at process start so the
// failure is surfaced before any payload is processed. Same panic
// pattern as NewClimateWriter / NewMotorWriter / NewMediaWriter /
// NewSafetyWriter / NewLocationWriter / NewTirePressureWriter /
// NewPositionsWriter.
func NewSecurityEventWriter(pool *pgxpool.Pool) router.Writer {
	if pool == nil {
		panic("NewSecurityEventWriter: pool must be non-nil")
	}
	return &securityEventWriter{db: pool}
}

// Write implements router.Writer for destination security_event.
//
// Algorithm:
//
//  1. Look up the event_type token for atom.Field. ok=false → error
//     "no event_type mapping" so a routing.yaml ↔ writer drift surfaces
//     loudly per the drop-loud contract.
//
//  2. Bind atom.Value to the to_state TEXT column via
//     bindSecurityEventState. Bool/string/fmt.Stringer are accepted;
//     nil and other types are rejected. The fmt.Stringer branch covers
//     the proto-generated enum types (e.g. ftproto.SentryModeState)
//     which the codec returns directly without pre-converting to
//     string per protomodel/datum_decoder_gen.go:117-118.
//
//  3. Normalise atom.EmittedAt to UTC with the monotonic clock
//     stripped so two atomics carrying the same Payload.CreatedAt
//     always key-equal (matches positions_writer.go:284).
//
//  4. Issue securityEventInsertSQL. RowsAffected==1 is the steady-state
//     happy path and returns nil immediately.
//
//  5. RowsAffected==0 means the SELECT yielded zero rows — either the
//     VIN is unregistered OR a duplicate row already exists. Issue
//     securityEventVehicleExistsSQL on the slow path to disambiguate:
//     - vehicle exists → idempotent duplicate skip, return nil
//     - vehicle does NOT exist → "vehicle not registered" error
//
// Failure modes (per ADR-004 #8 these are surfaced to the router
// caller — they MUST NOT propagate to MQTT redelivery):
//
//   - atom.Field not in securityEventTypeByField: routing/writer
//     drift, returns error so the router increments
//     writer_failures_total and the operator alert fires.
//
//   - atom.Value is nil or a type outside bool/string/fmt.Stringer:
//     producer/codec contract drift, returns error.
//
//   - db.Exec returns an error: backend transient or schema drift,
//     wrapped with the securityEventWriter[security_events].<field>
//     prefix so the router's classifyError tag set picks up timeouts
//     / cancellations from the wrapped chain.
//
//   - db.QueryRow on the slow path returns an error: same wrapping
//     pattern with a "disambiguation query" sub-prefix so an operator
//     can tell from the log message that the failure happened on the
//     follow-up SELECT, not the primary INSERT.
//
//   - tag.RowsAffected() == 0 + vehicle exists: idempotent dup, returns
//     nil. The router counts this as outcome=ok (no metric increment).
//
//   - tag.RowsAffected() == 0 + vehicle does NOT exist: returns a
//     typed error WITHOUT the VIN in the message (the VIN is PII; the
//     upstream subscriber log already records vehicle context).
//
// dst is part of the Writer interface contract but the security event
// writer deliberately does NOT consult dst.Column — the routing.yaml
// entries for security_event do not declare a `column:` (e.Column == ""
// for every entry) and the field→event_type mapping is sourced from
// securityEventTypeByField above. The reflective coverage test pins
// this contract.
func (w *securityEventWriter) Write(ctx context.Context, atom codec.Atomic, dst router.Entry) error {
	_ = dst // see godoc above — event_type is sourced from securityEventTypeByField, not dst.

	ctx, span, end := startWriterSpan(ctx, "security_event", atom.Field)
	var err error
	defer func() { end(err) }()

	eventType, ok := securityEventTypeFor(atom.Field)
	if !ok {
		err = fmt.Errorf("securityEventWriter[security_events].%s: no event_type mapping for field", atom.Field)
		return err
	}
	span.SetAttributes(attribute.String("event_type", eventType))

	toState, err := bindSecurityEventState(atom.Value)
	if err != nil {
		return fmt.Errorf("securityEventWriter[security_events].%s: %w", atom.Field, err)
	}

	ts := atom.EmittedAt.UTC().Round(0)

	tag, err := w.db.Exec(ctx, securityEventInsertSQL, atom.VehicleID, ts, eventType, toState)
	if err != nil {
		return fmt.Errorf("securityEventWriter[security_events].%s: %w", atom.Field, err)
	}
	span.SetAttributes(attribute.Int64("rows_affected", tag.RowsAffected()))
	if tag.RowsAffected() == 1 {
		span.SetAttributes(attribute.String("outcome", "inserted"))
		return nil
	}

	// Slow path: RowsAffected==0 is ambiguous (unknown VIN OR duplicate
	// event). Disambiguate via a follow-up SELECT EXISTS on vehicles.
	// Per the VIN RESOLUTION CONTRACT this only runs on the slow path,
	// not per-write, so the steady-state cost stays at one round-trip.
	var vehicleExists bool
	if existsErr := w.db.QueryRow(ctx, securityEventVehicleExistsSQL, atom.VehicleID).Scan(&vehicleExists); existsErr != nil {
		err = fmt.Errorf("securityEventWriter[security_events].%s: disambiguation query: %w", atom.Field, existsErr)
		return err
	}
	if !vehicleExists {
		// VIN deliberately not in the message — it is PII. The
		// router's writer_failures_total{dest=security_event,
		// reason="other"} counter increments on this path; the
		// upstream MQTT subscriber log already records the
		// (topic, vehicle) context if forensic correlation is needed.
		err = fmt.Errorf("securityEventWriter[security_events].%s: vehicle not registered", atom.Field)
		return err
	}
	// Vehicle exists but RowsAffected==0 → duplicate event. Per
	// The writer is idempotent: re-delivery of the same
	// (vehicle_id, ts, event_type) is a no-op success outcome, NOT a
	// failure, so the router's writer_failures_total counter does NOT
	// increment.
	span.SetAttributes(attribute.String("outcome", "duplicate"))
	return nil
}

// bindSecurityEventState narrows codec.Atomic.Value to the textual
// to_state representation that security_events.to_state (TEXT,
// nullable per migration 000183 line 202) expects. The helper accepts
// the three value-shape categories the routed fields can produce:
//
//   - bool: the codec returns Go bool for *ftproto.Value_BooleanValue
//     per protomodel/datum_decoder_gen.go:97-98. Locked and
//     ValetModeEnabled both route here as ValueKindBool per
//     protomodel/signal_metadata_gen.go.
//
//   - string: the codec returns Go string for
//     *ftproto.Value_StringValue per protomodel/datum_decoder_gen.go:87-88.
//     No security_event field routes a string today but the case is
//     authored for forward-compatibility (e.g. a hypothetical
//     LastSecurityAlertReason TEXT routing here).
//
//   - fmt.Stringer: the codec returns the proto-generated enum type
//     directly (e.g. ftproto.SentryModeState for SentryMode per
//     protomodel/datum_decoder_gen.go:117-118). Every protobuf
//     generated enum has a String() method so the Stringer dispatch
//     handles SentryMode and any future ValueKindEnum field routed
//     here without per-enum type assertions.
//
// nil values are rejected loudly because storing SQL NULL in to_state
// for a transition row would erase the only meaningful payload of the
// event. Producers wanting to clear state should send an explicit
// sentinel (e.g. "off") rather than nil; the decision to map a
// sentinel to NULL is event-type-specific and belongs in a future
// routing extension, not the shared bind helper.
//
// Empty strings (from a string variant or from an enum's String()
// returning "") are also rejected — to_state must carry a non-empty
// token for the transition to be meaningful and for downstream
// consumers (alerts, timeline UI) to render it.
func bindSecurityEventState(v any) (string, error) {
	switch t := v.(type) {
	case bool:
		if t {
			return "true", nil
		}
		return "false", nil
	case string:
		if t == "" {
			return "", fmt.Errorf("empty string not allowed for to_state")
		}
		return t, nil
	case fmt.Stringer:
		s := t.String()
		if s == "" {
			return "", fmt.Errorf("Stringer %T returned empty string for to_state", t)
		}
		return s, nil
	case nil:
		return "", fmt.Errorf("nil value not allowed for to_state")
	default:
		return "", fmt.Errorf("unsupported value type %T (security event accepts bool, string, fmt.Stringer)", v)
	}
}
