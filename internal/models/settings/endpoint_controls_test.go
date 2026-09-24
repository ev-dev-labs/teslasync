package settings

import (
	"net/http"
	"testing"
)

func TestEndpointControlsOperationCategories(t *testing.T) {
	type operation struct {
		method, path string
		automatic    bool
		disable      func(*LegacyPollingConfig)
	}
	cases := map[string]operation{
		"automatic discovery": {http.MethodGet, "/api/1/vehicles", true, func(pc *LegacyPollingConfig) { pc.VehicleDiscovery = false }},
		"manual discovery":    {http.MethodGet, "/api/1/vehicles", false, func(pc *LegacyPollingConfig) { pc.OnDemandVehicleDiscovery = false }},
		"automatic state":     {http.MethodGet, "/api/1/vehicles/VIN/vehicle_data?endpoints=charge_state;drive_state", true, func(pc *LegacyPollingConfig) { pc.DriveState = false }},
		"manual state":        {http.MethodGet, "/api/1/vehicles/VIN/vehicle_data?endpoints=charge_state", false, func(pc *LegacyPollingConfig) { pc.OnDemandChargeState = false }},
		"unfiltered state":    {http.MethodGet, "/api/1/vehicles/VIN/vehicle_data", false, func(pc *LegacyPollingConfig) { pc.OnDemandChargeState = false }},
		"charging sites":      {http.MethodGet, "/api/1/vehicles/VIN/nearby_charging_sites", false, func(pc *LegacyPollingConfig) { pc.NearbyChargingSites = false }},
		"release notes":       {http.MethodGet, "/api/1/vehicles/VIN/release_notes", false, func(pc *LegacyPollingConfig) { pc.ReleaseNotes = false }},
		"recent alerts":       {http.MethodGet, "/api/1/vehicles/VIN/recent_alerts", false, func(pc *LegacyPollingConfig) { pc.RecentAlerts = false }},
		"service data":        {http.MethodGet, "/api/1/vehicles/VIN/service_data", false, func(pc *LegacyPollingConfig) { pc.ServiceData = false }},
		"wake":                {http.MethodPost, "/api/1/vehicles/VIN/wake_up", false, func(pc *LegacyPollingConfig) { pc.WakeUp = false }},
		"command":             {http.MethodPost, "/api/1/vehicles/VIN/command/lock", false, func(pc *LegacyPollingConfig) { pc.Commands = false }},
	}
	for name, op := range cases {
		t.Run(name, func(t *testing.T) {
			pc := DefaultPollingConfig()
			if !pc.AllowsFleetOperation(op.method, op.path, op.automatic) {
				t.Fatal("default controls should permit operation")
			}
			op.disable(&pc)
			if pc.AllowsFleetOperation(op.method, op.path, op.automatic) {
				t.Fatal("disabled control permitted operation")
			}
			if !pc.AllowsFleetOperation(http.MethodGet, "/api/1/vehicles/VIN/specs", false) {
				t.Fatal("unrelated endpoint was blocked")
			}
		})
	}
	pc := DefaultPollingConfig()
	pc.DriveState = false
	if !pc.AllowsFleetOperation(http.MethodGet, "/api/1/vehicles/VIN/vehicle_data?endpoints=charge_state;climate_state", true) {
		t.Fatal("disabled drive_state must not block a filtered automatic charge/climate poll")
	}
}
