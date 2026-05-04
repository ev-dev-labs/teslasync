package worker

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	dto "github.com/prometheus/client_model/go"
)

// stubVehicleLister implements vehicleLister with an in-memory slice.
type stubVehicleLister struct {
	ids []int64
	err error
}

func (s *stubVehicleLister) GetAll(_ context.Context) ([]int64, error) {
	return s.ids, s.err
}

// stubSignalReader implements signalReader with an in-memory map. The
// key encodes (vehicle_id, field) to avoid nested maps in tests.
type stubSignalReader struct {
	series       map[stubKey][]TimedFloat
	historyAge   map[int64]time.Duration
	historyError map[int64]error
	queryErr     error // per-call SELECT error (test failure paths)
}

type stubKey struct {
	VehicleID int64
	Field     string
}

func (s *stubSignalReader) FloatSeries(_ context.Context, vehicleID int64, field string, _, _ time.Time) ([]TimedFloat, error) {
	if s.queryErr != nil {
		return nil, s.queryErr
	}
	return s.series[stubKey{vehicleID, field}], nil
}

func (s *stubSignalReader) LatestUnitHistoryAge(_ context.Context, vehicleID int64, _ time.Time) (time.Duration, error) {
	if err, ok := s.historyError[vehicleID]; ok {
		return 0, err
	}
	if age, ok := s.historyAge[vehicleID]; ok {
		return age, nil
	}
	return 0, ErrNoHistory
}

// driftCounterValue returns the current value of
// tesla_unit_drift_suspected_total{vehicle_id, kind}, or 0 if the
// label combination has never been incremented.
func driftCounterValue(t *testing.T, vehicleID int64, kind string) float64 {
	t.Helper()
	c, err := driftSuspectedTotal.GetMetricWithLabelValues(formatVehicleID(vehicleID), kind)
	if err != nil {
		t.Fatalf("get drift counter: %v", err)
	}
	var m dto.Metric
	if err := c.Write(&m); err != nil {
		t.Fatalf("write drift counter: %v", err)
	}
	return m.GetCounter().GetValue()
}

func canaryCounterValue(t *testing.T, vehicleID int64, reason string) float64 {
	t.Helper()
	c, err := canaryTotal.GetMetricWithLabelValues(formatVehicleID(vehicleID), reason)
	if err != nil {
		t.Fatalf("get canary counter: %v", err)
	}
	var m dto.Metric
	if err := c.Write(&m); err != nil {
		t.Fatalf("write canary counter: %v", err)
	}
	return m.GetCounter().GetValue()
}

func formatVehicleID(id int64) string {
	// Mirrors the production fmt.Sprintf("%d", vehicleID) so the test
	// reads the same Prometheus label the validator wrote.
	return (func(i int64) string {
		// Avoid pulling fmt into the helper; keep it tiny.
		const digits = "0123456789"
		if i == 0 {
			return "0"
		}
		neg := i < 0
		if neg {
			i = -i
		}
		var buf [20]byte
		pos := len(buf)
		for i > 0 {
			pos--
			buf[pos] = digits[i%10]
			i /= 10
		}
		if neg {
			pos--
			buf[pos] = '-'
		}
		return string(buf[pos:])
	})(id)
}

// generateStraightLineDrive simulates a vehicle moving in a straight
// line at a fixed speed for `samples` location samples spaced
// `intervalSec` seconds apart. Returns synthetic (speed, lat, lng)
// series consistent with each other (no drift). Speed samples are at
// 1Hz to mimic real telemetry.
func generateStraightLineDrive(start time.Time, samples int, intervalSec int, speedMS float64) (speeds []TimedFloat, lats []TimedFloat, lngs []TimedFloat) {
	totalSeconds := samples * intervalSec
	speeds = make([]TimedFloat, totalSeconds)
	lats = make([]TimedFloat, samples)
	lngs = make([]TimedFloat, samples)
	startLat, startLng := 37.7749, -122.4194
	deltaLatPerSec := speedMS / 111320.0
	for i := 0; i < totalSeconds; i++ {
		speeds[i] = TimedFloat{Ts: start.Add(time.Duration(i) * time.Second), Value: speedMS}
	}
	for i := 0; i < samples; i++ {
		ts := start.Add(time.Duration(i*intervalSec) * time.Second)
		lats[i] = TimedFloat{Ts: ts, Value: startLat + deltaLatPerSec*float64(i*intervalSec)}
		lngs[i] = TimedFloat{Ts: ts, Value: startLng}
	}
	return speeds, lats, lngs
}

