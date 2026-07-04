package tempimpact

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

// fp returns a heap pointer to a float literal, for building nullable
// column values in fake scan functions.
func fp(v float64) *float64 { return &v }

// approxEq compares two floats with a tolerance so rounding assertions do
// not trip over IEEE-754 representation error.
func approxEq(a, b float64) bool { return math.Abs(a-b) <= 1e-9 }

func getReq(target string) *http.Request {
	return httptest.NewRequest(http.MethodGet, target, nil)
}

// fakeTempImpactRepo is the in-memory tempImpactRepository used by handler
// tests so Get can be exercised end-to-end without a live pgx pool. It
// records the vehicle IDs each method was called with so tests can assert
// short-circuit / validation behaviour.
type fakeTempImpactRepo struct {
	eff       []tempEfficiencyBucket
	effErr    error
	trend     []monthlyTempTrend
	trendErr  error
	points    []drivePoint
	pointsErr error

	gotEffCalls    []int64
	gotTrendCalls  []int64
	gotPointsCalls []int64
}

func (f *fakeTempImpactRepo) EfficiencyBuckets(_ context.Context, vehicleID int64) ([]tempEfficiencyBucket, error) {
	f.gotEffCalls = append(f.gotEffCalls, vehicleID)
	if f.effErr != nil {
		return nil, f.effErr
	}
	return f.eff, nil
}

func (f *fakeTempImpactRepo) MonthlyTrend(_ context.Context, vehicleID int64) ([]monthlyTempTrend, error) {
	f.gotTrendCalls = append(f.gotTrendCalls, vehicleID)
	if f.trendErr != nil {
		return nil, f.trendErr
	}
	return f.trend, nil
}

func (f *fakeTempImpactRepo) DrivePoints(_ context.Context, vehicleID int64) ([]drivePoint, error) {
	f.gotPointsCalls = append(f.gotPointsCalls, vehicleID)
	if f.pointsErr != nil {
		return nil, f.pointsErr
	}
	return f.points, nil
}

var _ tempImpactRepository = (*fakeTempImpactRepo)(nil)

