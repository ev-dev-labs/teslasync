package dto

import "time"

// TripResponse is the API response for a trip.
type TripResponse struct {
	ID              string    `json:"id"`
	VehicleID       string    `json:"vehicleId"`
	StartAddress    string    `json:"startAddress"`
	EndAddress      string    `json:"endAddress"`
	DistanceMiles   float64   `json:"distanceMiles"`
	EnergyUsedKWh  float64   `json:"energyUsedKwh"`
	EfficiencyWhMi  float64   `json:"efficiencyWhPerMile"`
	MaxSpeedMph     float64   `json:"maxSpeedMph"`
	FSMState        string    `json:"fsmState"`
	StartedAt       time.Time `json:"startedAt"`
	CompletedAt     time.Time `json:"completedAt,omitempty"`
}
