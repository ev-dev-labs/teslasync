package yearreview

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
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// --- in-memory fakes for the dbQuerier port ------------------------------
//
// These mirror the established pgx.Rows / pgx.Row fake pattern used in
// internal/api/chargeheatmap/handler_test.go, letting us drive
// Handler.GetYearReview end-to-end without a live Postgres. Column values are
// stored as typed any and copied into the caller's scan destinations by
// assignScan, which fails loudly on a type mismatch so a future column/scan
// drift is caught rather than silently zeroing a field.

func assignScan(dest, vals []any) error {
	if len(dest) != len(vals) {
		return fmt.Errorf("fake scan: got %d destinations, want %d", len(dest), len(vals))
	}
	for i, d := range dest {
		v := vals[i]
		switch p := d.(type) {
		case *int:
			x, ok := v.(int)
			if !ok {
				return fmt.Errorf("fake scan: col %d: want int, got %T", i, v)
			}
			*p = x
		case *int64:
			x, ok := v.(int64)
			if !ok {
				return fmt.Errorf("fake scan: col %d: want int64, got %T", i, v)
			}
			*p = x
		case *float64:
			x, ok := v.(float64)
			if !ok {
				return fmt.Errorf("fake scan: col %d: want float64, got %T", i, v)
			}
			*p = x
		case *string:
			x, ok := v.(string)
			if !ok {
				return fmt.Errorf("fake scan: col %d: want string, got %T", i, v)
			}
			*p = x
		case *time.Time:
			x, ok := v.(time.Time)
			if !ok {
				return fmt.Errorf("fake scan: col %d: want time.Time, got %T", i, v)
			}
			*p = x
		case **float64:
			// Nullable numeric column: accept a raw float64 (wrapped),
			// an already-*float64 (including a typed nil for SQL NULL),
			// or an untyped nil.
			switch x := v.(type) {
			case nil:
				*p = nil
			case *float64:
				*p = x
			case float64:
				vv := x
				*p = &vv
			default:
				return fmt.Errorf("fake scan: col %d: want *float64/float64/nil, got %T", i, v)
			}
		case **string:
			switch x := v.(type) {
			case nil:
				*p = nil
			case *string:
				*p = x
			case string:
				vv := x
				*p = &vv
			default:
				return fmt.Errorf("fake scan: col %d: want *string/string/nil, got %T", i, v)
			}
		default:
			return fmt.Errorf("fake scan: col %d: unsupported destination type %T", i, d)
		}
	}
	return nil
}

// fakeRow is a single-row pgx.Row. A non-nil err exercises the scan-error
// branch (including pgx.ErrNoRows for not-found handling).
type fakeRow struct {
	vals []any
	err  error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	return assignScan(dest, r.vals)
}

var _ pgx.Row = fakeRow{}

// fakeRows is a minimal, cursor-driven pgx.Rows. rows holds the typed column
// values per row; scanErr forces every Scan to fail; iterErr is surfaced by
// Err() to simulate a mid-iteration transport failure.
type fakeRows struct {
	rows    [][]any
	pos     int
	scanErr error
	iterErr error
	closed  bool
}

func (r *fakeRows) Next() bool {
	if r.pos >= len(r.rows) {
		return false
	}
	r.pos++
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	if r.pos == 0 || r.pos > len(r.rows) {
		return fmt.Errorf("fakeRows: Scan called out of range (pos=%d)", r.pos)
	}
	return assignScan(dest, r.rows[r.pos-1])
}

func (r *fakeRows) Err() error                                   { return r.iterErr }
func (r *fakeRows) Close()                                       { r.closed = true }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

// fakeQuerier implements dbQuerier and dispatches by SQL shape to the fixture
// configured for each sub-query. Every SQL string and its bind args are
// recorded so tests can assert parameterised vehicle_id / year-window
// propagation and stop-on-error ordering.
type fakeQuerier struct {
	vehicleRow       pgx.Row
	driveStatsRow    pgx.Row
	efficiencyRow    pgx.Row
	chargingStatsRow pgx.Row
	settingsRow      pgx.Row
	longestRow       pgx.Row
	shortestRow      pgx.Row
	dowRow           pgx.Row
	hourRow          pgx.Row
	socRow           pgx.Row

	driveMonthRows  pgx.Rows
	driveMonthErr   error
	chargeMonthRows pgx.Rows
	chargeMonthErr  error
	chargeTypeRows  pgx.Rows
	chargeTypeErr   error

	queries []string
	args    [][]any
}

func (f *fakeQuerier) record(sql string, args []any) {
	f.queries = append(f.queries, sql)
	f.args = append(f.args, args)
}

func orErrRow(r pgx.Row) pgx.Row {
	if r == nil {
		return fakeRow{err: errors.New("fakeQuerier: row not configured")}
	}
	return r
}

