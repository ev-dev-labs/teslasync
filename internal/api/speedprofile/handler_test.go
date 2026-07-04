package speedprofile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// HTTP tests for SpeedProfileHandler.Get.
//
// The handler runs four sequential queries against the SI-canonical drives
// table: a speed-bucket distribution, an efficiency-category rollup, a
// per-drive scatter, and a hero-aggregate QueryRow. These tests drive the
// handler against a fake database.DBTX (no live pool, network, or Tesla API),
// following the established repo pattern in internal/api/gasprice/handler_test.go
// and internal/api/apikey/handler_test.go. They pin:
//   - vehicle_id validation (missing / empty / non-numeric / overflow -> 400)
//   - the nil-querier degradation contract (200 with empty-but-well-formed body)
//   - full-data success, including per-field rounding and null handling
//   - empty results returning JSON arrays (not null)
//   - query / scan / row-iteration failures per sub-query -> 500 with the
//     matching operator message
//   - hero-aggregate degradation (Scan error, pgx.ErrNoRows, and value paths)
//     never failing the whole payload
//   - date-range wiring: the SI bucket-boundary constants and the shared
//     start/end bounds threaded identically through all four queries
//   - rows.Close being deferred and a request deadline being applied

var errBoom = errors.New("boom")

// ---------------------------------------------------------------------------
// Test doubles — database.DBTX / pgx.Rows / pgx.Row fakes.
// ---------------------------------------------------------------------------

// fakeQuerier satisfies database.DBTX. It routes each Query to the correct row
// set by the query's stable SQL fragment, records the SQL + args each sub-query
// received, and can be steered to fail so every error branch is exercised
// deterministically. The single QueryRow call feeds the hero aggregates.
type fakeQuerier struct {
	distRows, catRows, ptRows *fakeRows
	distErr, catErr, ptErr    error
	heroRow                   pgx.Row

	gotDistArgs, gotCatArgs, gotPtArgs, gotHeroArgs []any
	gotDistSQL, gotCatSQL, gotPtSQL, gotHeroSQL     string

	queryCalls     int
	queryRowCalls  int
	ctxHadDeadline bool
}

func (f *fakeQuerier) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	f.queryCalls++
	if _, ok := ctx.Deadline(); ok {
		f.ctxHadDeadline = true
	}
	switch {
	case strings.Contains(sql, "GROUP BY speed_bucket"):
		f.gotDistSQL = sql
		f.gotDistArgs = append([]any(nil), args...)
		if f.distErr != nil {
			return nil, f.distErr
		}
		return orEmptyRows(f.distRows), nil
	case strings.Contains(sql, "GROUP BY category"):
		f.gotCatSQL = sql
		f.gotCatArgs = append([]any(nil), args...)
		if f.catErr != nil {
			return nil, f.catErr
		}
		return orEmptyRows(f.catRows), nil
	case strings.Contains(sql, "distance_mi_calc"):
		f.gotPtSQL = sql
		f.gotPtArgs = append([]any(nil), args...)
		if f.ptErr != nil {
			return nil, f.ptErr
		}
		return orEmptyRows(f.ptRows), nil
	default:
		return nil, fmt.Errorf("fakeQuerier: unexpected Query SQL: %s", sql)
	}
}

func (f *fakeQuerier) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	f.queryRowCalls++
	if _, ok := ctx.Deadline(); ok {
		f.ctxHadDeadline = true
	}
	f.gotHeroSQL = sql
	f.gotHeroArgs = append([]any(nil), args...)
	if f.heroRow != nil {
		return f.heroRow
	}
	return fakeRow{}
}

// Exec is part of the database.DBTX contract but the handler never issues a
// write; a call here signals a regression rather than being silently ignored.
func (f *fakeQuerier) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("fakeQuerier: Exec not expected in speedprofile")
}

var _ database.DBTX = (*fakeQuerier)(nil)

// orEmptyRows lets an unconfigured sub-query succeed with zero rows so tests
// that target a *later* sub-query's failure don't have to stub the earlier ones.
func orEmptyRows(r *fakeRows) pgx.Rows {
	if r == nil {
		return newFakeRows(nil)
	}
	return r
}

