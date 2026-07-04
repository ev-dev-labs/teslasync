package tesla

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ---------------------------------------------------------------------------
// Test doubles for the Tesla account / Fleet-API-mirror repositories.
//
// These model the established teslaPool / pgx.Rows / pgx.Row fake pattern used
// across the tree (see internal/database/admin/fakes_test.go and
// internal/database/geofence/fakes_test.go). No live DB / network / Tesla API
// is used, so every test runs deterministically under -race. The doubles are
// queue-driven: each pool / tx method pops the next scripted result FIFO and
// records the SQL + bound args so tests can assert both behaviour and query
// shape.
// ---------------------------------------------------------------------------

// errBoom is the canonical synthetic failure used to drive error branches.
var errBoom = errors.New("boom")

// recordedCall captures one SQL invocation for assertions.
type recordedCall struct {
	sql  string
	args []any
}

func cloneArgs(args []any) []any {
	cp := make([]any, len(args))
	copy(cp, args)
	return cp
}

// execResult scripts one Exec return value.
type execResult struct {
	tag pgconn.CommandTag
	err error
}

// queryResult scripts one Query return value.
type queryResult struct {
	rows pgx.Rows
	err  error
}

// beginResult scripts one Begin return value.
type beginResult struct {
	tx  pgx.Tx
	err error
}

// fakePool implements teslaPool. Each method pops the head of its scripted
// queue; when a queue is empty a benign default is returned so tests only
// script the calls they care about.
type fakePool struct {
	queryQueue    []queryResult
	queryRowQueue []pgx.Row
	execQueue     []execResult
	beginQueue    []beginResult

	queryCalls    []recordedCall
	queryRowCalls []recordedCall
	execCalls     []recordedCall
	beginCalls    int
}

func (f *fakePool) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	f.queryCalls = append(f.queryCalls, recordedCall{sql: sql, args: cloneArgs(args)})
	if len(f.queryQueue) > 0 {
		r := f.queryQueue[0]
		f.queryQueue = f.queryQueue[1:]
		return r.rows, r.err
	}
	return newFakeRows(nil), nil
}

func (f *fakePool) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	f.queryRowCalls = append(f.queryRowCalls, recordedCall{sql: sql, args: cloneArgs(args)})
	if len(f.queryRowQueue) > 0 {
		r := f.queryRowQueue[0]
		f.queryRowQueue = f.queryRowQueue[1:]
		return r
	}
	return fakeRow{}
}

func (f *fakePool) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execCalls = append(f.execCalls, recordedCall{sql: sql, args: cloneArgs(args)})
	if len(f.execQueue) > 0 {
		r := f.execQueue[0]
		f.execQueue = f.execQueue[1:]
		return r.tag, r.err
	}
	return pgconn.CommandTag{}, nil
}

func (f *fakePool) Begin(_ context.Context) (pgx.Tx, error) {
	f.beginCalls++
	if len(f.beginQueue) > 0 {
		r := f.beginQueue[0]
		f.beginQueue = f.beginQueue[1:]
		return r.tx, r.err
	}
	return newFakeTx(), nil
}

var _ teslaPool = (*fakePool)(nil)

// fakeTx implements pgx.Tx for the ReplaceAll / Upsert / Replace* transaction
// paths. It embeds the pgx.Tx interface so the many unused methods are
// satisfied for free; only the methods the repos actually call are overridden.
// Exec / QueryRow are queue-driven like fakePool; Commit / Rollback record
// their invocation and return a configurable error.
type fakeTx struct {
	pgx.Tx

	execQueue     []execResult
	queryRowQueue []pgx.Row

	commitErr   error
	rollbackErr error

	execCalls     []recordedCall
	queryRowCalls []recordedCall
	commitCalls   int
	rollbackCalls int
}

func newFakeTx() *fakeTx { return &fakeTx{} }

func (t *fakeTx) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	t.execCalls = append(t.execCalls, recordedCall{sql: sql, args: cloneArgs(args)})
	if len(t.execQueue) > 0 {
		r := t.execQueue[0]
		t.execQueue = t.execQueue[1:]
		return r.tag, r.err
	}
	return pgconn.CommandTag{}, nil
}

func (t *fakeTx) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	t.queryRowCalls = append(t.queryRowCalls, recordedCall{sql: sql, args: cloneArgs(args)})
	if len(t.queryRowQueue) > 0 {
		r := t.queryRowQueue[0]
		t.queryRowQueue = t.queryRowQueue[1:]
		return r
	}
	return fakeRow{}
}

func (t *fakeTx) Commit(_ context.Context) error {
	t.commitCalls++
	return t.commitErr
}

func (t *fakeTx) Rollback(_ context.Context) error {
	t.rollbackCalls++
	return t.rollbackErr
}