// fakePool is a tempImpactPool whose Query behaviour is supplied per test.
type fakePool struct {
	queryFn func(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func (p *fakePool) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return p.queryFn(ctx, sql, args...)
}

var _ tempImpactPool = (*fakePool)(nil)

// fakeRows is a generic pgx.Rows over a list of per-row scan closures, so
// each repo query (with its distinct column shape) can be driven without a
// database. iterErr is returned from Err() to simulate a mid-stream
// transport failure.
type fakeRows struct {
	scans   []func(dest ...any) error
	iterErr error
	pos     int
	closed  bool
}

func (r *fakeRows) Next() bool {
	if r.pos >= len(r.scans) {
		return false
	}
	r.pos++
	return true
}

func (r *fakeRows) Scan(dest ...any) error { return r.scans[r.pos-1](dest...) }
func (r *fakeRows) Close()                 { r.closed = true }
func (r *fakeRows) Err() error             { return r.iterErr }

func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

// --- per-row scan-closure builders -----------------------------------------

// effScan builds a scan closure matching efficiencyBucketsSQL's column
// list. A nil *float64 leaves the corresponding **float64 dest untouched,
// simulating a SQL NULL.
func effScan(bucket string, count int, dist, dur, bat, temp *float64) func(dest ...any) error {
	return func(dest ...any) error {
		*(dest[0].(*string)) = bucket
		*(dest[1].(*int)) = count
		if dist != nil {
			*(dest[2].(**float64)) = dist
		}
		if dur != nil {
			*(dest[3].(**float64)) = dur
		}
		if bat != nil {
			*(dest[4].(**float64)) = bat
		}
		if temp != nil {
			*(dest[5].(**float64)) = temp
		}
		return nil
	}
}

// trendScan builds a scan closure matching monthlyTrendSQL's column list.
func trendScan(month time.Time, temp, eff *float64, count int, total *float64) func(dest ...any) error {
	return func(dest ...any) error {
		*(dest[0].(*time.Time)) = month
		if temp != nil {
			*(dest[1].(**float64)) = temp
		}
		if eff != nil {
			*(dest[2].(**float64)) = eff
		}
		*(dest[3].(*int)) = count
		if total != nil {
			*(dest[4].(**float64)) = total
		}
		return nil
	}
}

// pointScan builds a scan closure matching drivePointsSQL's column list.
func pointScan(temp, eff, dist *float64, date time.Time) func(dest ...any) error {
	return func(dest ...any) error {
		if temp != nil {
			*(dest[0].(**float64)) = temp
		}
		if eff != nil {
			*(dest[1].(**float64)) = eff
		}
		if dist != nil {
			*(dest[2].(**float64)) = dist
		}
		*(dest[3].(*time.Time)) = date
		return nil
	}
}

func errScan(err error) func(dest ...any) error {
	return func(_ ...any) error { return err }
}

// ---------------------------------------------------------------------------
// parseVehicleID — validation
// ---------------------------------------------------------------------------

func TestParseVehicleID(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		raw     string
		wantID  int64
		wantErr string
	}{
		{"empty", "", 0, "vehicle_id query parameter required"},
		{"non_numeric", "abc", 0, "invalid vehicle_id"},
		{"float", "1.5", 0, "invalid vehicle_id"},
		{"leading_space", " 42", 0, "invalid vehicle_id"},
		{"zero", "0", 0, "invalid vehicle_id"},
		{"negative", "-5", 0, "invalid vehicle_id"},
		{"overflow", "9223372036854775808", 0, "invalid vehicle_id"},
		{"valid_one", "1", 1, ""},
		{"valid_large", "9223372036854775807", 9223372036854775807, ""},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			id, err := parseVehicleID(c.raw)
			if c.wantErr == "" {
				if err != nil {
					t.Fatalf("parseVehicleID(%q) err = %v, want nil", c.raw, err)
				}
				if id != c.wantID {
					t.Errorf("parseVehicleID(%q) id = %d, want %d", c.raw, id, c.wantID)
				}
				return
			}
			if err == nil {
				t.Fatalf("parseVehicleID(%q) err = nil, want %q", c.raw, c.wantErr)
			}
			if err.Error() != c.wantErr {
				t.Errorf("parseVehicleID(%q) err = %q, want %q", c.raw, err.Error(), c.wantErr)
			}
			if id != 0 {
				t.Errorf("parseVehicleID(%q) id = %d, want 0 on error", c.raw, id)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// round1 / round2 — pure display rounding
// ---------------------------------------------------------------------------

func TestRoundHelpers(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name         string
		in           float64
		want1, want2 float64
	}{
		{"zero", 0, 0, 0},
		{"one_decimal_down", 1.234, 1.2, 1.23},
		{"two_decimal_up", 5.678, 5.7, 5.68},
		{"negative", -3.146, -3.1, -3.15},
		{"already_round", 10, 10, 10},
		{"tiny", 0.014, 0, 0.01},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := round1(c.in); !approxEq(got, c.want1) {
				t.Errorf("round1(%v) = %v, want %v", c.in, got, c.want1)
			}
			if got := round2(c.in); !approxEq(got, c.want2) {
				t.Errorf("round2(%v) = %v, want %v", c.in, got, c.want2)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// roundEfficiency / roundTrend / roundPoints — non-nil + field rounding
// ---------------------------------------------------------------------------

func TestRoundEfficiency(t *testing.T) {
	t.Parallel()

	t.Run("nil_returns_empty_non_nil", func(t *testing.T) {
		t.Parallel()
		got := roundEfficiency(nil)
		if got == nil {
			t.Fatal("roundEfficiency(nil) = nil, want non-nil empty slice")
		}
		if len(got) != 0 {
			t.Errorf("len = %d, want 0", len(got))
		}
	})

	t.Run("rounds_and_preserves_labels", func(t *testing.T) {
		t.Parallel()
		got := roundEfficiency([]tempEfficiencyBucket{{
			TempBucket:         "10-20°C",
			DriveCount:         4,
			AvgDistanceKm:      15.674,
			AvgDurationS:       812.317,
			AvgBatteryPer100km: 22.229,
			AvgTemp:            5.53,
		}})
		if len(got) != 1 {
			t.Fatalf("len = %d, want 1", len(got))
		}
		b := got[0]
		if b.TempBucket != "10-20°C" || b.DriveCount != 4 {
			t.Errorf("label/count = %q/%d, want 10-20°C/4", b.TempBucket, b.DriveCount)
		}
		if !approxEq(b.AvgDistanceKm, 15.67) || !approxEq(b.AvgDurationS, 812.32) ||
			!approxEq(b.AvgBatteryPer100km, 22.23) || !approxEq(b.AvgTemp, 5.5) {
			t.Errorf("rounded = %+v, want {15.67 812.32 22.23 5.5}", b)
		}
	})
}

func TestRoundTrend(t *testing.T) {
	t.Parallel()

	t.Run("nil_returns_empty_non_nil", func(t *testing.T) {
		t.Parallel()
		got := roundTrend(nil)
		if got == nil || len(got) != 0 {
			t.Fatalf("roundTrend(nil) = %v, want non-nil empty", got)
		}
	})

	t.Run("rounds_and_preserves_month_count", func(t *testing.T) {
		t.Parallel()
		got := roundTrend([]monthlyTempTrend{{
			Month:         "2026-06",
			AvgTemp:       8.87,
			AvgEfficiency: 18.114,
			DriveCount:    10,
			TotalDistance: 234.56,
		}})
		if len(got) != 1 {
			t.Fatalf("len = %d, want 1", len(got))
		}
		tr := got[0]
		if tr.Month != "2026-06" || tr.DriveCount != 10 {
			t.Errorf("month/count = %q/%d, want 2026-06/10", tr.Month, tr.DriveCount)
		}
		if !approxEq(tr.AvgTemp, 8.9) || !approxEq(tr.AvgEfficiency, 18.11) || !approxEq(tr.TotalDistance, 234.6) {
			t.Errorf("rounded = %+v, want temp 8.9 eff 18.11 dist 234.6", tr)
		}
	})
}

func TestRoundPoints(t *testing.T) {
	t.Parallel()

	t.Run("nil_returns_empty_non_nil", func(t *testing.T) {
		t.Parallel()
		got := roundPoints(nil)
		if got == nil || len(got) != 0 {
			t.Fatalf("roundPoints(nil) = %v, want non-nil empty", got)
		}
	})

	t.Run("rounds_and_preserves_date", func(t *testing.T) {
		t.Parallel()
		got := roundPoints([]drivePoint{{
			OutsideTemp:    3.44,
			EfficiencyWhKm: 210.16,
			DistanceKm:     45.63,
			DriveDate:      "2026-06-15",
		}})
		if len(got) != 1 {
			t.Fatalf("len = %d, want 1", len(got))
		}
		p := got[0]
		if p.DriveDate != "2026-06-15" {
			t.Errorf("date = %q, want 2026-06-15", p.DriveDate)
		}
		if !approxEq(p.OutsideTemp, 3.4) || !approxEq(p.EfficiencyWhKm, 210.2) || !approxEq(p.DistanceKm, 45.6) {
			t.Errorf("rounded = %+v, want temp 3.4 eff 210.2 dist 45.6", p)
		}
	})
}

// ---------------------------------------------------------------------------
// newDBTempImpactRepo / NewHandler — wiring
// ---------------------------------------------------------------------------

func TestNewDBTempImpactRepo_NilPoolPanics(t *testing.T) {
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
					t.Errorf("newDBTempImpactRepo(%s) did not panic", c.name)
				}
			}()
			_ = newDBTempImpactRepo(c.db)
		})
	}
}

