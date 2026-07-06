package audit

// Shared in-package test doubles for the audit repositories.
//
// The repos hold a database.DBTX execution seam (satisfied by
// *pgxpool.Pool in production), so these fakes let every write/read path
// be exercised without a live PostgreSQL — the same approach used by
// internal/database/drive's txRecorder and internal/signal's fake
// pgx.Rows implementations. Query/QueryRow/Exec calls are recorded so
// tests can assert on the exact SQL text and argument order/values.

import (
	"context"
	"errors"
	"fmt"
	"reflect"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// dbCall captures a single Exec/Query/QueryRow invocation.
type dbCall struct {
	SQL  string
	Args []any
}

// fakeDBTX is a recording database.DBTX. Each verb can be pointed at a
// canned result (rows/row) or forced to fail (execErr/queryErr) so both
// happy and error branches are reachable.
type fakeDBTX struct {
	execCalls []dbCall
	execErr   error

	queryCalls []dbCall
	queryRows  pgx.Rows
	queryErr   error

	queryRowCalls []dbCall
	row           pgx.Row
}

func cloneArgs(args []any) []any {
	cp := make([]any, len(args))
	copy(cp, args)
	return cp
}

func (f *fakeDBTX) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execCalls = append(f.execCalls, dbCall{SQL: sql, Args: cloneArgs(args)})
	if f.execErr != nil {
		return pgconn.CommandTag{}, f.execErr
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (f *fakeDBTX) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	f.queryCalls = append(f.queryCalls, dbCall{SQL: sql, Args: cloneArgs(args)})
	if f.queryErr != nil {
		return nil, f.queryErr
	}
	if f.queryRows != nil {
		return f.queryRows, nil
	}
	return &fakeRows{}, nil
}

func (f *fakeDBTX) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	f.queryRowCalls = append(f.queryRowCalls, dbCall{SQL: sql, Args: cloneArgs(args)})
	if f.row != nil {
		return f.row
	}
	return &fakeRow{}
}

var _ database.DBTX = (*fakeDBTX)(nil)

// fakeRow is a single-row pgx.Row. When scan is nil it succeeds without
// touching the destinations; set scan to populate destinations or to
// force a scan error.
type fakeRow struct {
	scan func(dest ...any) error
}

func (r *fakeRow) Scan(dest ...any) error {
	if r.scan == nil {
		return nil
	}
	return r.scan(dest...)
}

var _ pgx.Row = (*fakeRow)(nil)

// fakeRows is a driver-free pgx.Rows. Each element of scans populates the
// Scan destinations for one row (and may itself return an error to
// exercise scan-failure branches). err is surfaced by Err() so
// post-iteration error handling can be tested.
type fakeRows struct {
	scans  []func(dest ...any) error
	pos    int
	err    error
	closed bool
}

func (r *fakeRows) Next() bool {
	if r.pos >= len(r.scans) {
		return false
	}
	r.pos++
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.pos == 0 || r.pos > len(r.scans) {
		return errors.New("fakeRows: Scan called out of order")
	}
	return r.scans[r.pos-1](dest...)
}

func (r *fakeRows) Close()                                       { r.closed = true }
func (r *fakeRows) Err() error                                   { return r.err }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

// rowsFrom builds a fakeRows from per-row scan callbacks (typically
// scanRow(...) values or an inline func returning an error to exercise a
// scan-failure branch).
func rowsFrom(scans ...func(dest ...any) error) *fakeRows {
	return &fakeRows{scans: scans}
}

// ptr returns a pointer to v — a terse way to build the nullable-column
// values (*string, *int64, *bool, …) the audit Recent/List queries scan.
func ptr[T any](v T) *T { return &v }

// scanRow builds a scan callback that writes the supplied values into the
// Scan destinations positionally. Each dest must be a pointer whose
// element type matches the corresponding value; a length or type mismatch
// returns an error so a drifted column projection is caught loudly.
func scanRow(values ...any) func(dest ...any) error {
	return func(dest ...any) error {
		if len(dest) != len(values) {
			return fmt.Errorf("scanRow: destination count %d != value count %d", len(dest), len(values))
		}
		for i := range dest {
			if err := assign(dest[i], values[i]); err != nil {
				return fmt.Errorf("scanRow: dest[%d]: %w", i, err)
			}
		}
		return nil
	}
}

// assign writes val into the pointer dest via reflection. A nil val sets
// dest's element to its zero value; a non-nil val must be assignable to
// the element type. Supports the scalar, pointer, and pointer-to-pointer
// destinations the audit repos scan into (e.g. *int64, *time.Time,
// **string, *[]byte).
func assign(dest any, val any) error {
	dv := reflect.ValueOf(dest)
	if dv.Kind() != reflect.Ptr || dv.IsNil() {
		return fmt.Errorf("assign: dest is not a non-nil pointer: %T", dest)
	}
	target := dv.Elem()
	if !target.CanSet() {
		return fmt.Errorf("assign: dest %T is not settable", dest)
	}
	if val == nil {
		target.Set(reflect.Zero(target.Type()))
		return nil
	}
	vv := reflect.ValueOf(val)
	if !vv.Type().AssignableTo(target.Type()) {
		return fmt.Errorf("assign: cannot assign %T to %s", val, target.Type())
	}
	target.Set(vv)
	return nil
}
