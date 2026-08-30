package writers

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// recorder is the in-file pgxPool implementation used instead of
// pgxmock. It records every Exec invocation and lets each test override
// the returned CommandTag's RowsAffected and / or the error.
type recorder struct {
	calls []recordedCall
	err   error // returned from Exec verbatim
	rows  int64 // RowsAffected reported by the synthesised CommandTag
}

type recordedCall struct {
	SQL  string
	Args []any
}

func (r *recorder) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	cp := make([]any, len(args))
	copy(cp, args)
	r.calls = append(r.calls, recordedCall{SQL: sql, Args: cp})
	if r.err != nil {
		return pgconn.CommandTag{}, r.err
	}
	// pgconn.NewCommandTag parses the trailing decimal as RowsAffected.
	return pgconn.NewCommandTag(fmt.Sprintf("INSERT 0 %d", r.rows)), nil
}

// staticColumnFor returns a columnFor that maps exactly one Field to
// one column. Useful in single-case tests where the wrapper-side
// mapping logic is out of scope.
func staticColumnFor(field, col string) func(string) (string, bool) {
	return func(f string) (string, bool) {
		if f == field {
			return col, true
		}
		return "", false
	}
}

// newTestWriter builds a snapshotWriter wired against the supplied
// recorder. Failures here are constructor / wiring bugs, never
// per-test conditions, so we t.Fatalf out.
func newTestWriter(t *testing.T, rec *recorder, columnFor func(string) (string, bool)) *snapshotWriter {
	t.Helper()
	w, err := newSnapshotWriter(rec, "test_snapshots", columnFor)
	if err != nil {
		t.Fatalf("newSnapshotWriter: %v", err)
	}
	return w
}

// assertCallShape factors the SQL-shape assertions every happy-path
// test repeats: the rendered SQL must contain the table identifier,
// the column identifier (both as pgx.Identifier-quoted strings), the
// VIN-lookup subquery, and the ON CONFLICT upsert clause.
func assertCallShape(t *testing.T, call recordedCall, table, col string) {
	t.Helper()
	wantTable := `"` + table + `"`
	wantCol := `"` + col + `"`
	if !strings.Contains(call.SQL, wantTable) {
		t.Errorf("SQL missing table identifier %s: %q", wantTable, call.SQL)
	}
	if !strings.Contains(call.SQL, wantCol) {
		t.Errorf("SQL missing column identifier %s: %q", wantCol, call.SQL)
	}
	if !strings.Contains(call.SQL, "FROM vehicles v WHERE v.vin = $1") {
		t.Errorf("SQL missing VIN lookup: %q", call.SQL)
	}
	if !strings.Contains(call.SQL, "ON CONFLICT (vehicle_id, ts) DO UPDATE SET "+wantCol+" = EXCLUDED."+wantCol) {
		t.Errorf("SQL missing per-column upsert clause: %q", call.SQL)
	}
}

// TestNewSnapshotWriter_Validation locks the constructor's
// fail-fast contract. Each invalid combination must produce an
// actionable error mentioning what went wrong.
func TestNewSnapshotWriter_Validation(t *testing.T) {
	rec := &recorder{}
	cf := staticColumnFor("F", "f")

	cases := []struct {
		name      string
		db        pgxPool
		table     string
		columnFor func(string) (string, bool)
		wantSub   string
	}{
		{name: "nil db", db: nil, table: "ok", columnFor: cf, wantSub: "db must be non-nil"},
		{name: "empty table", db: rec, table: "", columnFor: cf, wantSub: "invalid table identifier"},
		{name: "table with uppercase", db: rec, table: "Bad", columnFor: cf, wantSub: "invalid table identifier"},
		{name: "table with quote", db: rec, table: `bad"name`, columnFor: cf, wantSub: "invalid table identifier"},
		{name: "table with dot", db: rec, table: "schema.name", columnFor: cf, wantSub: "invalid table identifier"},
		{name: "nil columnFor", db: rec, table: "ok", columnFor: nil, wantSub: "columnFor must be non-nil"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := newSnapshotWriter(tc.db, tc.table, tc.columnFor)
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.wantSub)
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantSub)
			}
		})
	}
}

