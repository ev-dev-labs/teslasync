package observability

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SlowQueriesRepo wraps pg_stat_statements. The pure helpers (order-by
// whitelist, fingerprint normalisation, extension-absent detection) are
// pinned directly; the read/write paths are driven through the fake to
// cover clamping, the fmt.Sprintf-injected sort column, and the 503
// degradation contract.

func TestSlowQueryOrderBy_Validate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		in      SlowQueryOrderBy
		wantErr bool
	}{
		{"mean", OrderByMeanTime, false},
		{"total", OrderByTotalTime, false},
		{"calls", OrderByCalls, false},
		{"empty", SlowQueryOrderBy(""), true},
		{"bogus", SlowQueryOrderBy("; DROP TABLE"), true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if err := tt.in.Validate(); (err != nil) != tt.wantErr {
				t.Errorf("Validate(%q) err = %v, wantErr %v", tt.in, err, tt.wantErr)
			}
		})
	}
}

func TestOrderByColumnLive(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in   SlowQueryOrderBy
		want string
	}{
		{OrderByMeanTime, "mean_exec_time"},
		{OrderByTotalTime, "total_exec_time"},
		{OrderByCalls, "calls"},
		{SlowQueryOrderBy("unknown"), "mean_exec_time"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(string(tt.in), func(t *testing.T) {
			t.Parallel()
			if got := orderByColumnLive(tt.in); got != tt.want {
				t.Errorf("orderByColumnLive(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestNormaliseFingerprint(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("a", 500)
	tests := []struct {
		name    string
		in      string
		wantLen int
		want    string
	}{
		{"collapse_whitespace", "SELECT   *\n\tFROM   t", 0, "SELECT * FROM t"},
		{"trim_edges", "   SELECT 1   ", 0, "SELECT 1"},
		{"short_unchanged", "SELECT 1", 0, "SELECT 1"},
		{"truncate_over_400", long, 400, ""},
		{"exact_400", strings.Repeat("b", 400), 400, ""},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := normaliseFingerprint(tt.in)
			if tt.want != "" && got != tt.want {
				t.Errorf("normaliseFingerprint(%q) = %q, want %q", tt.in, got, tt.want)
			}
			if tt.wantLen != 0 && len(got) != tt.wantLen {
				t.Errorf("len = %d, want %d", len(got), tt.wantLen)
			}
		})
	}
}

func TestIsMissingRelationError(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"relation_missing", &pgconn.PgError{Code: "42P01"}, true},
		{"function_missing", &pgconn.PgError{Code: "42883"}, true},
		{"object_missing", &pgconn.PgError{Code: "42704"}, true},
		{"not_loaded_55000", &pgconn.PgError{Code: "55000"}, true},
		{"other_pg_code", &pgconn.PgError{Code: "42501"}, false},
		{"non_pg_error", errors.New("boom"), false},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := isMissingRelationError(tt.err); got != tt.want {
				t.Errorf("isMissingRelationError(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

func TestNewSlowQueriesRepo(t *testing.T) {
	t.Parallel()
	if r := NewSlowQueriesRepo(nil); r != nil {
		t.Error("nil db should yield nil repo")
	}
	if r := NewSlowQueriesRepo(&database.DB{}); r != nil {
		t.Error("nil pool should yield nil repo")
	}
	if r := NewSlowQueriesRepo(&database.DB{Pool: &pgxpool.Pool{}}); r == nil {
		t.Error("db+pool should yield non-nil repo")
	}
}

func TestSlowQueriesRepo_TopLive_NilReceiver(t *testing.T) {
	t.Parallel()
	var r *SlowQueriesRepo
	got, err := r.TopLive(context.Background(), OrderByMeanTime, 10)
	if err != nil || got != nil {
		t.Errorf("nil receiver = (%v, %v), want (nil, nil)", got, err)
	}
}

func TestSlowQueriesRepo_TopLive_InvalidOrderBy(t *testing.T) {
	t.Parallel()
	f := &fakeDBTX{}
	r := &SlowQueriesRepo{exec: f}
	if _, err := r.TopLive(context.Background(), SlowQueryOrderBy("bogus"), 10); err == nil {
		t.Fatal("want error for invalid order_by")
	}
	if len(f.queryCalls) != 0 {
		t.Errorf("no query should run for invalid order_by, got %d", len(f.queryCalls))
	}
}

func TestSlowQueriesRepo_TopLive_ClampAndSortColumn(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		orderBy   SlowQueryOrderBy
		limit     int
		wantLimit int
		wantCol   string
	}{
		{"negative_limit", OrderByMeanTime, -1, 25, "mean_exec_time"},
		{"zero_limit", OrderByTotalTime, 0, 25, "total_exec_time"},
		{"over_max", OrderByCalls, 500, 200, "calls"},
		{"in_range", OrderByMeanTime, 42, 42, "mean_exec_time"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := (&fakeDBTX{}).pushQuery(rowsFrom(), nil)
			r := &SlowQueriesRepo{exec: f}
			if _, err := r.TopLive(context.Background(), tt.orderBy, tt.limit); err != nil {
				t.Fatalf("TopLive: %v", err)
			}
			call := f.lastQuery()
			if !strings.Contains(call.SQL, "ORDER BY "+tt.wantCol+" DESC") {
				t.Errorf("SQL missing ORDER BY %s: %s", tt.wantCol, call.SQL)
			}
			if got := call.Args[0].(int); got != tt.wantLimit {
				t.Errorf("limit arg = %d, want %d", got, tt.wantLimit)
			}
		})
	}
}

func TestSlowQueriesRepo_TopLive_QueryErrors(t *testing.T) {
	t.Parallel()
	t.Run("missing_relation_maps_to_unavailable", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(nil, &pgconn.PgError{Code: "42P01"})
		r := &SlowQueriesRepo{exec: f}
		if _, err := r.TopLive(context.Background(), OrderByMeanTime, 10); !errors.Is(err, ErrPgStatStatementsUnavailable) {
			t.Errorf("want ErrPgStatStatementsUnavailable, got %v", err)
		}
	})
	t.Run("generic_wrapped", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(nil, errors.New("boom"))
		r := &SlowQueriesRepo{exec: f}
		_, err := r.TopLive(context.Background(), OrderByMeanTime, 10)
		if err == nil || errors.Is(err, ErrPgStatStatementsUnavailable) || !strings.Contains(err.Error(), "live query") {
			t.Errorf("want wrapped generic error, got %v", err)
		}
	})
}

func TestSlowQueriesRepo_TopLive_Happy(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushQuery(rowsFrom(
		scanRow(int64(10), "SELECT   *\nFROM t", int64(5), 12.5, 2.5, 4.0, int64(100), ptr(int64(7)), ptr(int64(3))),
		scanRow(int64(11), "UPDATE t SET x=1", int64(2), 1.0, 0.5, 0.9, int64(2), nil, nil),
	), nil)
	r := &SlowQueriesRepo{exec: f}
	out, err := r.TopLive(context.Background(), OrderByMeanTime, 10)
	if err != nil {
		t.Fatalf("TopLive: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("rows = %d, want 2", len(out))
	}
	if out[0].Fingerprint != "SELECT * FROM t" {
		t.Errorf("fingerprint = %q, want normalised", out[0].Fingerprint)
	}
	if out[0].SharedBlksHit == nil || *out[0].SharedBlksHit != 7 {
		t.Errorf("shared_blks_hit = %v, want 7", out[0].SharedBlksHit)
	}
	if out[1].SharedBlksHit != nil || out[1].SharedBlksRead != nil {
		t.Errorf("row1 blks should be nil, got hit=%v read=%v", out[1].SharedBlksHit, out[1].SharedBlksRead)
	}
}

func TestSlowQueriesRepo_TopLive_EmptyNonNil(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushQuery(rowsFrom(), nil)
	r := &SlowQueriesRepo{exec: f}
	out, err := r.TopLive(context.Background(), OrderByMeanTime, 10)
	if err != nil {
		t.Fatalf("TopLive: %v", err)
	}
	if out == nil {
		t.Error("empty result should be non-nil empty slice")
	}
}

func TestSlowQueriesRepo_TopLive_ScanError(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushQuery(rowsFrom(func(dest ...any) error { return errors.New("scan boom") }), nil)
	r := &SlowQueriesRepo{exec: f}
	if _, err := r.TopLive(context.Background(), OrderByMeanTime, 10); err == nil || !strings.Contains(err.Error(), "scan") {
		t.Fatalf("want wrapped scan error, got %v", err)
	}
}

func TestSlowQueriesRepo_TopLive_RowsErr(t *testing.T) {
	t.Parallel()
	t.Run("missing_relation", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsErr(&pgconn.PgError{Code: "42P01"}), nil)
		r := &SlowQueriesRepo{exec: f}
		if _, err := r.TopLive(context.Background(), OrderByMeanTime, 10); !errors.Is(err, ErrPgStatStatementsUnavailable) {
			t.Errorf("want ErrPgStatStatementsUnavailable, got %v", err)
		}
	})
	t.Run("generic", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsErr(errors.New("iter boom")), nil)
		r := &SlowQueriesRepo{exec: f}
		if _, err := r.TopLive(context.Background(), OrderByMeanTime, 10); err == nil || !strings.Contains(err.Error(), "rows.Err") {
			t.Errorf("want wrapped rows.Err, got %v", err)
		}
	})
}