func (f *fakeQuerier) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	f.record(sql, args)
	switch {
	case strings.Contains(sql, "FROM vehicles"):
		return orErrRow(f.vehicleRow)
	case strings.Contains(sql, "max_speed_mps"):
		return orErrRow(f.driveStatsRow)
	case strings.Contains(sql, "energy_used_wh"):
		return orErrRow(f.efficiencyRow)
	case strings.Contains(sql, "gas_price_per_unit"):
		return orErrRow(f.settingsRow)
	case strings.Contains(sql, "ORDER BY distance_m DESC"):
		return orErrRow(f.longestRow)
	case strings.Contains(sql, "ORDER BY distance_m ASC"):
		return orErrRow(f.shortestRow)
	case strings.Contains(sql, "EXTRACT(DOW"):
		return orErrRow(f.dowRow)
	case strings.Contains(sql, "EXTRACT(HOUR"):
		return orErrRow(f.hourRow)
	case strings.Contains(sql, "start_soc_pct"):
		return orErrRow(f.socRow)
	case strings.Contains(sql, "total_energy_added_wh"):
		return orErrRow(f.chargingStatsRow)
	default:
		return fakeRow{err: fmt.Errorf("fakeQuerier: unexpected QueryRow: %s", sql)}
	}
}

func (f *fakeQuerier) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	f.record(sql, args)
	switch {
	case strings.Contains(sql, "charger_type"):
		return f.chargeTypeRows, f.chargeTypeErr
	case strings.Contains(sql, "total_energy_added_wh"):
		return f.chargeMonthRows, f.chargeMonthErr
	case strings.Contains(sql, "FROM drives"):
		return f.driveMonthRows, f.driveMonthErr
	default:
		return nil, fmt.Errorf("fakeQuerier: unexpected Query: %s", sql)
	}
}

var _ dbQuerier = (*fakeQuerier)(nil)

// --- fixtures ------------------------------------------------------------

func strptr(s string) *string { return &s }

func mustDate(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return t
}

// okQuerier returns a fully-populated fakeQuerier whose every sub-query
// succeeds with deterministic fixtures. Distances/energy are the already
// SI-converted values the SELECT boundary produces (km, kWh, km/h, °C).
func okQuerier() *fakeQuerier {
	return &fakeQuerier{
		vehicleRow:       fakeRow{vals: []any{"Model Y Test", "modely"}},
		driveStatsRow:    fakeRow{vals: []any{int(100), 2000.0, 3000.0, 180.0, -5.0, 38.0}},
		efficiencyRow:    fakeRow{vals: []any{155.5}},
		chargingStatsRow: fakeRow{vals: []any{int(50), 1200.0, 50.0}},
		settingsRow:      fakeRow{vals: []any{3.50, 25.0}},
		longestRow:       fakeRow{vals: []any{int64(7), mustDate("2020-06-15"), 90000.0, 3600.0, strptr("Home"), strptr("Work")}},
		shortestRow:      fakeRow{vals: []any{int64(8), mustDate("2020-02-01"), 2000.0, 600.0, strptr("A"), strptr("B")}},
		dowRow:           fakeRow{vals: []any{int(5), int(30)}},
		hourRow:          fakeRow{vals: []any{int(17), int(25)}},
		socRow:           fakeRow{vals: []any{42.0}},
		driveMonthRows:   &fakeRows{rows: [][]any{{int(6), int(40), 800.0}, {int(2), int(60), 1200.0}}},
		chargeMonthRows:  &fakeRows{rows: [][]any{{int(6), 500.0, 90.0}, {int(2), 700.0, 90.0}}},
		chargeTypeRows:   &fakeRows{rows: [][]any{{"supercharger", int(30)}, {"dc_fast", int(15)}, {"ac_other", int(5)}}},
	}
}

// emptyQuerier returns a fakeQuerier whose vehicle exists but has no drives
// or charging sessions in the year: aggregate rows scan zeros, nullable
// extremes are SQL NULL, and highlight/dow/hour/soc lookups miss (ErrNoRows).
func emptyQuerier() *fakeQuerier {
	return &fakeQuerier{
		vehicleRow:       fakeRow{vals: []any{"Empty Car", ""}},
		driveStatsRow:    fakeRow{vals: []any{int(0), 0.0, 0.0, (*float64)(nil), (*float64)(nil), (*float64)(nil)}},
		efficiencyRow:    fakeRow{vals: []any{0.0}},
		chargingStatsRow: fakeRow{vals: []any{int(0), 0.0, 0.0}},
		settingsRow:      fakeRow{vals: []any{3.50, 25.0}},
		longestRow:       fakeRow{err: pgx.ErrNoRows},
		shortestRow:      fakeRow{err: pgx.ErrNoRows},
		dowRow:           fakeRow{err: pgx.ErrNoRows},
		hourRow:          fakeRow{err: pgx.ErrNoRows},
		socRow:           fakeRow{err: pgx.ErrNoRows},
		driveMonthRows:   &fakeRows{},
		chargeMonthRows:  &fakeRows{},
		chargeTypeRows:   &fakeRows{},
	}
}

// --- response decoding ---------------------------------------------------

type highlightJSON struct {
	DriveID      int64   `json:"DriveID"`
	Date         string  `json:"Date"`
	DistanceKm   float64 `json:"DistanceKm"`
	DurationS    int64   `json:"DurationS"`
	StartAddress string  `json:"StartAddress"`
	EndAddress   string  `json:"EndAddress"`
}

type monthJSON struct {
	Month      int     `json:"month"`
	Drives     int     `json:"drives"`
	DistanceKm float64 `json:"distance_km"`
	EnergyKwh  float64 `json:"energy_kwh"`
	Cost       float64 `json:"cost"`
}

type comparisonJSON struct {
	Label string `json:"label"`
	Value string `json:"value"`
	Emoji string `json:"emoji"`
}

