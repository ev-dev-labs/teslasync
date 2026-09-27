package tesla

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	settingsmodel "github.com/ev-dev-labs/teslasync/internal/models/settings"
)

func TestFleetEndpointCatalogCoversEveryExposedRoute(t *testing.T) {
	catalog := FleetEndpointCatalog()
	if len(catalog) < 100 {
		t.Fatalf("catalog has only %d operations; expected all vehicle, account, energy, telemetry and command routes", len(catalog))
	}
	seen := map[string]bool{}
	for _, entry := range catalog {
		if seen[entry.Key] {
			t.Fatalf("duplicate endpoint key %s", entry.Key)
		}
		seen[entry.Key] = true
		sample := strings.ReplaceAll(entry.Path, "{vin}", "TESTVIN")
		sample = strings.ReplaceAll(sample, "{site_id}", "1")
		sample = strings.ReplaceAll(sample, "{content_id}", "1")
		sample = strings.ReplaceAll(sample, "{invitation_id}", "1")
		keys, ok := fleetEndpointKeys(entry.Method, sample)
		if !ok || len(keys) != 1 || keys[0] != entry.Key {
			t.Errorf("%s %s resolves to %v (known=%t), want %s", entry.Method, sample, keys, ok, entry.Key)
		}
		if entry.Pollable && entry.Method != http.MethodGet {
			t.Errorf("non-read operation %s must not be pollable", entry.Key)
		}
	}
	for _, command := range commands {
		if !seen["command."+command.endpoint] {
			t.Errorf("Tesla command %s has no individual switch", command.endpoint)
		}
	}
}

func TestFleetEndpointsIndependentlyControlDirectPartnerAndProxyCalls(t *testing.T) {
	pc := settingsmodel.DefaultPollingConfig()
	pc.AutoPollingEnabled = true
	pc.FleetEndpoints = map[string]bool{}
	pc.AutoEndpoints = map[string]bool{"vehicle_data.charge_state": false}
	client := &Client{}
	client.SetEndpointControlsReader(endpointControlsReaderFunc(func(context.Context) (settingsmodel.LegacyPollingConfig, error) {
		return pc, nil
	}))
	for _, entry := range FleetEndpointCatalog() {
		path := strings.ReplaceAll(entry.Path, "{vin}", "VIN")
		path = strings.ReplaceAll(path, "{site_id}", "1")
		path = strings.ReplaceAll(path, "{content_id}", "1")
		path = strings.ReplaceAll(path, "{invitation_id}", "1")
		pc.FleetEndpoints[entry.Key] = false
		if err := client.checkEndpointControls(context.Background(), entry.Method, path); !errors.Is(err, ErrEndpointDisabled) {
			t.Errorf("%s disabled: %v", entry.Key, err)
		}
		pc.FleetEndpoints[entry.Key] = true
		if err := client.checkEndpointControls(context.Background(), entry.Method, path); err != nil {
			t.Errorf("%s re-enabled: %v", entry.Key, err)
		}
	}
	pc.FleetEndpoints["vehicle_data.drive_state"] = false
	if err := client.checkEndpointControls(context.Background(), http.MethodGet, "/api/1/vehicles/VIN/vehicle_data?endpoints=charge_state;drive_state"); !errors.Is(err, ErrEndpointDisabled) {
		t.Fatalf("mixed permitted and disabled sub-endpoints must fail closed: %v", err)
	}
	pc.FleetEndpoints["vehicle_data.drive_state"] = true
	for _, path := range []string{
		"/api/1/vehicles/VIN/vehicle_data?endpoints=unknown",
		"/api/1/vehicles/VIN/vehicle_data?endpoints=",
		"/api/1/vehicles/VIN/command/not_registered",
		"/api/1/unregistered",
	} {
		if err := client.checkEndpointControls(context.Background(), http.MethodGet, path); !errors.Is(err, ErrEndpointDisabled) {
			t.Errorf("unrecognized/auto-excluded path %s must fail closed: %v", path, err)
		}
	}
	if err := client.checkEndpointControls(context.Background(), http.MethodGet, "/api/1/vehicles/VIN/vehicle_data?endpoints=charge_state"); err != nil {
		t.Fatalf("enabled endpoint must remain available on demand: %v", err)
	}
	if err := client.checkEndpointControls(AutomaticPollingContext(context.Background()), http.MethodGet, "/api/1/vehicles/VIN/vehicle_data?endpoints=charge_state"); !errors.Is(err, ErrEndpointDisabled) {
		t.Fatalf("on-demand-only vehicle data should not poll: %v", err)
	}
	if err := client.checkEndpointControls(AutomaticPollingContext(context.Background()), http.MethodPost, "/api/1/vehicles/VIN/command/door_lock"); !errors.Is(err, ErrEndpointDisabled) {
		t.Fatalf("a command must not be auto-polled: %v", err)
	}
}
