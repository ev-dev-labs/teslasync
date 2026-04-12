package charging

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

// CanStartCharging checks that the charger is connected and battery < 100%.
func CanStartCharging(_ context.Context, s *ChargingSession, _ fsm.Event) (bool, error) {
	return s.ChargerConnected && s.StartBatteryLevel < 100, nil
}

// CanComplete checks that energy was actually added.
func CanComplete(_ context.Context, s *ChargingSession, _ fsm.Event) (bool, error) {
	return s.EnergyAddedKWh > 0 && s.EndBatteryLevel >= s.StartBatteryLevel, nil
}