type yrResponse struct {
	Year    int `json:"year"`
	Vehicle struct {
		ID          int64  `json:"id"`
		DisplayName string `json:"display_name"`
		Model       string `json:"model"`
	} `json:"vehicle"`
	TotalDrives           int              `json:"total_drives"`
	TotalDistanceKm       float64          `json:"total_distance_km"`
	TotalEnergyKwh        float64          `json:"total_energy_kwh"`
	TotalChargeSessions   int              `json:"total_charge_sessions"`
	TotalDrivingMinutes   int              `json:"total_driving_minutes"`
	TotalChargingCost     float64          `json:"total_charging_cost"`
	GasSavings            float64          `json:"gas_savings"`
	Co2OffsetKg           float64          `json:"co2_offset_kg"`
	LongestDrive          *highlightJSON   `json:"longest_drive"`
	ShortestDrive         *highlightJSON   `json:"shortest_drive"`
	MostEfficientDrive    json.RawMessage  `json:"most_efficient_drive"`
	LeastEfficientDrive   json.RawMessage  `json:"least_efficient_drive"`
	FastestSpeedKmh       float64          `json:"fastest_speed_kmh"`
	ColdestDriveTempC     float64          `json:"coldest_drive_temp_c"`
	HottestDriveTempC     float64          `json:"hottest_drive_temp_c"`
	MonthlyStats          []monthJSON      `json:"monthly_stats"`
	MostActiveDayOfWeek   string           `json:"most_active_day_of_week"`
	MostActiveHour        int              `json:"most_active_hour"`
	AvgDrivesPerWeek      float64          `json:"avg_drives_per_week"`
	AvgDistancePerDriveKm float64          `json:"avg_distance_per_drive_km"`
	AvgEfficiencyWhKm     float64          `json:"avg_efficiency_wh_km"`
	SuperchargerPct       float64          `json:"supercharger_pct"`
	DcFastPct             float64          `json:"dc_fast_pct"`
	AcOtherPct            float64          `json:"ac_other_pct"`
	AvgChargeStartSoc     float64          `json:"avg_charge_start_soc"`
	Comparisons           []comparisonJSON `json:"comparisons"`
}

func newRequest(query string) *http.Request {
	url := "/analytics/year-review"
	if query != "" {
		url += "?" + query
	}
	return httptest.NewRequest(http.MethodGet, url, nil)
}

func decodeError(t *testing.T, body []byte) map[string]string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("decode error body: %v; body=%s", err, body)
	}
	return m
}

func decodeYR(t *testing.T, body []byte) yrResponse {
	t.Helper()
	var got yrResponse
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("decode year-review body: %v; body=%s", err, body)
	}
	return got
}

// serve runs the handler against an in-memory fake and returns the recorder.
func serve(fq *fakeQuerier, query string) *httptest.ResponseRecorder {
	h := &Handler{q: fq}
	rec := httptest.NewRecorder()
	h.GetYearReview(rec, newRequest(query))
	return rec
}

const jsonCT = "application/json; charset=utf-8"

// --- validation & failure paths ------------------------------------------

