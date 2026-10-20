// Hermetic tests for the deterministic period-stats aggregate + handler.
//
// The package reads through the narrow statsQuerier seam, so every path here
// runs against an in-memory fake — no live database, no network. Tests pin:
//   - Handler.Get request validation (missing / invalid vehicle_id).
//   - The exact 6-key JSON envelope + rounding the chart and AI narration quote.
//   - The SI → display-unit conversion and Wh/km efficiency math.
//   - Charging-query failures are errors, not successful measured zeros.
//   - The drives-query error path (wrapped, surfaced as 500).
//   - Parameterisation of the trailing window ($2, never string-interpolated).
//   - Nil-handle guards that return errors instead of panicking.

package periodstats

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// The production connection pool must satisfy the seam the handler reads
// through. If a refactor widens statsQuerier past what *pgxpool.Pool offers,
// this fails to compile — a louder signal than a runtime wiring bug.
var _ statsQuerier = (*pgxpool.Pool)(nil)

// --- in-memory fakes --------------------------------------------------------

type scanFunc func(dest ...any) error

type fakeRow struct{ scan scanFunc }

func (r fakeRow) Scan(dest ...any) error { return r.scan(dest...) }

// fakeQuerier routes the two aggregate queries by table name so a test can
// supply an independent Scan behaviour (or error) for each, and records the
// SQL + bound args so parameterisation can be asserted.
type fakeQuerier struct {
	drives   scanFunc
	charging scanFunc

	driveCalls  int
	chargeCalls int
	driveSQL    string
	chargeSQL   string
	driveArgs   []any
	chargeArgs  []any
	unexpected  []string
	driveCtx    context.Context
	chargeCtx   context.Context
}

func (f *fakeQuerier) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	switch {
	case strings.Contains(sql, "FROM drives"):
		f.driveCalls++
		f.driveCtx = ctx
		f.driveSQL = sql
		f.driveArgs = args
		return fakeRow{scan: orErr(f.drives, "fakeQuerier: no drives scan configured")}
	case strings.Contains(sql, "FROM charging_sessions"):
		f.chargeCalls++
		f.chargeCtx = ctx
		f.chargeSQL = sql
		f.chargeArgs = args
		return fakeRow{scan: orErr(f.charging, "fakeQuerier: no charging scan configured")}
	default:
		f.unexpected = append(f.unexpected, sql)
		return fakeRow{scan: scanErr("fakeQuerier: unexpected sql: " + sql)}
	}
}

var _ statsQuerier = (*fakeQuerier)(nil)

func orErr(fn scanFunc, msg string) scanFunc {
	if fn != nil {
		return fn
	}
	return scanErr(msg)
}

func scanErr(msg string) scanFunc {
	return func(...any) error { return errors.New(msg) }
}

// drivesOK builds the drives-aggregate Scan: COUNT(*) into *int and
// COALESCE(SUM(distance_m),0) into **float64 (nil distM models a NULL leak).
func drivesOK(count int, distM *float64) scanFunc {
	return func(dest ...any) error {
		if len(dest) != 2 {
			return fmt.Errorf("drives scan: got %d dest, want 2", len(dest))
		}
		p0, ok := dest[0].(*int)
		if !ok {
			return fmt.Errorf("drives scan: dest[0] is %T, want *int", dest[0])
		}
		p1, ok := dest[1].(**float64)
		if !ok {
			return fmt.Errorf("drives scan: dest[1] is %T, want **float64", dest[1])
		}
		*p0 = count
		*p1 = distM
		return nil
	}
}

// chargingOK builds the charging-aggregate Scan: both sums into **float64.
func chargingOK(energyWh, cost *float64) scanFunc {
	return func(dest ...any) error {
		if len(dest) != 2 {
			return fmt.Errorf("charging scan: got %d dest, want 2", len(dest))
		}
		p0, ok := dest[0].(**float64)
		if !ok {
			return fmt.Errorf("charging scan: dest[0] is %T, want **float64", dest[0])
		}
		p1, ok := dest[1].(**float64)
		if !ok {
			return fmt.Errorf("charging scan: dest[1] is %T, want **float64", dest[1])
		}
		*p0 = energyWh
		*p1 = cost
		return nil
	}
}

