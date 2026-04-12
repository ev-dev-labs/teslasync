package external

import (
	"context"
	"time"
)

// VehicleState represents the state data returned by the Tesla API.
type VehicleState struct {
	VIN              string  `json:"vin"`
	State            string  `json:"state"`
	BatteryLevel     int     `json:"batteryLevel"`
	BatteryRange     float64 `json:"batteryRange"`
	IsCharging       bool    `json:"isCharging"`
	ChargeRate       float64 `json:"chargeRate"`
	ChargePowerKW    float64 `json:"chargePowerKw"`
	OdometerMiles    float64 `json:"odometerMiles"`
	Latitude         float64 `json:"latitude"`
	Longitude        float64 `json:"longitude"`
	Speed            float64 `json:"speed"`
	IsClimateOn      bool    `json:"isClimateOn"`
	InsideTemp       float64 `json:"insideTemp"`
	OutsideTemp      float64 `json:"outsideTemp"`
	ChargerConnected bool    `json:"chargerConnected"`
	SoftwareVersion  string  `json:"softwareVersion"`
	Timestamp        time.Time `json:"timestamp"`
}

// TokenPair holds OAuth token data.
type TokenPair struct {
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

// TeslaClient defines the interface for Tesla Fleet API operations.
type TeslaClient interface {
	GetVehicleState(ctx context.Context, vin string) (*VehicleState, error)
	GetVehicleData(ctx context.Context, vin string) (map[string]interface{}, error)
	WakeUp(ctx context.Context, vin string) error
	SendCommand(ctx context.Context, vin string, command string, params map[string]interface{}) error
	RefreshToken(ctx context.Context, refreshToken string) (*TokenPair, error)
	RevokeToken(ctx context.Context, accessToken string) error
}
