package dto

import "time"

// ChargingSessionResponse is the API response for a charging session.
type ChargingSessionResponse struct {
	ID                string     `json:"id"`
	VehicleID         string     `json:"vehicleId"`
	ChargerType       string     `json:"chargerType"`
	StartBatteryLevel int        `json:"startBatteryLevel"`
	EndBatteryLevel   int        `json:"endBatteryLevel"`
	EnergyAddedWh     float64    `json:"energyAddedWh"`
	MaxPowerW         float64    `json:"maxPowerW"`
	CostCents         int        `json:"costCents"`
	FSMState          string     `json:"fsmState"`
	SubFSMState       string     `json:"subFsmState,omitempty"`
	StartedAt         time.Time  `json:"startedAt"`
	CompletedAt       *time.Time `json:"completedAt,omitempty"`
}
