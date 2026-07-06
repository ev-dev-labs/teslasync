package postgres

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/domain"
)

// ---------------------------------------------------------------------------
// Fake pgx plumbing for the postgres repository adapters.
//
// The module vendors no pgxmock/testcontainers harness — the established
// precedent (internal/database/achievement/unlock_repo_test.go) is a hand
// written querier seam plus scripted pgx.Rows/pgx.Row fakes. The repositories
// here talk to the unexported pgxPool seam (pool.go), so these fakes supply a
// deterministic, DB-free row source that also exercises the exact
// pgx.CollectRows + RowToStructByName decoding path used in production.
// ---------------------------------------------------------------------------

// assignRow copies scripted column values into the caller's Scan destinations.
// It mirrors pgx's per-type scanning generically via reflection so it works for
// both the hand-written &field scans (Get* methods) and the reflected scan
// targets that RowToStructByName produces (list methods), including defined
// string types such as fsm.State/fsm.Event.
func assignRow(dest, vals []any) error {
	if len(dest) != len(vals) {
		return fmt.Errorf("scan: %d destinations but row has %d values", len(dest), len(vals))
	}
	for i := range dest {
		dv := reflect.ValueOf(dest[i])
		if dv.Kind() != reflect.Pointer || dv.IsNil() {
			return fmt.Errorf("scan: destination %d is not a non-nil pointer (%T)", i, dest[i])
		}
		target := dv.Elem()
		if !target.CanSet() {
			return fmt.Errorf("scan: destination %d (%s) is not settable", i, target.Type())
		}
		if vals[i] == nil {
			target.Set(reflect.Zero(target.Type()))
			continue
		}
		v := reflect.ValueOf(vals[i])
		switch {
		case v.Type().AssignableTo(target.Type()):
			target.Set(v)
		case v.Type().ConvertibleTo(target.Type()):
			target.Set(v.Convert(target.Type()))
		default:
			return fmt.Errorf("scan: cannot assign %T into destination %d (%s)", vals[i], i, target.Type())
		}
	}
	return nil
}

// fakeRows is a scripted pgx.Rows. cols are the projected column names (matched
// by RowToStructByName against the struct's db tags); each element of data is
// one row's values, positionally aligned to cols.
type fakeRows struct {
	cols      []string
	data      [][]any
	idx       int   // 0 before first row; 1-based once iterating
	scanErr   error // returned by Scan when idx == scanErrAt
	scanErrAt int   // 1-based row at which Scan fails; 0 = never
	iterErr   error // returned by Err() to simulate mid-stream iteration failure
	closed    bool
	closeN    int
}

func (r *fakeRows) Next() bool {
	if r.idx >= len(r.data) {
		return false
	}
	r.idx++
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.scanErr != nil && r.idx == r.scanErrAt {
		return r.scanErr
	}
	if r.idx < 1 || r.idx > len(r.data) {
		return fmt.Errorf("fakeRows.Scan: no current row (idx=%d)", r.idx)
	}
	return assignRow(dest, r.data[r.idx-1])
}

func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription {
	fds := make([]pgconn.FieldDescription, len(r.cols))
	for i, c := range r.cols {
		fds[i] = pgconn.FieldDescription{Name: c}
	}
	return fds
}