var _ pgx.Tx = (*fakeTx)(nil)

// fakeRow satisfies pgx.Row. vals holds one column value per Scan destination
// (in column order); scanErr forces the Scan to fail (e.g. pgx.ErrNoRows for a
// not-found row, or a synthetic scan error).
type fakeRow struct {
	vals    []any
	scanErr error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	return scanInto(dest, r.vals)
}

var _ pgx.Row = fakeRow{}

// noRow returns a pgx.Row whose Scan fails with pgx.ErrNoRows — the canonical
// "no matching row" signal the Get* methods translate into (nil, nil).
func noRow() pgx.Row { return fakeRow{scanErr: pgx.ErrNoRows} }

// fakeRows satisfies pgx.Rows for the GetAll SELECT paths. data holds one []any
// per row in column order; scanErrAt forces Scan to fail for a single row so
// the "unscannable row" branch can be exercised deterministically, and iterErr
// models a mid-iteration rows.Err().
type fakeRows struct {
	data      [][]any
	cursor    int
	closed    bool
	iterErr   error
	scanErrAt int
}

func newFakeRows(data [][]any) *fakeRows {
	return &fakeRows{data: data, cursor: -1, scanErrAt: -1}
}

func (r *fakeRows) Close()                                       { r.closed = true }
func (r *fakeRows) Err() error                                   { return r.iterErr }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }

func (r *fakeRows) Next() bool {
	r.cursor++
	return r.cursor < len(r.data)
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.cursor < 0 || r.cursor >= len(r.data) {
		return errors.New("fakeRows.Scan: cursor out of range")
	}
	if r.cursor == r.scanErrAt {
		return errors.New("fakeRows: forced scan error")
	}
	return scanInto(dest, r.data[r.cursor])
}

func (r *fakeRows) Values() ([]any, error) { return nil, nil }
func (r *fakeRows) RawValues() [][]byte    { return nil }
func (r *fakeRows) Conn() *pgx.Conn        { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

// scanInto copies src column values into the pointer destinations the repo
// hands to Scan, mimicking pgx's assignment semantics for the exact types the
// Tesla repos use (int, int64, string, bool, float64, time.Time, and their
// pointer forms). A src of nil zeroes the destination, matching a NULL column.
func scanInto(dest, src []any) error {
	if len(dest) != len(src) {
		return fmt.Errorf("scanInto: dest/src length mismatch (%d vs %d)", len(dest), len(src))
	}
	for i := range dest {
		dv := reflect.ValueOf(dest[i])
		if dv.Kind() != reflect.Pointer || dv.IsNil() {
			return errors.New("scanInto: dest is not a non-nil pointer")
		}
		target := dv.Elem()
		if src[i] == nil {
			target.Set(reflect.Zero(target.Type()))
			continue
		}
		sv := reflect.ValueOf(src[i])
		if !sv.Type().AssignableTo(target.Type()) {
			return fmt.Errorf("scanInto: %T not assignable to %s at col %d", src[i], target.Type(), i)
		}
		target.Set(sv)
	}
	return nil
}

// --- small typed-pointer helpers used across the repo test files ---

func strp(v string) *string          { return &v }
func f64p(v float64) *float64        { return &v }
func intp(v int) *int                { return &v }
func i64p(v int64) *int64            { return &v }
func timePtr(v time.Time) *time.Time { return &v }

// fixedTime is a deterministic timestamp for the *_datetime / *_at columns.
var fixedTime = time.Date(2026, 7, 4, 12, 0, 0, 0, time.UTC)

// --- assertion helpers ---

// requireErr fails the test unless err is non-nil and its message contains
// frag. An empty frag only asserts that some error occurred.
func requireErr(t *testing.T, err error, frag string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error containing %q, got nil", frag)
	}
	if frag != "" && !strings.Contains(err.Error(), frag) {
		t.Fatalf("error %q does not contain %q", err.Error(), frag)
	}
}

// assertArgsEqual compares bound SQL args element-wise. time.Time values are
// compared with Equal (ignoring monotonic-clock / location representation);
// everything else — including pointers and slices — via reflect.DeepEqual,
// which dereferences pointers so i64p(42) matches any *int64 pointing at 42.
func assertArgsEqual(t *testing.T, got, want []any) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("args len=%d, want %d (%#v vs %#v)", len(got), len(want), got, want)
	}
	for i := range want {
		if gt, ok := got[i].(time.Time); ok {
			if wt, ok2 := want[i].(time.Time); ok2 {
				if !gt.Equal(wt) {
					t.Errorf("arg[%d] time=%v, want %v", i, gt, wt)
				}
				continue
			}
		}
		if !reflect.DeepEqual(got[i], want[i]) {
			t.Errorf("arg[%d]=%#v, want %#v", i, got[i], want[i])
		}
	}
}