// TestNewHandler wires the production constructor. pgxpool.New parses the
// DSN but (with default MinConns=0) never opens a connection, so this
// exercises NewHandler + newDBTempImpactRepo's happy path without a DB.
func TestNewHandler(t *testing.T) {
	t.Parallel()
	pool, err := pgxpool.New(context.Background(), "postgres://u:p@127.0.0.1:1/db")
	if err != nil {
		t.Fatalf("pgxpool.New (parse-only) failed: %v", err)
	}
	defer pool.Close()

	h := NewHandler(&database.DB{Pool: pool})
	if h == nil {
		t.Fatal("NewHandler returned nil")
	}
	if h.repo == nil {
		t.Fatal("handler repo not wired")
	}
	if _, ok := h.repo.(*dbTempImpactRepo); !ok {
		t.Errorf("repo type = %T, want *dbTempImpactRepo", h.repo)
	}
}

// ---------------------------------------------------------------------------
// dbTempImpactRepo.EfficiencyBuckets — pgx-backed repo via fake pool
// ---------------------------------------------------------------------------

func TestDBTempImpactRepo_EfficiencyBuckets(t *testing.T) {
	t.Parallel()

	t.Run("query_error_wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("db down")
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) {
			return nil, sentinel
		}}
		repo := &dbTempImpactRepo{pool: pool}
		got, err := repo.EfficiencyBuckets(context.Background(), 1)
		if got != nil {
			t.Errorf("rows = %v, want nil on error", got)
		}
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "query temperature efficiency buckets") {
			t.Errorf("err = %v, want wrapped query error", err)
		}
	})

	t.Run("success_args_and_close", func(t *testing.T) {
		t.Parallel()
		rows := &fakeRows{scans: []func(dest ...any) error{
			effScan("Below 0°C", 2, fp(3.2), fp(600), fp(18.4), fp(-4.1)),
			effScan("10-20°C", 5, fp(12.1), fp(720), fp(15.0), fp(15.2)),
		}}
		pool := &fakePool{queryFn: func(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
			if !strings.Contains(sql, "FROM drives") {
				t.Errorf("unexpected sql: %s", sql)
			}
			if len(args) != 3 {
				t.Fatalf("args len = %d, want 3", len(args))
			}
			if args[0].(int64) != 7 {
				t.Errorf("args[0] = %v, want 7", args[0])
			}
			if args[1].(float64) != driveStatsMetersPerMile {
				t.Errorf("args[1] = %v, want %v", args[1], driveStatsMetersPerMile)
			}
			if args[2].(float64) != driveStatsTwoMilesMeters {
				t.Errorf("args[2] = %v, want %v", args[2], driveStatsTwoMilesMeters)
			}
			return rows, nil
		}}
		repo := &dbTempImpactRepo{pool: pool}
		got, err := repo.EfficiencyBuckets(context.Background(), 7)
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		if len(got) != 2 || got[0].TempBucket != "Below 0°C" || got[1].TempBucket != "10-20°C" {
			t.Fatalf("rows = %+v, want two buckets", got)
		}
		if got[0].DriveCount != 2 || !approxEq(got[0].AvgDistanceKm, 3.2) || !approxEq(got[0].AvgTemp, -4.1) {
			t.Errorf("row0 = %+v, want raw scanned values", got[0])
		}
		if !rows.closed {
			t.Error("rows.Close() not called (defer missing)")
		}
	})

	t.Run("null_columns_default_zero", func(t *testing.T) {
		t.Parallel()
		rows := &fakeRows{scans: []func(dest ...any) error{
			effScan("Above 30°C", 1, nil, nil, nil, nil),
		}}
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) { return rows, nil }}
		repo := &dbTempImpactRepo{pool: pool}
		got, err := repo.EfficiencyBuckets(context.Background(), 1)
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		if len(got) != 1 {
			t.Fatalf("len = %d, want 1", len(got))
		}
		b := got[0]
		if b.AvgDistanceKm != 0 || b.AvgDurationS != 0 || b.AvgBatteryPer100km != 0 || b.AvgTemp != 0 {
			t.Errorf("null columns = %+v, want all zero", b)
		}
	})

	t.Run("scan_error_fatal", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("scan boom")
		rows := &fakeRows{scans: []func(dest ...any) error{errScan(sentinel)}}
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) { return rows, nil }}
		repo := &dbTempImpactRepo{pool: pool}
		got, err := repo.EfficiencyBuckets(context.Background(), 1)
		if got != nil {
			t.Errorf("rows = %v, want nil on scan error", got)
		}
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "scan temperature efficiency row") {
			t.Errorf("err = %v, want wrapped scan error", err)
		}
	})

	t.Run("iteration_error_surfaced", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("mid-stream drop")
		rows := &fakeRows{
			scans:   []func(dest ...any) error{effScan("0-10°C", 1, fp(5), fp(60), fp(10), fp(3))},
			iterErr: sentinel,
		}
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) { return rows, nil }}
		repo := &dbTempImpactRepo{pool: pool}
		got, err := repo.EfficiencyBuckets(context.Background(), 1)
		if got != nil {
			t.Errorf("rows = %v, want nil on iteration error", got)
		}
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "iterate temperature efficiency rows") {
			t.Errorf("err = %v, want wrapped iterate error", err)
		}
	})

	t.Run("empty_non_nil", func(t *testing.T) {
		t.Parallel()
		rows := &fakeRows{scans: nil}
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) { return rows, nil }}
		repo := &dbTempImpactRepo{pool: pool}
		got, err := repo.EfficiencyBuckets(context.Background(), 1)
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		if got == nil || len(got) != 0 {
			t.Errorf("got = %v, want non-nil empty slice", got)
		}
	})
}