func f64(v float64) *float64 { return &v }

type querierFunc func(context.Context, string, ...any) pgx.Row

func (f querierFunc) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return f(ctx, sql, args...)
}

// --- computePeriodStats: core aggregate math -------------------------------

func TestComputePeriodStats_Core(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		vehicle  int64
		days     int
		drives   scanFunc
		charging scanFunc
		want     PeriodStats
		wantErr  string
	}{
		{
			name:     "canonical windowed",
			vehicle:  42,
			days:     30,
			drives:   drivesOK(24, f64(450500)),         // 450.5 km
			charging: chargingOK(f64(85200), f64(32.4)), // 85.2 kWh
			want: PeriodStats{
				TotalDistance: 450.5,
				TotalDrives:   24,
				EnergyUsed:    85.2,
				AvgEfficiency: 189.12, // 85200 / 450.5 = 189.1231 -> 189.12
				TotalCost:     32.4,
				CO2Saved:      54.06, // 450.5 * 0.120
			},
		},
		{
			name:     "all time (days zero)",
			vehicle:  7,
			days:     0,
			drives:   drivesOK(3, f64(12345)), // 12.345 km -> round 12.35 (co2 uses unrounded)
			charging: chargingOK(f64(5000), f64(2)),
			want: PeriodStats{
				TotalDistance: 12.35, // round(12.345)
				TotalDrives:   3,
				EnergyUsed:    5,      // 5000 Wh
				AvgEfficiency: 405.02, // 5000 / 12.345 = 405.02...
				TotalCost:     2,
				CO2Saved:      1.48, // 12.345 * 0.120 = 1.4814 -> 1.48
			},
		},
		{
			name:     "no drives, no charging -> all zero",
			vehicle:  1,
			days:     90,
			drives:   drivesOK(0, f64(0)),
			charging: chargingOK(f64(0), f64(0)),
			want:     PeriodStats{},
		},
		{
			name:     "distance present, energy zero -> efficiency stays zero",
			vehicle:  1,
			days:     0,
			drives:   drivesOK(2, f64(10000)), // 10 km
			charging: chargingOK(f64(0), f64(0)),
			want: PeriodStats{
				TotalDistance: 10,
				TotalDrives:   2,
				AvgEfficiency: 0,   // guarded: energyWh == 0
				CO2Saved:      1.2, // 10 * 0.120
			},
		},
		{
			name:     "nil distance pointer (NULL leak) folds to zero",
			vehicle:  1,
			days:     0,
			drives:   drivesOK(5, nil), // COALESCE should prevent this, but be defensive
			charging: chargingOK(f64(9000), f64(3)),
			want: PeriodStats{
				TotalDrives:   5,
				EnergyUsed:    9,
				AvgEfficiency: 0, // distKm == 0 so efficiency guard trips
				TotalCost:     3,
			},
		},
		{
			name:     "Inf distance is neutralised by roundStat",
			vehicle:  1,
			days:     0,
			drives:   drivesOK(1, f64(math.Inf(1))),
			charging: chargingOK(f64(1000), f64(1)),
			want: PeriodStats{
				TotalDistance: 0, // Inf -> 0
				TotalDrives:   1,
				EnergyUsed:    1,
				AvgEfficiency: 0, // 1000 / Inf = 0
				CO2Saved:      0, // Inf * 0.12 = Inf -> 0
				TotalCost:     1,
			},
		},
		{
			name:     "NaN cost is neutralised by roundStat",
			vehicle:  1,
			days:     0,
			drives:   drivesOK(1, f64(2000)),
			charging: chargingOK(f64(1000), f64(math.NaN())),
			want: PeriodStats{
				TotalDistance: 2,
				TotalDrives:   1,
				EnergyUsed:    1,
				AvgEfficiency: 500, // 1000 / 2
				CO2Saved:      0.24,
				TotalCost:     0, // NaN -> 0
			},
		},
		{
			// Intentional behavior correction: this original fixture used to
			// assert successful fabricated zeros. Original bytes preserved in
			// append-only session evidence; failure must now reach every caller.
			name:     "charging query error returns error, not zero energy/cost",
			vehicle:  99,
			days:     7,
			drives:   drivesOK(10, f64(200000)), // 200 km
			charging: scanErr("charging_sessions: relation schema drift"),
			wantErr:  "periodstats: charging aggregate query: charging_sessions: relation schema drift",
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			q := &fakeQuerier{drives: tc.drives, charging: tc.charging}
			got, err := computePeriodStats(context.Background(), q, tc.vehicle, tc.days)
			if tc.wantErr != "" {
				if err == nil || err.Error() != tc.wantErr {
					t.Fatalf("error = %v, want %q", err, tc.wantErr)
				}
			} else if err != nil {
				t.Fatalf("computePeriodStats returned error: %v", err)
			}
			if got != tc.want {
				t.Errorf("stats = %+v, want %+v", got, tc.want)
			}
			// Both aggregates must always be attempted (drives then charging).
			if q.driveCalls != 1 {
				t.Errorf("drive query calls = %d, want 1", q.driveCalls)
			}
			if q.chargeCalls != 1 {
				t.Errorf("charge query calls = %d, want 1", q.chargeCalls)
			}
			if len(q.unexpected) != 0 {
				t.Errorf("unexpected queries issued: %v", q.unexpected)
			}
		})
	}
}