// fakeRow satisfies pgx.Row for the hero-aggregate QueryRow path. A nil vals
// slice models "row present, all columns NULL" (Scan leaves the caller's
// **float64 destinations at their nil zero value); scanErr models a driver
// error such as pgx.ErrNoRows.
type fakeRow struct {
	vals    []any
	scanErr error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	if len(r.vals) == 0 {
		return nil
	}
	return scanInto(dest, r.vals)
}

var _ pgx.Row = fakeRow{}

// fakeRows satisfies pgx.Rows. data holds one []any per row in column order;
// scanErrAt forces Scan to fail for a single row and iterErr is surfaced by
// Err() to exercise the post-iteration error branch.
type fakeRows struct {
	data      [][]any
	cursor    int
	closed    bool
	iterErr   error
	scanErrAt int
}

func newFakeRows(data [][]any) *fakeRows {
	return &fakeRows{data: data, cursor: -1, scanErrAt: -1}
}

func (r *fakeRows) Close()                                       { r.closed = true }
func (r *fakeRows) Err() error                                   { return r.iterErr }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }

func (r *fakeRows) Next() bool {
	r.cursor++
	return r.cursor < len(r.data)
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.cursor < 0 || r.cursor >= len(r.data) {
		return errors.New("fakeRows.Scan: cursor out of range")
	}
	if r.cursor == r.scanErrAt {
		return errors.New("fakeRows: forced scan error")
	}
	return scanInto(dest, r.data[r.cursor])
}

func (r *fakeRows) Values() ([]any, error) { return nil, nil }
func (r *fakeRows) RawValues() [][]byte    { return nil }
func (r *fakeRows) Conn() *pgx.Conn        { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

// scanInto copies src column values into the pointer destinations the handler
// hands to Scan, mimicking pgx's assignment semantics for the exact types the
// queries use (string, int, float64, *float64, and **float64 for the nullable
// aggregate columns). A nil src column zeroes the destination — the same way
// pgx maps SQL NULL onto a nil *float64.
func scanInto(dest, src []any) error {
	if len(dest) != len(src) {
		return fmt.Errorf("scanInto: dest/src length mismatch: %d != %d", len(dest), len(src))
	}
	for i := range dest {
		dv := reflect.ValueOf(dest[i])
		if dv.Kind() != reflect.Pointer || dv.IsNil() {
			return errors.New("scanInto: dest is not a non-nil pointer")
		}
		target := dv.Elem()
		if src[i] == nil {
			target.Set(reflect.Zero(target.Type()))
			continue
		}
		sv := reflect.ValueOf(src[i])
		if !sv.Type().AssignableTo(target.Type()) {
			return fmt.Errorf("scanInto: %s not assignable to %s", sv.Type(), target.Type())
		}
		target.Set(sv)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Row + value builders.
// ---------------------------------------------------------------------------

func f64(v float64) *float64 { return &v }

func distRow(bucket string, readings int, avgPowerW *float64) []any {
	return []any{bucket, readings, avgPowerW}
}

func catRow(cat string, count int, avgSpd, batPer *float64) []any {
	return []any{cat, count, avgSpd, batPer}
}

func ptRow(speed, dist, eff float64) []any {
	return []any{speed, dist, eff}
}

func heroVals(avg, peak, opt *float64) []any {
	return []any{avg, peak, opt}
}

// ---------------------------------------------------------------------------
// Response decoding + assertion helpers.
// ---------------------------------------------------------------------------

const jsonContentType = "application/json; charset=utf-8"

type speedProfileResp struct {
	Distribution []struct {
		SpeedBucket string  `json:"speed_bucket"`
		Readings    int     `json:"readings"`
		AvgPowerW   float64 `json:"avg_power_w"`
	} `json:"distribution"`
	Categories []struct {
		Category        string  `json:"category"`
		DriveCount      int     `json:"drive_count"`
		AvgSpeed        float64 `json:"avg_speed"`
		BatteryPer100km float64 `json:"battery_pct_per_100km"`
	} `json:"categories"`
	Points []struct {
		SpeedAvgMps float64 `json:"avg_speed_mps"`
		Distance    float64 `json:"distance"`
		Efficiency  float64 `json:"efficiency"`
	} `json:"points"`
	AvgSpeedMps     float64 `json:"avg_speed_mps"`
	PeakSpeedMps    float64 `json:"peak_speed_mps"`
	OptimalSpeedMps float64 `json:"optimal_speed_mps"`
}

func speedProfileRequest(target string) *http.Request {
	return httptest.NewRequest(http.MethodGet, target, nil)
}

func assertStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, want, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != jsonContentType {
		t.Errorf("Content-Type = %q, want %q", ct, jsonContentType)
	}
}

func decodeResp(t *testing.T, rec *httptest.ResponseRecorder) speedProfileResp {
	t.Helper()
	var resp speedProfileResp
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode body %q: %v", rec.Body.String(), err)
	}
	return resp
}

func assertErrorBody(t *testing.T, rec *httptest.ResponseRecorder, wantMsg, wantCode string) {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode error body %q: %v", rec.Body.String(), err)
	}
	if m["error"] != wantMsg {
		t.Errorf("error = %q, want %q", m["error"], wantMsg)
	}
	if m["code"] != wantCode {
		t.Errorf("code = %q, want %q", m["code"], wantCode)
	}
}

