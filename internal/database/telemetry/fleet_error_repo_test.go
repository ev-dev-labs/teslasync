package telemetry

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	telemetrymodel "github.com/ev-dev-labs/teslasync/internal/models/telemetry"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Fake pgx plumbing.
//
// The codebase vendors no pgxmock/testcontainers harness (see
// achievement/unlock_repo_test.go and drive/repo_backfill_test.go for the same
// precedent). TeslaFleetTelemetryErrorRepo talks to the unexported errorQuerier
// seam, so these fakes supply a scripted row/tx source without a live database.
// ---------------------------------------------------------------------------

// fakeRows is a scripted pgx.Rows. Each element of data is one row's values,
// positionally matching the Scan destinations.
type fakeRows struct {
	data      [][]any
	idx       int
	scanErr   error // returned by Scan when idx == scanErrAt
	scanErrAt int   // 1-based row at which Scan fails; 0 = never
	errVal    error // returned by Err() to simulate mid-stream iteration failure
	closed    bool
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
	return assignScan(dest, r.data[r.idx-1])
}

func (r *fakeRows) Close()                                       { r.closed = true }
func (r *fakeRows) Err() error                                   { return r.errVal }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

// assignScan copies scripted values into the caller's Scan destinations,
// mimicking pgx's per-type scanning for the column types this package projects.
// Nullable columns use pointer destinations (**string / **time.Time); a nil
// script value maps to a nil pointer.
func assignScan(dest []any, vals []any) error {
	if len(dest) != len(vals) {
		return fmt.Errorf("scan: %d destinations but row has %d values", len(dest), len(vals))
	}
	for i, d := range dest {
		v := vals[i]
		switch p := d.(type) {
		case *int64:
			n, ok := v.(int64)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *int64", i, v)
			}
			*p = n
		case *string:
			s, ok := v.(string)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *string", i, v)
			}
			*p = s
		case *bool:
			b, ok := v.(bool)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *bool", i, v)
			}
			*p = b
		case *time.Time:
			t, ok := v.(time.Time)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *time.Time", i, v)
			}
			*p = t
		case **string:
			if v == nil {
				*p = nil
				continue
			}
			sp, ok := v.(*string)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into **string", i, v)
			}
			*p = sp
		case **time.Time:
			if v == nil {
				*p = nil
				continue
			}
			tp, ok := v.(*time.Time)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into **time.Time", i, v)
			}
			*p = tp
		default:
			return fmt.Errorf("col %d: unsupported destination type %T", i, d)
		}
	}
	return nil
}

// recordedExec captures one tx.Exec invocation.
type recordedExec struct {
	SQL  string
	Args []any
}

// fakeTx is a scripted pgx.Tx recording every Exec and tracking commit/rollback.
type fakeTx struct {
	execs       []recordedExec
	execErr     error // returned by Exec when execCalls == execErrAt
	execErrAt   int   // 1-based exec call index that fails; 0 = never
	rowsPerExec int64 // RowsAffected reported per successful Exec
	commitErr   error
	rollbackErr error
	committed   bool
	rolledBack  bool
	execCalls   int
}

func (t *fakeTx) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	t.execCalls++
	cp := append([]any(nil), args...)
	t.execs = append(t.execs, recordedExec{SQL: sql, Args: cp})
	if t.execErr != nil && t.execCalls == t.execErrAt {
		return pgconn.CommandTag{}, t.execErr
	}
	return pgconn.NewCommandTag(fmt.Sprintf("INSERT 0 %d", t.rowsPerExec)), nil
}

func (t *fakeTx) Commit(_ context.Context) error   { t.committed = true; return t.commitErr }
func (t *fakeTx) Rollback(_ context.Context) error { t.rolledBack = true; return t.rollbackErr }

