package batterydegradation

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// newBatteryDegradationRequest builds an *http.Request with vehicle_id
// wired onto the query string so Handler.Predict /
// .Health parse it via r.URL.Query().Get("vehicle_id"). Mirrors the
// pattern used in battery_cells_handler_test.go for the query-param
// driven endpoint.
func newBatteryDegradationRequest(t *testing.T, vehicleID string) *http.Request {
	t.Helper()
	return httptest.NewRequest(http.MethodGet, "/analytics/battery-degradation?vehicle_id="+vehicleID, nil)
}

// TestBatteryDegradation_AllSignalsCarryForward verifies that the Predict
// fallback branch (entered when no signal_log trace snapshots exist)
// resolves both EnergyRemaining and EstBatteryRange via
// signal.StateReader.SignalAt at time.Now(), and that those carried-
// forward values flow into the JSON response as current_capacity /
// current_range. The handler no longer uses the legacy
// signaldb.SignalLogReader.SignalAt helper. The fake returns last-known
// values for every signal name — emulating StateReader's forward-fold
// semantics where unchanged signals carry their prior emitted value
// rather than disappearing — and the test asserts every downstream
// projection field renders that carried-forward value. A future
// regression that re-points the per-signal lookups at signalLogReader
// (which would reintroduce the deleted helper), drops one of the two
// signal names, or anchors them to a stale "at" would zero the Battery
// Degradation panel and is caught here.
func TestBatteryDegradation_AllSignalsCarryForward(t *testing.T) {
	const (
		energyRemaining  = 60000.0 // capacity_wh
		estBatteryRangeM = 410500.0
		expectedRangeKm  = 410.5
	)
	vid := int64(42)

	carried := map[string]float64{
		"EnergyRemaining": energyRemaining,
		"EstBatteryRange": estBatteryRangeM,
	}

	var calls []signalAtCallRecord
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, v int64, name string, at time.Time) (signal.SignalValue, error) {
			calls = append(calls, signalAtCallRecord{vehicleID: v, name: name, at: at})
			if val, ok := carried[name]; ok {
				return val, nil
			}
			return nil, nil
		},
	}
	// db: nil skips the daily aggregate and enters the StateReader fallback.
	h := &Handler{state: fake}

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Predict(rec, newBatteryDegradationRequest(t, "42"))
	after := time.Now()

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	wantNames := map[string]bool{
		"EnergyRemaining": false,
		"EstBatteryRange": false,
	}
	for _, c := range calls {
		if _, ok := wantNames[c.name]; !ok {
			continue
		}
		wantNames[c.name] = true
		if c.vehicleID != vid {
			t.Fatalf("SignalAt(%q).vehicleID = %d, want %d", c.name, c.vehicleID, vid)
		}
		if c.at.Before(before.Add(-time.Second)) || c.at.After(after.Add(time.Second)) {
			t.Fatalf("SignalAt(%q).at = %v, want within [%v, %v] (≈ time.Now())", c.name, c.at, before, after)
		}
	}
	for name, sawIt := range wantNames {
		if !sawIt {
			t.Fatalf("handler never called SignalAt with name=%q; calls=%v", name, calls)
		}
	}

	// Verify the projected response carries the SignalAt-derived values.
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if got, _ := body["current_capacity"].(float64); got != energyRemaining {
		t.Fatalf("current_capacity = %#v, want %v (carried forward from EnergyRemaining)", body["current_capacity"], energyRemaining)
	}
	if got, _ := body["current_range"].(float64); got != expectedRangeKm {
		t.Fatalf("current_range = %#v, want %v km (converted from SI EstBatteryRange)", body["current_range"], expectedRangeKm)
	}
}

