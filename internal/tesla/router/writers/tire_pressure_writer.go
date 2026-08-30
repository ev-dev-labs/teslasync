package writers

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel/attribute"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// tirePressureColumnByField is the static field→column map for
// destination tire_pressure_snapshot. Built at file-edit time from
// routing.yaml entries with `dest: tire_pressure_snapshot`.
//
// The 8 routed fields decompose into TWO families that the writer
// must persist DIFFERENTLY:
//
//   - 4 pressure routes (TpmsPressure{Fl,Fr,Rl,Rr}) — UnitKindPressure,
//     normalize.toSI converts wire psi/bar to Pascals; the value
//     arrives at the writer as a bare float64 in Pa and lands in
//     {front,rear}_{left,right}_pa (DOUBLE PRECISION). These are
//     handled by the embedded snapshotWriter.
//
//   - 4 last-seen routes (TpmsLastSeenPressureTime{Fl,Fr,Rl,Rr}) —
//     UnitKindNone, ValueKindFloat. normalize.toSI is a pass-through;
//     the value arrives as a bare float64 unix epoch in seconds and
//     must be persisted into a TIMESTAMPTZ column. routing.yaml
//     lines 917-922 explicitly assign the epoch→TIMESTAMPTZ
//     conversion to THIS writer:
//
//     "the tire_pressure_snapshots writer converts to TIMESTAMPTZ
//     when populating the per-corner *_last_seen_at columns.
//     UnitKindNone so normalize.toSI is a pass-through — the
//     writer owns the epoch→timestamp conversion."
//
//     snapshotWriter.bindSnapshotValue rejects time.Time, so the
//     timestamp branch CANNOT delegate; it implements its own
//     INSERT path that mirrors snapshot_base.go byte-for-byte
//     except for the time.Time bind. See writeTimestamp below.
//
// This map is a static declaration, not a runtime read of routing.yaml:
// the routing layer's loader already validated every entry at process
// start, the per-payload hot path must not re-parse a 1000-line
// YAML file, and a compile-time declaration here lets the reflective
// coverage test in tire_pressure_writer_test.go catch any drift
// between routing.yaml and this file at CI time rather than at the
// first Write call.
//
// New routes are added by:
//
//  1. appending the entry to routing.yaml under
//     `dest: tire_pressure_snapshot`,
//  2. adding (and verifying) the matching column in
//     migrations/000183_snapshots_si.up.sql,
//  3. adding the entry below in the same commit, and
//  4. if the new column is TIMESTAMPTZ, adding the column to
//     tirePressureTimestampColumns so the timestamp branch picks it up.
//
// The reflective coverage test fails until step 3 lands, which is
// the intended check.
//
// Per-corner suffix convention: Fl=front-left, Fr=front-right,
// Rl=rear-left, Rr=rear-right. The Semi tractor's dual-rear-axle
// per-tyre fields (Re1L0/Re1L1/... per routing.yaml lines 760-770)
// are NOT routed here — they land in signal_log because
// tire_pressure_snapshots only models the four passenger-car
// corners.
var tirePressureColumnByField = map[string]string{
	"TpmsLastSeenPressureTimeFl": "front_left_last_seen_at",
	"TpmsLastSeenPressureTimeFr": "front_right_last_seen_at",
	"TpmsLastSeenPressureTimeRl": "rear_left_last_seen_at",
	"TpmsLastSeenPressureTimeRr": "rear_right_last_seen_at",
	"TpmsPressureFl":             "front_left_pa",
	"TpmsPressureFr":             "front_right_pa",
	"TpmsPressureRl":             "rear_left_pa",
	"TpmsPressureRr":             "rear_right_pa",
}

// tirePressureTimestampColumns is the closed set of TIMESTAMPTZ
// columns owned by this writer. Membership in this set causes Write
// to take the writeTimestamp branch instead of delegating to
// snapshotWriter (which only binds float64/int64/bool/string).
//
// The set is keyed on the COLUMN name (not the field name) so that
// the dispatch is decoupled from the producer-side proto field
// identifier — adding a new TIMESTAMPTZ corner column requires
// updating this set in addition to tirePressureColumnByField, but
// adding e.g. an ABS-pressure column does not.
//
// Kept in sync with migrations/000183_snapshots_si.up.sql lines
// 243-246 (the four *_last_seen_at TIMESTAMPTZ columns). If
// migration 000183 ever adds another TIMESTAMPTZ column to
// tire_pressure_snapshots that this writer routes, add it here.
var tirePressureTimestampColumns = map[string]struct{}{
	"front_left_last_seen_at":  {},
	"front_right_last_seen_at": {},
	"rear_left_last_seen_at":   {},
	"rear_right_last_seen_at":  {},
}

// tirePressureColumnFor is the columnFor callback supplied to
// snapshotWriter. It closes over tirePressureColumnByField so the
// snapshot helper has a single
// source-of-truth lookup; ok=false is returned for any field NOT
// routed here (the snapshot helper then errors out loudly per its
// drop-loud contract — see snapshot_base.go's columnFor godoc).
func tirePressureColumnFor(field string) (string, bool) {
	col, ok := tirePressureColumnByField[field]
	return col, ok
}