func (t *fakeTx) Begin(context.Context) (pgx.Tx, error) { panic("fakeTx.Begin: unexpected call") }
func (t *fakeTx) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	panic("fakeTx.CopyFrom: unexpected call")
}
func (t *fakeTx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults {
	panic("fakeTx.SendBatch: unexpected call")
}
func (t *fakeTx) LargeObjects() pgx.LargeObjects { panic("fakeTx.LargeObjects: unexpected call") }
func (t *fakeTx) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	panic("fakeTx.Prepare: unexpected call")
}
func (t *fakeTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	panic("fakeTx.Query: unexpected call")
}
func (t *fakeTx) QueryRow(context.Context, string, ...any) pgx.Row {
	panic("fakeTx.QueryRow: unexpected call")
}
func (t *fakeTx) Conn() *pgx.Conn { return nil }

var _ pgx.Tx = (*fakeTx)(nil)

// fakePool records the SQL + args it was asked to run and returns the scripted
// rows/tx (or a query/begin error). It satisfies the errorQuerier seam.
type fakePool struct {
	rows     pgx.Rows
	queryErr error
	tx       *fakeTx
	beginErr error

	gotQuerySQL  string
	gotQueryArgs []any
	queryCalls   int
	beginCalls   int
}

func (p *fakePool) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	p.queryCalls++
	p.gotQuerySQL = sql
	p.gotQueryArgs = append([]any(nil), args...)
	if p.queryErr != nil {
		return nil, p.queryErr
	}
	return p.rows, nil
}

func (p *fakePool) Begin(_ context.Context) (pgx.Tx, error) {
	p.beginCalls++
	if p.beginErr != nil {
		return nil, p.beginErr
	}
	return p.tx, nil
}

var _ errorQuerier = (*fakePool)(nil)

func newErrorRepo(q errorQuerier) *TeslaFleetTelemetryErrorRepo {
	return &TeslaFleetTelemetryErrorRepo{q: q}
}

func strPtr(s string) *string       { return &s }
func timePtr(t time.Time) *time.Time { return &t }

// ---------------------------------------------------------------------------
// Construction contract.
// ---------------------------------------------------------------------------

func TestNewTeslaFleetTelemetryErrorRepo_NilInputsPanic(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		db   *database.DB
	}{
		{"nil_db", nil},
		{"nil_pool", &database.DB{Pool: nil}},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			defer func() {
				if recover() == nil {
					t.Fatalf("NewTeslaFleetTelemetryErrorRepo(%s) did not panic; a nil pool is a wiring bug that must fail fast", c.name)
				}
			}()
			_ = NewTeslaFleetTelemetryErrorRepo(c.db)
		})
	}
}

// TestNewTeslaFleetTelemetryErrorRepo_WiresPool proves the happy path: a
// non-nil pool is stored on the repo unchanged. pgxpool.NewWithConfig does not
// connect eagerly (MinConns=0) so no live database is required.
func TestNewTeslaFleetTelemetryErrorRepo_WiresPool(t *testing.T) {
	t.Parallel()
	cfg, err := pgxpool.ParseConfig("postgres://u:p@127.0.0.1:5432/db?sslmode=disable")
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}
	cfg.MinConns = 0
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("NewWithConfig (should be lazy, no connect): %v", err)
	}
	defer pool.Close()

	repo := NewTeslaFleetTelemetryErrorRepo(&database.DB{Pool: pool})
	if repo == nil {
		t.Fatal("NewTeslaFleetTelemetryErrorRepo returned nil")
	}
	if repo.q != errorQuerier(pool) {
		t.Error("constructor did not wire db.Pool into the querier seam")
	}
}

// ---------------------------------------------------------------------------
// clampErrorPage — pure boundary logic.
// ---------------------------------------------------------------------------

