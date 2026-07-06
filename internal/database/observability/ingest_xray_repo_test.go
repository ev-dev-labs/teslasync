package observability

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// IngestXRayRepo (plus the VehicleCostReport methods that share its
// receiver) answers operator "is this vehicle streaming, and what does
// it cost?" questions from signal_log. Tests pin the input validation,
// clamping, interval encoding, never-seen semantics, and the
// signal_log_failures-absent fallback.

func TestNewIngestXRayRepo_NilPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("NewIngestXRayRepo(nil) should panic")
		}
	}()
	_ = NewIngestXRayRepo(nil)
}

func TestNewIngestXRayRepo_Valid(t *testing.T) {
	t.Parallel()
	r := NewIngestXRayRepo(&pgxpool.Pool{})
	if r == nil || r.exec == nil {
		t.Error("valid pool should yield configured repo")
	}
}

func TestIngestXRayRepo_FieldStats_Guards(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	var nilRepo *IngestXRayRepo
	if _, err := nilRepo.FieldStats(ctx, 1, tref, 10); err == nil {
		t.Error("nil repo should error")
	}
	if _, err := (&IngestXRayRepo{}).FieldStats(ctx, 1, tref, 10); err == nil {
		t.Error("nil exec should error")
	}
	if _, err := (&IngestXRayRepo{exec: &fakeDBTX{}}).FieldStats(ctx, 0, tref, 10); err == nil {
		t.Error("vehicle_id <= 0 should error")
	}
}

func TestIngestXRayRepo_FieldStats_LimitClamp(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		limit int
		want  int
	}{
		{"negative", -1, 200},
		{"zero", 0, 200},
		{"over_max", 5000, 1000},
		{"in_range", 42, 42},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := (&fakeDBTX{}).pushQuery(rowsFrom(), nil)
			r := &IngestXRayRepo{exec: f}
			if _, err := r.FieldStats(context.Background(), 7, tref, tt.limit); err != nil {
				t.Fatalf("FieldStats: %v", err)
			}
			args := f.lastQuery().Args
			if args[0].(int64) != 7 {
				t.Errorf("vehicle_id arg = %v, want 7", args[0])
			}
			if args[2].(int) != tt.want {
				t.Errorf("limit arg = %v, want %d", args[2], tt.want)
			}
		})
	}
}

func TestIngestXRayRepo_FieldStats_QueryError(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushQuery(nil, errors.New("boom"))
	r := &IngestXRayRepo{exec: f}
	if _, err := r.FieldStats(context.Background(), 1, tref, 10); err == nil || !strings.Contains(err.Error(), "query") {
		t.Fatalf("want wrapped query error, got %v", err)
	}
}

func TestIngestXRayRepo_FieldStats_Happy(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushQuery(rowsFrom(
		scanRow("VehicleSpeed", int64(120), tref, int16(5)),
		scanRow("Gear", int64(40), tref.Add(-time.Minute), int16(1)),
	), nil)
	r := &IngestXRayRepo{exec: f}
	out, err := r.FieldStats(context.Background(), 7, tref, 10)
	if err != nil {
		t.Fatalf("FieldStats: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("rows = %d, want 2", len(out))
	}
	if out[0].Field != "VehicleSpeed" || out[0].SampleCount != 120 || out[0].ValueKind != 5 {
		t.Errorf("row0 = %+v", out[0])
	}
}

func TestIngestXRayRepo_FieldStats_ScanAndRowsErr(t *testing.T) {
	t.Parallel()
	t.Run("scan_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsFrom(func(dest ...any) error { return errors.New("scan boom") }), nil)
		r := &IngestXRayRepo{exec: f}
		if _, err := r.FieldStats(context.Background(), 1, tref, 10); err == nil || !strings.Contains(err.Error(), "scan") {
			t.Errorf("want wrapped scan error, got %v", err)
		}
	})
	t.Run("rows_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsErr(errors.New("iter boom")), nil)
		r := &IngestXRayRepo{exec: f}
		if _, err := r.FieldStats(context.Background(), 1, tref, 10); err == nil || !strings.Contains(err.Error(), "rows") {
			t.Errorf("want wrapped rows error, got %v", err)
		}
	})
}

func TestIngestXRayRepo_SampleCountByBucket_Guards(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	var nilRepo *IngestXRayRepo
	if _, err := nilRepo.SampleCountByBucket(ctx, 1, tref, time.Minute); err == nil {
		t.Error("nil repo should error")
	}
	if _, err := (&IngestXRayRepo{}).SampleCountByBucket(ctx, 1, tref, time.Minute); err == nil {
		t.Error("nil exec should error")
	}
	if _, err := (&IngestXRayRepo{exec: &fakeDBTX{}}).SampleCountByBucket(ctx, -1, tref, time.Minute); err == nil {
		t.Error("vehicle_id <= 0 should error")
	}
}

