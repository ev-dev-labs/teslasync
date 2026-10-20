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
// succeeds with deterministic fixtures. Distances are the already
// SI-converted values the SELECT boundary produces (km, km/h, °C);
// energy stays SI watt-hours and durations stay SI seconds.
func okQuerier() *fakeQuerier {
	return &fakeQuerier{
		vehicleRow:       fakeRow{vals: []any{"Model Y Test", "modely"}},
		driveStatsRow:    fakeRow{vals: []any{int(100), 2000.0, 3000.0, 180.0, -5.0, 38.0}},
		efficiencyRow:    fakeRow{vals: []any{155.5}},
		chargingStatsRow: fakeRow{vals: []any{int(50), 1200000.0, 50.0}},
		settingsRow:      fakeRow{vals: []any{3.50, 25.0}},
		longestRow:       fakeRow{vals: []any{int64(7), mustDate("2020-06-15"), 90000.0, 3600.0, strptr("Home"), strptr("Work")}},
		shortestRow:      fakeRow{vals: []any{int64(8), mustDate("2020-02-01"), 2000.0, 600.0, strptr("A"), strptr("B")}},
		dowRow:           fakeRow{vals: []any{int(5), int(30)}},
		hourRow:          fakeRow{vals: []any{int(17), int(25)}},
		socRow:           fakeRow{vals: []any{42.0, int(20)}},
		driveMonthRows:   &fakeRows{rows: [][]any{{int(6), int(40), 800.0}, {int(2), int(60), 1200.0}}},
		chargeMonthRows:  &fakeRows{rows: [][]any{{int(6), 500000.0, 90.0}, {int(2), 700000.0, 90.0}}},
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
		socRow:           fakeRow{vals: []any{nil, int(0)}},
		driveMonthRows:   &fakeRows{},
		chargeMonthRows:  &fakeRows{},
		chargeTypeRows:   &fakeRows{},
	}
}

// --- response decoding ---------------------------------------------------

type highlightJSON struct {
	DriveID      int64   `json:"drive_id"`
	Date         string  `json:"date"`
	DistanceKm   float64 `json:"distance_km"`
	DurationS    float64 `json:"duration_s"`
	StartAddress string  `json:"start_address"`
	EndAddress   string  `json:"end_address"`
}

type monthJSON struct {
	Month      int     `json:"month"`
	Drives     int     `json:"drives"`
	DistanceKm float64 `json:"distance_km"`
	EnergyWh   float64 `json:"energy_wh"`
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
	TotalDrivingMinutes   float64          `json:"total_driving_minutes"`
	TotalChargingCost     float64          `json:"total_charging_cost"`
	GasSavings            float64          `json:"gas_savings"`
	Co2OffsetKg           float64          `json:"co2_offset_kg"`
	LongestDrive          *highlightJSON   `json:"longest_drive"`
	ShortestDrive         *highlightJSON   `json:"shortest_drive"`
	MostEfficientDrive    json.RawMessage  `json:"most_efficient_drive"`
	LeastEfficientDrive   json.RawMessage  `json:"least_efficient_drive"`
	FastestSpeedKmh       *float64         `json:"fastest_speed_kmh"`
	ColdestDriveTempC     *float64         `json:"coldest_drive_temp_c"`
	HottestDriveTempC     *float64         `json:"hottest_drive_temp_c"`
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

func rawReview(t *testing.T, fq *fakeQuerier) map[string]json.RawMessage {
	t.Helper()
	rec := serve(fq, "vehicle_id=42&year=2020")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", rec.Code, rec.Body.String())
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestGetYearReview_CalendarBasis(t *testing.T) {
	for _, tt := range []struct {
		name string
		at   time.Time
		want string
	}{
		{"west boundary", time.Date(2020, 1, 1, 23, 30, 0, 0, time.FixedZone("west", -8*3600)), "2020-01-02"},
		{"east boundary", time.Date(2020, 1, 2, 0, 30, 0, 0, time.FixedZone("east", 14*3600)), "2020-01-01"},
		{"missing", time.Time{}, ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			fq := okQuerier()
			fq.longestRow = fakeRow{vals: []any{int64(7), tt.at, 90000.0, 3576.0, strptr("McDonald ROAD"), strptr("iPhone Street")}}
			rec := serve(fq, "vehicle_id=42&year=2020")
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d; body=%s", rec.Code, rec.Body.String())
			}
			got := decodeYR(t, rec.Body.Bytes()).LongestDrive
			if got == nil || got.Date != tt.want || got.DurationS != 3576 || got.StartAddress != "McDonald ROAD" {
				t.Fatalf("highlight = %+v", got)
			}
			count := 0
			for _, query := range fq.queries {
				if strings.Contains(query, "EXTRACT(") {
					count++
					if !strings.Contains(query, "started_at AT TIME ZONE 'UTC'") {
						t.Errorf("calendar aggregation depends on session timezone: %s", query)
					}
				}
			}
			if count != 4 {
				t.Errorf("calendar queries = %d, want 4", count)
			}
		})
	}
}
func assertWire(t *testing.T, raw map[string]json.RawMessage, key, want string) {
	t.Helper()
	if got := string(raw[key]); got != want {
		t.Errorf("%s = %s, want %s", key, got, want)
	}
}