func assertApprox(t *testing.T, got, want float64, field string) {
	t.Helper()
	if math.Abs(got-want) > 1e-6 {
		t.Errorf("%s = %v, want %v", field, got, want)
	}
}

func argEqual(a, b any) bool {
	switch av := a.(type) {
	case time.Time:
		bv, ok := b.(time.Time)
		return ok && av.Equal(bv)
	case float64:
		bv, ok := b.(float64)
		return ok && math.Abs(av-bv) < 1e-9
	default:
		return reflect.DeepEqual(a, b)
	}
}

func argsEqual(got, want []any) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if !argEqual(got[i], want[i]) {
			return false
		}
	}
	return true
}

func assertArgs(t *testing.T, label string, got, want []any) {
	t.Helper()
	if !argsEqual(got, want) {
		t.Errorf("%s args = %#v, want %#v", label, got, want)
	}
}

// ---------------------------------------------------------------------------
// Constructor nil-tolerance.
// ---------------------------------------------------------------------------

func TestNewSpeedProfileHandler_NilTolerant(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		h    *SpeedProfileHandler
	}{
		{"nil *database.DB", NewSpeedProfileHandler(nil)},
		{"nil pool", NewSpeedProfileHandler(&database.DB{})},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if tc.h == nil {
				t.Fatal("NewSpeedProfileHandler returned nil handler")
			}
			rec := httptest.NewRecorder()
			tc.h.Get(rec, speedProfileRequest("/analytics/speed-profile?vehicle_id=7"))

			assertStatus(t, rec, http.StatusOK)
			assertEmptyPayload(t, rec)
		})
	}
}

// assertEmptyPayload verifies the empty-but-well-formed degradation shape:
// the three lists are JSON arrays (never null) and the hero aggregates are 0.
func assertEmptyPayload(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode body %q: %v", rec.Body.String(), err)
	}
	for _, key := range []string{"distribution", "categories", "points"} {
		if got := strings.TrimSpace(string(raw[key])); got != "[]" {
			t.Errorf("%s = %s, want []", key, got)
		}
	}
	resp := decodeResp(t, rec)
	assertApprox(t, resp.AvgSpeedMps, 0, "avg_speed_mps")
	assertApprox(t, resp.PeakSpeedMps, 0, "peak_speed_mps")
	assertApprox(t, resp.OptimalSpeedMps, 0, "optimal_speed_mps")
}

// ---------------------------------------------------------------------------
// vehicle_id validation.
// ---------------------------------------------------------------------------