func TestGetYearReview_ValidationAndErrors(t *testing.T) {
	tests := []struct {
		name       string
		query      string
		querier    func() *fakeQuerier
		wantStatus int
		wantErr    string
		wantCode   string
		wantNQ     int // expected number of DB queries executed (-1 = skip)
	}{
		{
			name:       "missing vehicle_id",
			query:      "",
			querier:    func() *fakeQuerier { return &fakeQuerier{} },
			wantStatus: http.StatusBadRequest,
			wantErr:    "vehicle_id is required",
			wantCode:   "BAD_REQUEST",
			wantNQ:     0,
		},
		{
			name:       "empty vehicle_id value",
			query:      "vehicle_id=",
			querier:    func() *fakeQuerier { return &fakeQuerier{} },
			wantStatus: http.StatusBadRequest,
			wantErr:    "vehicle_id is required",
			wantCode:   "BAD_REQUEST",
			wantNQ:     0,
		},
		{
			name:       "non-numeric vehicle_id",
			query:      "vehicle_id=abc",
			querier:    func() *fakeQuerier { return &fakeQuerier{} },
			wantStatus: http.StatusBadRequest,
			wantErr:    "invalid vehicle_id",
			wantCode:   "BAD_REQUEST",
			wantNQ:     0,
		},
		{
			name:       "zero vehicle_id rejected",
			query:      "vehicle_id=0",
			querier:    func() *fakeQuerier { return &fakeQuerier{} },
			wantStatus: http.StatusBadRequest,
			wantErr:    "invalid vehicle_id",
			wantCode:   "BAD_REQUEST",
			wantNQ:     0,
		},
		{
			name:       "negative vehicle_id rejected",
			query:      "vehicle_id=-5",
			querier:    func() *fakeQuerier { return &fakeQuerier{} },
			wantStatus: http.StatusBadRequest,
			wantErr:    "invalid vehicle_id",
			wantCode:   "BAD_REQUEST",
			wantNQ:     0,
		},
		{
			name:       "overflow vehicle_id",
			query:      "vehicle_id=99999999999999999999999999",
			querier:    func() *fakeQuerier { return &fakeQuerier{} },
			wantStatus: http.StatusBadRequest,
			wantErr:    "invalid vehicle_id",
			wantCode:   "BAD_REQUEST",
			wantNQ:     0,
		},
		{
			name:       "non-numeric year",
			query:      "vehicle_id=42&year=abc",
			querier:    func() *fakeQuerier { return &fakeQuerier{} },
			wantStatus: http.StatusBadRequest,
			wantErr:    "invalid year",
			wantCode:   "BAD_REQUEST",
			wantNQ:     0,
		},
		{
			name:       "year below range",
			query:      "vehicle_id=42&year=2009",
			querier:    func() *fakeQuerier { return &fakeQuerier{} },
			wantStatus: http.StatusBadRequest,
			wantErr:    "invalid year",
			wantCode:   "BAD_REQUEST",
			wantNQ:     0,
		},
		{
			name:       "year above range",
			query:      "vehicle_id=42&year=2101",
			querier:    func() *fakeQuerier { return &fakeQuerier{} },
			wantStatus: http.StatusBadRequest,
			wantErr:    "invalid year",
			wantCode:   "BAD_REQUEST",
			wantNQ:     0,
		},
		{
			name:  "vehicle not found",
			query: "vehicle_id=42&year=2020",
			querier: func() *fakeQuerier {
				fq := okQuerier()
				fq.vehicleRow = fakeRow{err: pgx.ErrNoRows}
				return fq
			},
			wantStatus: http.StatusNotFound,
			wantErr:    "vehicle not found",
			wantCode:   "NOT_FOUND",
			wantNQ:     1,
		},
		{
			name:  "vehicle lookup db error",
			query: "vehicle_id=42&year=2020",
			querier: func() *fakeQuerier {
				fq := okQuerier()
				fq.vehicleRow = fakeRow{err: errors.New("conn reset")}
				return fq
			},
			wantStatus: http.StatusInternalServerError,
			wantErr:    "failed to get vehicle",
			wantCode:   "INTERNAL_ERROR",
			wantNQ:     1,
		},
		{
			name:  "drive stats db error",
			query: "vehicle_id=42&year=2020",
			querier: func() *fakeQuerier {
				fq := okQuerier()
				fq.driveStatsRow = fakeRow{err: errors.New("stats boom")}
				return fq
			},
			wantStatus: http.StatusInternalServerError,
			wantErr:    "failed to compute year review",
			wantCode:   "INTERNAL_ERROR",
			wantNQ:     2, // vehicle + drive stats
		},
		{
			name:  "charging stats db error",
			query: "vehicle_id=42&year=2020",
			querier: func() *fakeQuerier {
				fq := okQuerier()
				fq.chargingStatsRow = fakeRow{err: errors.New("charge boom")}
				return fq
			},
			wantStatus: http.StatusInternalServerError,
			wantErr:    "failed to compute year review",
			wantCode:   "INTERNAL_ERROR",
			wantNQ:     4, // vehicle + drive stats + efficiency + charging stats
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fq := tt.querier()
			rec := serve(fq, tt.query)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); ct != jsonCT {
				t.Fatalf("Content-Type = %q, want %q", ct, jsonCT)
			}
			m := decodeError(t, rec.Body.Bytes())
			if m["error"] != tt.wantErr {
				t.Fatalf("error = %q, want %q", m["error"], tt.wantErr)
			}
			if m["code"] != tt.wantCode {
				t.Fatalf("code = %q, want %q", m["code"], tt.wantCode)
			}
			if tt.wantNQ >= 0 && len(fq.queries) != tt.wantNQ {
				t.Fatalf("ran %d queries, want %d: %v", len(fq.queries), tt.wantNQ, fq.queries)
			}
		})
	}
}

// --- full happy path -----------------------------------------------------