// tirePressureWriter is the router.Writer for destination
// tire_pressure_snapshot. It composes snapshotWriter for the four
// pressure (DOUBLE PRECISION) routes and implements its own INSERT path
// for the four last_seen_at (TIMESTAMPTZ) routes because snapshotWriter
// rejects time.Time bindings.
//
// The timestamp branch deliberately mirrors snapshot_base.go's SQL
// shape, identifier sanitisation, error-wrapping format, and
// PII-clean RowsAffected==0 message byte-for-byte (modulo the
// time.Time bind). This keeps the router's writer_failures_total
// classifier and operator slow-query log expectations stable across
// both branches.
//
// Concurrency: holds only immutable fields after construction.
// snapshotWriter has its own no-mutable-state guarantee, *pgxpool.Pool
// is thread-safe, and the static maps are read-only after init. Safe
// for concurrent Write calls across the pipeline goroutines.
type tirePressureWriter struct {
	snap      *snapshotWriter
	db        pgxPool
	table     string
	columnFor func(field string) (col string, ok bool)
}

// Compile-time assertion that *tirePressureWriter satisfies the
// router.Writer interface. A signature drift in router.Writer would
// fail the build here rather than the first integration test.
var _ router.Writer = (*tirePressureWriter)(nil)
var _ router.BatchWriter = (*tirePressureWriter)(nil)

// Write implements router.Writer for destination tire_pressure_snapshot.
//
// Dispatch:
//
//   - Field NOT in tirePressureColumnByField → "no column mapping for
//     field" error, no DB write. Same loud-drop semantics as
//     snapshotWriter.
//
//   - Routed field whose column IS in tirePressureTimestampColumns →
//     writeTimestamp (epoch float64 → time.Time → TIMESTAMPTZ).
//
//   - Routed field whose column is NOT a TIMESTAMPTZ → delegated to
//     the embedded snapshotWriter (binds float64/int64/bool/string
//     directly).
//
// The Field-vs-column dispatch lookup intentionally goes through
// w.columnFor (not the package-level map) so that future test
// scaffolding that injects an alternative columnFor automatically
// gets the same dispatch behaviour.
func (w *tirePressureWriter) Write(ctx context.Context, atom codec.Atomic, dst router.Entry) error {
	col, ok := w.columnFor(atom.Field)
	if !ok {
		return fmt.Errorf("snapshotWriter[%s].%s: no column mapping for field", w.table, atom.Field)
	}
	if _, isTS := tirePressureTimestampColumns[col]; isTS {
		return w.writeTimestamp(ctx, atom, col)
	}
	return w.snap.Write(ctx, atom, dst)
}

