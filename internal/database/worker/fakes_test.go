package worker

// In-package test doubles for WorkerQueueRepo.
//
// WorkerQueueRepo holds a database.DBTX execution seam (satisfied by
// *pgxpool.Pool in production), so this fake exercises every counter /
// recent-job read path without a live PostgreSQL — the same approach used
// by internal/database/observability's fakeDBTX and internal/database/audit's
// fakeDBTX. Query/QueryRow/Exec calls are recorded so tests can assert on the
// exact SQL text and argument order, and each verb has a FIFO result queue so
// a method that issues several statements can be driven deterministically.

import (
	"context"
	"fmt"
	"reflect"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// dbCall captures a single Query/QueryRow/Exec invocation.
type dbCall struct {
	SQL  string
	Args []any
}

// queryResult is a queued outcome the fake hands back on a Query call.
type queryResult struct {
	rows pgx.Rows
	err  error
}

// fakeDBTX is a recording database.DBTX with FIFO result queues. When a
// queue is empty the verb falls back to a benign success (an empty rows set
// or a no-op row) so tests only enqueue the results they actually assert on.
type fakeDBTX struct {
	queryCalls []dbCall
	queryQueue []queryResult

	rowCalls []dbCall
	rowQueue []pgx.Row
}

func cloneArgs(args []any) []any {
	cp := make([]any, len(args))
	copy(cp, args)
	return cp
}

func (f *fakeDBTX) Exec(_ context.Context, sql string, _ ...any) (pgconn.CommandTag, error) {
	// WorkerQueueRepo is read-only; Exec exists only to satisfy database.DBTX.
	return pgconn.NewCommandTag("SELECT 0"), nil
}

func (f *fakeDBTX) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	f.queryCalls = append(f.queryCalls, dbCall{SQL: sql, Args: cloneArgs(args)})
	if len(f.queryQueue) > 0 {
		res := f.queryQueue[0]
		f.queryQueue = f.queryQueue[1:]
		if res.err != nil {
			return nil, res.err
		}
		if res.rows != nil {
			return res.rows, nil
		}
	}
	return &fakeRows{}, nil
}

func (f *fakeDBTX) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	f.rowCalls = append(f.rowCalls, dbCall{SQL: sql, Args: cloneArgs(args)})
	if len(f.rowQueue) > 0 {
		row := f.rowQueue[0]
		f.rowQueue = f.rowQueue[1:]
		if row != nil {
			return row
		}
	}
	return &fakeRow{}
}

var _ database.DBTX = (*fakeDBTX)(nil)

// pushQuery / pushRow enqueue one canned outcome and return the receiver so
// setup reads as a fluent chain.
func (f *fakeDBTX) pushQuery(rows pgx.Rows, err error) *fakeDBTX {
	f.queryQueue = append(f.queryQueue, queryResult{rows: rows, err: err})
	return f
}

func (f *fakeDBTX) pushRow(row pgx.Row) *fakeDBTX {
	f.rowQueue = append(f.rowQueue, row)
	return f
}

// lastQuery / lastRow return the most recent call of each verb (or a zero
// value when none occurred) so tests can assert on the SQL text and args.
func (f *fakeDBTX) lastQuery() dbCall { return lastCall(f.queryCalls) }
func (f *fakeDBTX) lastRow() dbCall   { return lastCall(f.rowCalls) }

func lastCall(calls []dbCall) dbCall {
	if len(calls) == 0 {
		return dbCall{}
	}
	return calls[len(calls)-1]
}

// fakeRow is a single-row pgx.Row. When scan is nil it succeeds without
// touching the destinations; set scan to populate destinations or to force a
// scan error.
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

// rowWith builds a fakeRow whose Scan writes the supplied values.
func rowWith(values ...any) *fakeRow { return &fakeRow{scan: scanRow(values...)} }

// rowErr builds a fakeRow whose Scan always fails with err.
func rowErr(err error) *fakeRow { return &fakeRow{scan: func(...any) error { return err }} }

// fakeRows is a driver-free pgx.Rows. Each element of scans populates the
// Scan destinations for one row (and may itself return an error to exercise
// scan-failure branches). err is surfaced by Err() so post-iteration error
// handling can be tested.
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
		return fmt.Errorf("fakeRows: Scan called out of order")
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

// rowsErr builds a fakeRows that iterates the given rows and then surfaces err
// from Err(), for testing post-iteration error handling.
func rowsErr(err error, scans ...func(dest ...any) error) *fakeRows {
	return &fakeRows{scans: scans, err: err}
}

// ptr returns a pointer to v — a terse way to build the nullable-column values
// (*time.Time, *int64) the Recent* queries scan into.
func ptr[T any](v T) *T { return &v }

// contains is a terse strings.Contains for SQL/error-substring assertions.
func contains(s, sub string) bool { return strings.Contains(s, sub) }

// scanRow builds a scan callback that writes the supplied values into the Scan
// destinations positionally. Each dest must be a pointer whose element type
// matches the corresponding value; a length or type mismatch returns an error
// so a drifted column projection is caught loudly.
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
// dest's element to its zero value; a non-nil val must be assignable to the
// element type. Supports the scalar and pointer destinations the repo scans
// into (e.g. *int64, *string, *time.Time, **time.Time).
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