// TestBatteryDegradation_DegradationCalc_UsesLatestValues verifies that
// the Predict fallback branch derives current_health and
// current_degradation from the StateReader-resolved EnergyRemaining
// signal divided by the looked-up battery capacity (75 kWh default
// when no vehicle row exists). With energy_remaining=60 kWh and the
// default capacity of 75 kWh, expected health = 60000/75000*100 = 80%, and
// expected degradation = 100 - 80 = 20%. A future regression that
// drops the divide-by-capacity step (and degenerates current_health to
// raw kWh), inverts the degradation formula, or short-circuits the
// fallback derivation when no snapshots exist would silently break the
// Battery Degradation panel's headline metric and is caught here.
func TestBatteryDegradation_DegradationCalc_UsesLatestValues(t *testing.T) {
	const (
		nominalCapacity = 75000.0 // default when h.db == nil
		energyRemaining = 60000.0
		expectedHealth  = (energyRemaining / nominalCapacity) * 100 // 80
		expectedDegrad  = 100 - expectedHealth                      // 20
	)

	carried := map[string]float64{
		"EnergyRemaining": energyRemaining,
	}
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, _ int64, name string, _ time.Time) (signal.SignalValue, error) {
			if v, ok := carried[name]; ok {
				return v, nil
			}
			return nil, nil
		},
	}
	h := &Handler{state: fake}

	rec := httptest.NewRecorder()
	h.Predict(rec, newBatteryDegradationRequest(t, "42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if got, _ := body["current_health"].(float64); got != expectedHealth {
		t.Fatalf("current_health = %#v, want %v (= EnergyRemaining/%v*100)", body["current_health"], expectedHealth, nominalCapacity)
	}
	if got, _ := body["current_degradation"].(float64); got != expectedDegrad {
		t.Fatalf("current_degradation = %#v, want %v (= 100 - current_health)", body["current_degradation"], expectedDegrad)
	}
	// current_health_pct mirrors current_health on the new predictive shape.
	if got, _ := body["current_health_pct"].(float64); got != expectedHealth {
		t.Fatalf("current_health_pct = %#v, want %v (must mirror current_health)", body["current_health_pct"], expectedHealth)
	}
	// battery_capacity_wh must surface the looked-up (default) capacity
	// — a regression that loses the projection would break the Battery
	// Degradation panel's "estimated capacity" tile.
	if got, _ := body["battery_capacity_wh"].(float64); got != nominalCapacity {
		t.Fatalf("battery_capacity_wh = %#v, want %v (default when no vehicle row)", body["battery_capacity_wh"], nominalCapacity)
	}
}

