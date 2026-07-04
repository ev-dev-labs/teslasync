package observability

import (
	"context"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// HypertableMetricsRepo powers the disk-capacity operator warning. The
// Forecast math (linear growth over a 30-day window → est-days-to-quota
// → severity band) is the risk here, so it gets exhaustive coverage
// alongside the timescaledb-absent degradation path.

func TestNewHypertableMetricsRepo(t *testing.T) {
	t.Parallel()
	if r := NewHypertableMetricsRepo(nil); r != nil {
		t.Error("nil db should yield nil repo")
	}
	if r := NewHypertableMetricsRepo(&database.DB{}); r != nil {
		t.Error("nil pool should yield nil repo")
	}
	if r := NewHypertableMetricsRepo(&database.DB{Pool: &pgxpool.Pool{}}); r == nil {
		t.Error("db+pool should yield non-nil repo")
	}
}

func TestHypertableMetricsRepo_CurrentSizes_NilReceiver(t *testing.T) {
	t.Parallel()
	var r *HypertableMetricsRepo
	got, err := r.CurrentSizes(context.Background())
	if err != nil || got != nil {
		t.Errorf("nil receiver = (%v, %v), want (nil, nil)", got, err)
	}
}

func TestHypertableMetricsRepo_CurrentSizes_QueryErrors(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name          string
		queryErr      error
		wantTimescale bool
	}{
		{"generic_error", errors.New("boom"), false},
		{"relation_missing_42P01", &pgconn.PgError{Code: "42P01"}, true},
		{"function_missing_42883", &pgconn.PgError{Code: "42883"}, true},
		{"object_missing_42704", &pgconn.PgError{Code: "42704"}, true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := (&fakeDBTX{}).pushQuery(nil, tt.queryErr)
			r := &HypertableMetricsRepo{exec: f}
			_, err := r.CurrentSizes(context.Background())
			if tt.wantTimescale {
				if !errors.Is(err, ErrTimescaleUnavailable) {
					t.Errorf("want ErrTimescaleUnavailable, got %v", err)
				}
			} else if err == nil || errors.Is(err, ErrTimescaleUnavailable) {
				t.Errorf("want wrapped generic error, got %v", err)
			}
		})
	}
}

func TestHypertableMetricsRepo_CurrentSizes_Happy(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushQuery(rowsFrom(
		scanRow("signal_log", int64(1000), int64(1200), int64(300), int64(9)),
		scanRow("drives", int64(500), int64(0), int64(0), int64(3)),
	), nil)
	r := &HypertableMetricsRepo{exec: f}
	got, err := r.CurrentSizes(context.Background())
	if err != nil {
		t.Fatalf("CurrentSizes: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("rows = %d, want 2", len(got))
	}
	if got[0].HypertableName != "signal_log" || got[0].TotalBytes != 1000 || got[0].ChunkCount != 9 {
		t.Errorf("row0 = %+v", got[0])
	}
	if got[1].UncompressedBytes != 0 || got[1].CompressedBytes != 0 {
		t.Errorf("row1 compression should be zero: %+v", got[1])
	}
}

func TestHypertableMetricsRepo_CurrentSizes_EmptyNonNil(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushQuery(rowsFrom(), nil)
	r := &HypertableMetricsRepo{exec: f}
	got, err := r.CurrentSizes(context.Background())
	if err != nil {
		t.Fatalf("CurrentSizes: %v", err)
	}
	if got == nil {
		t.Error("empty result should be a non-nil empty slice")
	}
	if len(got) != 0 {
		t.Errorf("len = %d, want 0", len(got))
	}
}

func TestHypertableMetricsRepo_CurrentSizes_ScanError(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushQuery(rowsFrom(func(dest ...any) error { return errors.New("scan boom") }), nil)
	r := &HypertableMetricsRepo{exec: f}
	_, err := r.CurrentSizes(context.Background())
	if err == nil || !contains(err.Error(), "scan") {
		t.Fatalf("want wrapped scan error, got %v", err)
	}
}

func TestHypertableMetricsRepo_Forecast_NilReceiver(t *testing.T) {
	t.Parallel()
	var r *HypertableMetricsRepo
	got, err := r.Forecast(context.Background(), 100)
	if err != nil || got != nil {
		t.Errorf("nil receiver = (%v, %v), want (nil, nil)", got, err)
	}
}

func TestHypertableMetricsRepo_Forecast_CurrentSizesError(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushQuery(nil, errors.New("boom"))
	r := &HypertableMetricsRepo{exec: f}
	if _, err := r.Forecast(context.Background(), 100); err == nil {
		t.Fatal("want error from CurrentSizes propagated")
	}
}

// TestHypertableMetricsRepo_Forecast_Math pins growth + severity banding.
// Each case uses a single hypertable so days = quota - total when growth
// is normalised to 1 unit/day (total - hist30 = 30).
func TestHypertableMetricsRepo_Forecast_Math(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name         string
		total        int64
		hist30       int64
		quota        int64
		wantSeverity string
		wantDays     *int
		wantGrowth   float64
	}{
		{"critical_within_7d", 100, 70, 105, "critical", intp(5), 1},
		{"warn_within_30d", 100, 70, 120, "warn", intp(20), 1},
		{"ok_beyond_30d", 100, 70, 150, "ok", intp(50), 1},
		{"at_quota_is_critical", 100, 70, 100, "critical", intp(0), 1},
		{"over_quota_is_critical", 100, 70, 90, "critical", intp(0), 1},
		{"no_growth_is_ok", 50, 80, 200, "ok", nil, 0},
		{"no_quota_is_ok", 100, 70, 0, "ok", nil, 1},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := (&fakeDBTX{}).
				pushQuery(rowsFrom(scanRow("ht", tt.total, int64(0), int64(0), int64(1))), nil).
				pushQuery(rowsFrom(scanRow("ht", tt.hist30)), nil)
			r := &HypertableMetricsRepo{exec: f}
			got, err := r.Forecast(context.Background(), tt.quota)
			if err != nil {
				t.Fatalf("Forecast: %v", err)
			}
			if len(got) != 1 {
				t.Fatalf("rows = %d, want 1", len(got))
			}
			s := got[0]
			if s.Severity != tt.wantSeverity {
				t.Errorf("severity = %q, want %q", s.Severity, tt.wantSeverity)
			}
			if s.GrowthBytesPerDay != tt.wantGrowth {
				t.Errorf("growth = %v, want %v", s.GrowthBytesPerDay, tt.wantGrowth)
			}
			switch {
			case tt.wantDays == nil && s.EstDaysToQuota != nil:
				t.Errorf("EstDaysToQuota = %d, want nil", *s.EstDaysToQuota)
			case tt.wantDays != nil && s.EstDaysToQuota == nil:
				t.Errorf("EstDaysToQuota = nil, want %d", *tt.wantDays)
			case tt.wantDays != nil && *s.EstDaysToQuota != *tt.wantDays:
				t.Errorf("EstDaysToQuota = %d, want %d", *s.EstDaysToQuota, *tt.wantDays)
			}
		})
	}
}