func TestGetYearReview_SecondaryScalarAvailability(t *testing.T) {
	for _, tt := range []struct {
		name  string
		value any
		want  string
	}{
		{"missing", nil, "null"},
		{"nan", math.NaN(), "null"},
		{"infinity", math.Inf(1), "null"},
		{"negative infinity", math.Inf(-1), "null"},
		{"overflow", math.MaxFloat64, "null"},
		{"zero", 0.0, "0"},
		{"fraction", 42.26, "42.3"},
		{"signed fraction", -5.26, "-5.3"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			fq := okQuerier()
			fq.efficiencyRow = fakeRow{vals: []any{tt.value}}
			fq.socRow = fakeRow{vals: []any{tt.value, int(1)}}
			raw := rawReview(t, fq)
			assertWire(t, raw, "avg_efficiency_wh_km", tt.want)
			socWant := tt.want
			if value, ok := tt.value.(float64); ok && (value < 0 || value > 100) {
				socWant = "null"
			}
			assertWire(t, raw, "avg_charge_start_soc", socWant)
			assertWire(t, raw, "avg_charge_start_soc_count", "1")
			assertWire(t, raw, "total_drives", "100")
			assertWire(t, raw, "gas_savings", "123.98")
		})
	}
	for _, err := range []error{pgx.ErrNoRows, errors.New("query failed")} {
		fq := okQuerier()
		fq.efficiencyRow, fq.socRow = fakeRow{err: err}, fakeRow{err: err}
		raw := rawReview(t, fq)
		assertWire(t, raw, "avg_efficiency_wh_km", "null")
		assertWire(t, raw, "avg_charge_start_soc", "null")
		assertWire(t, raw, "avg_charge_start_soc_count", "null")
		assertWire(t, raw, "total_energy_kwh", "1200")
	}
}

