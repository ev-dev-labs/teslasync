package drives

import (
	"encoding/json"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestDriveTelemetryClimateUsesExplicitStateBeforeFanEvidence(t *testing.T) {
	for _, tt := range []struct {
		name   string
		fields map[string]signal.SignalValue
		want   any
	}{
		{"explicit on", map[string]signal.SignalValue{"hvac_power": true, "fan_status": 0.0}, true},
		{"explicit off overrides carried fan", map[string]signal.SignalValue{"hvac_power": false, "fan_status": 4.0}, false},
		{"positive fan", map[string]signal.SignalValue{"fan_status": 4.0}, true},
		{"codec text fan", map[string]signal.SignalValue{"fan_status": "4"}, true},
		{"setpoint is not activity", map[string]signal.SignalValue{"driver_temp": 19.0, "fan_status": 0.0}, nil},
		{"missing stays unknown", nil, nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			rows := timelineRowsToDriveTelemetry([]signal.TimelineRow{{Fields: tt.fields}})
			body, err := json.Marshal(rows[0])
			if err != nil {
				t.Fatal(err)
			}

			var row map[string]any
			if err := json.Unmarshal(body, &row); err != nil {
				t.Fatal(err)
			}
			got, exists := row["is_climate_on"]
			if !exists || got != tt.want {
				t.Fatalf("is_climate_on = %v (present %v), want %v", got, exists, tt.want)
			}
		})
	}
}

func TestDriveTelemetryNumericFanAndIndependentMeasurements(t *testing.T) {
	source := signal.State{
		"IdealBatteryRange": 280000.0, "RatedRange": 260000.0,
		"TpmsPressureFl": 281000.0, "TpmsPressureFr": 282000.0,
		"TpmsPressureRl": 283000.0, "TpmsPressureRr": 284000.0,
		"HvacLeftTemperatureRequest": 19.0, "HvacRightTemperatureRequest": 20.0,
		"HvacFanStatus": "4", "HvacPower": false,
		"LocationLatitude": 47.0, "LocationLongitude": -122.0,
	}
	fields := make(map[string]signal.SignalValue)
	for _, mapping := range driveTelemetryFieldMappings {
		fields[mapping.Field] = source[mapping.Signal]
	}
	rows := timelineRowsToDriveTelemetry([]signal.TimelineRow{{Fields: fields}, {Fields: nil}})
	body, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	var output []map[string]any
	if err := json.Unmarshal(body, &output); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"ideal_range": 280000.0, "rated_range": 260000.0,
		"tire_pressure_fl": 281000.0, "tire_pressure_fr": 282000.0,
		"tire_pressure_rl": 283000.0, "tire_pressure_rr": 284000.0,
		"driver_temp": 19.0, "passenger_temp": 20.0, "fan_status": 4.0,
		"is_climate_on": false, "latitude": 47.0, "longitude": -122.0,
	}
	for key, expected := range want {
		if output[0][key] != expected {
			t.Errorf("%s = %v, want its own source %v", key, output[0][key], expected)
		}
		if output[1][key] != nil {
			t.Errorf("missing %s copied from preceding row: %v", key, output[1][key])
		}
	}
}