func TestGet_ValidationErrors(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		target  string
		wantMsg string
	}{
		{"missing", "/analytics/speed-profile", "vehicle_id query parameter required"},
		{"empty", "/analytics/speed-profile?vehicle_id=", "vehicle_id query parameter required"},
		{"non-numeric", "/analytics/speed-profile?vehicle_id=abc", "invalid vehicle_id"},
		{"float", "/analytics/speed-profile?vehicle_id=3.5", "invalid vehicle_id"},
		{"overflow", "/analytics/speed-profile?vehicle_id=99999999999999999999999999", "invalid vehicle_id"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			q := &fakeQuerier{}
			h := newSpeedProfileHandler(q)
			rec := httptest.NewRecorder()
			h.Get(rec, speedProfileRequest(tc.target))

			assertStatus(t, rec, http.StatusBadRequest)
			assertErrorBody(t, rec, tc.wantMsg, "BAD_REQUEST")
			if q.queryCalls != 0 || q.queryRowCalls != 0 {
				t.Errorf("db touched on validation failure: queries=%d queryRows=%d", q.queryCalls, q.queryRowCalls)
			}
		})
	}
}

// TestGet_NilQuerier documents the nil-db seam directly (independent of the
// public constructor) so a future refactor that drops the guard is caught.
func TestGet_NilQuerier(t *testing.T) {
	t.Parallel()
	h := newSpeedProfileHandler(nil)
	rec := httptest.NewRecorder()
	h.Get(rec, speedProfileRequest("/analytics/speed-profile?vehicle_id=7"))

	assertStatus(t, rec, http.StatusOK)
	assertEmptyPayload(t, rec)
}

// ---------------------------------------------------------------------------
// Full-data success: rounding, null handling, row cleanup, deadline.
// ---------------------------------------------------------------------------

func TestGet_Success(t *testing.T) {
	t.Parallel()
	q := &fakeQuerier{
		distRows: newFakeRows([][]any{
			distRow("0-15", 12, f64(12500.567)),
			distRow("15-30", 8, nil), // NULL avg_power_w -> AvgPowerW stays 0
		}),
		catRows: newFakeRows([][]any{
			catRow("City (<30)", 5, f64(42.37), f64(18.126)),
			catRow("Highway (60-90)", 3, nil, nil), // NULL aggregates -> zeros
		}),
		ptRows: newFakeRows([][]any{
			ptRow(26.8224, 12.999, 205.674),
		}),
		heroRow: fakeRow{vals: heroVals(f64(25.556), f64(38.889), f64(16.764))},
	}
	h := newSpeedProfileHandler(q)
	rec := httptest.NewRecorder()
	h.Get(rec, speedProfileRequest("/analytics/speed-profile?vehicle_id=7"))

	assertStatus(t, rec, http.StatusOK)
	resp := decodeResp(t, rec)

	if len(resp.Distribution) != 2 || len(resp.Categories) != 2 || len(resp.Points) != 1 {
		t.Fatalf("lengths: dist=%d cat=%d pts=%d, want 2/2/1",
			len(resp.Distribution), len(resp.Categories), len(resp.Points))
	}

	// Distribution: rounding to 2dp, and NULL power -> 0.
	if resp.Distribution[0].SpeedBucket != "0-15" || resp.Distribution[0].Readings != 12 {
		t.Errorf("distribution[0] = %+v", resp.Distribution[0])
	}
	assertApprox(t, resp.Distribution[0].AvgPowerW, 12500.57, "distribution[0].avg_power_w")
	assertApprox(t, resp.Distribution[1].AvgPowerW, 0, "distribution[1].avg_power_w (NULL)")

	// Categories: avg_speed rounds to 1dp, battery to 2dp; NULLs -> 0.
	if resp.Categories[0].Category != "City (<30)" || resp.Categories[0].DriveCount != 5 {
		t.Errorf("categories[0] = %+v", resp.Categories[0])
	}
	assertApprox(t, resp.Categories[0].AvgSpeed, 42.4, "categories[0].avg_speed")
	assertApprox(t, resp.Categories[0].BatteryPer100km, 18.13, "categories[0].battery_pct_per_100km")
	assertApprox(t, resp.Categories[1].AvgSpeed, 0, "categories[1].avg_speed (NULL)")
	assertApprox(t, resp.Categories[1].BatteryPer100km, 0, "categories[1].battery (NULL)")

	// Points: all three fields round to 2dp.
	assertApprox(t, resp.Points[0].SpeedAvgMps, 26.82, "points[0].avg_speed_mps")
	assertApprox(t, resp.Points[0].Distance, 13.0, "points[0].distance")
	assertApprox(t, resp.Points[0].Efficiency, 205.67, "points[0].efficiency")

	// Hero aggregates round to 2dp.
	assertApprox(t, resp.AvgSpeedMps, 25.56, "avg_speed_mps")
	assertApprox(t, resp.PeakSpeedMps, 38.89, "peak_speed_mps")
	assertApprox(t, resp.OptimalSpeedMps, 16.76, "optimal_speed_mps")

	// Exactly three Query calls + one QueryRow, all under a bounded context,
	// and every opened rows handle was closed (no connection leak).
	if q.queryCalls != 3 {
		t.Errorf("queryCalls = %d, want 3", q.queryCalls)
	}
	if q.queryRowCalls != 1 {
		t.Errorf("queryRowCalls = %d, want 1", q.queryRowCalls)
	}
	if !q.ctxHadDeadline {
		t.Error("expected a request deadline on the query context")
	}
	if !q.distRows.closed || !q.catRows.closed || !q.ptRows.closed {
		t.Errorf("rows not closed: dist=%v cat=%v pts=%v",
			q.distRows.closed, q.catRows.closed, q.ptRows.closed)
	}
}

