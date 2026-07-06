package tesla

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/port/external"
)

func TestMapVehicleState(t *testing.T) {
	t.Parallel()

	// chargingPayload is a realistic, fully-populated vehicle_data response.
	// The charging_state literal is sourced from the enum so this test stays
	// aligned with enums.ChargeStateCharging.
	chargingPayload := fmt.Sprintf(`{
		"vin": "5YJ3E1EA1PF000001",
		"state": "online",
		"charge_state": {
			"battery_level": 72,
			"battery_range": 210.5,
			"charging_state": %q,
			"charge_rate": 24.5,
			"charger_power": 11,
			"conn_charge_cable": "IEC"
		},
		"drive_state": {
			"latitude": 37.42,
			"longitude": -122.08,
			"speed": 55
		},
		"vehicle_state": {
			"odometer": 12345.6,
			"software_update": {"version": "2024.20.1"}
		},
		"climate_state": {
			"is_climate_on": true,
			"inside_temp": 21.5,
			"outside_temp": 14.0
		}
	}`, enums.ChargeStateCharging)

	tests := []struct {
		name    string
		payload string
		wantErr bool
		check   func(t *testing.T, got external.VehicleState)
	}{
		{
			name:    "full charging payload maps every field",
			payload: chargingPayload,
			check: func(t *testing.T, got external.VehicleState) {
				assertEq(t, "VIN", got.VIN, "5YJ3E1EA1PF000001")
				assertEq(t, "State", got.State, "online")
				assertEq(t, "BatteryLevel", got.BatteryLevel, 72)
				assertEqf(t, "BatteryRange", got.BatteryRange, 210.5)
				assertEq(t, "IsCharging", got.IsCharging, true)
				assertEqf(t, "ChargeRate", got.ChargeRate, 24.5)
				assertEqf(t, "ChargePowerKW", got.ChargePowerKW, 11)
				assertEqf(t, "OdometerMiles", got.OdometerMiles, 12345.6)
				assertEqf(t, "Latitude", got.Latitude, 37.42)
				assertEqf(t, "Longitude", got.Longitude, -122.08)
				assertEqf(t, "Speed", got.Speed, 55)
				assertEq(t, "IsClimateOn", got.IsClimateOn, true)
				assertEqf(t, "InsideTemp", got.InsideTemp, 21.5)
				assertEqf(t, "OutsideTemp", got.OutsideTemp, 14.0)
				assertEq(t, "ChargerConnected", got.ChargerConnected, true)
				assertEq(t, "SoftwareVersion", got.SoftwareVersion, "2024.20.1")
			},
		},
		{
			name: "disconnected is not charging and no cable connected",
			payload: `{
				"vin": "VINB",
				"state": "asleep",
				"charge_state": {
					"battery_level": 40,
					"charging_state": "Disconnected",
					"conn_charge_cable": ""
				},
				"drive_state": {"speed": null}
			}`,
			check: func(t *testing.T, got external.VehicleState) {
				assertEq(t, "IsCharging", got.IsCharging, false)
				assertEq(t, "ChargerConnected", got.ChargerConnected, false)
				assertEqf(t, "Speed", got.Speed, 0)
				assertEq(t, "BatteryLevel", got.BatteryLevel, 40)
			},
		},
		{
			name: "nil speed defaults to zero",
			payload: `{
				"vin": "VINC",
				"drive_state": {"latitude": 1.0, "longitude": 2.0}
			}`,
			check: func(t *testing.T, got external.VehicleState) {
				assertEqf(t, "Speed", got.Speed, 0)
				assertEqf(t, "Latitude", got.Latitude, 1.0)
			},
		},
		{
			name: "cable present without active charging is still connected",
			payload: `{
				"vin": "VIND",
				"charge_state": {"charging_state": "Stopped", "conn_charge_cable": "SNK"}
			}`,
			check: func(t *testing.T, got external.VehicleState) {
				assertEq(t, "IsCharging", got.IsCharging, false)
				assertEq(t, "ChargerConnected", got.ChargerConnected, true)
			},
		},
		{
			name:    "empty object yields zero-value struct without error",
			payload: `{}`,
			check: func(t *testing.T, got external.VehicleState) {
				assertEq(t, "VIN", got.VIN, "")
				assertEq(t, "IsCharging", got.IsCharging, false)
				assertEq(t, "ChargerConnected", got.ChargerConnected, false)
				assertEqf(t, "Speed", got.Speed, 0)
			},
		},
		{
			name:    "json null yields zero-value struct without error",
			payload: `null`,
			check: func(t *testing.T, got external.VehicleState) {
				assertEq(t, "VIN", got.VIN, "")
			},
		},
		{
			name:    "malformed json returns error",
			payload: `not-json`,
			wantErr: true,
		},
		{
			name:    "wrong shape (array) returns error",
			payload: `[1, 2, 3]`,
			wantErr: true,
		},
		{
			name:    "type mismatch on numeric field returns error",
			payload: `{"charge_state": {"battery_level": "high"}}`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			before := time.Now()
			got, err := mapVehicleState(json.RawMessage(tt.payload))
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (state=%+v)", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			// Timestamp must be stamped at map time, within a sane window.
			if got.Timestamp.Before(before) || got.Timestamp.After(time.Now()) {
				t.Errorf("Timestamp %v not within [%v, now]", got.Timestamp, before)
			}
			if tt.check != nil {
				tt.check(t, got)
			}
		})
	}
}

func TestMapVehicleState_ErrorIsWrapped(t *testing.T) {
	t.Parallel()
	_, err := mapVehicleState(json.RawMessage(`not-json`))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "unmarshaling vehicle state") {
		t.Errorf("expected wrapped error mentioning context, got %q", err.Error())
	}
}
