package maintenance

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ─── test doubles ──────────────────────────────────────────────────────────

// fakeRow implements pgx.Row. scan runs against the caller's destinations so a
// test can populate the scanned vehicle id or surface a scan error.
type fakeRow struct {
	scan func(dest ...any) error
}

func (r fakeRow) Scan(dest ...any) error { return r.scan(dest...) }

// fakeRowReader implements vehicleRowReader and records the ctx + SQL it saw so
// tests can assert the query shape and that the request-level timeout is
// propagated.
type fakeRowReader struct {
	row    pgx.Row
	gotCtx context.Context
	gotSQL string
	calls  int
}

func (f *fakeRowReader) QueryRow(ctx context.Context, sql string, _ ...any) pgx.Row {
	f.calls++
	f.gotCtx = ctx
	f.gotSQL = sql
	return f.row
}

// fakeSignalReader implements liveSignalReader and records what it was asked.
type fakeSignalReader struct {
	signals map[string]interface{}
	err     error
	gotCtx  context.Context
	gotVeh  int64
	calls   int
}

func (f *fakeSignalReader) GetAll(ctx context.Context, vehicleID int64) (map[string]interface{}, error) {
	f.calls++
	f.gotCtx = ctx
	f.gotVeh = vehicleID
	return f.signals, f.err
}

// compile-time proof the fakes satisfy the handler's read ports.
var (
	_ vehicleRowReader = (*fakeRowReader)(nil)
	_ liveSignalReader = (*fakeSignalReader)(nil)
)

// rowReturningID builds a reader whose Scan writes id into the first *int64.
func rowReturningID(id int64) *fakeRowReader {
	return &fakeRowReader{row: fakeRow{scan: func(dest ...any) error {
		if len(dest) == 0 {
			return errors.New("scan: no destination")
		}
		p, ok := dest[0].(*int64)
		if !ok {
			return errors.New("scan: want *int64 destination")
		}
		*p = id
		return nil
	}}}
}

// rowReturningErr builds a reader whose Scan fails with err.
func rowReturningErr(err error) *fakeRowReader {
	return &fakeRowReader{row: fakeRow{scan: func(_ ...any) error { return err }}}
}

func listRequest() *http.Request {
	return httptest.NewRequest(http.MethodGet, "/maintenance", nil)
}

func decodeItems(t *testing.T, body []byte) []map[string]any {
	t.Helper()
	var items []map[string]any
	if err := json.Unmarshal(body, &items); err != nil {
		t.Fatalf("decode body: %v; raw=%s", err, body)
	}
	return items
}

// ─── List ──────────────────────────────────────────────────────────────────

// TestList_Success exercises the happy path AND doubles as the regression guard
// for the float32 odometer bug: the codec decodes Odometer as a float32, so the
// former v.(float64) assertion silently dropped it. Here the odometer arrives
// as a float32 and must flow through (in SI metres) to every item.
func TestList_Success(t *testing.T) {
	const vid int64 = 7
	const odo float64 = 82000 // SI metres
	reader := rowReturningID(vid)
	sig := &fakeSignalReader{signals: map[string]interface{}{"Odometer": float32(odo)}}
	h := &Handler{db: reader, redisCache: sig}

	rec := httptest.NewRecorder()
	h.List(rec, listRequest())

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Errorf("content-type = %q, want application/json…", ct)
	}

	// Query is the exact static, parameter-free lookup.
	if want := "SELECT id FROM vehicles ORDER BY id LIMIT 1"; reader.gotSQL != want {
		t.Errorf("sql = %q, want %q", reader.gotSQL, want)
	}
	// Timeout guard: both external reads must receive a deadline-bearing ctx.
	if reader.gotCtx == nil {
		t.Fatal("db reader never invoked")
	}
	if _, ok := reader.gotCtx.Deadline(); !ok {
		t.Error("db ctx has no deadline — timeout guard missing")
	}
	if sig.calls != 1 || sig.gotVeh != vid {
		t.Errorf("GetAll calls=%d veh=%d, want calls=1 veh=%d", sig.calls, sig.gotVeh, vid)
	}
	if _, ok := sig.gotCtx.Deadline(); !ok {
		t.Error("redis ctx has no deadline — timeout guard missing")
	}

	items := decodeItems(t, rec.Body.Bytes())
	if len(items) != 8 {
		t.Fatalf("len(items) = %d, want 8", len(items))
	}
	for i, it := range items {
		if got := it["vehicle_id"]; got != float64(vid) {
			t.Errorf("item %d vehicle_id = %v, want %d", i, got, vid)
		}
		if got := it["current_mileage"]; got != odo {
			t.Errorf("item %d current_mileage = %v, want %v (float32 odometer must survive)", i, got, odo)
		}
	}
	// Tire Rotation (index 1 / id 2) is due at odometer + 10000; Wheel
	// Alignment (index 6 / id 7) at odometer + 20000.
	if got := items[1]["due_mileage"]; got != odo+10000 {
		t.Errorf("tire due_mileage = %v, want %v", got, odo+10000)
	}
	if got := items[6]["due_mileage"]; got != odo+20000 {
		t.Errorf("alignment due_mileage = %v, want %v", got, odo+20000)
	}
}

