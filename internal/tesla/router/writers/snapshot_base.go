package writers

import (
	"context"
	"fmt"
	"regexp"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// pgxPool is the tiny subset of *pgxpool.Pool that snapshotWriter
// depends on. Production wiring passes a *pgxpool.Pool; the package's
// tests pass a recording fake. The interface stays minimal because the
// project does NOT vendor pgxmock or any equivalent SQL recorder, and
// the prompt's escape hatch (phase-42a/0010) explicitly allows an
// in-file recorder of just the Exec method the helper calls — see
// snapshot_base_test.go.
type pgxPool interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// safeIdentRE bounds the table and column identifier strings the
// helper interpolates into SQL via pgx.Identifier{}.Sanitize().
// pgx.Identifier already double-quotes and escapes embedded quotes,
// but a constructor-time allowlist on the unquoted form catches
// programmer errors (typos, embedded spaces, dot-paths) at startup
// rather than at the first Write call. The pattern matches the
// snake_case table/column names used by migrations 000182-000188 —
// any future widening (e.g. schema-qualified names) requires touching
// this regex AND the surrounding Identifier{} composition.
var safeIdentRE = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)

// snapshotWriter is the shared INSERT helper for the seven snapshot
// destinations declared in router.types.go (climate_snapshot,
// motor_snapshot, tire_pressure_snapshot, media_snapshot,
// safety_snapshot, location_snapshot, security_event). Per phase-42a
// prompt 0010 the struct shape is LOCKED — db, table, columnFor —
// and the per-destination wrappers in 0012-0018 supply only the
// table name and the columnFor mapping callback.
//
// columnFor maps codec.Atomic.Field to the destination column name
// (e.g. "InsideTemp" -> "inside_temp_c" for climate_snapshot). The
// callback returning ok=false means the writer has no column for
// the field; in production this is "should never happen" because
// routing.yaml guarantees every routed Field has a matching
// destination, but the writer fails LOUDLY rather than silently
// skipping so a regression is observable via the router's
// writer_failures_total counter.
//
// Concurrency: a *snapshotWriter holds no per-Write mutable state.
// All three fields are set at construction and read-only thereafter,
// so the value is safe for concurrent use across the pipeline's
// goroutines.
type snapshotWriter struct {
	db        pgxPool
	table     string
	columnFor func(field string) (col string, ok bool)
}

// Compile-time assertion that *snapshotWriter satisfies the
// router.Writer interface. A signature drift in router.Writer would
// fail the build here rather than the first integration test.
var _ router.Writer = (*snapshotWriter)(nil)

// newSnapshotWriter is the unexported constructor consumed by the
// per-destination wrappers in 0012-0018. The validation pass refuses
// nil dependencies and rejects table identifiers that don't match
// safeIdentRE so a typo at wiring time fails at process start
// rather than the first Write call.
func newSnapshotWriter(db pgxPool, table string, columnFor func(field string) (col string, ok bool)) (*snapshotWriter, error) {
	if db == nil {
		return nil, fmt.Errorf("snapshotWriter: db must be non-nil")
	}
	if !safeIdentRE.MatchString(table) {
		return nil, fmt.Errorf("snapshotWriter: invalid table identifier %q (must match %s)", table, safeIdentRE.String())
	}
	if columnFor == nil {
		return nil, fmt.Errorf("snapshotWriter: columnFor must be non-nil")
	}
	return &snapshotWriter{db: db, table: table, columnFor: columnFor}, nil
}