// ---------------------------------------------------------------------------
// dbTempImpactRepo.MonthlyTrend
// ---------------------------------------------------------------------------

func TestDBTempImpactRepo_MonthlyTrend(t *testing.T) {
	t.Parallel()

	t.Run("query_error_wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("db down")
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) {
			return nil, sentinel
		}}
		repo := &dbTempImpactRepo{pool: pool}
		got, err := repo.MonthlyTrend(context.Background(), 1)
		if got != nil {
			t.Errorf("rows = %v, want nil", got)
		}
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "query monthly temperature trend") {
			t.Errorf("err = %v, want wrapped query error", err)
		}
	})

	t.Run("success_formats_month", func(t *testing.T) {
		t.Parallel()
		june := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
		july := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
		rows := &fakeRows{scans: []func(dest ...any) error{
			trendScan(june, fp(12.5), fp(20.1), 8, fp(300.4)),
			trendScan(july, fp(18.0), fp(17.7), 12, fp(410.9)),
		}}
		pool := &fakePool{queryFn: func(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
			if !strings.Contains(sql, "DATE_TRUNC('month'") {
				t.Errorf("unexpected sql: %s", sql)
			}
			if len(args) != 3 || args[0].(int64) != 3 {
				t.Errorf("args = %v, want [3 ...]", args)
			}
			return rows, nil
		}}
		repo := &dbTempImpactRepo{pool: pool}
		got, err := repo.MonthlyTrend(context.Background(), 3)
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		if len(got) != 2 || got[0].Month != "2026-06" || got[1].Month != "2026-07" {
			t.Fatalf("rows = %+v, want months 2026-06/2026-07", got)
		}
		if got[0].DriveCount != 8 || !approxEq(got[0].AvgTemp, 12.5) || !approxEq(got[0].TotalDistance, 300.4) {
			t.Errorf("row0 = %+v, want raw scanned values", got[0])
		}
		if !rows.closed {
			t.Error("rows.Close() not called")
		}
	})

	t.Run("null_columns_default_zero", func(t *testing.T) {
		t.Parallel()
		rows := &fakeRows{scans: []func(dest ...any) error{
			trendScan(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), nil, nil, 4, nil),
		}}
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) { return rows, nil }}
		repo := &dbTempImpactRepo{pool: pool}
		got, err := repo.MonthlyTrend(context.Background(), 1)
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		if len(got) != 1 || got[0].Month != "2026-01" {
			t.Fatalf("rows = %+v, want one Jan row", got)
		}
		if got[0].AvgTemp != 0 || got[0].AvgEfficiency != 0 || got[0].TotalDistance != 0 {
			t.Errorf("null columns = %+v, want zero", got[0])
		}
	})

	t.Run("scan_error_fatal", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("scan boom")
		rows := &fakeRows{scans: []func(dest ...any) error{errScan(sentinel)}}
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) { return rows, nil }}
		repo := &dbTempImpactRepo{pool: pool}
		_, err := repo.MonthlyTrend(context.Background(), 1)
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "scan monthly trend row") {
			t.Errorf("err = %v, want wrapped scan error", err)
		}
	})

	t.Run("iteration_error_surfaced", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("mid-stream drop")
		rows := &fakeRows{
			scans:   []func(dest ...any) error{trendScan(time.Now(), fp(1), fp(1), 1, fp(1))},
			iterErr: sentinel,
		}
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) { return rows, nil }}
		repo := &dbTempImpactRepo{pool: pool}
		_, err := repo.MonthlyTrend(context.Background(), 1)
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "iterate monthly trend rows") {
			t.Errorf("err = %v, want wrapped iterate error", err)
		}
	})
}

