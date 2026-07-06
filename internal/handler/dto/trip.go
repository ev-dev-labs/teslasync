package dto

import "time"

// TripResponse is the API response for a trip.
type TripResponse struct {
	ID               string     `json:"id"`
	VehicleID        string     `json:"vehicleId"`
	StartAddress     string     `json:"startAddress"`
	EndAddress       string     `json:"endAddress"`
	DistanceM        float64    `json:"distanceM"`
	EnergyUsedWh     float64    `json:"energyUsedWh"`
	EfficiencyWhPerM float64    `json:"efficiencyWhPerM"`
	MaxSpeedMps      float64    `json:"maxSpeedMps"`
	FSMState         string     `json:"fsmState"`
	StartedAt        time.Time  `json:"startedAt"`
	CompletedAt      *time.Time `json:"completedAt,omitempty"`
}