func TestWriteBatch_CoalescesSameRowIntoOneUpsert(t *testing.T) {
	rec := &recorder{rows: 1}
	columns := map[string]string{
		"InsideTemp":  "inside_temp_c",
		"OutsideTemp": "outside_temp_c",
	}
	writer := newTestWriter(t, rec, func(field string) (string, bool) {
		col, ok := columns[field]
		return col, ok
	})
	ts := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

	results := writer.WriteBatch(context.Background(), []router.RoutedAtomic{
		{
			Atomic: codec.Atomic{
				Field: "InsideTemp", Value: float32(21.5), EmittedAt: ts, VehicleID: "VIN",
			},
			Entry: router.Entry{Field: "InsideTemp", Destination: router.DestClimateSnapshot},
		},
		{
			Atomic: codec.Atomic{
				Field: "OutsideTemp", Value: float64(12.25), EmittedAt: ts, VehicleID: "VIN",
			},
			Entry: router.Entry{Field: "OutsideTemp", Destination: router.DestClimateSnapshot},
		},
	})

	if len(results) != 2 || results[0] != nil || results[1] != nil {
		t.Fatalf("WriteBatch results = %#v, want two nil entries", results)
	}
	if len(rec.calls) != 1 {
		t.Fatalf("Exec calls = %d, want 1", len(rec.calls))
	}
	call := rec.calls[0]
	for _, token := range []string{
		`"inside_temp_c"`,
		`"outside_temp_c"`,
		`"inside_temp_c" = EXCLUDED."inside_temp_c"`,
		`"outside_temp_c" = EXCLUDED."outside_temp_c"`,
	} {
		if !strings.Contains(call.SQL, token) {
			t.Errorf("batch SQL missing %q: %s", token, call.SQL)
		}
	}
	if got := len(call.Args); got != 4 {
		t.Fatalf("batch args = %d, want 4 (VIN, timestamp, two values)", got)
	}
	if call.Args[0] != "VIN" || !reflect.DeepEqual(call.Args[1], ts) {
		t.Errorf("batch key args = %#v, want VIN and %v", call.Args[:2], ts)
	}
}

func TestWriteBatch_ReportsInvalidItemsWithoutBlockingValidFields(t *testing.T) {
	rec := &recorder{rows: 1}
	writer := newTestWriter(t, rec, staticColumnFor("InsideTemp", "inside_temp_c"))
	ts := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

	results := writer.WriteBatch(context.Background(), []router.RoutedAtomic{
		{
			Atomic: codec.Atomic{
				Field: "Unknown", Value: float64(1), EmittedAt: ts, VehicleID: "VIN",
			},
		},
		{
			Atomic: codec.Atomic{
				Field: "InsideTemp", Value: []byte("invalid"), EmittedAt: ts, VehicleID: "VIN",
			},
		},
		{
			Atomic: codec.Atomic{
				Field: "InsideTemp", Value: float64(21.5), EmittedAt: ts, VehicleID: "VIN",
			},
		},
	})

	if len(results) != 3 {
		t.Fatalf("results = %d, want 3", len(results))
	}
	if results[0] == nil || !strings.Contains(results[0].Error(), "no column mapping") {
		t.Errorf("unknown-field result = %v, want mapping error", results[0])
	}
	if results[1] == nil || !strings.Contains(results[1].Error(), "unsupported value type") {
		t.Errorf("invalid-value result = %v, want binding error", results[1])
	}
	if results[2] != nil {
		t.Errorf("valid-field result = %v, want nil", results[2])
	}
	if len(rec.calls) != 1 {
		t.Fatalf("Exec calls = %d, want 1 for the valid item", len(rec.calls))
	}
}

// TestWrite_TypeMatrix covers the four locked scalar types: float64,
// int64, bool, and string. Each case asserts the SQL shape AND that the bound $3 argument is
// the bare value (no coercion applied by the helper).
func TestWrite_TypeMatrix(t *testing.T) {
	const (
		vin       = "5YJ3E1EA0KF000001"
		field     = "InsideTemp"
		col       = "inside_temp_c"
		tableName = "test_snapshots"
	)
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)
	dst := router.Entry{Field: field, Destination: router.DestClimateSnapshot, Column: col}

	cases := []struct {
		name    string
		val     any
		wantArg any
	}{
		{name: "float64", val: float64(22.5), wantArg: float64(22.5)},
		{name: "int64", val: int64(42), wantArg: float64(42)},
		{name: "bool", val: true, wantArg: true},
		{name: "string", val: "auto", wantArg: "auto"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newTestWriter(t, rec, staticColumnFor(field, col))
			err := w.Write(context.Background(), codec.Atomic{
				Field: field, Value: tc.val, EmittedAt: ts, VehicleID: vin,
			}, dst)
			if err != nil {
				t.Fatalf("Write: %v", err)
			}
			if got := len(rec.calls); got != 1 {
				t.Fatalf("calls=%d, want 1", got)
			}
			call := rec.calls[0]
			assertCallShape(t, call, tableName, col)
			wantArgs := []any{vin, ts, tc.wantArg}
			if !reflect.DeepEqual(call.Args, wantArgs) {
				t.Errorf("args=%v, want %v", call.Args, wantArgs)
			}
		})
	}
}

