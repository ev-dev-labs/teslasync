package settings

import (
	"encoding/json"
	"reflect"
	"testing"

	settingsmodel "github.com/ev-dev-labs/teslasync/internal/models/settings"
)

func TestEndpointControlsPersistOnlyFleetSwitches(t *testing.T) {
	pc := settingsmodel.DefaultPollingConfig()
	pc.ChargeState = false
	pc.OnDemandVehicleDiscovery = false
	pc.Commands = false
	pc.AutoPollingEnabled = true
	pc.FleetEndpoints = map[string]bool{"command.door_lock": false}
	pc.AutoEndpoints = map[string]bool{"vehicle_data.charge_state": false}
	pc.TelemetryCapture = true // projection must exclude even old capture fields
	pc.TelemetryCaptureRetentionDays = 30
	raw, err := json.Marshal(endpointControlsFrom(pc))
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields) != 23 {
		t.Fatalf("persisted %d settings, want 23: %s", len(fields), raw)
	}
	if _, present := fields["telemetry_capture"]; present {
		t.Fatal("unsupported telemetry capture was persisted")
	}
	if _, present := fields["telemetry_capture_retention_days"]; present {
		t.Fatal("unsupported retention was persisted")
	}
	restored := settingsmodel.DefaultPollingConfig()
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	pc.TelemetryCapture = false
	pc.TelemetryCaptureRetentionDays = 7
	if !reflect.DeepEqual(restored, pc) {
		t.Fatalf("GET projection does not restore switches: got %+v, want %+v", restored, pc)
	}
}
