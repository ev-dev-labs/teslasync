package dto

import "time"

// CreateVehicleRequest is the request body for creating a vehicle.
type CreateVehicleRequest struct {
	VIN         string `json:"vin"`
	DisplayName string `json:"displayName"`
	Year        int    `json:"year,omitempty"`
}

// VehicleResponse is the API response for a vehicle.
type VehicleResponse struct {
	ID            string  `json:"id"`
	UserID        string  `json:"userId"`
	VIN           string  `json:"vin"`
	DisplayName   string  `json:"displayName"`
	Model         string  `json:"model"`
	Year          int     `json:"year"`
	FSMState      string  `json:"fsmState"`
	BatteryLevel  int     `json:"batteryLevel"`
	RangeMiles    float64 `json:"rangeMiles"`
	OdometerMiles float64 `json:"odometerMiles"`
	IsCharging    bool    `json:"isCharging"`
	Latitude      float64 `json:"latitude"`
	Longitude     float64 `json:"longitude"`
	UpdatedAt     time.Time `json:"updatedAt"`
}