// TestComputePeriodStats_Parameterisation pins that the trailing window is a
// bound parameter ($2), present only for a positive day count, and that the
// day value is never spliced into the SQL text.
func TestComputePeriodStats_Parameterisation(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name         string
		days         int
		wantFilter   bool
		wantArgCount int
	}{
		{"positive window binds days", 30, true, 2},
		{"large window binds days", 3650, true, 2},
		{"zero means all time", 0, false, 1},
		{"negative means all time", -5, false, 1},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			q := &fakeQuerier{
				drives:   drivesOK(1, f64(1000)),
				charging: chargingOK(f64(0), f64(0)),
			}
			if _, err := computePeriodStats(context.Background(), q, 42, tc.days); err != nil {
				t.Fatalf("computePeriodStats error: %v", err)
			}

			for label, sql := range map[string]string{"drives": q.driveSQL, "charging": q.chargeSQL} {
				hasParam := strings.Contains(sql, "$2")
				if hasParam != tc.wantFilter {
					t.Errorf("%s SQL contains $2 = %v, want %v (sql=%q)", label, hasParam, tc.wantFilter, sql)
				}
				// The literal day count must never appear as interpolated text.
				if tc.days > 0 && strings.Contains(sql, fmt.Sprintf("'%d days'", tc.days)) {
					t.Errorf("%s SQL string-interpolates the day count: %q", label, sql)
				}
			}

			for label, args := range map[string][]any{"drives": q.driveArgs, "charging": q.chargeArgs} {
				if len(args) != tc.wantArgCount {
					t.Fatalf("%s args = %v, want %d args", label, args, tc.wantArgCount)
				}
				if got, ok := args[0].(int64); !ok || got != 42 {
					t.Errorf("%s args[0] = %v (%T), want int64(42)", label, args[0], args[0])
				}
				if tc.wantFilter {
					if got, ok := args[1].(int); !ok || got != tc.days {
						t.Errorf("%s args[1] = %v (%T), want int(%d)", label, args[1], args[1], tc.days)
					}
				}
			}
		})
	}
}