// ---------------------------------------------------------------------------
// dbTempImpactRepo.DrivePoints
// ---------------------------------------------------------------------------

func TestDBTempImpactRepo_DrivePoints(t *testing.T) {
	t.Parallel()

	t.Run("query_error_wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("db down")
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) {
			return nil, sentinel
		}}
		repo := &dbTempImpactRepo{pool: pool}
		got, err := repo.DrivePoints(context.Background(), 1)
		if got != nil {
			t.Errorf("rows = %v, want nil", got)
		}
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "query drive points") {
			t.Errorf("err = %v, want wrapped query error", err)
		}
	})

	t.Run("success_formats_date", func(t *testing.T) {
		t.Parallel()
		d := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)
		rows := &fakeRows{scans: []func(dest ...any) error{
			pointScan(fp(3.5), fp(210.0), fp(45.6), d),
		}}
		pool := &fakePool{queryFn: func(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
			if !strings.Contains(sql, "LIMIT 500") {
				t.Errorf("unexpected sql: %s", sql)
			}
			if len(args) != 3 || args[0].(int64) != 9 {
				t.Errorf("args = %v, want [9 ...]", args)
			}
			return rows, nil
		}}
		repo := &dbTempImpactRepo{pool: pool}
		got, err := repo.DrivePoints(context.Background(), 9)
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		if len(got) != 1 || got[0].DriveDate != "2026-06-15" {
			t.Fatalf("rows = %+v, want one 2026-06-15 point", got)
		}
		if !approxEq(got[0].OutsideTemp, 3.5) || !approxEq(got[0].DistanceKm, 45.6) {
			t.Errorf("row0 = %+v, want raw scanned values", got[0])
		}
		if !rows.closed {
			t.Error("rows.Close() not called")
		}
	})

	t.Run("scan_error_row_skipped_not_fatal", func(t *testing.T) {
		t.Parallel()
		good := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
		later := time.Date(2026, 5, 2, 0, 0, 0, 0, time.UTC)
		rows := &fakeRows{scans: []func(dest ...any) error{
			pointScan(fp(1), fp(2), fp(3), good),
			errScan(errors.New("bad row")),
			pointScan(fp(4), fp(5), fp(6), later),
		}}
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) { return rows, nil }}
		repo := &dbTempImpactRepo{pool: pool}
		got, err := repo.DrivePoints(context.Background(), 1)
		if err != nil {
			t.Fatalf("err = %v, want nil (bad row skipped, not fatal)", err)
		}
		if len(got) != 2 {
			t.Fatalf("len = %d, want 2 (middle row skipped)", len(got))
		}
		if got[0].DriveDate != "2026-05-01" || got[1].DriveDate != "2026-05-02" {
			t.Errorf("dates = %q/%q, want 2026-05-01/2026-05-02", got[0].DriveDate, got[1].DriveDate)
		}
	})

	t.Run("iteration_error_surfaced", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("mid-stream drop")
		rows := &fakeRows{
			scans:   []func(dest ...any) error{pointScan(fp(1), fp(2), fp(3), time.Now())},
			iterErr: sentinel,
		}
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) { return rows, nil }}
		repo := &dbTempImpactRepo{pool: pool}
		got, err := repo.DrivePoints(context.Background(), 1)
		if got != nil {
			t.Errorf("rows = %v, want nil on iteration error", got)
		}
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "iterate drive point rows") {
			t.Errorf("err = %v, want wrapped iterate error", err)
		}
	})

	t.Run("null_columns_default_zero", func(t *testing.T) {
		t.Parallel()
		d := time.Date(2026, 3, 3, 0, 0, 0, 0, time.UTC)
		rows := &fakeRows{scans: []func(dest ...any) error{pointScan(nil, nil, nil, d)}}
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) { return rows, nil }}
		repo := &dbTempImpactRepo{pool: pool}
		got, err := repo.DrivePoints(context.Background(), 1)
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		if len(got) != 1 || got[0].DriveDate != "2026-03-03" {
			t.Fatalf("rows = %+v, want one 2026-03-03 point", got)
		}
		if got[0].OutsideTemp != 0 || got[0].EfficiencyWhKm != 0 || got[0].DistanceKm != 0 {
			t.Errorf("null columns = %+v, want zero", got[0])
		}
	})
}

