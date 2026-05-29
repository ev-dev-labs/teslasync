package charging

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
)

func CanStartCharging(_ context.Context, s *ChargingSession, _ fsm.Event) (bool, error) {
	return s.ChargerConnected && s.StartBatteryLevel < 100, nil
}

func CanComplete(_ context.Context, s *ChargingSession, _ fsm.Event) (bool, error) {
	return s.EnergyAddedWh > 0 && s.EndBatteryLevel >= s.StartBatteryLevel, nil
}