func TestIngestXRayRepo_SampleCountByBucket_IntervalEncoding(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		width time.Duration
		want  string
	}{
		{"default_on_zero", 0, time.Minute.String()},
		{"default_on_negative", -time.Second, time.Minute.String()},
		{"five_minutes", 5 * time.Minute, (5 * time.Minute).String()},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := (&fakeDBTX{}).pushQuery(rowsFrom(), nil)
			r := &IngestXRayRepo{exec: f}
			if _, err := r.SampleCountByBucket(context.Background(), 7, tref, tt.width); err != nil {
				t.Fatalf("SampleCountByBucket: %v", err)
			}
			if got := f.lastQuery().Args[2].(string); got != tt.want {
				t.Errorf("interval arg = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestIngestXRayRepo_SampleCountByBucket_Happy(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushQuery(rowsFrom(
		scanRow(tref, int64(30)),
		scanRow(tref.Add(time.Minute), int64(45)),
	), nil)
	r := &IngestXRayRepo{exec: f}
	out, err := r.SampleCountByBucket(context.Background(), 7, tref, time.Minute)
	if err != nil {
		t.Fatalf("SampleCountByBucket: %v", err)
	}
	if len(out) != 2 || out[0].Count != 30 || out[1].Count != 45 {
		t.Errorf("out = %+v", out)
	}
}

func TestIngestXRayRepo_SampleCountByBucket_Errors(t *testing.T) {
	t.Parallel()
	t.Run("query_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(nil, errors.New("boom"))
		r := &IngestXRayRepo{exec: f}
		if _, err := r.SampleCountByBucket(context.Background(), 1, tref, time.Minute); err == nil {
			t.Error("want query error")
		}
	})
	t.Run("scan_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsFrom(func(dest ...any) error { return errors.New("scan boom") }), nil)
		r := &IngestXRayRepo{exec: f}
		if _, err := r.SampleCountByBucket(context.Background(), 1, tref, time.Minute); err == nil {
			t.Error("want scan error")
		}
	})
	t.Run("rows_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsErr(errors.New("iter boom")), nil)
		r := &IngestXRayRepo{exec: f}
		if _, err := r.SampleCountByBucket(context.Background(), 1, tref, time.Minute); err == nil {
			t.Error("want rows error")
		}
	})
}

func TestIngestXRayRepo_LastSeen(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	t.Run("guards", func(t *testing.T) {
		t.Parallel()
		var nilRepo *IngestXRayRepo
		if _, err := nilRepo.LastSeen(ctx, 1); err == nil {
			t.Error("nil repo should error")
		}
		if _, err := (&IngestXRayRepo{}).LastSeen(ctx, 1); err == nil {
			t.Error("nil exec should error")
		}
		if _, err := (&IngestXRayRepo{exec: &fakeDBTX{}}).LastSeen(ctx, 0); err == nil {
			t.Error("vehicle_id <= 0 should error")
		}
	})
	t.Run("scan_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushRow(rowErr(errors.New("boom")))
		r := &IngestXRayRepo{exec: f}
		if _, err := r.LastSeen(ctx, 1); err == nil {
			t.Error("want scan error")
		}
	})
	t.Run("never_seen_returns_zero", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushRow(rowWith((*time.Time)(nil)))
		r := &IngestXRayRepo{exec: f}
		got, err := r.LastSeen(ctx, 1)
		if err != nil {
			t.Fatalf("LastSeen: %v", err)
		}
		if !got.IsZero() {
			t.Errorf("never-seen should return zero time, got %v", got)
		}
	})
	t.Run("returns_timestamp", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushRow(rowWith(ptr(tref)))
		r := &IngestXRayRepo{exec: f}
		got, err := r.LastSeen(ctx, 1)
		if err != nil {
			t.Fatalf("LastSeen: %v", err)
		}
		if !got.Equal(tref) {
			t.Errorf("LastSeen = %v, want %v", got, tref)
		}
	})
}

func TestIngestXRayRepo_VehicleCostReport_Guards(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	var nilRepo *IngestXRayRepo
	if _, err := nilRepo.VehicleCostReport(ctx, tref, 10); err == nil {
		t.Error("nil repo should error")
	}
	if _, err := (&IngestXRayRepo{}).VehicleCostReport(ctx, tref, 10); err == nil {
		t.Error("nil exec should error")
	}
}