// TestComputePeriodStats_DrivesError proves a drives-query failure is wrapped
// with package context and surfaced, just like charging-query failures.
func TestComputePeriodStats_DrivesError(t *testing.T) {
	t.Parallel()
	cause := errors.New("connection reset by peer")
	q := &fakeQuerier{
		drives:   func(...any) error { return cause },
		charging: chargingOK(f64(0), f64(0)),
	}
	got, err := computePeriodStats(context.Background(), q, 1, 0)
	if err == nil {
		t.Fatalf("expected error, got stats %+v", got)
	}
	if !strings.Contains(err.Error(), "periodstats: drives aggregate query") {
		t.Errorf("error = %q, want package-scoped context", err.Error())
	}
	if !strings.Contains(err.Error(), "connection reset by peer") {
		t.Errorf("error = %q, want wrapped cause", err.Error())
	}
	if !errors.Is(err, cause) {
		t.Errorf("error = %v, want original cause preserved", err)
	}
	if got != (PeriodStats{}) {
		t.Errorf("stats on error = %+v, want zero value", got)
	}
	// A drives failure must short-circuit before the charging query runs.
	if q.chargeCalls != 0 {
		t.Errorf("charge query calls = %d, want 0 after drives failure", q.chargeCalls)
	}
}

// This is the core directly delegated to by the exported helper used by AI.
// Even a scan that populates some targets before failing cannot yield stats.
func TestComputePeriodStats_ChargingErrorPreservesCause(t *testing.T) {
	t.Parallel()
	for _, cause := range []error{
		errors.New("charging unavailable"),
		context.Canceled,
		context.DeadlineExceeded,
		pgx.ErrNoRows, // An aggregate Scan failure is not a healthy empty sum.
	} {
		t.Run(cause.Error(), func(t *testing.T) {
			t.Parallel()
			q := &fakeQuerier{
				drives: drivesOK(10, f64(200000)),
				charging: func(dest ...any) error {
					if err := chargingOK(f64(85200), f64(32.4))(dest...); err != nil {
						return err
					}
					return cause
				},
			}
			got, err := computePeriodStats(context.Background(), q, 99, 7)
			if !errors.Is(err, cause) || !strings.Contains(err.Error(), "periodstats: charging aggregate query") {
				t.Fatalf("error = %v, want contextual wrapped %v", err, cause)
			}
			if got != (PeriodStats{}) {
				t.Errorf("stats on error = %+v, want zero value with non-nil error", got)
			}
			for label, args := range map[string][]any{"drives": q.driveArgs, "charging": q.chargeArgs} {
				if len(args) != 2 || args[0] != int64(99) || args[1] != 7 {
					t.Errorf("%s bindings = %v, want [int64(99), int(7)]", label, args)
				}
			}
		})
	}
}

func TestComputePeriodStats_NilQuerier(t *testing.T) {
	t.Parallel()
	_, err := computePeriodStats(context.Background(), nil, 1, 0)
	if err == nil {
		t.Fatal("computePeriodStats(nil querier) returned nil error, want error (no panic)")
	}
	if !strings.Contains(err.Error(), "nil querier") {
		t.Errorf("error = %q, want nil-querier context", err.Error())
	}
}

// --- exported ComputePeriodStats: nil-handle guards ------------------------

func TestComputePeriodStats_NilHandles(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		db   *database.DB
	}{
		{"nil db", nil},
		{"nil pool", &database.DB{}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := ComputePeriodStats(context.Background(), tc.db, 1, 30)
			if err == nil {
				t.Fatalf("ComputePeriodStats(%s) returned nil error, want error (no panic)", tc.name)
			}
			if !strings.Contains(err.Error(), "nil database handle") {
				t.Errorf("error = %q, want nil-database-handle context", err.Error())
			}
		})
	}
}

// --- roundStat --------------------------------------------------------------