// ---------------------------------------------------------------------------
// Get — HTTP handler
// ---------------------------------------------------------------------------

func TestGet_BadVehicleID(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		query   string
		wantMsg string
	}{
		{"missing", "", "vehicle_id query parameter required"},
		{"empty", "vehicle_id=", "vehicle_id query parameter required"},
		{"non_numeric", "vehicle_id=abc", "invalid vehicle_id"},
		{"zero", "vehicle_id=0", "invalid vehicle_id"},
		{"negative", "vehicle_id=-5", "invalid vehicle_id"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeTempImpactRepo{}
			h := newHandler(repo)
			rec := httptest.NewRecorder()
			h.Get(rec, getReq("/analytics/temperature-impact?"+c.query))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), c.wantMsg) {
				t.Errorf("body missing %q\nbody=%s", c.wantMsg, rec.Body.String())
			}
			if len(repo.gotEffCalls) != 0 || len(repo.gotTrendCalls) != 0 || len(repo.gotPointsCalls) != 0 {
				t.Errorf("repo called for invalid vehicle_id — must validate first")
			}
		})
	}
}

func TestGet_Success(t *testing.T) {
	t.Parallel()
	repo := &fakeTempImpactRepo{
		eff: []tempEfficiencyBucket{{
			TempBucket: "10-20°C", DriveCount: 4,
			AvgDistanceKm: 15.674, AvgDurationS: 812.317, AvgBatteryPer100km: 22.229, AvgTemp: 5.53,
		}},
		trend: []monthlyTempTrend{{
			Month: "2026-06", AvgTemp: 8.87, AvgEfficiency: 18.114, DriveCount: 10, TotalDistance: 234.56,
		}},
		points: []drivePoint{{
			OutsideTemp: 3.44, EfficiencyWhKm: 210.16, DistanceKm: 45.63, DriveDate: "2026-06-15",
		}},
	}
	h := newHandler(repo)
	rec := httptest.NewRecorder()
	h.Get(rec, getReq("/analytics/temperature-impact?vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("content-type = %q, want application/json; charset=utf-8", ct)
	}
	if len(repo.gotEffCalls) != 1 || repo.gotEffCalls[0] != 42 {
		t.Errorf("efficiency called with %v, want [42]", repo.gotEffCalls)
	}

	var body struct {
		Points []struct {
			OutsideTemp    float64 `json:"outside_temp"`
			EfficiencyWhKm float64 `json:"efficiency_wh_km"`
			DistanceKm     float64 `json:"distance_km"`
			DriveDate      string  `json:"drive_date"`
		} `json:"points"`
		Efficiency []struct {
			TempBucket         string  `json:"temp_bucket"`
			DriveCount         int     `json:"drive_count"`
			AvgDistanceKm      float64 `json:"avg_distance_km"`
			AvgDurationS       float64 `json:"avg_duration_s"`
			AvgBatteryPer100km float64 `json:"avg_battery_pct_per_100km"`
			AvgTemp            float64 `json:"avg_temp"`
		} `json:"efficiency"`
		VampireDrain []vampireDrainBucket `json:"vampire_drain"`
		MonthlyTrend []struct {
			Month         string  `json:"month"`
			AvgTemp       float64 `json:"avg_temp"`
			AvgEfficiency float64 `json:"avg_efficiency"`
			DriveCount    int     `json:"drive_count"`
			TotalDistance float64 `json:"total_distance"`
		} `json:"monthly_trend"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}

	if len(body.Efficiency) != 1 {
		t.Fatalf("efficiency len = %d, want 1", len(body.Efficiency))
	}
	e := body.Efficiency[0]
	if e.TempBucket != "10-20°C" || e.DriveCount != 4 {
		t.Errorf("efficiency label/count = %q/%d, want 10-20°C/4", e.TempBucket, e.DriveCount)
	}
	if !approxEq(e.AvgDistanceKm, 15.67) || !approxEq(e.AvgDurationS, 812.32) ||
		!approxEq(e.AvgBatteryPer100km, 22.23) || !approxEq(e.AvgTemp, 5.5) {
		t.Errorf("efficiency not rounded: %+v", e)
	}

	if len(body.MonthlyTrend) != 1 {
		t.Fatalf("monthly_trend len = %d, want 1", len(body.MonthlyTrend))
	}
	tr := body.MonthlyTrend[0]
	if tr.Month != "2026-06" || tr.DriveCount != 10 {
		t.Errorf("trend month/count = %q/%d, want 2026-06/10", tr.Month, tr.DriveCount)
	}
	if !approxEq(tr.AvgTemp, 8.9) || !approxEq(tr.AvgEfficiency, 18.11) || !approxEq(tr.TotalDistance, 234.6) {
		t.Errorf("trend not rounded: %+v", tr)
	}

	if len(body.Points) != 1 {
		t.Fatalf("points len = %d, want 1", len(body.Points))
	}
	p := body.Points[0]
	if p.DriveDate != "2026-06-15" {
		t.Errorf("point date = %q, want 2026-06-15", p.DriveDate)
	}
	if !approxEq(p.OutsideTemp, 3.4) || !approxEq(p.EfficiencyWhKm, 210.2) || !approxEq(p.DistanceKm, 45.6) {
		t.Errorf("points not rounded: %+v", p)
	}

	if body.VampireDrain == nil {
		t.Error("vampire_drain = null, want [] (non-nil empty array)")
	}
	if len(body.VampireDrain) != 0 {
		t.Errorf("vampire_drain len = %d, want 0", len(body.VampireDrain))
	}
}

func TestGet_EfficiencyError_500(t *testing.T) {
	t.Parallel()
	repo := &fakeTempImpactRepo{effErr: errors.New("db down")}
	h := newHandler(repo)
	rec := httptest.NewRecorder()
	h.Get(rec, getReq("/analytics/temperature-impact?vehicle_id=1"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "failed to query temperature efficiency") {
		t.Errorf("body missing efficiency error\nbody=%s", rec.Body.String())
	}
	// Efficiency failure short-circuits: trend/points must not run.
	if len(repo.gotTrendCalls) != 0 || len(repo.gotPointsCalls) != 0 {
		t.Errorf("downstream repo methods ran after efficiency failure (trend=%d points=%d)",
			len(repo.gotTrendCalls), len(repo.gotPointsCalls))
	}
}

func TestGet_MonthlyTrendError_500(t *testing.T) {
	t.Parallel()
	repo := &fakeTempImpactRepo{trendErr: errors.New("db down")}
	h := newHandler(repo)
	rec := httptest.NewRecorder()
	h.Get(rec, getReq("/analytics/temperature-impact?vehicle_id=1"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "failed to query monthly trend") {
		t.Errorf("body missing monthly trend error\nbody=%s", rec.Body.String())
	}
	if len(repo.gotEffCalls) != 1 {
		t.Errorf("efficiency calls = %d, want 1 (ran before trend)", len(repo.gotEffCalls))
	}
	if len(repo.gotPointsCalls) != 0 {
		t.Errorf("points ran after trend failure (points=%d)", len(repo.gotPointsCalls))
	}
}

func TestGet_DrivePointsError_NonFatal(t *testing.T) {
	t.Parallel()
	repo := &fakeTempImpactRepo{
		eff:       []tempEfficiencyBucket{{TempBucket: "0-10°C", DriveCount: 1}},
		trend:     []monthlyTempTrend{{Month: "2026-06", DriveCount: 1}},
		pointsErr: errors.New("points blew up"),
	}
	h := newHandler(repo)
	rec := httptest.NewRecorder()
	h.Get(rec, getReq("/analytics/temperature-impact?vehicle_id=1"))

	// A drive-points failure must NOT sink the response.
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (points error must be non-fatal, body=%s)", rec.Code, rec.Body.String())
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := string(body["points"]); got != "[]" {
		t.Errorf("points = %s, want [] on non-fatal error", got)
	}
	if _, ok := body["efficiency"]; !ok {
		t.Error("efficiency key missing — primary payload should still be served")
	}
	if len(repo.gotPointsCalls) != 1 {
		t.Errorf("points calls = %d, want 1", len(repo.gotPointsCalls))
	}
}

func TestGet_EmptyResults_NonNilArrays(t *testing.T) {
	t.Parallel()
	repo := &fakeTempImpactRepo{} // all nil slices, no errors
	h := newHandler(repo)
	rec := httptest.NewRecorder()
	h.Get(rec, getReq("/analytics/temperature-impact?vehicle_id=1"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, key := range []string{"points", "efficiency", "vampire_drain", "monthly_trend"} {
		raw, ok := body[key]
		if !ok {
			t.Errorf("response missing key %q", key)
			continue
		}
		if string(raw) != "[]" {
			t.Errorf("%s = %s, want [] (never null)", key, string(raw))
		}
	}
}

// ---------------------------------------------------------------------------
// SQL-shape pins — catch schema drift without a live DB
// ---------------------------------------------------------------------------

func TestSQLShapes(t *testing.T) {
	t.Parallel()

	t.Run("efficiency_buckets", func(t *testing.T) {
		t.Parallel()
		for _, frag := range []string{
			"FROM drives", "vehicle_id = $1", "distance_m > $3", "distance_m / $2",
			"ambient_temp_c_avg IS NOT NULL", "GROUP BY temp_bucket", "COUNT(*)", "distance_m / 1000.0",
		} {
			if !strings.Contains(efficiencyBucketsSQL, frag) {
				t.Errorf("efficiencyBucketsSQL missing %q\nSQL: %s", frag, efficiencyBucketsSQL)
			}
		}
	})

	t.Run("monthly_trend", func(t *testing.T) {
		t.Parallel()
		for _, frag := range []string{
			"DATE_TRUNC('month', started_at)", "FROM drives", "vehicle_id = $1",
			"12 months", "GROUP BY month", "SUM(distance_m / 1000.0)",
		} {
			if !strings.Contains(monthlyTrendSQL, frag) {
				t.Errorf("monthlyTrendSQL missing %q\nSQL: %s", frag, monthlyTrendSQL)
			}
		}
	})

	t.Run("drive_points", func(t *testing.T) {
		t.Parallel()
		for _, frag := range []string{
			"FROM drives", "started_at::date", "distance_m / 1000.0", "LIMIT 500", "* 0.75",
		} {
			if !strings.Contains(drivePointsSQL, frag) {
				t.Errorf("drivePointsSQL missing %q\nSQL: %s", frag, drivePointsSQL)
			}
		}
	})

	t.Run("no_dropped_or_non_si_columns", func(t *testing.T) {
		t.Parallel()
		// Phase-42 dropped vampire_drain_events; Phase-48 forbids legacy
		// unit-suffixed columns on disk. None may reappear in the SQL.
		for _, sql := range []string{efficiencyBucketsSQL, monthlyTrendSQL, drivePointsSQL} {
			for _, banned := range []string{"vampire_drain", "distance_mi", "distance_km_stored", "_mph", "_kwh"} {
				if strings.Contains(sql, banned) {
					t.Errorf("SQL references forbidden token %q\nSQL: %s", banned, sql)
				}
			}
		}
	})

	t.Run("two_miles_constant", func(t *testing.T) {
		t.Parallel()
		if !approxEq(driveStatsTwoMilesMeters, 2*driveStatsMetersPerMile) {
			t.Errorf("driveStatsTwoMilesMeters = %v, want %v", driveStatsTwoMilesMeters, 2*driveStatsMetersPerMile)
		}
	})
}