func TestList_NoVehicle(t *testing.T) {
	reader := rowReturningErr(pgx.ErrNoRows)
	sig := &fakeSignalReader{}
	h := &Handler{db: reader, redisCache: sig}

	rec := httptest.NewRecorder()
	h.List(rec, listRequest())

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (graceful empty)", rec.Code)
	}
	if items := decodeItems(t, rec.Body.Bytes()); len(items) != 0 {
		t.Fatalf("len(items) = %d, want 0 (empty schedule)", len(items))
	}
	if sig.calls != 0 {
		t.Errorf("GetAll called %d times, want 0 when there is no vehicle", sig.calls)
	}
}

func TestList_DBError(t *testing.T) {
	reader := rowReturningErr(errors.New("connection refused"))
	sig := &fakeSignalReader{}
	h := &Handler{db: reader, redisCache: sig}

	rec := httptest.NewRecorder()
	h.List(rec, listRequest())

	// A real DB error still degrades gracefully to an empty 200 (the frontend
	// renders an empty state rather than an error page).
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if items := decodeItems(t, rec.Body.Bytes()); len(items) != 0 {
		t.Fatalf("len(items) = %d, want 0", len(items))
	}
	if sig.calls != 0 {
		t.Errorf("GetAll called %d times, want 0 after a lookup failure", sig.calls)
	}
}

func TestList_NilDatabase(t *testing.T) {
	// NewHandler(nil) must not panic — it degrades to an empty schedule.
	h := NewHandler(nil)
	rec := httptest.NewRecorder()
	h.List(rec, listRequest())

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if items := decodeItems(t, rec.Body.Bytes()); len(items) != 0 {
		t.Fatalf("len(items) = %d, want 0", len(items))
	}
}

func TestList_NoRedisCache(t *testing.T) {
	h := &Handler{db: rowReturningID(3)} // redisCache intentionally nil
	rec := httptest.NewRecorder()
	h.List(rec, listRequest())

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	items := decodeItems(t, rec.Body.Bytes())
	if len(items) != 8 {
		t.Fatalf("len(items) = %d, want 8", len(items))
	}
	if got := items[0]["current_mileage"]; got != float64(0) {
		t.Errorf("current_mileage = %v, want 0 with no cache wired", got)
	}
	if got := items[1]["due_mileage"]; got != float64(10000) {
		t.Errorf("tire due_mileage = %v, want 10000 (odometer 0 + 10000)", got)
	}
}

func TestList_RedisError(t *testing.T) {
	sig := &fakeSignalReader{err: errors.New("redis down")}
	h := &Handler{db: rowReturningID(5), redisCache: sig}

	rec := httptest.NewRecorder()
	h.List(rec, listRequest())

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	items := decodeItems(t, rec.Body.Bytes())
	if len(items) != 8 {
		t.Fatalf("len(items) = %d, want 8 even when the cache read fails", len(items))
	}
	if got := items[0]["current_mileage"]; got != float64(0) {
		t.Errorf("current_mileage = %v, want 0 on redis error", got)
	}
	if sig.calls != 1 {
		t.Errorf("GetAll calls = %d, want 1", sig.calls)
	}
}

// ─── readOdometer ──────────────────────────────────────────────────────────

// TestReadOdometer_Coercion pins the numeric-coercion contract. float32 is the
// shape the Tesla codec actually produces for Odometer; the remaining kinds are
// JSON / transport artifacts. All must resolve to the same SI-metre float64.
func TestReadOdometer_Coercion(t *testing.T) {
	tests := []struct {
		name string
		raw  interface{}
		want float64
	}{
		{"float32_codec_shape", float32(82000.5), 82000.5},
		{"float64", float64(91234), 91234},
		{"int", int(45000), 45000},
		{"int32", int32(45000), 45000},
		{"int64", int64(45000), 45000},
		{"uint32", uint32(45000), 45000},
		{"json_number", json.Number("123456.7"), 123456.7},
		{"numeric_string", "50000", 50000},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sig := &fakeSignalReader{signals: map[string]interface{}{"Odometer": tt.raw}}
			h := &Handler{redisCache: sig}
			if got := h.readOdometer(context.Background(), 1); got != tt.want {
				t.Errorf("readOdometer(%T %v) = %v, want %v", tt.raw, tt.raw, got, tt.want)
			}
		})
	}
}

