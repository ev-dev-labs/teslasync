package dto

import (
	"testing"
	"time"
)

func TestTripResponse_JSON(t *testing.T) {
	started := time.Date(2024, 7, 1, 12, 0, 0, 0, time.UTC)
	completed := time.Date(2024, 7, 1, 12, 45, 0, 0, time.UTC)

	// Only completedAt carries omitempty; every other field is always present.
	baseKeys := []string{
		"id", "vehicleId", "startAddress", "endAddress", "distanceM",
		"energyUsedWh", "efficiencyWhPerM", "maxSpeedMps", "fsmState", "startedAt",
	}

	t.Run("in-progress omits completedAt", func(t *testing.T) {
		tr := TripResponse{
			ID:           "t1",
			VehicleID:    "v1",
			StartAddress: "1 A St",
			FSMState:     "driving",
			StartedAt:    started,
		}
		m := marshalToMap(t, tr)
		assertKeys(t, m, baseKeys...)
		if _, ok := m["completedAt"]; ok {
			t.Error("completedAt must be omitted for an in-progress trip (regression: field must be *time.Time)")
		}
		assertRoundTrip(t, tr)
	})

	t.Run("completed includes completedAt", func(t *testing.T) {
		tr := TripResponse{
			ID:               "t1",
			VehicleID:        "v1",
			StartAddress:     "1 A St",
			EndAddress:       "2 B Ave",
			DistanceM:        15000,
			EnergyUsedWh:     3000,
			EfficiencyWhPerM: 0.2,
			MaxSpeedMps:      31.3,
			FSMState:         "complete",
			StartedAt:        started,
			CompletedAt:      &completed,
		}
		m := marshalToMap(t, tr)
		assertKeys(t, m, append(baseKeys, "completedAt")...)
		if got := string(m["distanceM"]); got != "15000" {
			t.Errorf("distanceM = %s, want 15000", got)
		}
		assertRoundTrip(t, tr)
	})
}