func TestGetYearReview_Success(t *testing.T) {
	fq := okQuerier()
	rec := serve(fq, "vehicle_id=42&year=2020")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != jsonCT {
		t.Fatalf("Content-Type = %q, want %q", ct, jsonCT)
	}
	got := decodeYR(t, rec.Body.Bytes())

	if got.Year != 2020 {
		t.Errorf("year = %d, want 2020", got.Year)
	}
	if got.Vehicle.ID != 42 || got.Vehicle.DisplayName != "Model Y Test" || got.Vehicle.Model != "modely" {
		t.Errorf("vehicle = %+v, want id=42 name=Model Y Test model=modely", got.Vehicle)
	}
	if got.TotalDrives != 100 {
		t.Errorf("total_drives = %d, want 100", got.TotalDrives)
	}
	if got.TotalDistanceKm != 2000 {
		t.Errorf("total_distance_km = %v, want 2000", got.TotalDistanceKm)
	}
	if got.TotalEnergyKwh != 1200 {
		t.Errorf("total_energy_kwh = %v, want 1200", got.TotalEnergyKwh)
	}
	if got.TotalChargeSessions != 50 {
		t.Errorf("total_charge_sessions = %d, want 50", got.TotalChargeSessions)
	}
	if got.TotalDrivingMinutes != 3000 {
		t.Errorf("total_driving_minutes = %d, want 3000", got.TotalDrivingMinutes)
	}
	if got.TotalChargingCost != 50 {
		t.Errorf("total_charging_cost = %v, want 50", got.TotalChargingCost)
	}
	// gas savings: 2000km -> 1242.74mi / 25mpg * $3.50 = $173.98 - $50 = $123.98
	if got.GasSavings != 123.98 {
		t.Errorf("gas_savings = %v, want 123.98", got.GasSavings)
	}
	if got.Co2OffsetKg != 384 {
		t.Errorf("co2_offset_kg = %v, want 384", got.Co2OffsetKg)
	}
	if got.FastestSpeedKmh != 180 {
		t.Errorf("fastest_speed_kmh = %v, want 180", got.FastestSpeedKmh)
	}
	if got.ColdestDriveTempC != -5 {
		t.Errorf("coldest_drive_temp_c = %v, want -5", got.ColdestDriveTempC)
	}
	if got.HottestDriveTempC != 38 {
		t.Errorf("hottest_drive_temp_c = %v, want 38", got.HottestDriveTempC)
	}
	if got.MostActiveDayOfWeek != "Friday" {
		t.Errorf("most_active_day_of_week = %q, want Friday", got.MostActiveDayOfWeek)
	}
	if got.MostActiveHour != 17 {
		t.Errorf("most_active_hour = %d, want 17", got.MostActiveHour)
	}
	if got.AvgDrivesPerWeek != 1.9 {
		t.Errorf("avg_drives_per_week = %v, want 1.9", got.AvgDrivesPerWeek)
	}
	if got.AvgDistancePerDriveKm != 20 {
		t.Errorf("avg_distance_per_drive_km = %v, want 20", got.AvgDistancePerDriveKm)
	}
	if got.AvgEfficiencyWhKm != 155.5 {
		t.Errorf("avg_efficiency_wh_km = %v, want 155.5", got.AvgEfficiencyWhKm)
	}
	if got.SuperchargerPct != 60 || got.DcFastPct != 30 || got.AcOtherPct != 10 {
		t.Errorf("charge split = sc %v / dc %v / ac %v, want 60/30/10", got.SuperchargerPct, got.DcFastPct, got.AcOtherPct)
	}
	if got.AvgChargeStartSoc != 42 {
		t.Errorf("avg_charge_start_soc = %v, want 42", got.AvgChargeStartSoc)
	}

	// highlights
	if got.LongestDrive == nil {
		t.Fatalf("longest_drive is null, want populated")
	}
	if got.LongestDrive.DriveID != 7 || got.LongestDrive.Date != "2020-06-15" ||
		got.LongestDrive.DistanceKm != 90 || got.LongestDrive.DurationS != 3600 ||
		got.LongestDrive.StartAddress != "Home" || got.LongestDrive.EndAddress != "Work" {
		t.Errorf("longest_drive = %+v", *got.LongestDrive)
	}
	if got.ShortestDrive == nil {
		t.Fatalf("shortest_drive is null, want populated")
	}
	if got.ShortestDrive.DriveID != 8 || got.ShortestDrive.DistanceKm != 2 {
		t.Errorf("shortest_drive = %+v, want id=8 dist=2", *got.ShortestDrive)
	}
	// efficiency-extreme highlights are intentionally always null (range
	// columns were dropped from drives).
	if string(got.MostEfficientDrive) != "null" {
		t.Errorf("most_efficient_drive = %s, want null", got.MostEfficientDrive)
	}
	if string(got.LeastEfficientDrive) != "null" {
		t.Errorf("least_efficient_drive = %s, want null", got.LeastEfficientDrive)
	}

	// monthly stats: always exactly 12 entries, months 1..12 in order.
	if len(got.MonthlyStats) != 12 {
		t.Fatalf("monthly_stats len = %d, want 12", len(got.MonthlyStats))
	}
	for i, ms := range got.MonthlyStats {
		if ms.Month != i+1 {
			t.Fatalf("monthly_stats[%d].month = %d, want %d", i, ms.Month, i+1)
		}
	}
	feb := got.MonthlyStats[1]
	if feb.Drives != 60 || feb.DistanceKm != 1200 || feb.EnergyKwh != 700 || feb.Cost != 90 {
		t.Errorf("february = %+v, want drives=60 dist=1200 energy=700 cost=90", feb)
	}
	jun := got.MonthlyStats[5]
	if jun.Drives != 40 || jun.DistanceKm != 800 || jun.EnergyKwh != 500 || jun.Cost != 90 {
		t.Errorf("june = %+v, want drives=40 dist=800 energy=500 cost=90", jun)
	}
	jan := got.MonthlyStats[0]
	if jan.Drives != 0 || jan.DistanceKm != 0 || jan.EnergyKwh != 0 || jan.Cost != 0 {
		t.Errorf("january = %+v, want all zero", jan)
	}

	// comparisons: 4 base cards + gas (savings>0) + hours (driving>0) = 6.
	if len(got.Comparisons) != 6 {
		t.Fatalf("comparisons len = %d, want 6: %+v", len(got.Comparisons), got.Comparisons)
	}
	if got.Comparisons[0].Label != "Paris round-trips" || got.Comparisons[0].Value != "1.8" || got.Comparisons[0].Emoji != "🗼" {
		t.Errorf("comparisons[0] = %+v, want Paris/1.8/🗼", got.Comparisons[0])
	}
	if !strings.Contains(got.Comparisons[3].Value, "384") || !strings.Contains(got.Comparisons[3].Value, "18 trees") {
		t.Errorf("comparisons[3] (co2) value = %q, want contains 384 & 18 trees", got.Comparisons[3].Value)
	}
	if got.Comparisons[4].Label != "Gas money saved" || got.Comparisons[4].Value != "$124 — that's 24 cups of coffee!" {
		t.Errorf("comparisons[4] = %+v, want gas $124/24 cups", got.Comparisons[4])
	}
	if got.Comparisons[5].Label != "Hours on the road" || got.Comparisons[5].Value != "50 hours — 25 movies!" {
		t.Errorf("comparisons[5] = %+v, want 50 hours/25 movies", got.Comparisons[5])
	}
}