// TestGet_EmptyResults verifies that zero-row sub-queries and a NULL hero row
// produce JSON arrays (never null) and zero aggregates.
func TestGet_EmptyResults(t *testing.T) {
	t.Parallel()
	q := &fakeQuerier{} // all sub-queries empty, hero NULL
	h := newSpeedProfileHandler(q)
	rec := httptest.NewRecorder()
	h.Get(rec, speedProfileRequest("/analytics/speed-profile?vehicle_id=7"))

	assertStatus(t, rec, http.StatusOK)
	assertEmptyPayload(t, rec)
	if q.queryRowCalls != 1 {
		t.Errorf("queryRowCalls = %d, want 1 (hero still attempted on empty lists)", q.queryRowCalls)
	}
}

// ---------------------------------------------------------------------------
// Query / scan / iteration failures per sub-query -> 500.
// ---------------------------------------------------------------------------

func TestGet_QueryErrors(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		mutate  func(*fakeQuerier)
		wantMsg string
	}{
		{"distribution", func(q *fakeQuerier) { q.distErr = errBoom }, "failed to query speed distribution"},
		{"categories", func(q *fakeQuerier) { q.catErr = errBoom }, "failed to query efficiency categories"},
		{"points", func(q *fakeQuerier) { q.ptErr = errBoom }, "failed to query efficiency points"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			q := &fakeQuerier{}
			tc.mutate(q)
			h := newSpeedProfileHandler(q)
			rec := httptest.NewRecorder()
			h.Get(rec, speedProfileRequest("/analytics/speed-profile?vehicle_id=7"))

			assertStatus(t, rec, http.StatusInternalServerError)
			assertErrorBody(t, rec, tc.wantMsg, "INTERNAL_ERROR")
			if q.queryRowCalls != 0 {
				t.Errorf("hero queried despite an earlier list-query failure (queryRowCalls=%d)", q.queryRowCalls)
			}
		})
	}
}

func TestGet_ScanErrors(t *testing.T) {
	t.Parallel()
	scanErrRows := func(row []any) *fakeRows {
		r := newFakeRows([][]any{row})
		r.scanErrAt = 0
		return r
	}
	tests := []struct {
		name    string
		mutate  func(*fakeQuerier)
		wantMsg string
	}{
		{"distribution", func(q *fakeQuerier) { q.distRows = scanErrRows(distRow("0-15", 1, nil)) }, "failed to scan speed distribution"},
		{"categories", func(q *fakeQuerier) { q.catRows = scanErrRows(catRow("City (<30)", 1, nil, nil)) }, "failed to scan efficiency categories"},
		{"points", func(q *fakeQuerier) { q.ptRows = scanErrRows(ptRow(1, 1, 1)) }, "failed to scan efficiency points"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			q := &fakeQuerier{}
			tc.mutate(q)
			h := newSpeedProfileHandler(q)
			rec := httptest.NewRecorder()
			h.Get(rec, speedProfileRequest("/analytics/speed-profile?vehicle_id=7"))

			assertStatus(t, rec, http.StatusInternalServerError)
			assertErrorBody(t, rec, tc.wantMsg, "INTERNAL_ERROR")
		})
	}
}