// TestBatteryDegradation_PropagatesError verifies that a
// StateReader.SignalAt transport error (e.g. pgx connection drop) becomes
// a 500 to the client for the Predict endpoint. The legacy
// *signaldb.SignalLogReader-backed handler silently swallowed SignalAt
// errors and returned a partial / zero-valued payload, which was
// indistinguishable on the frontend from "vehicle truly idle / brand-
// new vehicle with no signal_log history" and rendered the Battery
// Degradation panel as "battery looks dead" even when the underlying
// read had genuinely failed. The stricter error handling lets the
// frontend surface the failure rather than silently
// rendering a dead-battery panel. A future regression that reverts to
// the silent-swallow behavior is caught here.
func TestBatteryDegradation_PropagatesError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, _ int64, _ string, _ time.Time) (signal.SignalValue, error) {
			return nil, wantErr
		},
	}
	h := &Handler{state: fake}

	rec := httptest.NewRecorder()
	h.Predict(rec, newBatteryDegradationRequest(t, "42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

func TestBatteryHealthQueryUsesBoundedDailyAggregate(t *testing.T) {
	for _, clause := range []string{
		"FROM cagg_battery_daily",
		"max_soc - min_soc >= $2",
		"LIMIT $3",
		"field = 'EstBatteryRange'",
		"field = 'Odometer'",
		"ORDER BY ts DESC",
	} {
		if !strings.Contains(batteryHealthHistoryQuery, clause) {
			t.Fatalf("batteryHealthHistoryQuery missing %q", clause)
		}
	}
	if batteryHistoryLimit != 180 {
		t.Fatalf("batteryHistoryLimit = %d, want 180", batteryHistoryLimit)
	}
}

func TestBatteryHealthCoalescesConcurrentColdLoads(t *testing.T) {
	fixedNow := time.Date(2026, time.August, 23, 12, 0, 0, 0, time.UTC)
	h := &Handler{
		now:         func() time.Time { return fixedNow },
		healthCache: make(map[int64]batteryHealthCacheEntry),
	}
	var loadCount atomic.Int32
	h.healthLoader = func(context.Context, int64) (*batteryHealthResponse, batteryHealthTimings, error) {
		loadCount.Add(1)
		time.Sleep(25 * time.Millisecond)
		return &batteryHealthResponse{
			VehicleID:       42,
			History:         []batteryHealthHistoryPoint{},
			Projections:     []predictiveProjection{},
			RiskFactors:     []riskFactor{},
			Recommendations: []string{},
			ChargingAnalysis: batteryChargingAnalysis{
				ChargeLevelDistribution: []chargeLevelBucket{},
			},
		}, batteryHealthTimings{}, nil
	}

	const callers = 12
	var requests sync.WaitGroup
	requests.Add(callers)
	statuses := make(chan int, callers)
	for range callers {
		go func() {
			defer requests.Done()
			rec := httptest.NewRecorder()
			h.Health(rec, httptest.NewRequest(http.MethodGet, "/analytics/battery-health?vehicle_id=42", nil))
			statuses <- rec.Code
		}()
	}
	requests.Wait()
	close(statuses)

	for status := range statuses {
		if status != http.StatusOK {
			t.Fatalf("status = %d, want 200", status)
		}
	}
	if got := loadCount.Load(); got != 1 {
		t.Fatalf("health loader calls = %d, want 1", got)
	}
	h.healthLoadLocksMu.Lock()
	defer h.healthLoadLocksMu.Unlock()
	if got := len(h.healthLoadLocks); got != 0 {
		t.Fatalf("retained load locks = %d, want 0", got)
	}
}

func TestBatteryHealthResponseUsesCanonicalSIFields(t *testing.T) {
	h := &Handler{
		now:         time.Now,
		healthCache: make(map[int64]batteryHealthCacheEntry),
	}
	h.healthLoader = func(context.Context, int64) (*batteryHealthResponse, batteryHealthTimings, error) {
		return &batteryHealthResponse{
			VehicleID:           42,
			EstimatedCapacityWh: 72_500,
			OriginalCapacityWh:  75_000,
			History: []batteryHealthHistoryPoint{{
				Date:       "2026-08-23",
				OdometerM:  20_000,
				CapacityWh: 72_500,
				RangeM:     410_000,
			}},
			Projections:     []predictiveProjection{},
			RiskFactors:     []riskFactor{},
			Recommendations: []string{},
			ChargingAnalysis: batteryChargingAnalysis{
				ChargeLevelDistribution: []chargeLevelBucket{},
			},
		}, batteryHealthTimings{}, nil
	}

	rec := httptest.NewRecorder()
	h.Health(rec, httptest.NewRequest(http.MethodGet, "/analytics/battery-health?vehicle_id=42", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "private, max-age=300" {
		t.Fatalf("Cache-Control = %q, want private max-age", got)
	}
	if got := rec.Header().Get("Server-Timing"); !strings.Contains(got, `cache;desc="miss"`) {
		t.Fatalf("Server-Timing = %q, want cache miss timing", got)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	for _, field := range []string{"estimated_capacity_wh", "original_capacity_wh"} {
		if _, ok := body[field]; !ok {
			t.Fatalf("response missing %q: %s", field, rec.Body.String())
		}
	}
	for _, legacyField := range []string{"estimated_capacity", "original_capacity"} {
		if _, ok := body[legacyField]; ok {
			t.Fatalf("response unexpectedly contains legacy field %q", legacyField)
		}
	}
	history := body["history"].([]any)
	point := history[0].(map[string]any)
	for _, field := range []string{"capacity_wh", "range_m", "odometer_m"} {
		if _, ok := point[field]; !ok {
			t.Fatalf("history point missing %q: %v", field, point)
		}
	}
	for _, legacyField := range []string{"range_km", "odometer"} {
		if _, ok := point[legacyField]; ok {
			t.Fatalf("history point unexpectedly contains legacy field %q", legacyField)
		}
	}
}

func TestBatteryHealthLiveCapacityNormalizesEnergyBySOC(t *testing.T) {
	values := map[string]float64{
		"EnergyRemaining": 30000,
		"BatteryLevel":    50,
		"EstBatteryRange": 400000,
	}
	h := &Handler{
		state: &fakeStateReader{
			signalAtFn: func(_ context.Context, _ int64, name string, _ time.Time) (signal.SignalValue, error) {
				return values[name], nil
			},
		},
		now: time.Now,
	}

	capacityWh, rangeM, err := h.loadLiveBatteryCapacity(context.Background(), 42, 75000)
	if err != nil {
		t.Fatalf("loadLiveBatteryCapacity() error = %v", err)
	}
	if capacityWh != 60000 {
		t.Fatalf("capacityWh = %v, want 60000", capacityWh)
	}
	if rangeM != 400000 {
		t.Fatalf("rangeM = %v, want 400000", rangeM)
	}
}

func TestCalculateStressLevelMatchesPredictiveContract(t *testing.T) {
	tests := []struct {
		name               string
		fastChargePct      float64
		deepDischargeCount int
		fullChargeCount    int
		totalCount         int
		want               string
	}{
		{name: "low", fastChargePct: 20, deepDischargeCount: 2, fullChargeCount: 2, totalCount: 20, want: "Low"},
		{name: "medium fast charging", fastChargePct: 30, totalCount: 20, want: "Medium"},
		{name: "high deep discharge", deepDischargeCount: 21, totalCount: 40, want: "High"},
		{name: "high full charging", fullChargeCount: 6, totalCount: 10, want: "High"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := calculateStressLevel(
				tt.fastChargePct,
				tt.deepDischargeCount,
				tt.fullChargeCount,
				tt.totalCount,
			)
			if got != tt.want {
				t.Fatalf("calculateStressLevel() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestBatteryHealthCacheIsBounded(t *testing.T) {
	fixedNow := time.Date(2026, time.August, 23, 12, 0, 0, 0, time.UTC)
	h := &Handler{
		now:         func() time.Time { return fixedNow },
		healthCache: make(map[int64]batteryHealthCacheEntry),
	}
	for vehicleID := int64(1); vehicleID <= batteryHealthCacheMaxSize+10; vehicleID++ {
		h.cacheBatteryHealth(vehicleID, &batteryHealthResponse{VehicleID: vehicleID})
	}
	if got := len(h.healthCache); got != batteryHealthCacheMaxSize {
		t.Fatalf("cache size = %d, want %d", got, batteryHealthCacheMaxSize)
	}
}