// TestGetYearReview_EmptyYear covers the zero-data path: a real vehicle with
// no qualifying drives/charging. Sections must still render with zeros and
// arrays (monthly_stats) must never collapse to null.
func TestGetYearReview_EmptyYear(t *testing.T) {
	rec := serve(emptyQuerier(), "vehicle_id=7&year=2020")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	// monthly_stats must be a JSON array, never null, always 12 long.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode raw: %v", err)
	}
	if strings.HasPrefix(string(raw["monthly_stats"]), "null") {
		t.Fatalf("monthly_stats = null, want [] array")
	}

	got := decodeYR(t, rec.Body.Bytes())
	if got.TotalDrives != 0 || got.TotalDistanceKm != 0 || got.TotalChargeSessions != 0 {
		t.Errorf("totals not zero: %+v", got)
	}
	if got.GasSavings != 0 {
		t.Errorf("gas_savings = %v, want 0 (no distance)", got.GasSavings)
	}
	if got.Co2OffsetKg != 0 {
		t.Errorf("co2_offset_kg = %v, want 0", got.Co2OffsetKg)
	}
	if got.FastestSpeedKmh != 0 || got.ColdestDriveTempC != 0 || got.HottestDriveTempC != 0 {
		t.Errorf("null extremes should deref to 0: %+v", got)
	}
	if got.LongestDrive != nil || got.ShortestDrive != nil {
		t.Errorf("highlights should be null when no drives")
	}
	if got.MostActiveDayOfWeek != "" || got.MostActiveHour != 0 {
		t.Errorf("active dow/hour should be empty: %q/%d", got.MostActiveDayOfWeek, got.MostActiveHour)
	}
	if got.AvgDrivesPerWeek != 0 || got.AvgDistancePerDriveKm != 0 || got.AvgEfficiencyWhKm != 0 {
		t.Errorf("averages should be 0: %+v", got)
	}
	if got.SuperchargerPct != 0 || got.DcFastPct != 0 || got.AcOtherPct != 0 {
		t.Errorf("charge split should be 0 when no sessions")
	}
	if len(got.MonthlyStats) != 12 {
		t.Fatalf("monthly_stats len = %d, want 12", len(got.MonthlyStats))
	}
	// Only the 4 unconditional comparison cards appear with no gas/hours.
	if len(got.Comparisons) != 4 {
		t.Fatalf("comparisons len = %d, want 4: %+v", len(got.Comparisons), got.Comparisons)
	}
}

// --- tolerated (non-fatal) sub-query failures ----------------------------

func TestGetYearReview_ToleratedFailures(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(fq *fakeQuerier)
		check  func(t *testing.T, got yrResponse)
	}{
		{
			name: "efficiency query error keeps 200 with zero efficiency",
			mutate: func(fq *fakeQuerier) {
				fq.efficiencyRow = fakeRow{err: errors.New("eff boom")}
			},
			check: func(t *testing.T, got yrResponse) {
				if got.AvgEfficiencyWhKm != 0 {
					t.Errorf("avg_efficiency_wh_km = %v, want 0 after error", got.AvgEfficiencyWhKm)
				}
				if got.TotalDrives != 100 {
					t.Errorf("unrelated totals should survive: total_drives=%d", got.TotalDrives)
				}
			},
		},
		{
			name: "settings error falls back to gas defaults",
			mutate: func(fq *fakeQuerier) {
				fq.settingsRow = fakeRow{err: errors.New("settings boom")}
			},
			check: func(t *testing.T, got yrResponse) {
				// Default $3.50 / 25mpg reproduce the happy-path savings.
				if got.GasSavings != 123.98 {
					t.Errorf("gas_savings = %v, want 123.98 from defaults", got.GasSavings)
				}
			},
		},
		{
			name: "highlight scan error yields null highlights not 500",
			mutate: func(fq *fakeQuerier) {
				fq.longestRow = fakeRow{err: errors.New("longest boom")}
				fq.shortestRow = fakeRow{err: pgx.ErrNoRows}
			},
			check: func(t *testing.T, got yrResponse) {
				if got.LongestDrive != nil || got.ShortestDrive != nil {
					t.Errorf("highlights should be null on error/no-rows")
				}
			},
		},
		{
			name: "month/charge-type query errors keep 200 with zeros",
			mutate: func(fq *fakeQuerier) {
				fq.driveMonthErr = errors.New("dm boom")
				fq.driveMonthRows = nil
				fq.chargeMonthErr = errors.New("cm boom")
				fq.chargeMonthRows = nil
				fq.chargeTypeErr = errors.New("ct boom")
				fq.chargeTypeRows = nil
			},
			check: func(t *testing.T, got yrResponse) {
				for _, ms := range got.MonthlyStats {
					if ms.Drives != 0 || ms.EnergyKwh != 0 {
						t.Fatalf("month %d should be zero after query error: %+v", ms.Month, ms)
					}
				}
				if got.SuperchargerPct != 0 || got.DcFastPct != 0 || got.AcOtherPct != 0 {
					t.Errorf("charge split should be 0 after query error")
				}
			},
		},
		{
			name: "month iteration error tolerated (Err surfaced, not fatal)",
			mutate: func(fq *fakeQuerier) {
				fq.driveMonthRows = &fakeRows{iterErr: errors.New("dm iter boom")}
				fq.chargeMonthRows = &fakeRows{iterErr: errors.New("cm iter boom")}
			},
			check: func(t *testing.T, got yrResponse) {
				for _, ms := range got.MonthlyStats {
					if ms.Drives != 0 {
						t.Fatalf("month %d should be zero on iter error: %+v", ms.Month, ms)
					}
				}
			},
		},
		{
			name: "month scan error skips row, keeps 200",
			mutate: func(fq *fakeQuerier) {
				fq.driveMonthRows = &fakeRows{rows: [][]any{{int(6), int(40), 800.0}}, scanErr: errors.New("scan boom")}
			},
			check: func(t *testing.T, got yrResponse) {
				if got.MonthlyStats[5].Drives != 0 {
					t.Errorf("june drives = %d, want 0 (scan skipped)", got.MonthlyStats[5].Drives)
				}
			},
		},
		{
			name: "soc query error keeps 200 with zero soc",
			mutate: func(fq *fakeQuerier) {
				fq.socRow = fakeRow{err: errors.New("soc boom")}
			},
			check: func(t *testing.T, got yrResponse) {
				if got.AvgChargeStartSoc != 0 {
					t.Errorf("avg_charge_start_soc = %v, want 0 after error", got.AvgChargeStartSoc)
				}
			},
		},
		{
			name: "dow/hour query error keeps defaults",
			mutate: func(fq *fakeQuerier) {
				fq.dowRow = fakeRow{err: errors.New("dow boom")}
				fq.hourRow = fakeRow{err: errors.New("hour boom")}
			},
			check: func(t *testing.T, got yrResponse) {
				if got.MostActiveDayOfWeek != "" {
					t.Errorf("most_active_day_of_week = %q, want empty", got.MostActiveDayOfWeek)
				}
				if got.MostActiveHour != 0 {
					t.Errorf("most_active_hour = %d, want 0", got.MostActiveHour)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fq := okQuerier()
			tt.mutate(fq)
			rec := serve(fq, "vehicle_id=42&year=2020")
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			tt.check(t, decodeYR(t, rec.Body.Bytes()))
		})
	}
}