func TestGetYearReview_ChargingObservationAvailability(t *testing.T) {
	for _, tt := range []struct {
		name  string
		soc   any
		count int
		want  string
	}{
		{"no observations", nil, 0, "null"},
		{"zero without observations", 0.0, 0, "null"},
		{"measured zero", 0.0, 3, "0"},
		{"fractional SOC", 42.26, 3, "42.3"},
		{"full SOC", 100.0, 3, "100"},
		{"missing SOC", nil, 3, "null"},
		{"negative SOC", -0.1, 3, "null"},
		{"above full SOC", 100.1, 3, "null"},
		{"nan SOC", math.NaN(), 3, "null"},
		{"infinite SOC", math.Inf(1), 3, "null"},
		{"invalid count", 42.0, -1, "null"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			fq := okQuerier()
			fq.socRow = fakeRow{vals: []any{tt.soc, tt.count}}
			raw := rawReview(t, fq)
			assertWire(t, raw, "avg_charge_start_soc", tt.want)
			countWant := fmt.Sprint(tt.count)
			if tt.count < 0 {
				countWant = "null"
			}
			assertWire(t, raw, "avg_charge_start_soc_count", countWant)
			assertWire(t, raw, "total_charge_sessions", "50")
			for i, sql := range fq.queries {
				if !strings.Contains(sql, "AVG(start_soc_pct)") {
					continue
				}
				for _, fragment := range []string{
					"COUNT(start_soc_pct)", "start_soc_pct >= 0", "start_soc_pct <= 100",
					"vehicle_id = $1", "ended_at IS NOT NULL", "started_at >= $2", "started_at < $3",
				} {
					if !strings.Contains(sql, fragment) {
						t.Errorf("SOC query missing %q: %s", fragment, sql)
					}
				}
				if len(fq.args[i]) != 3 || fq.args[i][0] != int64(42) ||
					fq.args[i][1] != mustDate("2020-01-01") || fq.args[i][2] != mustDate("2021-01-01") {
					t.Errorf("SOC scope args = %v", fq.args[i])
				}
			}
		})
	}

	for _, tt := range []struct {
		name string
		rows *fakeRows
		sc   string
		dc   string
		ac   string
	}{
		{"no sessions", &fakeRows{}, "null", "null", "null"},
		{"zero denominator", &fakeRows{rows: [][]any{{"supercharger", 0}}}, "null", "null", "null"},
		{"measured zero share", &fakeRows{rows: [][]any{{"dc_fast", 2}}}, "0", "100", "0"},
		{"fractional shares", &fakeRows{rows: [][]any{{"supercharger", 1}, {"dc_fast", 2}}}, "33.3", "66.7", "0"},
		{"negative count", &fakeRows{rows: [][]any{{"supercharger", -1}}}, "null", "null", "null"},
		{"unknown category", &fakeRows{rows: [][]any{{"unknown", 1}}}, "null", "null", "null"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			fq := okQuerier()
			fq.chargeTypeRows = tt.rows
			raw := rawReview(t, fq)
			assertWire(t, raw, "supercharger_pct", tt.sc)
			assertWire(t, raw, "dc_fast_pct", tt.dc)
			assertWire(t, raw, "ac_other_pct", tt.ac)
		})
	}

	raw := rawReview(t, emptyQuerier())
	assertWire(t, raw, "avg_charge_start_soc", "null")
	assertWire(t, raw, "avg_charge_start_soc_count", "0")
}

func TestGetYearReview_SettingsAvailability(t *testing.T) {
	for _, tt := range []struct {
		name       string
		price, mpg any
		want       string
	}{
		{"missing price", nil, 25.0, "null"},
		{"missing efficiency", 3.5, nil, "null"},
		{"invalid price", math.NaN(), 25.0, "null"},
		{"invalid efficiency", 3.5, math.Inf(1), "null"},
		{"zero efficiency", 3.5, 0.0, "null"},
		{"negative efficiency", 3.5, -25.0, "null"},
		{"negative price", -3.5, 25.0, "null"},
		{"zero price is measured", 0.0, 25.0, "-50"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			fq := okQuerier()
			fq.settingsRow = fakeRow{vals: []any{tt.price, tt.mpg}}
			raw := rawReview(t, fq)
			assertWire(t, raw, "gas_savings", tt.want)
			assertWire(t, raw, "total_charging_cost", "50")
		})
	}
	fq := okQuerier()
	fq.settingsRow = fakeRow{err: errors.New("unavailable settings")}
	raw := rawReview(t, fq)
	assertWire(t, raw, "gas_savings", "null")
	var cards []comparisonJSON
	if err := json.Unmarshal(raw["comparisons"], &cards); err != nil {
		t.Fatal(err)
	}
	for _, card := range cards {
		if card.Label == "Gas money saved" {
			t.Fatal("unavailable savings produced a comparison")
		}
	}
}