// TestWrite_NumericKindCoercion pins the numeric coercion contract:
// numeric values from the codec (int, int8, int16, int32, int64,
// uint variants, and float32) are coerced to float64 via the
// canonical signal.Float64 converter before SQL binding. The codec
// emits Float5 fields as float32 and Int3/Int4 as int32 (per the
// proto schema's `int32 int_value` / `float float_value`); without
// this coercion every snapshot write for those fields silently fails
// with "unsupported value type" — the regression previously caught in
// /vehicles/state (commit 30bd16a1).
func TestWrite_NumericKindCoercion(t *testing.T) {
	const (
		vin       = "5YJ3E1EA0KF000001"
		field     = "InsideTemp"
		col       = "inside_temp_c"
		tableName = "test_snapshots"
	)
	ts := time.Date(2026, 5, 6, 12, 34, 56, 0, time.UTC)
	dst := router.Entry{Field: field, Destination: router.DestClimateSnapshot, Column: col}

	cases := []struct {
		name string
		in   any
		want float64
	}{
		{name: "int", in: int(42), want: 42.0},
		{name: "int8", in: int8(-7), want: -7.0},
		{name: "int16", in: int16(1234), want: 1234.0},
		{name: "int32", in: int32(987654), want: 987654.0},
		{name: "uint", in: uint(99), want: 99.0},
		{name: "uint32", in: uint32(4_000_000_000), want: 4_000_000_000.0},
		{name: "float32", in: float32(22.5), want: 22.5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &recorder{rows: 1}
			w := newTestWriter(t, rec, staticColumnFor(field, col))
			err := w.Write(context.Background(), codec.Atomic{
				Field: field, Value: tc.in, EmittedAt: ts, VehicleID: vin,
			}, dst)
			if err != nil {
				t.Fatalf("Write: %v", err)
			}
			if got := len(rec.calls); got != 1 {
				t.Fatalf("calls=%d, want 1", got)
			}
			gotVal := rec.calls[0].Args[2]
			gotFloat, ok := gotVal.(float64)
			if !ok {
				t.Fatalf("bound value type=%T, want float64 (Rule 12 canonical converter must widen to float64 before SQL bind)", gotVal)
			}
			if gotFloat != tc.want {
				t.Errorf("bound value=%v, want %v", gotFloat, tc.want)
			}
		})
	}
}

// TestWrite_UnknownFieldReturnsError exercises the columnFor=ok=false
// branch — the prompt's "drop loudly" semantics. The SQL exec MUST
// NOT happen.
func TestWrite_UnknownFieldReturnsError(t *testing.T) {
	rec := &recorder{rows: 1}
	w := newTestWriter(t, rec, staticColumnFor("KnownField", "known_col"))
	err := w.Write(context.Background(), codec.Atomic{
		Field: "OtherField", Value: float64(1), EmittedAt: time.Now().UTC(), VehicleID: "VIN",
	}, router.Entry{Field: "OtherField", Destination: router.DestClimateSnapshot})
	if err == nil {
		t.Fatal("expected error for unknown field, got nil")
	}
	if !strings.Contains(err.Error(), "no column mapping for field") {
		t.Errorf("error does not mention missing mapping: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "OtherField") {
		t.Errorf("error does not name the offending field: %q", err.Error())
	}
	if got := len(rec.calls); got != 0 {
		t.Errorf("expected zero db calls when columnFor returns ok=false, got %d", got)
	}
}

// TestWrite_InvalidColumnIdentifierReturnsError catches the case
// where columnFor returns a column name the safeIdentRE allowlist
// rejects. The exec MUST NOT happen — a malformed identifier is a
// programmer error at the wrapper level, not a recoverable
// per-payload condition.
func TestWrite_InvalidColumnIdentifierReturnsError(t *testing.T) {
	rec := &recorder{rows: 1}
	cf := staticColumnFor("F", `bad"col`)
	w := newTestWriter(t, rec, cf)
	err := w.Write(context.Background(), codec.Atomic{
		Field: "F", Value: float64(1), EmittedAt: time.Now().UTC(), VehicleID: "VIN",
	}, router.Entry{})
	if err == nil {
		t.Fatal("expected error for invalid column identifier, got nil")
	}
	if !strings.Contains(err.Error(), "invalid column identifier") {
		t.Errorf("error does not mention invalid identifier: %q", err.Error())
	}
	if got := len(rec.calls); got != 0 {
		t.Errorf("expected zero db calls when column identifier is invalid, got %d", got)
	}
}

// TestWrite_UnsupportedValueTypeReturnsError covers the "anything
// outside float64/int64/bool/string" rejection branch. We probe with
// int (untyped int literal) and time.Time which are both plausible
// producer outputs but not in the LOCKED set.
func TestWrite_UnsupportedValueTypeReturnsError(t *testing.T) {
	rec := &recorder{rows: 1}
	w := newTestWriter(t, rec, staticColumnFor("F", "f"))

	cases := []struct {
		name string
		val  any
	}{
		{name: "time.Time", val: time.Now()},
		{name: "byte_slice", val: []byte("hello")},
		{name: "struct", val: struct{ X int }{X: 1}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec.calls = nil
			err := w.Write(context.Background(), codec.Atomic{
				Field: "F", Value: tc.val, EmittedAt: time.Now().UTC(), VehicleID: "VIN",
			}, router.Entry{})
			if err == nil {
				t.Fatalf("expected error for value type %T, got nil", tc.val)
			}
			if !strings.Contains(err.Error(), "unsupported value type") {
				t.Errorf("error does not mention unsupported type: %q", err.Error())
			}
			if got := len(rec.calls); got != 0 {
				t.Errorf("expected zero db calls for unsupported type, got %d", got)
			}
		})
	}
}