// TestGetYearReview_GasSavingsClamped verifies that when the equivalent gas
// cost is below the actual charging cost the reported savings floor at 0 and
// the "Gas money saved" comparison card is omitted.
func TestGetYearReview_GasSavingsClamped(t *testing.T) {
	fq := okQuerier()
	// Charging cost far exceeds the gas-equivalent -> negative -> clamp 0.
	fq.chargingStatsRow = fakeRow{vals: []any{int(50), 1200.0, 5000.0}}
	rec := serve(fq, "vehicle_id=42&year=2020")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	got := decodeYR(t, rec.Body.Bytes())
	if got.GasSavings != 0 {
		t.Errorf("gas_savings = %v, want 0 (clamped)", got.GasSavings)
	}
	for _, c := range got.Comparisons {
		if c.Label == "Gas money saved" {
			t.Errorf("gas comparison card must be absent when savings=0")
		}
	}
}

// TestGetYearReview_YearWindowBranches exercises the elapsed-year branch: a
// far-future (but valid) year makes yearEnd.After(now) true while elapsed<=0,
// so weeksInYear stays 52 and avg_drives_per_week is deterministic.
func TestGetYearReview_YearWindowBranches(t *testing.T) {
	rec := serve(okQuerier(), "vehicle_id=42&year=2099")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	got := decodeYR(t, rec.Body.Bytes())
	if got.Year != 2099 {
		t.Errorf("year = %d, want 2099", got.Year)
	}
	if got.AvgDrivesPerWeek != 1.9 {
		t.Errorf("avg_drives_per_week = %v, want 1.9 (52-week baseline)", got.AvgDrivesPerWeek)
	}
}

// TestGetYearReview_DefaultYear verifies the default-year branch (no year
// param) uses the current year and still returns 200.
func TestGetYearReview_DefaultYear(t *testing.T) {
	rec := serve(okQuerier(), "vehicle_id=42")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	got := decodeYR(t, rec.Body.Bytes())
	if got.Year != time.Now().Year() {
		t.Errorf("year = %d, want current year %d", got.Year, time.Now().Year())
	}
}

// TestGetYearReview_BoundaryYears confirms the inclusive 2010..2100 bounds
// are accepted (the just-outside values are rejected in the validation table).
func TestGetYearReview_BoundaryYears(t *testing.T) {
	for _, y := range []string{"2010", "2100"} {
		t.Run("year="+y, func(t *testing.T) {
			rec := serve(okQuerier(), "vehicle_id=42&year="+y)
			if rec.Code != http.StatusOK {
				t.Fatalf("year %s: status = %d, want 200; body=%s", y, rec.Code, rec.Body.String())
			}
		})
	}
}

// --- parameterised-SQL safety --------------------------------------------