func TestGet_RowIterationErrors(t *testing.T) {
	t.Parallel()
	iterErrRows := func() *fakeRows {
		r := newFakeRows(nil)
		r.iterErr = errBoom
		return r
	}
	tests := []struct {
		name    string
		mutate  func(*fakeQuerier)
		wantMsg string
	}{
		{"distribution", func(q *fakeQuerier) { q.distRows = iterErrRows() }, "failed to read speed distribution"},
		{"categories", func(q *fakeQuerier) { q.catRows = iterErrRows() }, "failed to read efficiency categories"},
		{"points", func(q *fakeQuerier) { q.ptRows = iterErrRows() }, "failed to read efficiency points"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			q := &fakeQuerier{}
			tc.mutate(q)
			h := newSpeedProfileHandler(q)
			rec := httptest.NewRecorder()
			h.Get(rec, speedProfileRequest("/analytics/speed-profile?vehicle_id=7"))

			assertStatus(t, rec, http.StatusInternalServerError)
			assertErrorBody(t, rec, tc.wantMsg, "INTERNAL_ERROR")
		})
	}
}

// ---------------------------------------------------------------------------
// Hero-aggregate degradation: never fails the whole payload.
// ---------------------------------------------------------------------------

func TestGet_HeroAggregateDegradation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name                    string
		heroRow                 pgx.Row
		wantAvg, wantPeak, wOpt float64
	}{
		{"scan error degrades to zero", fakeRow{scanErr: errBoom}, 0, 0, 0},
		{"no rows degrades to zero", fakeRow{scanErr: pgx.ErrNoRows}, 0, 0, 0},
		{"all-null row degrades to zero", fakeRow{}, 0, 0, 0},
		{"values rounded", fakeRow{vals: heroVals(f64(25.556), f64(38.889), f64(16.764))}, 25.56, 38.89, 16.76},
		{"partial null (avg only)", fakeRow{vals: heroVals(f64(20.0), nil, nil)}, 20, 0, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			q := &fakeQuerier{
				distRows: newFakeRows([][]any{distRow("0-15", 1, f64(1000))}),
				heroRow:  tc.heroRow,
			}
			h := newSpeedProfileHandler(q)
			rec := httptest.NewRecorder()
			h.Get(rec, speedProfileRequest("/analytics/speed-profile?vehicle_id=7"))

			// Degradation must never 500 — the list data is still useful.
			assertStatus(t, rec, http.StatusOK)
			resp := decodeResp(t, rec)
			if len(resp.Distribution) != 1 {
				t.Errorf("distribution len = %d, want 1 (list data must survive hero failure)", len(resp.Distribution))
			}
			assertApprox(t, resp.AvgSpeedMps, tc.wantAvg, "avg_speed_mps")
			assertApprox(t, resp.PeakSpeedMps, tc.wantPeak, "peak_speed_mps")
			assertApprox(t, resp.OptimalSpeedMps, tc.wOpt, "optimal_speed_mps")
		})
	}
}

// ---------------------------------------------------------------------------
// Date-range wiring: SI constants + shared bounds through all four queries.
// ---------------------------------------------------------------------------