func TestClampErrorPage(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name                   string
		limit, offset          int
		wantLimit, wantOffset  int
	}{
		{"typical", 50, 10, 50, 10},
		{"zero_limit_defaults", 0, 0, defaultErrorPageLimit, 0},
		{"negative_limit_defaults", -5, 0, defaultErrorPageLimit, 0},
		{"over_max_limit_defaults", maxErrorPageLimit + 1, 0, defaultErrorPageLimit, 0},
		{"at_max_limit_kept", maxErrorPageLimit, 0, maxErrorPageLimit, 0},
		{"one_limit_kept", 1, 0, 1, 0},
		{"negative_offset_clamped", 100, -3, 100, 0},
		{"both_out_of_range", -1, -1, defaultErrorPageLimit, 0},
		{"large_offset_kept", 100, 100000, 100, 100000},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			gotLimit, gotOffset := clampErrorPage(c.limit, c.offset)
			if gotLimit != c.wantLimit {
				t.Errorf("limit: got %d, want %d", gotLimit, c.wantLimit)
			}
			if gotOffset != c.wantOffset {
				t.Errorf("offset: got %d, want %d", gotOffset, c.wantOffset)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// GetActiveErrorVINs.
// ---------------------------------------------------------------------------

func TestGetActiveErrorVINs(t *testing.T) {
	t.Parallel()

	seen := time.Date(2026, 3, 1, 8, 30, 0, 0, time.UTC)
	resolved := time.Date(2026, 3, 2, 9, 0, 0, 0, time.UTC)
	queryBoom := errors.New("connection reset")
	scanBoom := errors.New("bad column type")
	iterBoom := errors.New("stream aborted")

	cases := []struct {
		name       string
		rows       *fakeRows
		queryErr   error
		wantLen    int
		wantErr    error
		wantErrSub string
	}{
		{
			name: "two_rows_success",
			rows: &fakeRows{data: [][]any{
				{int64(1), "VIN1", true, seen, seen, timePtr(resolved)},
				{int64(2), "VIN2", true, seen, seen, nil}, // NULL resolved_at
			}},
			wantLen: 2,
		},
		{
			name:    "empty_no_rows",
			rows:    &fakeRows{data: nil},
			wantLen: 0,
		},
		{
			name:       "query_error_wrapped",
			queryErr:   queryBoom,
			wantErr:    queryBoom,
			wantErrSub: "query active error vins",
		},
		{
			name: "scan_error_wrapped",
			rows: &fakeRows{
				data:      [][]any{{int64(1), "VIN1", true, seen, seen, nil}},
				scanErr:   scanBoom,
				scanErrAt: 1,
			},
			wantErr:    scanBoom,
			wantErrSub: "scan error vin",
		},
		{
			name: "rows_err_wrapped",
			rows: &fakeRows{
				data:   [][]any{{int64(1), "VIN1", true, seen, seen, nil}},
				errVal: iterBoom,
			},
			wantErr:    iterBoom,
			wantErrSub: "iterate active error vins",
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{rows: c.rows, queryErr: c.queryErr}
			repo := newErrorRepo(pool)

			got, err := repo.GetActiveErrorVINs(context.Background())

			if pool.queryCalls != 1 {
				t.Fatalf("queryCalls = %d, want 1", pool.queryCalls)
			}
			if pool.gotQuerySQL != selectActiveErrorVINsSQL {
				t.Errorf("SQL = %q, want selectActiveErrorVINsSQL constant", pool.gotQuerySQL)
			}
			if len(pool.gotQueryArgs) != 0 {
				t.Errorf("Query args = %v, want none", pool.gotQueryArgs)
			}

			if c.wantErr != nil {
				assertWrappedErr(t, err, c.wantErr, c.wantErrSub)
				if got != nil {
					t.Errorf("result = %v, want nil on error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != c.wantLen {
				t.Fatalf("len(result) = %d, want %d", len(got), c.wantLen)
			}
			if c.rows != nil && !c.rows.closed {
				t.Error("rows.Close() was not called")
			}
			// Spot-check the nullable mapping on the two-row case.
			if c.name == "two_rows_success" {
				if got[0].ResolvedAt == nil || !got[0].ResolvedAt.Equal(resolved) {
					t.Errorf("row0 ResolvedAt = %v, want %v", got[0].ResolvedAt, resolved)
				}
				if got[1].ResolvedAt != nil {
					t.Errorf("row1 ResolvedAt = %v, want nil (NULL column)", got[1].ResolvedAt)
				}
				if got[0].VIN != "VIN1" || got[1].VIN != "VIN2" {
					t.Errorf("VINs = %q,%q, want VIN1,VIN2", got[0].VIN, got[1].VIN)
				}
			}
		})
	}
}

// ---------------------------------------------------------------------------
// GetErrors.
// ---------------------------------------------------------------------------

func TestGetErrors(t *testing.T) {
	t.Parallel()

	fetched := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	reported := time.Date(2026, 3, 31, 23, 0, 0, 0, time.UTC)
	queryBoom := errors.New("pool exhausted")
	scanBoom := errors.New("null into non-pointer")
	iterBoom := errors.New("cursor died")

	okRow := []any{int64(9), "VINX", strPtr("E100"), strPtr("boom"), timePtr(reported), nil, fetched}

	cases := []struct {
		name       string
		vin        string
		limit      int
		offset     int
		rows       *fakeRows
		queryErr   error
		wantSQL    string
		wantArgs   []any
		wantLen    int
		wantErr    error
		wantErrSub string
	}{
		{
			name:     "with_vin_uses_filtered_sql",
			vin:      "VINX",
			limit:    25,
			offset:   5,
			rows:     &fakeRows{data: [][]any{okRow}},
			wantSQL:  selectErrorsByVINSQL,
			wantArgs: []any{"VINX", 25, 5},
			wantLen:  1,
		},
		{
			name:     "no_vin_uses_all_sql",
			vin:      "",
			limit:    10,
			offset:   0,
			rows:     &fakeRows{data: [][]any{okRow, okRow}},
			wantSQL:  selectErrorsAllSQL,
			wantArgs: []any{10, 0},
			wantLen:  2,
		},
		{
			name:     "zero_limit_clamped_in_args",
			vin:      "",
			limit:    0,
			offset:   -4,
			rows:     &fakeRows{data: nil},
			wantSQL:  selectErrorsAllSQL,
			wantArgs: []any{defaultErrorPageLimit, 0},
			wantLen:  0,
		},
		{
			name:     "over_max_limit_clamped_with_vin",
			vin:      "VINY",
			limit:    9999,
			offset:   2,
			rows:     &fakeRows{data: nil},
			wantSQL:  selectErrorsByVINSQL,
			wantArgs: []any{"VINY", defaultErrorPageLimit, 2},
			wantLen:  0,
		},
		{
			name:       "query_error_wrapped",
			vin:        "VINX",
			limit:      10,
			queryErr:   queryBoom,
			wantSQL:    selectErrorsByVINSQL,
			wantArgs:   []any{"VINX", 10, 0},
			wantErr:    queryBoom,
			wantErrSub: "query fleet telemetry errors",
		},
		{
			name:       "scan_error_wrapped",
			vin:        "",
			limit:      10,
			rows:       &fakeRows{data: [][]any{okRow}, scanErr: scanBoom, scanErrAt: 1},
			wantSQL:    selectErrorsAllSQL,
			wantArgs:   []any{10, 0},
			wantErr:    scanBoom,
			wantErrSub: "scan fleet telemetry error",
		},
		{
			name:       "rows_err_wrapped",
			vin:        "",
			limit:      10,
			rows:       &fakeRows{data: [][]any{okRow}, errVal: iterBoom},
			wantSQL:    selectErrorsAllSQL,
			wantArgs:   []any{10, 0},
			wantErr:    iterBoom,
			wantErrSub: "iterate fleet telemetry errors",
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{rows: c.rows, queryErr: c.queryErr}
			repo := newErrorRepo(pool)

			got, err := repo.GetErrors(context.Background(), c.vin, c.limit, c.offset)

			if pool.queryCalls != 1 {
				t.Fatalf("queryCalls = %d, want 1", pool.queryCalls)
			}
			if pool.gotQuerySQL != c.wantSQL {
				t.Errorf("SQL = %q, want %q", pool.gotQuerySQL, c.wantSQL)
			}
			if !reflect.DeepEqual(pool.gotQueryArgs, c.wantArgs) {
				t.Errorf("Query args = %v, want %v", pool.gotQueryArgs, c.wantArgs)
			}

			if c.wantErr != nil {
				assertWrappedErr(t, err, c.wantErr, c.wantErrSub)
				if got != nil {
					t.Errorf("result = %v, want nil on error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != c.wantLen {
				t.Fatalf("len(result) = %d, want %d", len(got), c.wantLen)
			}
			if c.rows != nil && !c.rows.closed {
				t.Error("rows.Close() was not called")
			}
			if c.wantLen > 0 {
				if got[0].VIN != "VINX" || got[0].ErrorCode == nil || *got[0].ErrorCode != "E100" {
					t.Errorf("row0 = %+v, want VINX/E100", got[0])
				}
				if got[0].TeslaUpdatedAt != nil {
					t.Errorf("row0 TeslaUpdatedAt = %v, want nil (NULL column)", got[0].TeslaUpdatedAt)
				}
			}
		})
	}
}

// ---------------------------------------------------------------------------
// ReplaceErrorVINs.
// ---------------------------------------------------------------------------

func TestReplaceErrorVINs(t *testing.T) {
	t.Parallel()

	beginBoom := errors.New("no connection")
	execBoom := errors.New("deadlock")
	commitBoom := errors.New("commit failed")

	t.Run("non_empty_upserts_then_resolves_absent", func(t *testing.T) {
		t.Parallel()
		vins := []string{"VIN1", "VIN2"}
		tx := &fakeTx{rowsPerExec: 1}
		pool := &fakePool{tx: tx}
		repo := newErrorRepo(pool)

		if err := repo.ReplaceErrorVINs(context.Background(), vins); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if pool.beginCalls != 1 {
			t.Fatalf("beginCalls = %d, want 1", pool.beginCalls)
		}
		// 2 upserts + 1 resolve.
		if len(tx.execs) != 3 {
			t.Fatalf("exec count = %d, want 3", len(tx.execs))
		}
		for i, vin := range vins {
			if tx.execs[i].SQL != upsertErrorVINSQL {
				t.Errorf("exec[%d] SQL = %q, want upsertErrorVINSQL", i, tx.execs[i].SQL)
			}
			if len(tx.execs[i].Args) != 2 || tx.execs[i].Args[0] != any(vin) {
				t.Errorf("exec[%d] args = %v, want [%s now]", i, tx.execs[i].Args, vin)
			}
			if _, ok := tx.execs[i].Args[1].(time.Time); !ok {
				t.Errorf("exec[%d] arg[1] = %T, want time.Time", i, tx.execs[i].Args[1])
			}
		}
		resolve := tx.execs[2]
		if resolve.SQL != resolveAbsentVINsSQL {
			t.Errorf("resolve SQL = %q, want resolveAbsentVINsSQL", resolve.SQL)
		}
		if len(resolve.Args) != 2 {
			t.Fatalf("resolve args = %v, want [now vins]", resolve.Args)
		}
		gotVins, ok := resolve.Args[1].([]string)
		if !ok || !reflect.DeepEqual(gotVins, vins) {
			t.Errorf("resolve arg[1] = %v, want %v", resolve.Args[1], vins)
		}
		if !tx.committed {
			t.Error("transaction was not committed")
		}
	})

	t.Run("empty_resolves_all_active", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{rowsPerExec: 1}
		pool := &fakePool{tx: tx}
		repo := newErrorRepo(pool)

		if err := repo.ReplaceErrorVINs(context.Background(), nil); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(tx.execs) != 1 {
			t.Fatalf("exec count = %d, want 1 (resolve-all only)", len(tx.execs))
		}
		if tx.execs[0].SQL != resolveAllActiveVINsSQL {
			t.Errorf("SQL = %q, want resolveAllActiveVINsSQL", tx.execs[0].SQL)
		}
		if len(tx.execs[0].Args) != 1 {
			t.Errorf("args = %v, want [now]", tx.execs[0].Args)
		}
		if !tx.committed {
			t.Error("transaction was not committed")
		}
	})

	t.Run("begin_error_wrapped", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{beginErr: beginBoom}
		repo := newErrorRepo(pool)
		err := repo.ReplaceErrorVINs(context.Background(), []string{"VIN1"})
		assertWrappedErr(t, err, beginBoom, "begin tx")
	})

	t.Run("upsert_exec_error_wrapped_no_commit", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{execErr: execBoom, execErrAt: 1}
		pool := &fakePool{tx: tx}
		repo := newErrorRepo(pool)
		err := repo.ReplaceErrorVINs(context.Background(), []string{"VINBAD", "VIN2"})
		assertWrappedErr(t, err, execBoom, "upsert error vin VINBAD")
		if tx.committed {
			t.Error("must not commit after an upsert failure")
		}
		if !tx.rolledBack {
			t.Error("deferred Rollback must run on the error path")
		}
	})

	t.Run("resolve_exec_error_wrapped", func(t *testing.T) {
		t.Parallel()
		// Two upserts succeed (calls 1,2); the resolve (call 3) fails.
		tx := &fakeTx{execErr: execBoom, execErrAt: 3, rowsPerExec: 1}
		pool := &fakePool{tx: tx}
		repo := newErrorRepo(pool)
		err := repo.ReplaceErrorVINs(context.Background(), []string{"VIN1", "VIN2"})
		assertWrappedErr(t, err, execBoom, "mark resolved error vins")
		if tx.committed {
			t.Error("must not commit after a resolve failure")
		}
	})

	t.Run("commit_error_wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{rowsPerExec: 1, commitErr: commitBoom}
		pool := &fakePool{tx: tx}
		repo := newErrorRepo(pool)
		err := repo.ReplaceErrorVINs(context.Background(), []string{"VIN1"})
		assertWrappedErr(t, err, commitBoom, "commit error vins")
	})
}