// TestGetYearReview_ParamsPropagated asserts the parsed int64 vehicle_id and
// the derived [yearStart, yearEnd) window reach the sub-queries as bind
// parameters — guarding against a regression that hard-codes an ID, drops a
// parameter, or interpolates values into the SQL string.
func TestGetYearReview_ParamsPropagated(t *testing.T) {
	fq := okQuerier()
	rec := serve(fq, "vehicle_id=42&year=2020")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	wantStart := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	wantEnd := time.Date(2021, 1, 1, 0, 0, 0, 0, time.UTC)

	var sawVehicle, sawWindowed bool
	for i, sql := range fq.queries {
		a := fq.args[i]
		switch {
		case strings.Contains(sql, "FROM vehicles"):
			sawVehicle = true
			if len(a) != 1 {
				t.Fatalf("vehicle query args = %v, want [42]", a)
			}
			if id, ok := a[0].(int64); !ok || id != 42 {
				t.Fatalf("vehicle query $1 = %v (%T), want int64 42", a[0], a[0])
			}
		case strings.Contains(sql, "FROM settings"):
			if len(a) != 0 {
				t.Fatalf("settings query should take no bind args, got %v", a)
			}
		case len(a) == 3:
			// Every windowed drive/charging query carries (id, start, end).
			if id, ok := a[0].(int64); !ok || id != 42 {
				t.Fatalf("query %d $1 = %v (%T), want int64 42", i, a[0], a[0])
			}
			start, ok1 := a[1].(time.Time)
			end, ok2 := a[2].(time.Time)
			if !ok1 || !ok2 {
				t.Fatalf("query %d window args = (%T,%T), want (time.Time,time.Time)", i, a[1], a[2])
			}
			if !start.Equal(wantStart) || !end.Equal(wantEnd) {
				t.Fatalf("query %d window = [%s,%s), want [%s,%s)", i, start, end, wantStart, wantEnd)
			}
			sawWindowed = true
		}
	}
	if !sawVehicle {
		t.Fatal("no vehicle lookup query recorded")
	}
	if !sawWindowed {
		t.Fatal("no windowed (id,start,end) query recorded")
	}
}

// TestGetYearReview_SICanonicalColumns pins the queries to the SI-canonical
// column names mandated by Phase-48 (no legacy Mi/Min/Mph/Kwh/Kw suffixes on
// disk). A regression that reintroduces a legacy unit column would silently
// misrepresent the aggregates, and is caught here.
func TestGetYearReview_SICanonicalColumns(t *testing.T) {
	fq := okQuerier()
	rec := serve(fq, "vehicle_id=42&year=2020")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	all := strings.ToLower(strings.Join(fq.queries, "\n"))
	for _, col := range []string{"distance_m", "duration_s", "max_speed_mps", "energy_used_wh", "total_energy_added_wh", "cost_decimal", "start_soc_pct"} {
		if !strings.Contains(all, col) {
			t.Fatalf("queries missing SI column %q", col)
		}
	}
	for _, forbidden := range []string{"distance_mi", "duration_min", "avg_speed_mph", "max_speed_mph", "energy_used_kwh", "energy_added_kwh", "_kw ", "_psi"} {
		if strings.Contains(all, forbidden) {
			t.Fatalf("query contains forbidden legacy unit token %q", forbidden)
		}
	}
}

// --- pure-function helpers -----------------------------------------------

func TestRoundYR(t *testing.T) {
	tests := []struct {
		name     string
		in       float64
		decimals int
		want     float64
	}{
		{"one decimal rounds up", 123.456, 1, 123.5},
		{"one decimal rounds down", 123.44, 1, 123.4},
		{"two decimals", 1.239, 2, 1.24},
		{"whole number unchanged", 100, 2, 100},
		{"zero", 0, 3, 0},
		{"negative", -5.24, 1, -5.2},
		{"nan sanitised to zero", math.NaN(), 1, 0},
		{"positive inf sanitised", math.Inf(1), 1, 0},
		{"negative inf sanitised", math.Inf(-1), 2, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := roundYR(tt.in, tt.decimals); got != tt.want {
				t.Errorf("roundYR(%v, %d) = %v, want %v", tt.in, tt.decimals, got, tt.want)
			}
		})
	}
}

func TestSafeFloat(t *testing.T) {
	tests := []struct {
		name string
		in   float64
		want float64
	}{
		{"finite passthrough", 1.5, 1.5},
		{"zero", 0, 0},
		{"negative passthrough", -42.25, -42.25},
		{"nan", math.NaN(), 0},
		{"positive inf", math.Inf(1), 0},
		{"negative inf", math.Inf(-1), 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := safeFloat(tt.in); got != tt.want {
				t.Errorf("safeFloat(%v) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestDerefFloat(t *testing.T) {
	if got := derefFloat(nil); got != 0 {
		t.Errorf("derefFloat(nil) = %v, want 0", got)
	}
	v := 3.14
	if got := derefFloat(&v); got != 3.14 {
		t.Errorf("derefFloat(&3.14) = %v, want 3.14", got)
	}
	zero := 0.0
	if got := derefFloat(&zero); got != 0 {
		t.Errorf("derefFloat(&0) = %v, want 0", got)
	}
}

// --- constructor / port wiring -------------------------------------------

// TestNewHandler_WiresPort verifies the exported constructor produces a
// handler whose query port is populated (production wires the real
// *pgxpool.Pool via db.Pool) and whose HTTP method surface stays stable.
func TestNewHandler_WiresPort(t *testing.T) {
	h := &Handler{q: okQuerier()}
	if h.q == nil {
		t.Fatal("handler query port is nil")
	}
	var _ http.HandlerFunc = h.GetYearReview
}
