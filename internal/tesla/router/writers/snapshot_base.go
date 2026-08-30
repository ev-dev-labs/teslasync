package writers

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"go.opentelemetry.io/otel/attribute"

	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// pgxPool is the tiny subset of *pgxpool.Pool that snapshotWriter
// depends on. Production wiring passes a *pgxpool.Pool; tests use an
// in-file recorder for only the Exec method this helper calls — see
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
// safety_snapshot, location_snapshot, security_event). Per-destination
// wrappers supply only the table name and columnFor mapping callback.
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
var _ router.BatchWriter = (*snapshotWriter)(nil)

// newSnapshotWriter validates dependencies and table identifiers at
// wiring time so typos fail at process start rather than the first
// Write call.
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
//   - atom.Value is not one of the supported scalar types
//     (numeric, bool, string): producer/codec contract drift,
//     returns error.
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
// for the field-to-column mapping. Wrappers that want to reuse
// routing.yaml's column declaration can compose a columnFor that
// closes over the loaded router.Entry map.
func (w *snapshotWriter) Write(ctx context.Context, atom codec.Atomic, dst router.Entry) error {
	_ = dst // see godoc above — column is sourced from columnFor, not dst.

	ctx, span, end := startWriterSpan(ctx, w.table, atom.Field)
	var err error
	defer func() { end(err) }()

	col, ok := w.columnFor(atom.Field)
	if !ok {
		err = fmt.Errorf("snapshotWriter[%s].%s: no column mapping for field", w.table, atom.Field)
		return err
	}
	span.SetAttributes(attribute.String("column", col), attribute.String("table", w.table))
	if !safeIdentRE.MatchString(col) {
		err = fmt.Errorf("snapshotWriter[%s].%s: invalid column identifier %q (must match %s)", w.table, atom.Field, col, safeIdentRE.String())
		return err
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
	span.SetAttributes(attribute.Int64("rows_affected", tag.RowsAffected()))
	if tag.RowsAffected() == 0 {
		// VIN deliberately not in the message — it is PII. The
		// router's writer_failures_total{dest, reason="other"}
		// counter increments on this path; the upstream MQTT
		// subscriber log already records the (topic, vehicle)
		// context if forensic correlation is needed.
		err = fmt.Errorf("snapshotWriter[%s].%s: vehicle not registered", w.table, atom.Field)
		return err
	}
	return nil
}

type snapshotBatchKey struct {
	vin string
	ts  time.Time
}

type snapshotBatchGroup struct {
	key         snapshotBatchKey
	columns     map[string]any
	itemIndexes []int
}

// WriteBatch coalesces every field sharing a (vehicle, timestamp) key into a
// single multi-column upsert. This removes the same-row lock amplification
// caused by issuing one INSERT ... ON CONFLICT per field.
func (w *snapshotWriter) WriteBatch(ctx context.Context, items []router.RoutedAtomic) []error {
	results := make([]error, len(items))
	if len(items) == 0 {
		return results
	}

	ctx, span, end := startWriterSpan(ctx, w.table, "batch")
	var batchErr error
	defer func() { end(batchErr) }()

	groups := make(map[snapshotBatchKey]*snapshotBatchGroup)
	order := make([]snapshotBatchKey, 0, len(items))
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
		if !safeIdentRE.MatchString(col) {
			results[i] = fmt.Errorf(
				"snapshotWriter[%s].%s: invalid column identifier %q (must match %s)",
				w.table,
				item.Atomic.Field,
				col,
				safeIdentRE.String(),
			)
			continue
		}
		bound, err := bindSnapshotBatchValue(item.Atomic.Value)
		if err != nil {
			results[i] = fmt.Errorf(
				"snapshotWriter[%s].%s: %w",
				w.table,
				item.Atomic.Field,
				err,
			)
			continue
		}

		key := snapshotBatchKey{
			vin: item.Atomic.VehicleID,
			ts:  item.Atomic.EmittedAt.UTC().Round(0),
		}
		group, exists := groups[key]
		if !exists {
			group = &snapshotBatchGroup{
				key:     key,
				columns: make(map[string]any),
			}
			groups[key] = group
			order = append(order, key)
		}
		group.columns[col] = bound
		group.itemIndexes = append(group.itemIndexes, i)
	}

	span.SetAttributes(
		attribute.Int("batch.items", len(items)),
		attribute.Int("batch.rows", len(order)),
	)
	for groupIndex, key := range order {
		if err := ctx.Err(); err != nil {
			batchErr = err
			for _, remainingKey := range order[groupIndex:] {
				group := groups[remainingKey]
				for _, itemIndex := range group.itemIndexes {
					if results[itemIndex] == nil {
						results[itemIndex] = err
					}
				}
			}
			return results
		}

		group := groups[key]
		columns := make([]string, 0, len(group.columns))
		for col := range group.columns {
			columns = append(columns, col)
		}
		sort.Strings(columns)

		quotedColumns := make([]string, len(columns))
		assignments := make([]string, len(columns))
		args := make([]any, 0, len(columns)+2)
		args = append(args, group.key.vin, group.key.ts)
		placeholders := make([]string, len(columns))
		for i, col := range columns {
			quoted := pgx.Identifier{col}.Sanitize()
			quotedColumns[i] = quoted
			assignments[i] = quoted + " = EXCLUDED." + quoted
			placeholders[i] = fmt.Sprintf("$%d", i+3)
			args = append(args, group.columns[col])
		}

		sql := fmt.Sprintf(
			"INSERT INTO %s (vehicle_id, ts, %s) "+
				"SELECT v.id, $2, %s FROM vehicles v WHERE v.vin = $1 "+
				"ON CONFLICT (vehicle_id, ts) DO UPDATE SET %s",
			pgx.Identifier{w.table}.Sanitize(),
			strings.Join(quotedColumns, ", "),
			strings.Join(placeholders, ", "),
			strings.Join(assignments, ", "),
		)
		tag, err := w.db.Exec(ctx, sql, args...)
		if err == nil && tag.RowsAffected() == 0 {
			err = fmt.Errorf("snapshotWriter[%s]: vehicle not registered", w.table)
		}
		if err != nil {
			if batchErr == nil {
				batchErr = err
			}
			for _, itemIndex := range group.itemIndexes {
				if results[itemIndex] == nil {
					results[itemIndex] = fmt.Errorf(
						"snapshotWriter[%s].%s: %w",
						w.table,
						items[itemIndex].Atomic.Field,
						err,
					)
				}
			}
		}
	}
	return results
}

