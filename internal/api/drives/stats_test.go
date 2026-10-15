package drives

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
)

type fakeDrivingStatsReader struct {
	stats     drivedb.DrivingStats
	err       error
	vehicleID int64
}

func (f *fakeDrivingStatsReader) GetStats(_ context.Context, vehicleID int64) (drivedb.DrivingStats, error) {
	f.vehicleID = vehicleID
	return f.stats, f.err
}

func TestDrivingStatsMetricContract(t *testing.T) {
	efficiency, avgSpeed, maxSpeed := 0.180123456, 20.0, 35.0
	regen, ratio := 22230.125, 0.1
	reader := &fakeDrivingStatsReader{stats: drivedb.DrivingStats{
		Count: 60, DistanceM: 1235000, DurationS: 91800,
		EfficiencyWhPerM: &efficiency, AvgSpeedMps: &avgSpeed, MaxSpeedMps: &maxSpeed,
		RegenEnergyWh: &regen, RegenRatio: &ratio,
	}}
	h := &DriveHandler{statsRepo: reader}
	rec := httptest.NewRecorder()
	h.Stats(rec, httptest.NewRequest(http.MethodGet, "/drives/stats?vehicle_id=42", nil))
	if rec.Code != http.StatusOK || reader.vehicleID != 42 {
		t.Fatalf("status=%d, vehicle=%d, body=%s", rec.Code, reader.vehicleID, rec.Body.String())
	}
	var body map[string]float64
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	for name, expected := range map[string]float64{
		"total_drives": 60, "total_distance_km": 1235, "total_duration_s": 91800,
		"avg_efficiency_wh_km": efficiency * 1000, "avg_speed_kmh": 72,
		"top_speed_kmh": 126, "regen_energy_wh": regen, "regen_ratio": ratio,
		"co2_saved_kg": 1235000 * 0.00007,
	} {
		if math.Abs(body[name]-expected) > 1e-9 {
			t.Errorf("%s=%v, want %v", name, body[name], expected)
		}
	}
}

func TestDrivingStatsMissingAndMeasuredZero(t *testing.T) {
	zero := 0.0
	for _, value := range []*float64{nil, &zero} {
		reader := &fakeDrivingStatsReader{stats: drivedb.DrivingStats{
			AvgSpeedMps: value, MaxSpeedMps: value, EfficiencyWhPerM: value,
			RegenEnergyWh: value, RegenRatio: value,
		}}
		h := &DriveHandler{statsRepo: reader}
		rec := httptest.NewRecorder()
		h.Stats(rec, httptest.NewRequest(http.MethodGet, "/drives/stats?vehicle_id=1", nil))
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"avg_speed_kmh", "top_speed_kmh", "avg_efficiency_wh_km", "regen_energy_wh", "regen_ratio"} {
			got, exists := body[name]
			if !exists || (value == nil && got != nil) || (value != nil && got != float64(0)) {
				t.Errorf("%s=%v, exists=%v, measured=%v", name, got, exists, value != nil)
			}
		}
	}
}

func TestDrivingStatsErrors(t *testing.T) {
	for _, query := range []string{"", "?vehicle_id=bad", "?vehicle_id=0", "?vehicle_id=-1"} {
		reader := &fakeDrivingStatsReader{}
		h := &DriveHandler{statsRepo: reader}
		rec := httptest.NewRecorder()
		h.Stats(rec, httptest.NewRequest(http.MethodGet, "/drives/stats"+query, nil))
		if rec.Code != http.StatusBadRequest || reader.vehicleID != 0 {
			t.Fatalf("query=%s status=%d reader called for %d", query, rec.Code, reader.vehicleID)
		}
	}
	h := &DriveHandler{statsRepo: &fakeDrivingStatsReader{err: errors.New("database unavailable")}}
	rec := httptest.NewRecorder()
	h.Stats(rec, httptest.NewRequest(http.MethodGet, "/drives/stats?vehicle_id=1", nil))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("database failure status=%d, body=%s", rec.Code, rec.Body.String())
	}
}
