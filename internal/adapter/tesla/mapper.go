package tesla

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/port/external"
)

func mapVehicleState(data json.RawMessage) (external.VehicleState, error) {
	var raw struct {
		VIN         string `json:"vin"`
		State       string `json:"state"`
		ChargeState struct {
			BatteryLevel    int     `json:"battery_level"`
			BatteryRange    float64 `json:"battery_range"`
			ChargingState   string  `json:"charging_state"`
			ChargeRate      float64 `json:"charge_rate"`
			ChargerPower    int     `json:"charger_power"`
			ConnChargeCable string  `json:"conn_charge_cable"`
		} `json:"charge_state"`
		DriveState struct {
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
			Speed     *int    `json:"speed"`
		} `json:"drive_state"`
		VehicleState struct {
			Odometer       float64 `json:"odometer"`
			SoftwareUpdate struct {
				Version string `json:"version"`
			} `json:"software_update"`
		} `json:"vehicle_state"`
		ClimateState struct {
			IsClimateOn bool    `json:"is_climate_on"`
			InsideTemp  float64 `json:"inside_temp"`
			OutsideTemp float64 `json:"outside_temp"`
		} `json:"climate_state"`
	}

	if err := json.Unmarshal(data, &raw); err != nil {
		return external.VehicleState{}, fmt.Errorf("unmarshaling vehicle state: %w", err)
	}

	speed := 0.0
	if raw.DriveState.Speed != nil {
		speed = float64(*raw.DriveState.Speed)
	}

	return external.VehicleState{
		VIN:              raw.VIN,
		State:            raw.State,
		BatteryLevel:     raw.ChargeState.BatteryLevel,
		BatteryRange:     raw.ChargeState.BatteryRange,
		IsCharging:       raw.ChargeState.ChargingState == enums.ChargeStateCharging,
		ChargeRate:       raw.ChargeState.ChargeRate,
		ChargePowerKW:    float64(raw.ChargeState.ChargerPower),
		OdometerMiles:    raw.VehicleState.Odometer,
		Latitude:         raw.DriveState.Latitude,
		Longitude:        raw.DriveState.Longitude,
		Speed:            speed,
		IsClimateOn:      raw.ClimateState.IsClimateOn,
		InsideTemp:       raw.ClimateState.InsideTemp,
		OutsideTemp:      raw.ClimateState.OutsideTemp,
		ChargerConnected: raw.ChargeState.ConnChargeCable != "",
		SoftwareVersion:  raw.VehicleState.SoftwareUpdate.Version,
		Timestamp:        time.Now(),
	}, nil
}
