package drives

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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

func TestDriveTelemetryBoundaryState(t *testing.T) {
	start := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	readErr := errors.New("boundary unavailable")
	tests := []struct {
		name      string
		state     signal.State
		rows      []signal.TimelineRow
		stateErr  error
		wantRows  int
		wantReads int
		wantErr   error
	}{
		{name: "unknown is not an observation", state: signal.State{"PackCurrent": nil}, wantReads: 1},
		{name: "unrelated state is not telemetry", state: signal.State{"DoorState": "closed"}, wantReads: 1},
		{name: "measured zero and false survive", state: signal.State{"PackCurrent": 0.0, "PackVoltage": 400.0, "HvacPower": false}, wantRows: 1, wantReads: 1},
		{name: "exact boundary is not duplicated", rows: []signal.TimelineRow{{Timestamp: start, Fields: map[string]signal.SignalValue{"pack_current": 2.0}}}, wantRows: 1},
		{name: "boundary failure is surfaced", stateErr: readErr, wantReads: 1, wantErr: readErr},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reads := 0
			reader := &fakeStateReader{
				stateFn: func(context.Context, int64, time.Time) (signal.State, error) {
					reads++
					return tt.state, tt.stateErr
				},
				timelineFn: func(context.Context, int64, []signal.FieldMapping, time.Time, time.Time, signal.TimelineOptions) ([]signal.TimelineRow, error) {
					return tt.rows, nil
				},
			}
			rows, err := (&driveDetailHandler{state: reader}).telemetryTimeline(context.Background(), 42, start, start.Add(time.Minute))
			if !errors.Is(err, tt.wantErr) || len(rows) != tt.wantRows || reads != tt.wantReads {
				t.Fatalf("rows=%+v reads=%d err=%v; want rows=%d reads=%d err=%v", rows, reads, err, tt.wantRows, tt.wantReads, tt.wantErr)
			}
			if tt.state["PackCurrent"] == 0.0 {
				output := timelineRowsToDriveTelemetry(rows)[0]
				if output.Power == nil || *output.Power != 0 || output.IsClimateOn == nil || *output.IsClimateOn {
					t.Fatalf("known zero/false replaced by unknown: %+v", output)
				}
			}
		})
	}
}

func TestDriveTelemetryRetainsLeadingBoundaryPowerInterval(t *testing.T) {
	start := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	fake := &fakeStateReader{
		stateFn: func(context.Context, int64, time.Time) (signal.State, error) {
			return signal.State{"PackVoltage": 400.0, "PackCurrent": 40.0}, nil
		},
		timelineFn: func(_ context.Context, _ int64, fields []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			if len(fields) == len(drivePositionFieldMappings) {
				return nil, nil
			}
			return []signal.TimelineRow{{Timestamp: start.Add(52 * time.Second),
				Fields: map[string]signal.SignalValue{"pack_voltage": 400.0, "pack_current": -10.0}}}, nil
		},
	}
	for _, endpoint := range []string{"detail", "telemetry"} {
		t.Run(endpoint, func(t *testing.T) {
			h := &driveDetailHandler{DriveHandler: &DriveHandler{live: newTestLiveStateReader(fake)},
				state: fake, drives: &fakeDriveByIDFetcher{drive: completedDrive(7, 42, start, start.Add(time.Minute))}}
			rec := httptest.NewRecorder()
			req := newDriveDetailRequest(t, "7", "")
			if endpoint == "detail" {
				h.Get(rec, req)
			} else {
				h.TelemetryReadings(rec, req)
			}
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
			}
			var rows []driveTelemetryRow
			if endpoint == "detail" {
				var payload struct {
					Telemetry []driveTelemetryRow `json:"telemetry"`
				}
				if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
					t.Fatal(err)
				}
				rows = payload.Telemetry
			} else if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
				t.Fatal(err)
			}
			if len(rows) != 2 || !rows[0].CreatedAt.Equal(start) || rows[0].Power == nil || *rows[0].Power != 16000 {
				t.Fatalf("leading 52-second draw interval lost: %+v", rows)
			}
			if rows[1].Power == nil || *rows[1].Power != -4000 {
				t.Fatalf("regen sign lost: %+v", rows[1])
			}
		})
	}
}