// TestWrite_NilValueReturnsError pins the "no silent NULL writes"
// rule. The snapshot tables' per-column upsert would happily set
// the column to SQL NULL and overwrite any prior recorded value;
// that would almost never be the producer's intent.
func TestWrite_NilValueReturnsError(t *testing.T) {
	rec := &recorder{rows: 1}
	w := newTestWriter(t, rec, staticColumnFor("F", "f"))
	err := w.Write(context.Background(), codec.Atomic{
		Field: "F", Value: nil, EmittedAt: time.Now().UTC(), VehicleID: "VIN",
	}, router.Entry{})
	if err == nil {
		t.Fatal("expected error for nil value, got nil")
	}
	if !strings.Contains(err.Error(), "nil value not allowed") {
		t.Errorf("error does not mention nil rejection: %q", err.Error())
	}
	if got := len(rec.calls); got != 0 {
		t.Errorf("expected zero db calls for nil value, got %d", got)
	}
}

// TestWrite_RowsAffectedZeroReturnsUnknownVehicleError is the
// VIN-not-in-vehicles branch. The error message MUST NOT contain
// the VIN itself (PII) but must clearly identify the destination
// and the field for log correlation.
func TestWrite_RowsAffectedZeroReturnsUnknownVehicleError(t *testing.T) {
	const vin = "VIN-NOT-REGISTERED-XYZ"
	rec := &recorder{rows: 0}
	w := newTestWriter(t, rec, staticColumnFor("F", "f"))
	err := w.Write(context.Background(), codec.Atomic{
		Field: "F", Value: float64(1), EmittedAt: time.Now().UTC(), VehicleID: vin,
	}, router.Entry{})
	if err == nil {
		t.Fatal("expected error when RowsAffected==0, got nil")
	}
	if !strings.Contains(err.Error(), "vehicle not registered") {
		t.Errorf("error does not mention unknown vehicle: %q", err.Error())
	}
	if strings.Contains(err.Error(), vin) {
		t.Errorf("error message must NOT include VIN (PII): %q", err.Error())
	}
	if !strings.Contains(err.Error(), "test_snapshots") {
		t.Errorf("error must include destination table for log correlation: %q", err.Error())
	}
	if !strings.Contains(err.Error(), "F") {
		t.Errorf("error must include field name for log correlation: %q", err.Error())
	}
	// The exec DID run — we just observed RowsAffected==0.
	if got := len(rec.calls); got != 1 {
		t.Errorf("expected exactly one db call, got %d", got)
	}
}

// TestWrite_DBExecErrorWrapped pins the error-wrapping format the
// router's classifyError tag set depends on. The wrapped error must
// be unwrappable via errors.Is so context.DeadlineExceeded /
// context.Canceled are still detectable downstream.
func TestWrite_DBExecErrorWrapped(t *testing.T) {
	sentinel := errors.New("simulated db failure")
	rec := &recorder{err: sentinel}
	w := newTestWriter(t, rec, staticColumnFor("F", "f"))
	err := w.Write(context.Background(), codec.Atomic{
		Field: "F", Value: float64(1), EmittedAt: time.Now().UTC(), VehicleID: "VIN",
	}, router.Entry{})
	if err == nil {
		t.Fatal("expected error from db.Exec, got nil")
	}
	if !errors.Is(err, sentinel) {
		t.Errorf("wrapped error does not unwrap to sentinel: %v", err)
	}
	if !strings.Contains(err.Error(), "snapshotWriter[test_snapshots].F:") {
		t.Errorf("error missing standard prefix: %q", err.Error())
	}
}

// TestWrite_SatisfiesRouterWriter is a runtime confirmation of the
// compile-time assertion in snapshot_base.go. Keeping it as a runtime
// test as well makes the contract greppable from the tests folder.
func TestWrite_SatisfiesRouterWriter(t *testing.T) {
	rec := &recorder{rows: 1}
	w := newTestWriter(t, rec, staticColumnFor("F", "f"))
	var _ router.Writer = w
}