func TestSlowQueriesRepo_Snapshot(t *testing.T) {
	t.Parallel()
	t.Run("nil_receiver", func(t *testing.T) {
		t.Parallel()
		var r *SlowQueriesRepo
		n, err := r.Snapshot(context.Background())
		if n != 0 || err != nil {
			t.Errorf("nil receiver = (%d, %v), want (0, nil)", n, err)
		}
	})
	t.Run("rows_affected", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushExec(pgTag("INSERT 0 7"), nil)
		r := &SlowQueriesRepo{exec: f}
		n, err := r.Snapshot(context.Background())
		if err != nil || n != 7 {
			t.Errorf("Snapshot = (%d, %v), want (7, nil)", n, err)
		}
	})
	t.Run("missing_relation", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushExec(pgTag(""), &pgconn.PgError{Code: "55000"})
		r := &SlowQueriesRepo{exec: f}
		if _, err := r.Snapshot(context.Background()); !errors.Is(err, ErrPgStatStatementsUnavailable) {
			t.Errorf("want ErrPgStatStatementsUnavailable, got %v", err)
		}
	})
	t.Run("generic_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushExec(pgTag(""), errors.New("boom"))
		r := &SlowQueriesRepo{exec: f}
		if _, err := r.Snapshot(context.Background()); err == nil || errors.Is(err, ErrPgStatStatementsUnavailable) || !strings.Contains(err.Error(), "snapshot") {
			t.Errorf("want wrapped generic error, got %v", err)
		}
	})
}