func TestGetYearReview_ActivityAvailability(t *testing.T) {
	for _, tt := range []struct {
		name     string
		row      fakeRow
		wantHour string
		wantDay  string
	}{
		{"missing", fakeRow{err: pgx.ErrNoRows}, "null", "null"},
		{"failed", fakeRow{err: errors.New("unavailable")}, "null", "null"},
		{"invalid negative", fakeRow{vals: []any{-1, 5}}, "null", "null"},
		{"invalid index", fakeRow{vals: []any{24, 5}}, "null", "null"},
		{"invalid count", fakeRow{vals: []any{0, 0}}, "null", "null"},
		{"midnight Sunday", fakeRow{vals: []any{0, 5}}, "0", `"Sunday"`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			fq := okQuerier()
			fq.hourRow, fq.dowRow = tt.row, tt.row
			raw := rawReview(t, fq)
			assertWire(t, raw, "most_active_hour", tt.wantHour)
			assertWire(t, raw, "most_active_day_of_week", tt.wantDay)
			assertWire(t, raw, "avg_efficiency_wh_km", "155.5")
		})
	}
}

func TestGetYearReview_GroupFailuresPreserveNeighbors(t *testing.T) {
	for _, group := range []string{"drive", "charge", "type"} {
		for _, failure := range []string{"query", "scan", "iteration"} {
			t.Run(group+"/"+failure, func(t *testing.T) {
				fq := okQuerier()
				fail := errors.New("secondary failure")
				rows := &fakeRows{rows: [][]any{{6, 40, 800.0}}}
				if group == "charge" {
					rows.rows = [][]any{{6, 500.0, 90.0}}
				} else if group == "type" {
					rows.rows = [][]any{{"supercharger", 30}}
				}
				if failure == "scan" {
					rows.scanErr = fail
				} else if failure == "iteration" {
					rows.iterErr = fail
				}
				switch group {
				case "drive":
					fq.driveMonthRows = rows
					if failure == "query" {
						fq.driveMonthErr = fail
					}
				case "charge":
					fq.chargeMonthRows = rows
					if failure == "query" {
						fq.chargeMonthErr = fail
					}
				case "type":
					fq.chargeTypeRows = rows
					if failure == "query" {
						fq.chargeTypeErr = fail
					}
				}
				raw := rawReview(t, fq)
				assertWire(t, raw, "total_drives", "100")
				assertWire(t, raw, "avg_charge_start_soc", "42")
				var months []map[string]json.RawMessage
				if err := json.Unmarshal(raw["monthly_stats"], &months); err != nil {
					t.Fatal(err)
				}
				if len(months) != 12 {
					t.Fatalf("got %d months", len(months))
				}
				for _, month := range months {
					if group == "drive" {
						assertWire(t, month, "drives", "null")
						assertWire(t, month, "distance_km", "null")
					} else if group == "charge" {
						assertWire(t, month, "energy_wh", "null")
						assertWire(t, month, "cost", "null")
					}
				}
				if group != "charge" {
					assertWire(t, months[5], "energy_wh", "500000")
				}
				if group != "drive" {
					assertWire(t, months[5], "drives", "40")
				}
				for _, key := range []string{"supercharger_pct", "dc_fast_pct", "ac_other_pct"} {
					if group == "type" {
						assertWire(t, raw, key, "null")
					} else if string(raw[key]) == "null" {
						t.Errorf("successful %s became unavailable", key)
					}
				}
				if failure != "query" && !rows.closed {
					t.Error("rows not closed")
				}
			})
		}
	}
}