func TestGet_DateRangeWiring(t *testing.T) {
	t.Parallel()

	t.Run("no range: full history, no BETWEEN", func(t *testing.T) {
		t.Parallel()
		q := &fakeQuerier{}
		h := newSpeedProfileHandler(q)
		rec := httptest.NewRecorder()
		h.Get(rec, speedProfileRequest("/analytics/speed-profile?vehicle_id=7"))

		assertStatus(t, rec, http.StatusOK)
		assertArgs(t, "distribution", q.gotDistArgs, []any{int64(7)})
		assertArgs(t, "categories", q.gotCatArgs, []any{int64(7), driveStatsMetersPerMile, driveStatsMetersPerMile})
		assertArgs(t, "points", q.gotPtArgs, []any{int64(7), driveStatsMetersPerMile, 5 * driveStatsMetersPerMile})
		assertArgs(t, "hero", q.gotHeroArgs, []any{int64(7)})
		for _, sql := range []string{q.gotDistSQL, q.gotCatSQL, q.gotPtSQL, q.gotHeroSQL} {
			if strings.Contains(sql, "BETWEEN") {
				t.Errorf("unexpected BETWEEN in no-range SQL:\n%s", sql)
			}
		}
	})

	t.Run("with range: shared bounds, BETWEEN $2 AND $3", func(t *testing.T) {
		t.Parallel()
		q := &fakeQuerier{}
		h := newSpeedProfileHandler(q)
		rec := httptest.NewRecorder()
		h.Get(rec, speedProfileRequest("/analytics/speed-profile?vehicle_id=7&start=2026-05-01&end=2026-05-08"))

		assertStatus(t, rec, http.StatusOK)
		// apiparams.ParseDateRange: date-only start -> UTC midnight; date-only
		// end -> inclusive UTC end-of-day (next midnight minus one second).
		start := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
		end := time.Date(2026, 5, 8, 23, 59, 59, 0, time.UTC)

		assertArgs(t, "distribution", q.gotDistArgs, []any{int64(7), start, end})
		assertArgs(t, "categories", q.gotCatArgs, []any{int64(7), driveStatsMetersPerMile, driveStatsMetersPerMile, start, end})
		assertArgs(t, "points", q.gotPtArgs, []any{int64(7), driveStatsMetersPerMile, 5 * driveStatsMetersPerMile, start, end})
		assertArgs(t, "hero", q.gotHeroArgs, []any{int64(7), start, end})

		if !strings.Contains(q.gotDistSQL, "BETWEEN $2 AND $3") {
			t.Errorf("distribution SQL missing BETWEEN $2 AND $3:\n%s", q.gotDistSQL)
		}
		if !strings.Contains(q.gotCatSQL, "BETWEEN $4 AND $5") {
			t.Errorf("categories SQL missing BETWEEN $4 AND $5:\n%s", q.gotCatSQL)
		}
		if !strings.Contains(q.gotPtSQL, "BETWEEN $4 AND $5") {
			t.Errorf("points SQL missing BETWEEN $4 AND $5:\n%s", q.gotPtSQL)
		}
		if !strings.Contains(q.gotHeroSQL, "BETWEEN $2 AND $3") {
			t.Errorf("hero SQL missing BETWEEN $2 AND $3:\n%s", q.gotHeroSQL)
		}
	})

	t.Run("start only: treated as full history", func(t *testing.T) {
		t.Parallel()
		q := &fakeQuerier{}
		h := newSpeedProfileHandler(q)
		rec := httptest.NewRecorder()
		h.Get(rec, speedProfileRequest("/analytics/speed-profile?vehicle_id=7&start=2026-05-01"))

		assertStatus(t, rec, http.StatusOK)
		// hasRange requires BOTH bounds; a lone start falls back to full history.
		assertArgs(t, "distribution", q.gotDistArgs, []any{int64(7)})
		if strings.Contains(q.gotDistSQL, "BETWEEN") {
			t.Errorf("start-only must not add BETWEEN:\n%s", q.gotDistSQL)
		}
	})
}

// ---------------------------------------------------------------------------
// Non-positive vehicle_id is parsed and forwarded (current contract).
// ---------------------------------------------------------------------------

func TestGet_NonPositiveVehicleIDForwarded(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		vid   string
		wantV int64
	}{
		{"zero", "0", 0},
		{"negative", "-5", -5},
		{"max int64", "9223372036854775807", math.MaxInt64},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			q := &fakeQuerier{}
			h := newSpeedProfileHandler(q)
			rec := httptest.NewRecorder()
			h.Get(rec, speedProfileRequest("/analytics/speed-profile?vehicle_id="+tc.vid))

			// A syntactically valid int64 is accepted and threaded into the query
			// as $1 — the handler does not reject non-positive ids.
			assertStatus(t, rec, http.StatusOK)
			assertArgs(t, "distribution", q.gotDistArgs, []any{tc.wantV})
		})
	}
}