func (w *tirePressureWriter) WriteBatch(ctx context.Context, items []router.RoutedAtomic) []error {
	results := make([]error, len(items))
	valid := make([]router.RoutedAtomic, 0, len(items))
	validIndexes := make([]int, 0, len(items))
	for i, item := range items {
		col, ok := w.columnFor(item.Atomic.Field)
		if !ok {
			results[i] = fmt.Errorf(
				"snapshotWriter[%s].%s: no column mapping for field",
				w.table,
				item.Atomic.Field,
			)
			continue
		}
		if _, isTimestamp := tirePressureTimestampColumns[col]; isTimestamp {
			value, err := coerceEpochToTime(item.Atomic.Value)
			if err != nil {
				results[i] = fmt.Errorf(
					"snapshotWriter[%s].%s: %w",
					w.table,
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

// writeTimestamp persists a float64 unix-epoch atomic into a
// TIMESTAMPTZ column. The SQL shape, identifier sanitisation,
// error-wrapping prefix, and PII-clean unknown-vehicle handling
// mirror snapshot_base.go byte-for-byte so the two branches are
// indistinguishable to operator tooling (slow-query logs, the
// router's classifyError tag set).
//
// Value contract:
//
//   - Accepts float64 only. int64 / string / bool / nil produce
//     an "unsupported value type" error mirroring
//     snapshot_base.bindSnapshotValue's loud-reject contract. The
//     codec emits ValueKindFloat for these fields per
//     protomodel.SignalsByName (UnitKind=UnitKindNone), so anything
//     else is a producer/codec contract drift.
//
//   - NaN, +Inf, -Inf, and negative epochs are rejected (a TPMS
//     "last seen" timestamp before the unix epoch is never valid).
//     Zero epoch is intentionally accepted: routing.yaml does not
//     constrain it as a sentinel and rejecting it would silently
//     drop a "never-seen" marker that a downstream consumer might
//     legitimately want to observe.
//
//   - Sub-second precision is preserved via math.Modf + math.Round
//     so a fractional float64 epoch (e.g. 1746541200.25) lands as
//     a time.Time with the correct nanoseconds — important because
//     ValueKindFloat does not lose information at the codec
//     boundary. The .UTC() canonicalisation matches the rest of
//     the writer family (positions, snapshot_base) and keeps
//     server-local timezone configuration from leaking into
//     stored timestamps.
func (w *tirePressureWriter) writeTimestamp(ctx context.Context, atom codec.Atomic, col string) error {
	ctx, span, end := startWriterSpan(ctx, "tire_pressure_snapshot", atom.Field)
	var err error
	defer func() { end(err) }()

	span.SetAttributes(attribute.String("column", col), attribute.String("table", w.table), attribute.String("path", "timestamp"))

	if !safeIdentRE.MatchString(col) {
		err = fmt.Errorf("snapshotWriter[%s].%s: invalid column identifier %q (must match %s)", w.table, atom.Field, col, safeIdentRE.String())
		return err
	}

	ts, err := coerceEpochToTime(atom.Value)
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

	tag, err := w.db.Exec(ctx, sql, atom.VehicleID, atom.EmittedAt, ts)
	if err != nil {
		return fmt.Errorf("snapshotWriter[%s].%s: %w", w.table, atom.Field, err)
	}
	span.SetAttributes(attribute.Int64("rows_affected", tag.RowsAffected()))
	if tag.RowsAffected() == 0 {
		// VIN deliberately not in the message — it is PII. Same
		// PII-clean error as snapshot_base.go so the router's
		// writer_failures_total{dest, reason="other"} counter
		// increments on a single, recognisable error.
		err = fmt.Errorf("snapshotWriter[%s].%s: vehicle not registered", w.table, atom.Field)
		return err
	}
	return nil
}

// coerceEpochToTime narrows codec.Atomic.Value to a unix-epoch float64
// and returns the equivalent time.Time in UTC. All rejection paths
// return an error whose wording matches snapshotWriter.bindSnapshotValue
// for "unsupported value type" so existing classifier tests treat both
// branches identically.
//
// math.Modf splits whole and fractional parts before scaling to
// nanoseconds. math.Round on the fractional part avoids systematic
// truncation when the float64 is very close to a second boundary,
// and the nsec==1e9 carry handles the round-up-to-next-second edge
// case so the returned time.Time is canonicalised.
func coerceEpochToTime(v any) (time.Time, error) {
	f, ok := v.(float64)
	if !ok {
		return time.Time{}, fmt.Errorf("unsupported value type %T (tire_pressure timestamp helper accepts float64 unix epoch seconds)", v)
	}
	if math.IsNaN(f) {
		return time.Time{}, fmt.Errorf("invalid epoch value: NaN")
	}
	if math.IsInf(f, 0) {
		return time.Time{}, fmt.Errorf("invalid epoch value: Inf")
	}
	if f < 0 {
		return time.Time{}, fmt.Errorf("invalid epoch value: %g (must be non-negative)", f)
	}
	if f > float64(math.MaxInt64) {
		return time.Time{}, fmt.Errorf("invalid epoch value: %g (overflows int64 seconds)", f)
	}
	whole, frac := math.Modf(f)
	sec := int64(whole)
	nsec := int64(math.Round(frac * 1e9))
	if nsec >= 1_000_000_000 {
		sec++
		nsec -= 1_000_000_000
	}
	return time.Unix(sec, nsec).UTC(), nil
}

// NewTirePressureWriter constructs the production tire-pressure
// snapshot writer for destination tire_pressure_snapshot.
//
// The writer composes snapshotWriter for the four
// pressure (DOUBLE PRECISION) routes; the four last_seen_at
// (TIMESTAMPTZ) routes are owned by writeTimestamp because
// snapshotWriter rejects time.Time bindings. See
// tire_pressure_writer.go's package doc and routing.yaml lines
// 917-922 for the contract.
//
// All 8 routed fields resolve to a column; the compile-time map
// plus the reflective coverage test together guarantee
// routing.yaml ↔ writer alignment.
//
// A nil pool is a wiring bug and panics at process start so the
// failure is surfaced before any payload is processed. Same panic
// pattern as NewClimateWriter / NewMotorWriter / NewPositionsWriter.
//
// snapshotWriter constructor errors are also fatal — they indicate
// a programmer typo in the table identifier or a nil columnFor —
// neither of which is a runtime-recoverable condition. The panic
// message includes the wrapped error so the operator can correlate.
func NewTirePressureWriter(pool *pgxpool.Pool) router.Writer {
	if pool == nil {
		panic("NewTirePressureWriter: pool must be non-nil")
	}
	snap, err := newSnapshotWriter(pool, "tire_pressure_snapshots", tirePressureColumnFor)
	if err != nil {
		panic(fmt.Sprintf("NewTirePressureWriter: %v", err))
	}
	return &tirePressureWriter{
		snap:      snap,
		db:        pool,
		table:     "tire_pressure_snapshots",
		columnFor: tirePressureColumnFor,
	}
}