func TestRoundStat(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   float64
		want float64
	}{
		{"zero", 0, 0},
		{"round down", 1.234, 1.23},
		{"round up", 1.235, 1.24},
		{"already two dp", 9.99, 9.99},
		{"negative rounds", -1.006, -1.01},
		{"large value", 123456.789, 123456.79},
		{"positive infinity -> 0", math.Inf(1), 0},
		{"negative infinity -> 0", math.Inf(-1), 0},
		{"NaN -> 0", math.NaN(), 0},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := roundStat(tc.in); got != tc.want {
				t.Errorf("roundStat(%v) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

// --- NewHandler -------------------------------------------------------------

func TestNewHandler_NilInputsAreSafe(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		db   *database.DB
	}{
		{"nil db", nil},
		{"nil pool", &database.DB{}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			h := NewHandler(tc.db) // must not panic
			if h == nil {
				t.Fatal("NewHandler returned nil")
			}
			if h.q != nil {
				t.Errorf("handler querier = %v, want nil for %s", h.q, tc.name)
			}
		})
	}
}

// --- Handler.Get: request validation ---------------------------------------

func TestGet_Validation(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		query    string
		wantMsg  string
		wantCode string
	}{
		{"missing vehicle_id", "", "vehicle_id required", "BAD_REQUEST"},
		{"blank vehicle_id", "vehicle_id=", "vehicle_id required", "BAD_REQUEST"},
		{"non-numeric vehicle_id", "vehicle_id=abc", "invalid vehicle_id", "BAD_REQUEST"},
		{"float vehicle_id", "vehicle_id=1.5", "invalid vehicle_id", "BAD_REQUEST"},
		{"overflow vehicle_id", "vehicle_id=99999999999999999999999", "invalid vehicle_id", "BAD_REQUEST"},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			// A fake that errors on any query proves validation returns before DB access.
			h := &Handler{q: &fakeQuerier{}}
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/period-stats?"+tc.query, nil)
			h.Get(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
				t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
			}
			body := decodeObj(t, rec.Body.Bytes())
			if body["error"] != tc.wantMsg {
				t.Errorf("error = %v, want %q", body["error"], tc.wantMsg)
			}
			if body["code"] != tc.wantCode {
				t.Errorf("code = %v, want %q", body["code"], tc.wantCode)
			}
		})
	}
}

// TestGet_NoDBQueryOnValidationFailure proves the DB is never touched when
// validation fails — the fake would error loudly if QueryRow ran.
func TestGet_NoDBQueryOnValidationFailure(t *testing.T) {
	t.Parallel()
	q := &fakeQuerier{}
	h := &Handler{q: q}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/period-stats?vehicle_id=abc", nil)
	h.Get(rec, req)

	if q.driveCalls != 0 || q.chargeCalls != 0 {
		t.Errorf("query calls drives=%d charging=%d, want 0/0 on validation failure", q.driveCalls, q.chargeCalls)
	}
}

// --- Handler.Get: success envelope -----------------------------------------