func TestUnitDriftValidator_NoDrift_NoFindings(t *testing.T) {
	// 12 location samples × 10s intervals = 120s drive at 25 m/s,
	// each gap = 250m (well above 50m noise floor).
	speeds, lats, lngs := generateStraightLineDrive(time.Now().UTC().Add(-30*time.Minute), 12, 10, 25.0)
	signals := &stubSignalReader{
		series: map[stubKey][]TimedFloat{
			{VehicleID: 1, Field: "VehicleSpeed"}:      speeds,
			{VehicleID: 1, Field: "LocationLatitude"}:  lats,
			{VehicleID: 1, Field: "LocationLongitude"}: lngs,
		},
		historyAge: map[int64]time.Duration{1: 1 * time.Hour},
	}
	v := NewUnitDriftValidatorWithDeps(&stubVehicleLister{ids: []int64{1}}, signals)
	before := driftCounterValue(t, 1, driftKindSpeed)
	if err := v.Run(context.Background(), Options{Lookback: time.Hour}); err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	after := driftCounterValue(t, 1, driftKindSpeed)
	if after != before {
		t.Errorf("speed drift counter incremented (%v -> %v) on no-drift series", before, after)
	}
}

func TestUnitDriftValidator_SpeedDrift_Detected(t *testing.T) {
	// Build a series where VehicleSpeed reads 25 m/s (wrong) but
	// Location moves at 11.176 m/s — i.e., the recorded speed is
	// actually mph mistakenly stored as m/s. Implied speed is half
	// the recorded → ratio ~2.0, well outside [0.85, 1.15].
	// 12 samples × 10s = 120s drive, each gap ~111m at 11.176 m/s.
	speeds, lats, lngs := generateStraightLineDrive(time.Now().UTC().Add(-30*time.Minute), 12, 10, 11.176)
	for i := range speeds {
		speeds[i].Value = 25.0
	}
	signals := &stubSignalReader{
		series: map[stubKey][]TimedFloat{
			{VehicleID: 2, Field: "VehicleSpeed"}:      speeds,
			{VehicleID: 2, Field: "LocationLatitude"}:  lats,
			{VehicleID: 2, Field: "LocationLongitude"}: lngs,
		},
		historyAge: map[int64]time.Duration{2: 1 * time.Hour},
	}
	v := NewUnitDriftValidatorWithDeps(&stubVehicleLister{ids: []int64{2}}, signals)
	before := driftCounterValue(t, 2, driftKindSpeed)
	if err := v.Run(context.Background(), Options{Lookback: time.Hour}); err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	after := driftCounterValue(t, 2, driftKindSpeed)
	if after <= before {
		t.Errorf("speed drift counter not incremented (%v -> %v) on drifted series", before, after)
	}
}

func TestUnitDriftValidator_DryRun_NoCounterIncrement(t *testing.T) {
	speeds, lats, lngs := generateStraightLineDrive(time.Now().UTC().Add(-30*time.Minute), 12, 10, 11.176)
	for i := range speeds {
		speeds[i].Value = 25.0
	}
	signals := &stubSignalReader{
		series: map[stubKey][]TimedFloat{
			{VehicleID: 3, Field: "VehicleSpeed"}:      speeds,
			{VehicleID: 3, Field: "LocationLatitude"}:  lats,
			{VehicleID: 3, Field: "LocationLongitude"}: lngs,
		},
		historyAge: map[int64]time.Duration{3: 1 * time.Hour},
	}
	v := NewUnitDriftValidatorWithDeps(&stubVehicleLister{ids: []int64{3}}, signals)
	before := driftCounterValue(t, 3, driftKindSpeed)
	if err := v.Run(context.Background(), Options{Lookback: time.Hour, DryRun: true}); err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	after := driftCounterValue(t, 3, driftKindSpeed)
	if after != before {
		t.Errorf("dry-run still incremented counter (%v -> %v); dry-run must be observation-only", before, after)
	}
}

func TestUnitDriftValidator_TemperatureDrift_Detected(t *testing.T) {
	// 10 samples all reading 95°C (impossible for cabin/exterior).
	// Likely 95°F mistakenly stored as °C.
	now := time.Now().UTC()
	series := make([]TimedFloat, 10)
	for i := range series {
		series[i] = TimedFloat{Ts: now.Add(time.Duration(i) * time.Minute), Value: 95.0}
	}
	signals := &stubSignalReader{
		series: map[stubKey][]TimedFloat{
			{VehicleID: 4, Field: "InsideTemp"}: series,
		},
		historyAge: map[int64]time.Duration{4: 1 * time.Hour},
	}
	v := NewUnitDriftValidatorWithDeps(&stubVehicleLister{ids: []int64{4}}, signals)
	before := driftCounterValue(t, 4, driftKindTempHigh)
	if err := v.Run(context.Background(), Options{Lookback: time.Hour}); err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	after := driftCounterValue(t, 4, driftKindTempHigh)
	if after <= before {
		t.Errorf("temperature drift counter not incremented (%v -> %v) on impossible-Celsius series", before, after)
	}
}

