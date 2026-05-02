package tesla

import "errors"

// ErrVehicleAsleep indicates the vehicle is asleep and cannot respond.
var ErrVehicleAsleep = errors.New("vehicle is asleep")

// VehicleData represents a vehicle entry from the list endpoint.
type VehicleData struct {
	ID          int64  `json:"id"`
	VehicleID   int64  `json:"vehicle_id"`
	VIN         string `json:"vin"`
	DisplayName string `json:"display_name"`
	State       string `json:"state"`
	Color       string `json:"color"`
}

// VehicleDataResponse is the full vehicle_data response.
type VehicleDataResponse struct {
	ID            int64         `json:"id"`
	VehicleID     int64         `json:"vehicle_id"`
	VIN           string        `json:"vin"`
	DisplayName   string        `json:"display_name"`
	State         string        `json:"state"`
	ChargeState   ChargeState   `json:"charge_state"`
	ClimateState  ClimateState  `json:"climate_state"`
	DriveState    DriveState    `json:"drive_state"`
	VehicleState  VehicleState  `json:"vehicle_state"`
	VehicleConfig VehicleConfig `json:"vehicle_config"`
}

type ChargeState struct {
	BatteryLevel             int      `json:"battery_level"`
	BatteryRange             float64  `json:"battery_range"`
	EstBatteryRange          float64  `json:"est_battery_range"`
	IdealBatteryRange        float64  `json:"ideal_battery_range"`
	ChargeRate               float64  `json:"charge_rate"`
	ChargerPower             float64  `json:"charger_power"`
	ChargerVoltage           int      `json:"charger_voltage"`
	ChargerActualCurrent     int      `json:"charger_actual_current"`
	ChargerPhases            *int     `json:"charger_phases"`
	ChargingState            string   `json:"charging_state"` // Charging, Stopped, Disconnected, Complete
	ChargeEnergyAdded        float64  `json:"charge_energy_added"`
	ChargeLimitSoc           int      `json:"charge_limit_soc"`
	ChargePortDoorOpen       bool     `json:"charge_port_door_open"`
	ChargePortLatch          string   `json:"charge_port_latch"` // Engaged, Disengaged
	TimeToFullCharge         float64  `json:"time_to_full_charge"`
	FastChargerType          string   `json:"fast_charger_type"`
	FastChargerBrand         string   `json:"fast_charger_brand"`
	ConnChargeCable          string   `json:"conn_charge_cable"`
	Timestamp                int64    `json:"timestamp"`
}

type ClimateState struct {
	InsideTemp          float64 `json:"inside_temp"`
	OutsideTemp         float64 `json:"outside_temp"`
	DriverTempSetting   float64 `json:"driver_temp_setting"`
	PassengerTempSetting float64 `json:"passenger_temp_setting"`
	IsClimateOn         bool    `json:"is_climate_on"`
	FanStatus           int     `json:"fan_status"`
	IsPreconditioning   bool    `json:"is_preconditioning"`
	Timestamp           int64   `json:"timestamp"`
}

type DriveState struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Speed     *int    `json:"speed"`
	Power     int     `json:"power"`
	Heading   int     `json:"heading"`
	Timestamp int64   `json:"timestamp"`
}

type VehicleState struct {
	Odometer       float64             `json:"odometer"`
	Locked         bool                `json:"locked"`
	SentryMode     bool                `json:"sentry_mode"`
	SoftwareUpdate SoftwareUpdateState `json:"software_update"`
	// Timezone is the IANA tz database name reported by the car
	// (e.g. "America/Los_Angeles"). The worker persists this on every
	// successful poll so vehicle-anchored timestamps render in the car's
	// local time (Phase 40 / 22).
	Timezone  string `json:"timezone"`
	Timestamp int64  `json:"timestamp"`
}

type SoftwareUpdateState struct {
	Status          string `json:"status"`
	Version         string `json:"version"`
	ExpectedDurSec  int    `json:"expected_duration_sec"`
}

type VehicleConfig struct {
	CarType        string `json:"car_type"`
	TrimBadging    string `json:"trim_badging"`
	ExteriorColor  string `json:"exterior_color"`
	WheelType      string `json:"wheel_type"`
}
