// Hermetic tests for the deterministic period-stats aggregate + handler.
//
// The package reads through the narrow statsQuerier seam, so every path here
// runs against an in-memory fake — no live database, no network. Tests pin:
//   - Handler.Get request validation (missing / invalid vehicle_id).
//   - The exact 6-key JSON envelope + rounding the chart and AI narration quote.
//   - The SI → display-unit conversion and Wh/km efficiency math.
//   - The charging-query fold-to-zero contract (never a 500 for the SPA).
//   - The drives-query error path (wrapped, surfaced as 500).
//   - Parameterisation of the trailing window ($2, never string-interpolated).
//   - Nil-handle guards that return errors instead of panicking.

package periodstats

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

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
}

func (f *fakeQuerier) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	switch {
	case strings.Contains(sql, "FROM drives"):
		f.driveCalls++
		f.driveSQL = sql
		f.driveArgs = args
		return fakeRow{scan: orErr(f.drives, "fakeQuerier: no drives scan configured")}
	case strings.Contains(sql, "FROM charging_sessions"):
		f.chargeCalls++
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
			name:     "charging query error folds to zero energy/cost",
			vehicle:  99,
			days:     7,
			drives:   drivesOK(10, f64(200000)), // 200 km
			charging: scanErr("charging_sessions: relation schema drift"),
			want: PeriodStats{
				TotalDistance: 200,
				TotalDrives:   10,
				EnergyUsed:    0,
				AvgEfficiency: 0,
				TotalCost:     0,
				CO2Saved:      24, // 200 * 0.120
			},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			q := &fakeQuerier{drives: tc.drives, charging: tc.charging}
			got, err := computePeriodStats(context.Background(), q, tc.vehicle, tc.days)
			if err != nil {
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
// with package context and surfaced (not swallowed like the charging fold).
func TestComputePeriodStats_DrivesError(t *testing.T) {
	t.Parallel()
	q := &fakeQuerier{
		drives:   scanErr("connection reset by peer"),
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
	if got != (PeriodStats{}) {
		t.Errorf("stats on error = %+v, want zero value", got)
	}
	// A drives failure must short-circuit before the charging query runs.
	if q.chargeCalls != 0 {
		t.Errorf("charge query calls = %d, want 0 after drives failure", q.chargeCalls)
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

// TestGet_ChargingErrorStill200 proves the charging fold-to-zero contract at
// the HTTP boundary: distance/drives survive, energy/cost are zero, status 200.
func TestGet_ChargingErrorStill200(t *testing.T) {
	t.Parallel()
	q := &fakeQuerier{
		drives:   drivesOK(12, f64(360000)), // 360 km
		charging: scanErr("charging_sessions: column total_energy_added_wh drift"),
	}
	h := &Handler{q: q}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/period-stats?vehicle_id=42&days=90", nil)
	h.Get(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	body := decodeObj(t, rec.Body.Bytes())
	assertNum(t, body, "total_distance", 360)
	assertNum(t, body, "total_drives", 12)
	assertNum(t, body, "energy_used", 0)
	assertNum(t, body, "total_cost", 0)
	assertNum(t, body, "avg_efficiency", 0)
	assertNum(t, body, "co2_saved", 43.2) // 360 * 0.120
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