func TestUnitDriftValidator_TemperaturePlausible_NoFindings(t *testing.T) {
	// 10 samples all reading 22°C — perfectly plausible.
	now := time.Now().UTC()
	series := make([]TimedFloat, 10)
	for i := range series {
		series[i] = TimedFloat{Ts: now.Add(time.Duration(i) * time.Minute), Value: 22.0}
	}
	signals := &stubSignalReader{
		series: map[stubKey][]TimedFloat{
			{VehicleID: 5, Field: "InsideTemp"}: series,
		},
		historyAge: map[int64]time.Duration{5: 1 * time.Hour},
	}
	v := NewUnitDriftValidatorWithDeps(&stubVehicleLister{ids: []int64{5}}, signals)
	before := driftCounterValue(t, 5, driftKindTempHigh)
	if err := v.Run(context.Background(), Options{Lookback: time.Hour}); err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	after := driftCounterValue(t, 5, driftKindTempHigh)
	if after != before {
		t.Errorf("temperature drift counter incremented (%v -> %v) on plausible series", before, after)
	}
}

func TestUnitDriftValidator_Canary_FiresOnNoHistory(t *testing.T) {
	signals := &stubSignalReader{
		series:       map[stubKey][]TimedFloat{},
		historyError: map[int64]error{6: ErrNoHistory},
	}
	v := NewUnitDriftValidatorWithDeps(&stubVehicleLister{ids: []int64{6}}, signals)
	before := canaryCounterValue(t, 6, canaryNoHistory7d)
	if err := v.Run(context.Background(), Options{Lookback: time.Hour}); err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	after := canaryCounterValue(t, 6, canaryNoHistory7d)
	if after <= before {
		t.Errorf("canary counter not incremented (%v -> %v) on missing vehicle_unit_history", before, after)
	}
}

func TestUnitDriftValidator_Canary_FiresOnStaleHistory(t *testing.T) {
	signals := &stubSignalReader{
		series:     map[stubKey][]TimedFloat{},
		historyAge: map[int64]time.Duration{7: 30 * 24 * time.Hour}, // 30 days old
	}
	v := NewUnitDriftValidatorWithDeps(&stubVehicleLister{ids: []int64{7}}, signals)
	before := canaryCounterValue(t, 7, canaryNoHistory7d)
	if err := v.Run(context.Background(), Options{Lookback: time.Hour}); err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	after := canaryCounterValue(t, 7, canaryNoHistory7d)
	if after <= before {
		t.Errorf("canary counter not incremented (%v -> %v) on stale vehicle_unit_history", before, after)
	}
}

func TestUnitDriftValidator_OnlyVehicle_FiltersFleet(t *testing.T) {
	signals := &stubSignalReader{
		series:     map[stubKey][]TimedFloat{},
		historyAge: map[int64]time.Duration{1: 1 * time.Hour, 2: 1 * time.Hour, 99: 1 * time.Hour},
	}
	// Lister returns 3 vehicles; OnlyVehicle should bypass the
	// repo entirely and check just vehicle 99.
	listErr := errors.New("repo MUST NOT be called when OnlyVehicle is set")
	v := NewUnitDriftValidatorWithDeps(&stubVehicleLister{err: listErr}, signals)
	if err := v.Run(context.Background(), Options{Lookback: time.Hour, OnlyVehicle: 99}); err != nil {
		t.Fatalf("OnlyVehicle should bypass listVehicles call but Run returned: %v", err)
	}
}

func TestUnitDriftValidator_ListError_PropagatesError(t *testing.T) {
	signals := &stubSignalReader{}
	listErr := errors.New("DB down")
	v := NewUnitDriftValidatorWithDeps(&stubVehicleLister{err: listErr}, signals)
	err := v.Run(context.Background(), Options{Lookback: time.Hour})
	if err == nil || !strings.Contains(err.Error(), "list vehicles") {
		t.Errorf("expected wrapped list-vehicles error, got %v", err)
	}
}

func TestHaversineMeters_KnownDistances(t *testing.T) {
	// SF City Hall (37.7793, -122.4192) → Oakland City Hall (37.8044, -122.2712)
	// Real distance: ~13,400 m.
	got := haversineMeters(37.7793, -122.4192, 37.8044, -122.2712)
	want := 13400.0
	if math.Abs(got-want)/want > 0.05 {
		t.Errorf("haversineMeters SF→Oakland = %.1f m, want ~%.1f m (±5%%)", got, want)
	}
}

func TestHaversineMeters_ZeroDistance(t *testing.T) {
	if d := haversineMeters(37.7793, -122.4192, 37.7793, -122.4192); d != 0 {
		t.Errorf("haversineMeters identity = %v, want 0", d)
	}
}

func TestPairLocations_TimestampMismatch_DropsUnpaired(t *testing.T) {
	t0 := time.Now().UTC()
	lats := []TimedFloat{
		{Ts: t0, Value: 37.7},
		{Ts: t0.Add(time.Second), Value: 37.71},
		{Ts: t0.Add(2 * time.Second), Value: 37.72},
	}
	lngs := []TimedFloat{
		{Ts: t0, Value: -122.4},
		{Ts: t0.Add(2 * time.Second), Value: -122.42}, // gap at +1s
	}
	got := pairLocations(lats, lngs)
	if len(got) != 2 {
		t.Errorf("pairLocations dropped wrong count: got %d pairs, want 2", len(got))
	}
}