func (r *fakeRows) Close()                        { r.closed = true; r.closeN++ }
func (r *fakeRows) Err() error                    { return r.iterErr }
func (r *fakeRows) CommandTag() pgconn.CommandTag { return pgconn.CommandTag{} }
func (r *fakeRows) Values() ([]any, error) {
	if r.idx < 1 || r.idx > len(r.data) {
		return nil, fmt.Errorf("fakeRows.Values: no current row")
	}
	return r.data[r.idx-1], nil
}
func (r *fakeRows) RawValues() [][]byte { return nil }
func (r *fakeRows) Conn() *pgx.Conn     { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

// fakeRow is a scripted pgx.Row for the single-row Get* methods. It populates
// the hand-written Scan destinations from vals, or returns err to exercise the
// not-found / scan-failure branches.
type fakeRow struct {
	vals []any
	err  error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	return assignRow(dest, r.vals)
}

var _ pgx.Row = fakeRow{}

// fakePool records the SQL + args it was asked to run and returns the scripted
// rows / row / command tag (or an error). It satisfies the pgxPool seam.
type fakePool struct {
	// Scripted responses.
	rows     pgx.Rows
	queryErr error
	row      pgx.Row
	tag      pgconn.CommandTag
	execErr  error

	// Captured invocations.
	querySQL     string
	queryArgs    []any
	queryRowSQL  string
	queryRowArgs []any
	execSQL      string
	execArgs     []any
	queryN       int
	queryRowN    int
	execN        int
}

func (p *fakePool) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	p.queryN++
	p.querySQL = sql
	p.queryArgs = args
	if p.queryErr != nil {
		return nil, p.queryErr
	}
	return p.rows, nil
}

func (p *fakePool) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	p.queryRowN++
	p.queryRowSQL = sql
	p.queryRowArgs = args
	return p.row
}

func (p *fakePool) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	p.execN++
	p.execSQL = sql
	p.execArgs = args
	if p.execErr != nil {
		return pgconn.CommandTag{}, p.execErr
	}
	return p.tag, nil
}

var _ pgxPool = (*fakePool)(nil)

// lazyPool builds a real *pgxpool.Pool without connecting to a database
// (MinConns=0 makes pgxpool.NewWithConfig lazy). Used to exercise the exported
// constructors' wiring contract — they accept a concrete pool — without a live
// server, matching the sibling TestNewUnlockRepo_WiresPool precedent.
func lazyPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	cfg, err := pgxpool.ParseConfig("postgres://user:pass@127.0.0.1:5432/db?sslmode=disable")
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	cfg.MinConns = 0
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("NewWithConfig (should be lazy, no connect): %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// argAt returns the i-th captured arg or nil when out of range, so assertions
// stay panic-free even on unexpected arg counts.
func argAt(args []any, i int) any {
	if i < 0 || i >= len(args) {
		return nil
	}
	return args[i]
}

// newCommandTag builds a pgconn.CommandTag from its textual form (e.g.
// "DELETE 1"), so tests can drive RowsAffected() without a live server.
func newCommandTag(s string) pgconn.CommandTag { return pgconn.NewCommandTag(s) }

// runGetter exercises a single-row Get* method against the three canonical
// branches: found (row decodes to want), not-found (pgx.ErrNoRows maps to
// domain.ErrNotFound), and scan failure (wrapped with scanCtx). It pins the
// issued SQL and the single positional argument.
func runGetter[T any](
	t *testing.T,
	name string,
	row []any,
	want T,
	wantSQL string,
	wantArg any,
	scanCtx string,
	call func(pool *fakePool) (*T, error),
) {
	t.Helper()
	scanBoom := errors.New("scan boom: " + name)

	t.Run(name+"/found", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{row: fakeRow{vals: row}}
		got, err := call(pool)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if pool.queryRowN != 1 {
			t.Fatalf("queryRowN = %d, want 1", pool.queryRowN)
		}
		if pool.queryRowSQL != wantSQL {
			t.Errorf("SQL = %q, want the matching getter query", pool.queryRowSQL)
		}
		if len(pool.queryRowArgs) != 1 || argAt(pool.queryRowArgs, 0) != wantArg {
			t.Errorf("args = %v, want [%v]", pool.queryRowArgs, wantArg)
		}
		if got == nil {
			t.Fatalf("result nil, want %+v", want)
		}
		if !reflect.DeepEqual(*got, want) {
			t.Errorf("result = %+v, want %+v", *got, want)
		}
	})

	t.Run(name+"/not_found", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{row: fakeRow{err: pgx.ErrNoRows}}
		got, err := call(pool)
		if !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("error = %v, want wrap of domain.ErrNotFound", err)
		}
		if got != nil {
			t.Errorf("result = %+v, want nil on not-found", got)
		}
	})

	t.Run(name+"/scan_error", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{row: fakeRow{err: scanBoom}}
		got, err := call(pool)
		if !errors.Is(err, scanBoom) {
			t.Fatalf("error = %v, want wrap of scanBoom", err)
		}
		if !strings.Contains(err.Error(), scanCtx) {
			t.Errorf("error %q missing context %q", err, scanCtx)
		}
		if got != nil {
			t.Errorf("result = %+v, want nil on error", got)
		}
	})
}