// bindSnapshotValue narrows codec.Atomic.Value to a SQL-bindable
// scalar suitable for the snapshot tables' (vehicle_id, ts, <col>)
// INSERT shape. Compound atomics (Location lat/lng pairs, Doors flags,
// TireLocation per-corner values) are NOT routed to snapshot tables —
// they go to positions / signal_log via different writers.
//
// All numeric narrowing of signal-derived values goes through
// signal.Float64, the canonical converter. The helper covers every
// numeric kind the codec emits (float64, float32, int, int8, int16,
// int32, int64 plus unsigned counterparts) so this writer does not
// duplicate the type switch. Adding fresh `case float32:` /
// `case int32:` arms here would re-introduce divergent conversion
// behavior.
//
// Numeric snapshot columns are uniformly DOUBLE PRECISION (per
// migrations 000003 / 000016 / 000017 / 000183) so the canonical
// converter's float64 output binds correctly for every routed numeric
// destination. The lone integer column today is the gear TEXT field
// on drive_telemetry, which is intercepted by drive_telemetry_writer's
// coerceProtoEnumToText BEFORE delegation and arrives here as a
// string — the helper therefore never needs to bind raw int64 to
// snapshot columns.
//
// Bool and string are kept as explicit non-numeric arms because
// signal.Float64 deliberately treats bool as a legacy 1/0 envelope
// (signal/coerce.go:94-101) — promoting an unrelated boolean snapshot
// column to a numeric 1.0 binding would silently corrupt the column.
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
	case nil:
		return nil, fmt.Errorf("nil value not allowed in snapshot write")
	case bool:
		return t, nil
	case string:
		return t, nil
	}
	if f, ok := signal.Float64(v); ok {
		return f, nil
	}
	return nil, fmt.Errorf("unsupported value type %T (snapshot helper accepts bool, string, and any signal.Float64-coercible numeric)", v)
}

func bindSnapshotBatchValue(v any) (any, error) {
	if ts, ok := v.(time.Time); ok {
		return ts.UTC().Round(0), nil
	}
	return bindSnapshotValue(v)
}