// Write implements router.Writer for the *_snapshot family.
//
// The SQL is a per-column upsert under the natural key
// (vehicle_id, ts):
//
//	INSERT INTO <table> (vehicle_id, ts, <col>)
//	SELECT v.id, $2, $3 FROM vehicles v WHERE v.vin = $1
//	ON CONFLICT (vehicle_id, ts) DO UPDATE SET <col> = EXCLUDED.<col>
//
// The numeric vehicle_id BIGINT (the snapshot tables' natural-key
// component) is resolved by the SELECT against vehicles.vin (which
// migration 000142 declares NOT NULL UNIQUE) so the writer can stay
// at the codec.Atomic boundary without taking the int64 explicitly.
// The router.Writer interface itself remains unchanged.
//
// Two atomics for the same (vehicle_id, ts) carrying different
// fields (e.g. InsideTemp + OutsideTemp at the same payload
// CreatedAt) produce ONE row with both columns set, not two —
// the per-column DO UPDATE preserves any previously-written
// columns on the same row. Same-field re-deliveries are
// idempotent: the EXCLUDED side carries the same value, the row
// stays byte-identical.
//
// Failure modes (per ADR-004 #8 these are surfaced to the router
// caller — they MUST NOT propagate to MQTT redelivery):
//
//   - columnFor(atom.Field) returns ok=false: routing/columnFor
//     drift, returns error so the router increments
//     writer_failures_total and the operator alert fires.
//
//   - atom.Value is not one of the four LOCKED scalar types
//     (float64, int64, bool, string): producer/codec contract
//     drift, returns error.
//
//   - db.Exec returns an error: backend transient or schema drift,
//     wrapped with the snapshotWriter[<table>].<field> prefix so
//     the router's classifyError tag set picks up timeouts /
//     cancellations from the wrapped chain.
//
//   - tag.RowsAffected() == 0: the VIN is not registered in
//     vehicles. Returns a typed error WITHOUT the VIN in the
//     message (the VIN is PII; the upstream subscriber log
//     already records vehicle context).
//
// dst is part of the Writer interface contract but the snapshot
// helper deliberately does NOT consult dst.Column — the columnFor
// callback supplied at construction is the single source of truth
// for the field-to-column mapping per phase-42a prompt 0010
// decision #2. Wrappers that want to reuse routing.yaml's column
// declaration can compose a columnFor that closes over the loaded
// router.Entry map.
func (w *snapshotWriter) Write(ctx context.Context, atom codec.Atomic, dst router.Entry) error {
	_ = dst // see godoc above — column is sourced from columnFor, not dst.

	col, ok := w.columnFor(atom.Field)
	if !ok {
		return fmt.Errorf("snapshotWriter[%s].%s: no column mapping for field", w.table, atom.Field)
	}
	if !safeIdentRE.MatchString(col) {
		return fmt.Errorf("snapshotWriter[%s].%s: invalid column identifier %q (must match %s)", w.table, atom.Field, col, safeIdentRE.String())
	}

	bound, err := bindSnapshotValue(atom.Value)
	if err != nil {
		return fmt.Errorf("snapshotWriter[%s].%s: %w", w.table, atom.Field, err)
	}

	qTable := pgx.Identifier{w.table}.Sanitize()
	qCol := pgx.Identifier{col}.Sanitize()

	sql := fmt.Sprintf(
		"INSERT INTO %s (vehicle_id, ts, %s) "+
			"SELECT v.id, $2, $3 FROM vehicles v WHERE v.vin = $1 "+
			"ON CONFLICT (vehicle_id, ts) DO UPDATE SET %s = EXCLUDED.%s",
		qTable, qCol, qCol, qCol,
	)

	tag, err := w.db.Exec(ctx, sql, atom.VehicleID, atom.EmittedAt, bound)
	if err != nil {
		return fmt.Errorf("snapshotWriter[%s].%s: %w", w.table, atom.Field, err)
	}
	if tag.RowsAffected() == 0 {
		// VIN deliberately not in the message — it is PII. The
		// router's writer_failures_total{dest, reason="other"}
		// counter increments on this path; the upstream MQTT
		// subscriber log already records the (topic, vehicle)
		// context if forensic correlation is needed.
		return fmt.Errorf("snapshotWriter[%s].%s: vehicle not registered", w.table, atom.Field)
	}
	return nil
}

// bindSnapshotValue narrows codec.Atomic.Value to the four scalar
// types LOCKED by phase-42a prompt 0010 decision #4. Compound
// atomics (Location lat/lng pairs, Doors flags, TireLocation per-
// corner values) are NOT routed to snapshot tables — they go to
// positions / signal_log via different writers — so the helper
// deliberately rejects everything outside the four types instead of
// silently coercing.
//
// nil values are rejected loudly because the snapshot tables'
// per-column upsert would happily write SQL NULL and overwrite a
// previously-recorded value, which is almost never the producer's
// intent. Producers wanting to clear a field send a sentinel
// (e.g. an empty string or a zero numeric); the decision to map
// that sentinel to NULL belongs to the per-destination wrapper, not
// the shared helper.
func bindSnapshotValue(v any) (any, error) {
	switch t := v.(type) {
	case float64:
		return t, nil
	case int64:
		return t, nil
	case bool:
		return t, nil
	case string:
		return t, nil
	case nil:
		return nil, fmt.Errorf("nil value not allowed in snapshot write")
	default:
		return nil, fmt.Errorf("unsupported value type %T (snapshot helper accepts float64, int64, bool, string)", v)
	}
}