func TestSlowQueriesRepo_HistoricalForQuery(t *testing.T) {
	t.Parallel()
	t.Run("nil_receiver", func(t *testing.T) {
		t.Parallel()
		var r *SlowQueriesRepo
		got, err := r.HistoricalForQuery(context.Background(), 1, 10)
		if got != nil || err != nil {
			t.Errorf("nil receiver = (%v, %v), want (nil, nil)", got, err)
		}
	})
	t.Run("limit_clamp", func(t *testing.T) {
		t.Parallel()
		for _, lim := range []int{0, -5, 5000} {
			f := (&fakeDBTX{}).pushQuery(rowsFrom(), nil)
			r := &SlowQueriesRepo{exec: f}
			if _, err := r.HistoricalForQuery(context.Background(), 99, lim); err != nil {
				t.Fatalf("HistoricalForQuery: %v", err)
			}
			args := f.lastQuery().Args
			if args[0].(int64) != 99 {
				t.Errorf("queryID arg = %v, want 99", args[0])
			}
			if args[1].(int) != 100 {
				t.Errorf("limit %d should clamp to 100, got %v", lim, args[1])
			}
		}
	})
	t.Run("query_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(nil, errors.New("boom"))
		r := &SlowQueriesRepo{exec: f}
		if _, err := r.HistoricalForQuery(context.Background(), 1, 10); err == nil || !strings.Contains(err.Error(), "historical") {
			t.Errorf("want wrapped historical error, got %v", err)
		}
	})
	t.Run("happy", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsFrom(
			scanRow(int64(10), "SELECT 1", int64(5), 12.5, 2.5, 4.0, int64(100), ptr(int64(7)), ptr(int64(3))),
		), nil)
		r := &SlowQueriesRepo{exec: f}
		out, err := r.HistoricalForQuery(context.Background(), 10, 50)
		if err != nil {
			t.Fatalf("HistoricalForQuery: %v", err)
		}
		if len(out) != 1 || out[0].QueryID != 10 || out[0].Fingerprint != "SELECT 1" {
			t.Errorf("out = %+v", out)
		}
		if out[0].SharedBlksHit == nil || *out[0].SharedBlksHit != 7 {
			t.Errorf("shared_blks_hit = %v, want 7", out[0].SharedBlksHit)
		}
	})
	t.Run("scan_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsFrom(func(dest ...any) error { return errors.New("scan boom") }), nil)
		r := &SlowQueriesRepo{exec: f}
		if _, err := r.HistoricalForQuery(context.Background(), 1, 10); err == nil || !strings.Contains(err.Error(), "scan historical") {
			t.Errorf("want wrapped scan error, got %v", err)
		}
	})
	t.Run("empty_non_nil", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsFrom(), nil)
		r := &SlowQueriesRepo{exec: f}
		out, err := r.HistoricalForQuery(context.Background(), 1, 10)
		if err != nil || out == nil {
			t.Errorf("want non-nil empty slice, got (%v, %v)", out, err)
		}
	})
	t.Run("rows_err", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsErr(errors.New("iter boom")), nil)
		r := &SlowQueriesRepo{exec: f}
		if _, err := r.HistoricalForQuery(context.Background(), 1, 10); err == nil || !strings.Contains(err.Error(), "historical rows") {
			t.Errorf("want wrapped rows error, got %v", err)
		}
	})
}