// ---------------------------------------------------------------------------
// UpsertErrors.
// ---------------------------------------------------------------------------

func TestUpsertErrors(t *testing.T) {
	t.Parallel()

	beginBoom := errors.New("no connection")
	execBoom := errors.New("constraint violation")
	commitBoom := errors.New("commit failed")
	fetched := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)

	mkErr := func(vin, code string) *telemetrymodel.TeslaFleetTelemetryError {
		return &telemetrymodel.TeslaFleetTelemetryError{
			VIN:       vin,
			ErrorCode: strPtr(code),
			FetchedAt: fetched,
		}
	}

	t.Run("empty_slice_short_circuits", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{}
		repo := newErrorRepo(pool)
		n, err := repo.UpsertErrors(context.Background(), nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if n != 0 {
			t.Errorf("inserted = %d, want 0", n)
		}
		if pool.beginCalls != 0 {
			t.Errorf("beginCalls = %d, want 0 (no tx for empty batch)", pool.beginCalls)
		}
	})

	t.Run("multiple_entries_sum_rows_affected", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{rowsPerExec: 1}
		pool := &fakePool{tx: tx}
		repo := newErrorRepo(pool)
		entries := []*telemetrymodel.TeslaFleetTelemetryError{
			mkErr("VIN1", "E1"), mkErr("VIN2", "E2"), mkErr("VIN3", "E3"),
		}
		n, err := repo.UpsertErrors(context.Background(), entries)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if n != 3 {
			t.Errorf("inserted = %d, want 3", n)
		}
		if len(tx.execs) != 3 {
			t.Fatalf("exec count = %d, want 3", len(tx.execs))
		}
		for i, e := range entries {
			if tx.execs[i].SQL != upsertErrorSQL {
				t.Errorf("exec[%d] SQL = %q, want upsertErrorSQL", i, tx.execs[i].SQL)
			}
			if len(tx.execs[i].Args) != 6 {
				t.Fatalf("exec[%d] args = %v, want 6", i, tx.execs[i].Args)
			}
			if tx.execs[i].Args[0] != any(e.VIN) {
				t.Errorf("exec[%d] arg[0] = %v, want %s", i, tx.execs[i].Args[0], e.VIN)
			}
		}
		if !tx.committed {
			t.Error("transaction was not committed")
		}
	})

	t.Run("nil_entry_skipped_no_panic", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{rowsPerExec: 1}
		pool := &fakePool{tx: tx}
		repo := newErrorRepo(pool)
		entries := []*telemetrymodel.TeslaFleetTelemetryError{
			mkErr("VIN1", "E1"), nil, mkErr("VIN2", "E2"),
		}
		n, err := repo.UpsertErrors(context.Background(), entries)
		if err != nil {
			t.Fatalf("unexpected error (nil entry must be skipped, not panic): %v", err)
		}
		if n != 2 {
			t.Errorf("inserted = %d, want 2 (nil entry skipped)", n)
		}
		if len(tx.execs) != 2 {
			t.Errorf("exec count = %d, want 2", len(tx.execs))
		}
		if !tx.committed {
			t.Error("transaction was not committed")
		}
	})

	t.Run("all_nil_entries_commit_zero", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{rowsPerExec: 1}
		pool := &fakePool{tx: tx}
		repo := newErrorRepo(pool)
		entries := []*telemetrymodel.TeslaFleetTelemetryError{nil, nil}
		n, err := repo.UpsertErrors(context.Background(), entries)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if n != 0 {
			t.Errorf("inserted = %d, want 0", n)
		}
		if len(tx.execs) != 0 {
			t.Errorf("exec count = %d, want 0", len(tx.execs))
		}
		if !tx.committed {
			t.Error("transaction should still commit (empty effective batch)")
		}
	})

	t.Run("begin_error_wrapped", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{beginErr: beginBoom}
		repo := newErrorRepo(pool)
		n, err := repo.UpsertErrors(context.Background(), []*telemetrymodel.TeslaFleetTelemetryError{mkErr("VIN1", "E1")})
		assertWrappedErr(t, err, beginBoom, "begin tx")
		if n != 0 {
			t.Errorf("inserted = %d, want 0 on error", n)
		}
	})

	t.Run("exec_error_wrapped_no_commit", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{execErr: execBoom, execErrAt: 2, rowsPerExec: 1}
		pool := &fakePool{tx: tx}
		repo := newErrorRepo(pool)
		n, err := repo.UpsertErrors(context.Background(), []*telemetrymodel.TeslaFleetTelemetryError{
			mkErr("VIN1", "E1"), mkErr("VIN2", "E2"),
		})
		assertWrappedErr(t, err, execBoom, "upsert fleet telemetry error")
		if n != 0 {
			t.Errorf("inserted = %d, want 0 on error", n)
		}
		if tx.committed {
			t.Error("must not commit after an exec failure")
		}
		if !tx.rolledBack {
			t.Error("deferred Rollback must run on the error path")
		}
	})

	t.Run("commit_error_wrapped", func(t *testing.T) {
		t.Parallel()
		tx := &fakeTx{rowsPerExec: 1, commitErr: commitBoom}
		pool := &fakePool{tx: tx}
		repo := newErrorRepo(pool)
		n, err := repo.UpsertErrors(context.Background(), []*telemetrymodel.TeslaFleetTelemetryError{mkErr("VIN1", "E1")})
		assertWrappedErr(t, err, commitBoom, "commit fleet telemetry errors")
		if n != 0 {
			t.Errorf("inserted = %d, want 0 on commit error", n)
		}
	})
}