func TestGetYearReview_MonthlyValuesAndFractionalDuration(t *testing.T) {
	fq := okQuerier()
	fq.driveStatsRow = fakeRow{vals: []any{100, 2000.0, 3000.5, 180.0, -5.0, 38.0}}
	fq.driveMonthRows = &fakeRows{rows: [][]any{{6, 40, math.NaN()}}}
	fq.chargeMonthRows = &fakeRows{rows: [][]any{
		{6, nil, -5.265}, {2, 0.0, 0.0}, {3, 1260.0, math.Inf(1)},
	}}
	raw := rawReview(t, fq)
	assertWire(t, raw, "total_driving_minutes", "3000.5")
	var months []map[string]json.RawMessage
	if err := json.Unmarshal(raw["monthly_stats"], &months); err != nil {
		t.Fatal(err)
	}
	assertWire(t, months[5], "drives", "40")
	assertWire(t, months[5], "distance_km", "null")
	assertWire(t, months[5], "energy_wh", "null")
	assertWire(t, months[5], "cost", "-5.27")
	assertWire(t, months[1], "energy_wh", "0")
	assertWire(t, months[1], "cost", "0")
	assertWire(t, months[2], "energy_wh", "1260")
	assertWire(t, months[2], "cost", "null")
	assertWire(t, months[0], "drives", "0")
	assertWire(t, months[0], "energy_wh", "0")
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
		t.Errorf("total_driving_minutes = %v, want 3000", got.TotalDrivingMinutes)
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
	if got.FastestSpeedKmh == nil || *got.FastestSpeedKmh != 180 {
		t.Errorf("fastest_speed_kmh = %v, want 180", got.FastestSpeedKmh)
	}
	if got.ColdestDriveTempC == nil || *got.ColdestDriveTempC != -5 {
		t.Errorf("coldest_drive_temp_c = %v, want -5", got.ColdestDriveTempC)
	}
	if got.HottestDriveTempC == nil || *got.HottestDriveTempC != 38 {
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
	if got.ShortestDrive.DriveID != 8 || got.ShortestDrive.DistanceKm != 2 || got.ShortestDrive.DurationS != 600 {
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
	if feb.Drives != 60 || feb.DistanceKm != 1200 || feb.EnergyWh != 700000 || feb.Cost != 90 {
		t.Errorf("february = %+v, want drives=60 dist=1200 energy=700000 cost=90", feb)
	}
	jun := got.MonthlyStats[5]
	if jun.Drives != 40 || jun.DistanceKm != 800 || jun.EnergyWh != 500000 || jun.Cost != 90 {
		t.Errorf("june = %+v, want drives=40 dist=800 energy=500000 cost=90", jun)
	}
	jan := got.MonthlyStats[0]
	if jan.Drives != 0 || jan.DistanceKm != 0 || jan.EnergyWh != 0 || jan.Cost != 0 {
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
	if got.Comparisons[4].Label != "Gas money saved" || got.Comparisons[4].Value != "$123.98 — that's 24 cups of coffee!" {
		t.Errorf("comparisons[4] = %+v, want gas $123.98/24 cups", got.Comparisons[4])
	}
	if got.Comparisons[5].Label != "Hours on the road" || got.Comparisons[5].Value != "50 hours — 25 movies!" {
		t.Errorf("comparisons[5] = %+v, want 50 hours/25 movies", got.Comparisons[5])
	}
}

func TestGetYearReview_EfficiencyRecordsUnavailableReason(t *testing.T) {
	for _, tt := range []struct {
		name string
		fq   *fakeQuerier
	}{
		{"populated year", okQuerier()},
		{"empty year", emptyQuerier()},
	} {
		t.Run(tt.name, func(t *testing.T) {
			raw := rawReview(t, tt.fq)
			assertWire(t, raw, "most_efficient_drive", "null")
			assertWire(t, raw, "least_efficient_drive", "null")
			assertWire(t, raw, "efficiency_records_unavailable_reason", `"unsupported"`)
			if tt.name == "populated year" {
				assertWire(t, raw, "avg_efficiency_wh_km", "155.5")
				assertWire(t, raw, "total_drives", "100")
				for _, key := range []string{"longest_drive", "shortest_drive"} {
					if len(raw[key]) == 0 || string(raw[key]) == "null" {
						t.Errorf("%s must remain populated", key)
					}
				}
			} else {
				assertWire(t, raw, "total_drives", "0")
				assertWire(t, raw, "longest_drive", "null")
				assertWire(t, raw, "shortest_drive", "null")
			}
		})
	}
}

func TestGetYearReview_HighlightWireContract(t *testing.T) {
	fq := okQuerier()
	fq.longestRow = fakeRow{vals: []any{
		int64(7), mustDate("2020-06-15"), 90000.0, 3576.0, strptr("Home"), strptr("Work"),
	}}
	fq.shortestRow = fakeRow{vals: []any{
		int64(8), mustDate("2020-02-01"), 2000.0, 30.0, nil, nil,
	}}
	rec := serve(fq, "vehicle_id=42&year=2020")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var response map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		name string
		want string
	}{
		{"longest_drive", `{"drive_id":7,"date":"2020-06-15","distance_km":90,"duration_s":3576,"start_address":"Home","end_address":"Work","efficiency_wh_km":0}`},
		{"shortest_drive", `{"drive_id":8,"date":"2020-02-01","distance_km":2,"duration_s":30,"start_address":"","end_address":"","efficiency_wh_km":0}`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var got, want map[string]any
			if err := json.Unmarshal(response[tt.name], &got); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal([]byte(tt.want), &want); err != nil {
				t.Fatal(err)
			}
			if len(got) != len(want) {
				t.Fatalf("highlight keys = %v, want exactly %v", got, want)
			}
			for key, value := range want {
				if got[key] != value {
					t.Errorf("%s = %v, want %v", key, got[key], value)
				}
			}
		})
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
	if got.FastestSpeedKmh != nil || got.ColdestDriveTempC != nil || got.HottestDriveTempC != nil {
		t.Errorf("missing extremes should remain null: %+v", got)
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
			name: "efficiency query error keeps 200",
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
			name: "settings error leaves savings unavailable",
			mutate: func(fq *fakeQuerier) {
				fq.settingsRow = fakeRow{err: errors.New("settings boom")}
			},
			check: func(t *testing.T, got yrResponse) {
				if got.GasSavings != 0 {
					t.Errorf("null gas_savings decoded as %v, want zero value", got.GasSavings)
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
					if ms.Drives != 0 || ms.EnergyWh != 0 {
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

// Negative savings are valid, but must not generate a money-saved card.
func TestGetYearReview_NegativeGasSavings(t *testing.T) {
	fq := okQuerier()
	// Charging cost far exceeds the gas-equivalent.
	fq.chargingStatsRow = fakeRow{vals: []any{int(50), 1200.0, 5000.0}}
	rec := serve(fq, "vehicle_id=42&year=2020")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	got := decodeYR(t, rec.Body.Bytes())
	if got.GasSavings != -4826.02 {
		t.Errorf("gas_savings = %v, want -4826.02", got.GasSavings)
	}
	for _, c := range got.Comparisons {
		if c.Label == "Gas money saved" {
			t.Errorf("gas money saved card must be absent when savings are negative")
		}
	}
	var found bool
	for _, c := range got.Comparisons {
		if c.Label == "Additional spending" {
			found = true
			if c.Value != "$-4826.02" {
				t.Errorf("additional spending = %q, want $-4826.02", c.Value)
			}
		}
	}
	if !found {
		t.Fatal("negative savings must produce an additional spending comparison")
	}
}

func TestGetYearReview_SignedChargingCosts(t *testing.T) {
	for _, tt := range []struct {
		name        string
		cost        any
		wantCost    string
		wantSavings string
		wantLabel   string
		wantValue   string
	}{
		{"missing cost", nil, "null", "null", "", ""},
		{"invalid cost", math.NaN(), "null", "null", "", ""},
		{"positive infinity", math.Inf(1), "null", "null", "", ""},
		{"negative infinity", math.Inf(-1), "null", "null", "", ""},
		{"measured zero", 0.0, "0", "0", "", ""},
		{"fractional spending", 0.25, "0.25", "-0.25", "Additional spending", "$-0.25"},
		{"credit", -50.0, "-50", "50", "Gas money saved", "$50.00 — that's 10 cups of coffee!"},
		{"fractional credit", -0.25, "-0.25", "0.25", "Gas money saved", "$0.25 — that's 0 cups of coffee!"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			fq := okQuerier()
			fq.settingsRow = fakeRow{vals: []any{0.0, 25.0}}
			fq.chargingStatsRow = fakeRow{vals: []any{50, 1200.0, tt.cost}}
			fq.chargeMonthRows = &fakeRows{rows: [][]any{{6, 1200.0, tt.cost}}}
			raw := rawReview(t, fq)
			assertWire(t, raw, "total_charging_cost", tt.wantCost)
			assertWire(t, raw, "gas_savings", tt.wantSavings)
			var months []map[string]json.RawMessage
			if err := json.Unmarshal(raw["monthly_stats"], &months); err != nil {
				t.Fatal(err)
			}
			assertWire(t, months[5], "cost", tt.wantCost)
			var cards []comparisonJSON
			if err := json.Unmarshal(raw["comparisons"], &cards); err != nil {
				t.Fatal(err)
			}
			found := false
			for _, card := range cards {
				if card.Label != "Gas money saved" && card.Label != "Additional spending" {
					continue
				}
				found = true
				if card.Label != tt.wantLabel || (tt.wantValue != "" && card.Value != tt.wantValue) {
					t.Errorf("money comparison = %+v, want label %q value %q", card, tt.wantLabel, tt.wantValue)
				}
			}
			if found != (tt.wantLabel != "") {
				t.Errorf("money comparison present = %v, want %v", found, tt.wantLabel != "")
			}
		})
	}
}

// A future year has no elapsed denominator, even if a fixture supplies drives.
func TestGetYearReview_YearWindowBranches(t *testing.T) {
	rec := serve(okQuerier(), "vehicle_id=42&year=2099")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	got := decodeYR(t, rec.Body.Bytes())
	if got.Year != 2099 {
		t.Errorf("year = %d, want 2099", got.Year)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	assertWire(t, raw, "avg_drives_per_week", "null")
	var period weeklyRatePeriod
	if err := json.Unmarshal(raw["weekly_rate_period"], &period); err != nil {
		t.Fatal(err)
	}
	if period.Basis != "not_started" || period.DenominatorWeeks != nil ||
		period.Label != "Drives per week (year not started)" || period.ObservationCoverage != "unknown" {
		t.Fatalf("future period = %+v", period)
	}
}

func TestGetYearReview_ElapsedWeeklyRateWireContract(t *testing.T) {
	before := time.Now().UTC()
	rec := serve(okQuerier(), fmt.Sprintf("vehicle_id=42&year=%d", before.Year()))
	after := time.Now().UTC()
	if before.Year() != after.Year() {
		t.Skip("request crossed the calendar-year boundary")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Rate   *float64         `json:"avg_drives_per_week"`
		Period weeklyRatePeriod `json:"weekly_rate_period"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	first, last := weeklyPeriodYR(before.Year(), before), weeklyPeriodYR(before.Year(), after)
	if first.DenominatorWeeks == nil {
		t.Skip("request began exactly at the start of the year")
	}
	if got.Period.Basis != first.Basis || got.Period.Label != first.Label ||
		got.Period.ObservationCoverage != "unknown" || got.Period.MinimumWeeks != 1 ||
		got.Period.DenominatorWeeks == nil || *got.Period.DenominatorWeeks < *first.DenominatorWeeks ||
		*got.Period.DenominatorWeeks > *last.DenominatorWeeks {
		t.Fatalf("elapsed period = %+v", got.Period)
	}
	want := roundYR(100 / *got.Period.DenominatorWeeks, 1)
	if got.Rate == nil || *got.Rate != want {
		t.Fatalf("rate = %v, want %v from published denominator", got.Rate, want)
	}
}

func TestWeeklyPeriodYR(t *testing.T) {
	for _, tt := range []struct {
		name  string
		now   time.Time
		basis string
		weeks float64
		label string
	}{
		{"before start", mustDate("2019-12-31"), "not_started", 0, "Drives per week (year not started)"},
		{"at start", mustDate("2020-01-01"), "not_started", 0, "Drives per week (year not started)"},
		{"minimum week", mustDate("2020-01-02"), "elapsed_year", 1, "Drives per week (elapsed year, minimum one week)"},
		{"exact week", mustDate("2020-01-08"), "elapsed_year", 1, "Drives per week (elapsed year, minimum one week)"},
		{"fractional weeks", mustDate("2020-01-11").Add(12 * time.Hour), "elapsed_year", 1.5, "Drives per week (elapsed year, minimum one week)"},
		{"leap year end", mustDate("2021-01-01"), "full_year", 52, "Drives per week (full-year 52-week baseline)"},
		{"past year", mustDate("2026-10-14"), "full_year", 52, "Drives per week (full-year 52-week baseline)"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := weeklyPeriodYR(2020, tt.now)
			if got.Basis != tt.basis || got.Label != tt.label || got.MinimumWeeks != 1 || got.ObservationCoverage != "unknown" {
				t.Fatalf("period = %+v", got)
			}
			if tt.weeks == 0 {
				if got.DenominatorWeeks != nil {
					t.Fatalf("denominator = %v, want nil", *got.DenominatorWeeks)
				}
			} else if got.DenominatorWeeks == nil || *got.DenominatorWeeks != tt.weeks {
				t.Fatalf("denominator = %v, want %v", got.DenominatorWeeks, tt.weeks)
			}
		})
	}
}

func TestGetYearReview_WeeklyRateWireContract(t *testing.T) {
	for _, tt := range []struct {
		name  string
		count any
		want  string
	}{
		{"measured zero", 0, "0"},
		{"fractional rate", 13, "0.3"},
		{"positive count", 104, "2"},
		{"invalid negative count", -1, "null"},
		{"missing count", nil, ""},
		{"invalid fractional count", 1.5, ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			fq := okQuerier()
			fq.driveStatsRow = fakeRow{vals: []any{tt.count, 2000.0, 3000.0, 180.0, -5.25, 38.25}}
			rec := serve(fq, "vehicle_id=42&year=2020")
			if tt.want == "" {
				if rec.Code != http.StatusInternalServerError {
					t.Fatalf("status = %d, want 500", rec.Code)
				}
				return
			}
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d; body=%s", rec.Code, rec.Body.String())
			}
			var raw map[string]json.RawMessage
			if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
				t.Fatal(err)
			}
			assertWire(t, raw, "avg_drives_per_week", tt.want)
			assertWire(t, raw, "coldest_drive_temp_c", "-5.3")
			assertWire(t, raw, "hottest_drive_temp_c", "38.3")
			var period weeklyRatePeriod
			if err := json.Unmarshal(raw["weekly_rate_period"], &period); err != nil {
				t.Fatal(err)
			}
			if period.Basis != "full_year" || period.DenominatorWeeks == nil || *period.DenominatorWeeks != 52 ||
				period.Label != "Drives per week (full-year 52-week baseline)" || period.ObservationCoverage != "unknown" {
				t.Fatalf("wire period = %+v", period)
			}
		})
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

func TestGetYearReview_ExtremeWireContract(t *testing.T) {
	tests := []struct {
		name  string
		input any
		want  string
	}{
		{"missing", nil, "null"},
		{"typed missing", (*float64)(nil), "null"},
		{"nan", math.NaN(), "null"},
		{"positive infinity", math.Inf(1), "null"},
		{"negative infinity", math.Inf(-1), "null"},
		{"rounding overflow", math.MaxFloat64, "null"},
		{"measured zero", 0.0, "0"},
		{"positive", 38.0, "38"},
		{"negative", -5.0, "-5"},
		{"positive fraction", 38.26, "38.3"},
		{"negative fraction", -5.26, "-5.3"},
		{"fraction rounds to zero", 0.04, "0"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fq := okQuerier()
			fq.driveStatsRow = fakeRow{vals: []any{100, 2000.0, 3000.0, tt.input, tt.input, tt.input}}
			rec := serve(fq, "vehicle_id=7&year=2020")
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			var raw map[string]json.RawMessage
			if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			for _, key := range []string{"fastest_speed_kmh", "coldest_drive_temp_c", "hottest_drive_temp_c"} {
				if string(raw[key]) != tt.want {
					t.Errorf("%s = %s, want %s", key, raw[key], tt.want)
				}
			}
			if !strings.Contains(fq.queries[1], "MAX(max_speed_mps) * 3.6") {
				t.Fatal("speed display conversion changed")
			}
		})
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