// listScenario is one scripted scenario for a repository list method.
type listScenario[T any] struct {
	name       string
	rows       *fakeRows
	queryErr   error
	want       []T
	wantErr    error  // errors.Is target (nil = derive from wantErrSub only)
	wantErrSub string // substring the wrapped error must contain ("" = success)
}

// runListMethod exercises a list method across its scenarios, pinning the query
// SQL + args and asserting decode results, error wrapping, and that rows are
// always closed.
func runListMethod[T any](
	t *testing.T,
	scenarios []listScenario[T],
	wantSQL string,
	wantArgs []any,
	call func(pool *fakePool) ([]T, error),
) {
	t.Helper()
	for _, sc := range scenarios {
		sc := sc
		t.Run(sc.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{rows: sc.rows, queryErr: sc.queryErr}
			got, err := call(pool)

			if pool.queryN != 1 {
				t.Fatalf("queryN = %d, want 1", pool.queryN)
			}
			if pool.querySQL != wantSQL {
				t.Errorf("SQL = %q, want the matching list query", pool.querySQL)
			}
			if !reflect.DeepEqual(pool.queryArgs, wantArgs) {
				t.Errorf("args = %v, want %v", pool.queryArgs, wantArgs)
			}

			if sc.wantErrSub != "" {
				if sc.wantErr != nil && !errors.Is(err, sc.wantErr) {
					t.Fatalf("error = %v, want wrap of %v", err, sc.wantErr)
				}
				if err == nil || !strings.Contains(err.Error(), sc.wantErrSub) {
					t.Fatalf("error = %v, want context %q", err, sc.wantErrSub)
				}
				if got != nil {
					t.Errorf("result = %v, want nil on error", got)
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != len(sc.want) {
				t.Fatalf("len = %d, want %d", len(got), len(sc.want))
			}
			for i := range sc.want {
				if !reflect.DeepEqual(got[i], sc.want[i]) {
					t.Errorf("result[%d] = %+v, want %+v", i, got[i], sc.want[i])
				}
			}
			if sc.rows != nil && !sc.rows.closed {
				t.Error("rows.Close() was not called")
			}
		})
	}
}

// listScenarios builds the five standard list-method scenarios (rows, empty,
// query error, collect scan error, collect iteration error) from a decoder and
// at least one sample item. queryCtxSub/collectCtxSub are the substrings the
// wrapped errors must carry for the Query-failure and CollectRows-failure paths.
func listScenarios[T any](
	cols []string,
	rowOf func(T) []any,
	items []T,
	queryCtxSub, collectCtxSub string,
) []listScenario[T] {
	queryBoom := errors.New("connection reset")
	scanBoom := errors.New("bad column type")
	iterBoom := errors.New("stream aborted")

	data := make([][]any, len(items))
	for i, it := range items {
		data[i] = rowOf(it)
	}
	var first [][]any
	if len(items) > 0 {
		first = [][]any{rowOf(items[0])}
	}

	return []listScenario[T]{
		{name: "rows", rows: &fakeRows{cols: cols, data: data}, want: items},
		{name: "empty", rows: &fakeRows{cols: cols, data: nil}},
		{name: "query_error", queryErr: queryBoom, wantErr: queryBoom, wantErrSub: queryCtxSub},
		{name: "collect_scan_error", rows: &fakeRows{cols: cols, data: first, scanErr: scanBoom, scanErrAt: 1}, wantErr: scanBoom, wantErrSub: collectCtxSub},
		{name: "collect_iter_error", rows: &fakeRows{cols: cols, data: first, iterErr: iterBoom}, wantErr: iterBoom, wantErrSub: collectCtxSub},
	}
}