// ---------------------------------------------------------------------------
// SQL-shape guards. Pin critical fragments so a column/table/clause typo is
// caught at test time rather than at runtime (matches the sibling repos'
// SQL-shape precedent).
// ---------------------------------------------------------------------------

func TestFleetErrorSQL_Shapes(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name        string
		sql         string
		mustContain []string
		mustNot     []string
	}{
		{
			name: "selectActiveErrorVINsSQL",
			sql:  selectActiveErrorVINsSQL,
			mustContain: []string{
				"SELECT id, vin, active, first_seen_at, last_seen_at, resolved_at",
				"FROM tesla_fleet_telemetry_error_vins",
				"WHERE active = TRUE",
				"ORDER BY last_seen_at DESC",
			},
			mustNot: []string{"INSERT", "UPDATE ", "DELETE"},
		},
		{
			name: "upsertErrorVINSQL",
			sql:  upsertErrorVINSQL,
			mustContain: []string{
				"INSERT INTO tesla_fleet_telemetry_error_vins (vin, active, first_seen_at, last_seen_at)",
				"VALUES ($1, TRUE, $2, $2)",
				"ON CONFLICT (vin) DO UPDATE SET",
				"resolved_at = NULL",
			},
		},
		{
			name: "resolveAbsentVINsSQL",
			sql:  resolveAbsentVINsSQL,
			mustContain: []string{
				"UPDATE tesla_fleet_telemetry_error_vins",
				"SET active = FALSE, resolved_at = $1",
				"WHERE active = TRUE AND vin != ALL($2)",
			},
		},
		{
			name: "resolveAllActiveVINsSQL",
			sql:  resolveAllActiveVINsSQL,
			mustContain: []string{
				"UPDATE tesla_fleet_telemetry_error_vins",
				"SET active = FALSE, resolved_at = $1",
				"WHERE active = TRUE",
			},
			mustNot: []string{"ALL(", "!="},
		},
		{
			name: "selectErrorsByVINSQL",
			sql:  selectErrorsByVINSQL,
			mustContain: []string{
				"FROM tesla_fleet_telemetry_errors",
				"WHERE vin = $1",
				"ORDER BY fetched_at DESC",
				"LIMIT $2 OFFSET $3",
			},
		},
		{
			name: "selectErrorsAllSQL",
			sql:  selectErrorsAllSQL,
			mustContain: []string{
				"FROM tesla_fleet_telemetry_errors",
				"ORDER BY fetched_at DESC",
				"LIMIT $1 OFFSET $2",
			},
			mustNot: []string{"WHERE vin"},
		},
		{
			name: "upsertErrorSQL",
			sql:  upsertErrorSQL,
			mustContain: []string{
				"INSERT INTO tesla_fleet_telemetry_errors (vin, error_code, error_message, reported_at, tesla_updated_at, fetched_at)",
				"VALUES ($1, $2, $3, $4, $5, $6)",
				"ON CONFLICT (vin, error_code, reported_at) DO UPDATE SET",
				"error_message = EXCLUDED.error_message",
			},
		},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			for _, frag := range c.mustContain {
				if !strings.Contains(c.sql, frag) {
					t.Errorf("%s missing %q\nfull SQL:\n%s", c.name, frag, c.sql)
				}
			}
			for _, frag := range c.mustNot {
				if strings.Contains(c.sql, frag) {
					t.Errorf("%s must not contain %q\nfull SQL:\n%s", c.name, frag, c.sql)
				}
			}
		})
	}
}

// assertWrappedErr fails the test unless err is non-nil, wraps sentinel, and
// its message contains the operational context substring.
func assertWrappedErr(t *testing.T, err, sentinel error, sub string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error wrapping %v, got nil", sentinel)
	}
	if !errors.Is(err, sentinel) {
		t.Errorf("error %v does not wrap sentinel %v", err, sentinel)
	}
	if !strings.Contains(err.Error(), sub) {
		t.Errorf("error %q missing context %q", err.Error(), sub)
	}
}
