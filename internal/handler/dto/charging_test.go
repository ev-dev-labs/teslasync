package dto

import (
	"testing"
	"time"
)

func TestChargingSessionResponse_JSON(t *testing.T) {
	started := time.Date(2024, 6, 1, 8, 0, 0, 0, time.UTC)
	completed := time.Date(2024, 6, 1, 9, 30, 0, 0, time.UTC)

	t.Run("in-progress omits completedAt and subFsmState", func(t *testing.T) {
		s := ChargingSessionResponse{
			ID:                "c1",
			VehicleID:         "v1",
			ChargerType:       "supercharger",
			StartBatteryLevel: 20,
			EndBatteryLevel:   20,
			FSMState:          "charging",
			StartedAt:         started,
		}
		m := marshalToMap(t, s)
		assertKeys(t, m,
			"id", "vehicleId", "chargerType", "startBatteryLevel", "endBatteryLevel",
			"energyAddedWh", "maxPowerW", "costCents", "fsmState", "startedAt",
		)
		if _, ok := m["completedAt"]; ok {
			t.Error("completedAt must be omitted for an in-progress session (regression: field must be *time.Time)")
		}
		if _, ok := m["subFsmState"]; ok {
			t.Error("subFsmState must be omitted when empty")
		}
		assertRoundTrip(t, s)
	})

	t.Run("completed includes completedAt and subFsmState", func(t *testing.T) {
		s := ChargingSessionResponse{
			ID:                "c1",
			VehicleID:         "v1",
			ChargerType:       "supercharger",
			StartBatteryLevel: 20,
			EndBatteryLevel:   80,
			EnergyAddedWh:     42000,
			MaxPowerW:         150000,
			CostCents:         1250,
			FSMState:          "complete",
			SubFSMState:       "topping_off",
			StartedAt:         started,
			CompletedAt:       &completed,
		}
		m := marshalToMap(t, s)
		assertKeys(t, m,
			"id", "vehicleId", "chargerType", "startBatteryLevel", "endBatteryLevel",
			"energyAddedWh", "maxPowerW", "costCents", "fsmState", "subFsmState",
			"startedAt", "completedAt",
		)
		if got := string(m["energyAddedWh"]); got != "42000" {
			t.Errorf("energyAddedWh = %s, want 42000", got)
		}
		if got := string(m["subFsmState"]); got != `"topping_off"` {
			t.Errorf("subFsmState = %s, want \"topping_off\"", got)
		}
		assertRoundTrip(t, s)
	})
}