func TestGet_SuccessEnvelope(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name         string
		query        string
		drives       scanFunc
		charging     scanFunc
		wantArgCount int
		want         map[string]float64
	}{
		{
			name:         "healthy empty window remains measured zero",
			query:        "vehicle_id=42&days=90",
			drives:       drivesOK(0, f64(0)),
			charging:     chargingOK(f64(0), f64(0)),
			wantArgCount: 2,
			want: map[string]float64{
				"total_distance": 0, "total_drives": 0, "energy_used": 0,
				"avg_efficiency": 0, "total_cost": 0, "co2_saved": 0,
			},
		},
		{
			name:         "windowed",
			query:        "vehicle_id=42&days=30",
			drives:       drivesOK(24, f64(450500)),
			charging:     chargingOK(f64(85200), f64(32.4)),
			wantArgCount: 2,
			want: map[string]float64{
				"total_distance": 450.5,
				"total_drives":   24,
				"energy_used":    85.2,
				"avg_efficiency": 189.12,
				"total_cost":     32.4,
				"co2_saved":      54.06,
			},
		},
		{
			name:         "all time (days omitted)",
			query:        "vehicle_id=7",
			drives:       drivesOK(3, f64(30000)),
			charging:     chargingOK(f64(6000), f64(4)),
			wantArgCount: 1,
			want: map[string]float64{
				"total_distance": 30,
				"total_drives":   3,
				"energy_used":    6,
				"avg_efficiency": 200, // 6000 / 30
				"total_cost":     4,
				"co2_saved":      3.6,
			},
		},
		{
			name:         "days=0 explicit all time",
			query:        "vehicle_id=7&days=0",
			drives:       drivesOK(0, f64(0)),
			charging:     chargingOK(f64(0), f64(0)),
			wantArgCount: 1,
			want: map[string]float64{
				"total_distance": 0, "total_drives": 0, "energy_used": 0,
				"avg_efficiency": 0, "total_cost": 0, "co2_saved": 0,
			},
		},
		{
			name:         "unparseable days folds to all time",
			query:        "vehicle_id=7&days=notanumber",
			drives:       drivesOK(1, f64(1000)),
			charging:     chargingOK(f64(500), f64(1)),
			wantArgCount: 1,
			want: map[string]float64{
				"total_distance": 1,
				"total_drives":   1,
				"energy_used":    0.5,
				"avg_efficiency": 500, // 500 / 1
				"total_cost":     1,
				"co2_saved":      0.12,
			},
		},
	}

	wantKeys := []string{"total_distance", "total_drives", "energy_used", "avg_efficiency", "total_cost", "co2_saved"}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			q := &fakeQuerier{drives: tc.drives, charging: tc.charging}
			h := &Handler{q: q}
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/period-stats?"+tc.query, nil)
			h.Get(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
				t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
			}

			body := decodeObj(t, rec.Body.Bytes())
			if len(body) != len(wantKeys) {
				t.Errorf("envelope has %d keys, want %d: keys=%v", len(body), len(wantKeys), keysOf(body))
			}
			for _, k := range wantKeys {
				v, ok := body[k]
				if !ok {
					t.Errorf("envelope missing key %q", k)
					continue
				}
				num, ok := v.(float64)
				if !ok {
					t.Errorf("key %q = %v (%T), want JSON number", k, v, v)
					continue
				}
				if math.Abs(num-tc.want[k]) > 1e-9 {
					t.Errorf("key %q = %v, want %v", k, num, tc.want[k])
				}
			}

			if len(q.driveArgs) != tc.wantArgCount {
				t.Errorf("drive args = %v, want %d args", q.driveArgs, tc.wantArgCount)
			}
			if len(q.chargeArgs) != len(q.driveArgs) {
				t.Fatalf("charging args = %v, want same bindings as drives %v", q.chargeArgs, q.driveArgs)
			}
			for i, arg := range q.driveArgs {
				if q.chargeArgs[i] != arg {
					t.Errorf("charging args[%d] = %v, want %v", i, q.chargeArgs[i], arg)
				}
			}
		})
	}
}

// TestGet_DrivesErrorReturns500 proves a hard drives failure becomes a 500
// with the structured error envelope (never a panic, never a partial 200).
func TestGet_DrivesErrorReturns500(t *testing.T) {
	t.Parallel()
	q := &fakeQuerier{
		drives:   scanErr("timescaledb: canceling statement due to statement timeout"),
		charging: chargingOK(f64(0), f64(0)),
	}
	h := &Handler{q: q}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/period-stats?vehicle_id=42&days=30", nil)
	h.Get(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%q)", rec.Code, rec.Body.String())
	}
	body := decodeObj(t, rec.Body.Bytes())
	if body["error"] != "failed to query period stats" {
		t.Errorf("error = %v, want %q", body["error"], "failed to query period stats")
	}
	if body["code"] != "INTERNAL_ERROR" {
		t.Errorf("code = %v, want INTERNAL_ERROR", body["code"])
	}
	// The internal cause must not leak to the client body.
	if strings.Contains(rec.Body.String(), "statement timeout") {
		t.Errorf("500 body leaks internal cause: %q", rec.Body.String())
	}
}