// TestReadOdometer_ZeroFallbacks covers every path that must yield 0 without
// panicking.
func TestReadOdometer_ZeroFallbacks(t *testing.T) {
	tests := []struct {
		name   string
		reader liveSignalReader
	}{
		{"nil_cache", nil},
		{"nil_signals_map", &fakeSignalReader{signals: nil}},
		{"missing_odometer_key", &fakeSignalReader{signals: map[string]interface{}{"BatteryLevel": 80.0}}},
		{"cache_error", &fakeSignalReader{err: errors.New("boom")}},
		{"non_numeric_string", &fakeSignalReader{signals: map[string]interface{}{"Odometer": "n/a"}}},
		{"nil_value", &fakeSignalReader{signals: map[string]interface{}{"Odometer": nil}}},
		{"unsupported_type", &fakeSignalReader{signals: map[string]interface{}{"Odometer": struct{}{}}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &Handler{redisCache: tt.reader}
			if got := h.readOdometer(context.Background(), 1); got != 0 {
				t.Errorf("readOdometer = %v, want 0", got)
			}
		})
	}
}

// ─── Records ───────────────────────────────────────────────────────────────

func TestRecords(t *testing.T) {
	h := &Handler{}
	rec := httptest.NewRecorder()
	h.Records(rec, httptest.NewRequest(http.MethodGet, "/maintenance/records", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Errorf("content-type = %q, want application/json…", ct)
	}
	if items := decodeItems(t, rec.Body.Bytes()); len(items) != 0 {
		t.Fatalf("len(records) = %d, want 0", len(items))
	}
}

// ─── defaultItems ──────────────────────────────────────────────────────────

func TestDefaultItems(t *testing.T) {
	const vid int64 = 11
	const odo float64 = 60000
	items := (&Handler{}).defaultItems(vid, odo)

	if len(items) != 8 {
		t.Fatalf("len = %d, want 8", len(items))
	}

	requiredKeys := []string{
		"id", "vehicle_id", "category", "name", "description",
		"due_date", "due_mileage", "current_mileage", "last_service_date",
		"last_service_mileage", "interval_months", "interval_miles",
		"status", "created_at",
	}
	for i, it := range items {
		for _, k := range requiredKeys {
			if _, ok := it[k]; !ok {
				t.Errorf("item %d missing key %q", i, k)
			}
		}
		if it["id"] != i+1 {
			t.Errorf("item %d id = %v, want %d", i, it["id"], i+1)
		}
		if it["vehicle_id"] != vid {
			t.Errorf("item %d vehicle_id = %v, want %d", i, it["vehicle_id"], vid)
		}
		if it["current_mileage"] != odo {
			t.Errorf("item %d current_mileage = %v, want %v", i, it["current_mileage"], odo)
		}
		if it["status"] != "good" {
			t.Errorf("item %d status = %v, want good", i, it["status"])
		}
	}

	byName := map[string]map[string]interface{}{}
	for _, it := range items {
		name, ok := it["name"].(string)
		if !ok {
			t.Fatalf("item name is not a string: %v", it["name"])
		}
		byName[name] = it
	}
	if got := byName["Tire Rotation"]["due_mileage"]; got != odo+10000 {
		t.Errorf("Tire Rotation due_mileage = %v, want %v", got, odo+10000)
	}
	if got := byName["Wheel Alignment"]["due_mileage"]; got != odo+20000 {
		t.Errorf("Wheel Alignment due_mileage = %v, want %v", got, odo+20000)
	}

	wantCats := map[string]bool{
		"filters": false, "tires": false, "brakes": false, "battery": false,
		"fluids": false, "wipers": false, "alignment": false,
	}
	for _, it := range items {
		if c, ok := it["category"].(string); ok {
			wantCats[c] = true
		}
	}
	for c, seen := range wantCats {
		if !seen {
			t.Errorf("category %q not present in default items", c)
		}
	}
}

// TestDefaultItems_ZeroOdometer confirms the odometer-relative due points are
// deterministic when the odometer is unknown (0).
func TestDefaultItems_ZeroOdometer(t *testing.T) {
	items := (&Handler{}).defaultItems(1, 0)
	byName := map[string]map[string]interface{}{}
	for _, it := range items {
		byName[it["name"].(string)] = it
	}
	if got := byName["Tire Rotation"]["due_mileage"]; got != float64(10000) {
		t.Errorf("Tire Rotation due_mileage = %v, want 10000", got)
	}
	if got := byName["Wheel Alignment"]["due_mileage"]; got != float64(20000) {
		t.Errorf("Wheel Alignment due_mileage = %v, want 20000", got)
	}
}

// ─── constructors ──────────────────────────────────────────────────────────

func TestNewHandler_NilPoolYieldsNilReader(t *testing.T) {
	if h := NewHandler(nil); h.db != nil {
		t.Error("NewHandler(nil).db should be nil (no reader wired)")
	}
	if h := NewHandler(&database.DB{}); h.db != nil {
		t.Error("NewHandler(db with nil Pool).db should be nil")
	}
}

func TestWithRedisCache_NilIgnored(t *testing.T) {
	h := &Handler{}
	got := h.WithRedisCache(nil)
	if got != h {
		t.Error("WithRedisCache should return the same handler for chaining")
	}
	if h.redisCache != nil {
		t.Error("WithRedisCache(nil) must not install a typed-nil cache")
	}
	// A nil cache must remain safe to read from.
	if odo := h.readOdometer(context.Background(), 1); odo != 0 {
		t.Errorf("readOdometer with nil cache = %v, want 0", odo)
	}
}