func TestHypertableMetricsRepo_Forecast_BytesAtCutoffTimescaleMissingTolerated(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).
		pushQuery(rowsFrom(scanRow("ht", int64(100), int64(0), int64(0), int64(1))), nil).
		pushQuery(nil, &pgconn.PgError{Code: "42P01"})
	r := &HypertableMetricsRepo{exec: f}
	got, err := r.Forecast(context.Background(), 200)
	if err != nil {
		t.Fatalf("timescale-missing history should be tolerated, got %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("rows = %d, want 1", len(got))
	}
	// prev=0 → delta=total → growth=100/30 > 0.
	if got[0].GrowthBytesPerDay <= 0 {
		t.Errorf("growth should be positive with missing history, got %v", got[0].GrowthBytesPerDay)
	}
}

func TestHypertableMetricsRepo_Forecast_BytesAtCutoffOtherError(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).
		pushQuery(rowsFrom(scanRow("ht", int64(100), int64(0), int64(0), int64(1))), nil).
		pushQuery(nil, errors.New("history boom"))
	r := &HypertableMetricsRepo{exec: f}
	if _, err := r.Forecast(context.Background(), 200); err == nil {
		t.Fatal("non-timescale history error should propagate")
	}
}

func TestHypertableMetricsRepo_BytesAtCutoff(t *testing.T) {
	t.Parallel()
	t.Run("happy", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsFrom(
			scanRow("signal_log", int64(4096)),
			scanRow("drives", int64(2048)),
		), nil)
		r := &HypertableMetricsRepo{exec: f}
		got, err := r.bytesAtCutoff(context.Background(), timeCutoff())
		if err != nil {
			t.Fatalf("bytesAtCutoff: %v", err)
		}
		if got["signal_log"] != 4096 || got["drives"] != 2048 {
			t.Errorf("map = %v", got)
		}
	})
	t.Run("generic_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(nil, errors.New("boom"))
		r := &HypertableMetricsRepo{exec: f}
		if _, err := r.bytesAtCutoff(context.Background(), timeCutoff()); err == nil || errors.Is(err, ErrTimescaleUnavailable) {
			t.Errorf("want wrapped generic error, got %v", err)
		}
	})
	t.Run("timescale_missing", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(nil, &pgconn.PgError{Code: "42883"})
		r := &HypertableMetricsRepo{exec: f}
		if _, err := r.bytesAtCutoff(context.Background(), timeCutoff()); !errors.Is(err, ErrTimescaleUnavailable) {
			t.Errorf("want ErrTimescaleUnavailable, got %v", err)
		}
	})
	t.Run("scan_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsFrom(func(dest ...any) error { return errors.New("scan boom") }), nil)
		r := &HypertableMetricsRepo{exec: f}
		if _, err := r.bytesAtCutoff(context.Background(), timeCutoff()); err == nil || !contains(err.Error(), "scan") {
			t.Errorf("want wrapped scan error, got %v", err)
		}
	})
}

func TestIsTimescaleMissing(t *testing.T) {
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
		{"other_pg_code", &pgconn.PgError{Code: "42501"}, false},
		{"non_pg_error", errors.New("boom"), false},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := isTimescaleMissing(tt.err); got != tt.want {
				t.Errorf("isTimescaleMissing(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}