// TestGet_ChargingErrorReturns500 intentionally corrects the old
// TestGet_ChargingErrorStill200 contract with the same failure fixture.
// Unavailable energy/cost must not be presented as measured-zero success.
func TestGet_ChargingErrorReturns500(t *testing.T) {
	t.Parallel()
	q := &fakeQuerier{
		drives:   drivesOK(12, f64(360000)), // 360 km
		charging: scanErr("charging_sessions: column total_energy_added_wh drift"),
	}
	h := &Handler{q: q}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/period-stats?vehicle_id=42&days=90", nil)
	h.Get(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%q)", rec.Code, rec.Body.String())
	}
	body := decodeObj(t, rec.Body.Bytes())
	if body["error"] != "failed to query period stats" || body["code"] != "INTERNAL_ERROR" {
		t.Errorf("body = %v, want standard INTERNAL_ERROR envelope", body)
	}
	if strings.Contains(rec.Body.String(), "drift") {
		t.Errorf("500 body leaks internal cause: %q", rec.Body.String())
	}
	for _, key := range []string{"total_distance", "total_drives", "energy_used", "total_cost", "avg_efficiency", "co2_saved"} {
		if _, ok := body[key]; ok {
			t.Errorf("500 body contains successful stats key %q", key)
		}
	}
	if q.driveCalls != 1 || q.chargeCalls != 1 {
		t.Errorf("query calls drives=%d charging=%d, want 1/1", q.driveCalls, q.chargeCalls)
	}
}

// TestGet_NilQuerierReturns500 proves a handler built from a nil DB (a wiring
// bug) fails a valid request with a clean 500 rather than a nil-deref panic.
func TestGet_NilQuerierReturns500(t *testing.T) {
	t.Parallel()
	h := NewHandler(nil) // q is nil
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/period-stats?vehicle_id=1", nil)
	h.Get(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%q)", rec.Code, rec.Body.String())
	}
	body := decodeObj(t, rec.Body.Bytes())
	if body["error"] != "failed to query period stats" {
		t.Errorf("error = %v, want %q", body["error"], "failed to query period stats")
	}
}

func TestGet_ContextTimeoutAndCancellation(t *testing.T) {
	t.Parallel()
	type contextKey struct{}
	for _, mode := range []string{"healthy", "parent deadline", "parent canceled", "canceled after drives"} {
		t.Run(mode, func(t *testing.T) {
			t.Parallel()
			parent := context.WithValue(context.Background(), contextKey{}, "request marker")
			var cancel context.CancelFunc
			if mode == "parent deadline" {
				parent, cancel = context.WithDeadline(parent, time.Now().Add(-time.Second))
			} else {
				parent, cancel = context.WithCancel(parent)
			}
			defer cancel()
			if mode == "parent canceled" {
				cancel()
			}
			q := &fakeQuerier{
				drives:   drivesOK(0, f64(0)),
				charging: chargingOK(f64(0), f64(0)),
			}
			if mode == "canceled after drives" {
				q.drives = func(dest ...any) error {
					err := drivesOK(0, f64(0))(dest...)
					cancel()
					return err
				}
			}
			var contexts []context.Context
			qctx := querierFunc(func(ctx context.Context, sql string, args ...any) pgx.Row {
				contexts = append(contexts, ctx)
				if ctx.Value(contextKey{}) != "request marker" {
					t.Error("query lost request context value")
				}
				deadline, ok := ctx.Deadline()
				if !ok || time.Until(deadline) > computeTimeout {
					t.Errorf("query deadline = %v (present=%v), want at most %v", deadline, ok, computeTimeout)
				}
				if mode == "parent deadline" {
					want, _ := parent.Deadline()
					if !deadline.Equal(want) {
						t.Errorf("query deadline = %v, want inherited earlier deadline %v", deadline, want)
					}
				} else if mode == "healthy" && time.Until(deadline) < computeTimeout-time.Second {
					t.Errorf("healthy query timeout unexpectedly shortened: %v", time.Until(deadline))
				}
				row := q.QueryRow(ctx, sql, args...)
				return fakeRow{scan: func(dest ...any) error {
					if err := ctx.Err(); err != nil {
						return err
					}
					return row.Scan(dest...)
				}}
			})
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/period-stats?vehicle_id=42&days=30", nil).WithContext(parent)
			(&Handler{q: qctx}).Get(rec, req)
			wantStatus, wantQueries := http.StatusInternalServerError, 1
			if mode == "healthy" {
				wantStatus, wantQueries = http.StatusOK, 2
			} else if mode == "canceled after drives" {
				wantQueries = 2
			}
			if rec.Code != wantStatus {
				t.Fatalf("status = %d, want %d (body=%q)", rec.Code, wantStatus, rec.Body.String())
			}
			if len(contexts) != wantQueries {
				t.Fatalf("query contexts = %d, want %d", len(contexts), wantQueries)
			}
			for _, ctx := range contexts {
				if !errors.Is(ctx.Err(), context.Canceled) && mode != "parent deadline" {
					t.Errorf("query context after handler = %v, want canceled by deferred cleanup", ctx.Err())
				}
			}
			if len(contexts) == 2 && contexts[0] != contexts[1] {
				t.Error("aggregates did not receive the same bounded context")
			}
			if mode != "healthy" {
				body := decodeObj(t, rec.Body.Bytes())
				if body["code"] != "INTERNAL_ERROR" || body["energy_used"] != nil {
					t.Errorf("failure body = %v, want standard error without stats", body)
				}
			}
		})
	}
}