func TestIngestXRayRepo_VehicleCostReport_LimitClamp(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		limit int
		want  int
	}{
		{"negative", -1, 100},
		{"zero", 0, 100},
		{"over_max", 5000, 1000},
		{"in_range", 250, 250},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := (&fakeDBTX{}).pushQuery(rowsFrom(), nil)
			r := &IngestXRayRepo{exec: f}
			if _, err := r.VehicleCostReport(context.Background(), tref, tt.limit); err != nil {
				t.Fatalf("VehicleCostReport: %v", err)
			}
			if got := f.lastQuery().Args[1].(int); got != tt.want {
				t.Errorf("limit arg = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestIngestXRayRepo_VehicleCostReport_Happy(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushQuery(rowsFrom(
		costRow(1, "Model 3", 1000, 96000, 5.0, 2),
		costRow(2, "Model Y", 500, 48000, 3.0, 1),
	), nil)
	r := &IngestXRayRepo{exec: f}
	rep, err := r.VehicleCostReport(context.Background(), tref, 100)
	if err != nil {
		t.Fatalf("VehicleCostReport: %v", err)
	}
	if len(rep.Vehicles) != 2 {
		t.Fatalf("vehicles = %d, want 2", len(rep.Vehicles))
	}
	if rep.Totals.TotalRows != 1500 || rep.Totals.TotalBytesEst != 144000 {
		t.Errorf("totals rows/bytes = %d/%d", rep.Totals.TotalRows, rep.Totals.TotalBytesEst)
	}
	if rep.Totals.TotalRate24h != 8.0 || rep.Totals.TotalFailures != 3 {
		t.Errorf("totals rate/failures = %v/%d", rep.Totals.TotalRate24h, rep.Totals.TotalFailures)
	}
	if rep.Vehicles[0].DisplayName == nil || *rep.Vehicles[0].DisplayName != "Model 3" {
		t.Errorf("display name = %v", rep.Vehicles[0].DisplayName)
	}
}

func TestIngestXRayRepo_VehicleCostReport_FallbackNoDLQ(t *testing.T) {
	t.Parallel()
	// Primary query hits a missing signal_log_failures relation → the
	// report must transparently fall back to the DLQ-less path.
	f := (&fakeDBTX{}).
		pushQuery(nil, &pgconn.PgError{Code: "42P01"}).
		pushQuery(rowsFrom(costRow(1, "Model 3", 1000, 96000, 5.0, 0)), nil)
	r := &IngestXRayRepo{exec: f}
	rep, err := r.VehicleCostReport(context.Background(), tref, 100)
	if err != nil {
		t.Fatalf("VehicleCostReport fallback: %v", err)
	}
	if len(rep.Vehicles) != 1 || rep.Totals.TotalRows != 1000 {
		t.Errorf("fallback report wrong: %+v", rep.Totals)
	}
	if rep.Totals.TotalFailures != 0 {
		t.Errorf("DLQ-less fallback should have zero failures, got %d", rep.Totals.TotalFailures)
	}
	if len(f.queryCalls) != 2 {
		t.Errorf("expected primary + fallback query, got %d calls", len(f.queryCalls))
	}
}

func TestIngestXRayRepo_VehicleCostReport_GenericQueryError(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushQuery(nil, errors.New("boom"))
	r := &IngestXRayRepo{exec: f}
	if _, err := r.VehicleCostReport(context.Background(), tref, 100); err == nil || !strings.Contains(err.Error(), "query") {
		t.Fatalf("want wrapped query error, got %v", err)
	}
}

func TestIngestXRayRepo_VehicleCostReport_ScanAndRowsErr(t *testing.T) {
	t.Parallel()
	t.Run("scan_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsFrom(func(dest ...any) error { return errors.New("scan boom") }), nil)
		r := &IngestXRayRepo{exec: f}
		if _, err := r.VehicleCostReport(context.Background(), tref, 100); err == nil || !strings.Contains(err.Error(), "scan") {
			t.Errorf("want wrapped scan error, got %v", err)
		}
	})
	t.Run("rows_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsErr(errors.New("iter boom")), nil)
		r := &IngestXRayRepo{exec: f}
		if _, err := r.VehicleCostReport(context.Background(), tref, 100); err == nil || !strings.Contains(err.Error(), "rows") {
			t.Errorf("want wrapped rows error, got %v", err)
		}
	})
}

func TestIngestXRayRepo_VehicleCostReportNoDLQ(t *testing.T) {
	t.Parallel()
	t.Run("query_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(nil, errors.New("boom"))
		r := &IngestXRayRepo{exec: f}
		if _, err := r.vehicleCostReportNoDLQ(context.Background(), tref, 100); err == nil || !strings.Contains(err.Error(), "query") {
			t.Errorf("want wrapped query error, got %v", err)
		}
	})
	t.Run("happy", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsFrom(
			costRow(1, "Model 3", 1000, 96000, 5.0, 0),
		), nil)
		r := &IngestXRayRepo{exec: f}
		rep, err := r.vehicleCostReportNoDLQ(context.Background(), tref, 100)
		if err != nil {
			t.Fatalf("vehicleCostReportNoDLQ: %v", err)
		}
		if len(rep.Vehicles) != 1 || rep.Totals.TotalRows != 1000 {
			t.Errorf("report wrong: %+v", rep)
		}
	})
	t.Run("rows_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsErr(errors.New("iter boom")), nil)
		r := &IngestXRayRepo{exec: f}
		if _, err := r.vehicleCostReportNoDLQ(context.Background(), tref, 100); err == nil || !strings.Contains(err.Error(), "rows") {
			t.Errorf("want wrapped rows error, got %v", err)
		}
	})
}

// costRow builds the 7-column VehicleCostReport projection.
func costRow(id int64, name string, rows, bytes int64, rate float64, fails int64) func(dest ...any) error {
	return scanRow(id, ptr(name), rows, bytes, rate, fails, tref)
}