// Non-parallel: temporarily replaces process-wide tracing/logging providers,
// restoring them before the parallel tests resume.
func TestGet_ChargingFailureRecordsSpanAndTraceLog(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	originalProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(originalProvider)
	defer func() {
		if err := provider.Shutdown(context.Background()); err != nil {
			t.Errorf("tracer shutdown: %v", err)
		}
	}()
	var logs bytes.Buffer
	originalLogger := log.Logger
	log.Logger = zerolog.New(&logs)
	defer func() { log.Logger = originalLogger }()

	parent := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    trace.TraceID{1},
		SpanID:     trace.SpanID{2},
		TraceFlags: trace.FlagsSampled,
		Remote:     true,
	})
	cause := errors.New("charging aggregate unavailable")
	q := &fakeQuerier{
		drives:   drivesOK(12, f64(360000)),
		charging: func(...any) error { return cause },
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/period-stats?vehicle_id=42&days=90", nil).
		WithContext(trace.ContextWithRemoteSpanContext(context.Background(), parent))
	rec := httptest.NewRecorder()
	(&Handler{q: q}).Get(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	span := spans[0]
	if span.Name() != "api.periodstats.get" || span.InstrumentationScope().Name != "api" {
		t.Errorf("span = %q / %q, want API boundary span", span.Name(), span.InstrumentationScope().Name)
	}
	if !span.Parent().Equal(parent) || span.SpanContext().TraceID() != parent.TraceID() {
		t.Error("span lost incoming trace parent")
	}
	if span.Status().Code != codes.Error || len(span.Events()) != 1 || span.Events()[0].Name != "exception" {
		t.Errorf("span status/events = %v / %v, want recorded error", span.Status(), span.Events())
	}
	if !trace.SpanContextFromContext(q.chargeCtx).Equal(span.SpanContext()) {
		t.Error("charging query did not inherit active API span")
	}
	entry := decodeObj(t, logs.Bytes())
	if entry["level"] != "error" || entry["trace_id"] != parent.TraceID().String() ||
		entry["vehicle_id"] != float64(42) || entry["days"] != float64(90) ||
		entry["error"] != "periodstats: charging aggregate query: charging aggregate unavailable" {
		t.Errorf("log = %v, want contextual traced aggregate error", entry)
	}
}

// --- helpers ----------------------------------------------------------------

func decodeObj(t *testing.T, b []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("response body is not a JSON object: %v (body=%q)", err, b)
	}
	return m
}

func assertNum(t *testing.T, m map[string]any, key string, want float64) {
	t.Helper()
	v, ok := m[key]
	if !ok {
		t.Errorf("missing key %q", key)
		return
	}
	num, ok := v.(float64)
	if !ok {
		t.Errorf("key %q = %v (%T), want JSON number", key, v, v)
		return
	}
	if math.Abs(num-want) > 1e-9 {
		t.Errorf("key %q = %v, want %v", key, num, want)
	}
}

func keysOf(m map[string]any) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	return ks
}
