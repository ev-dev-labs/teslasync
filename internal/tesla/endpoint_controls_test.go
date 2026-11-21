package tesla

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	settingsmodel "github.com/ev-dev-labs/teslasync/internal/models/settings"
)

type endpointControlsReaderFunc func(context.Context) (settingsmodel.LegacyPollingConfig, error)

func (f endpointControlsReaderFunc) GetEndpointControls(ctx context.Context) (settingsmodel.LegacyPollingConfig, error) {
	return f(ctx)
}

type smartFleetControls struct {
	config    settingsmodel.LegacyPollingConfig
	suspended bool
}

func (s *smartFleetControls) GetEndpointControls(context.Context) (settingsmodel.LegacyPollingConfig, error) {
	return s.config, nil
}

func (s *smartFleetControls) IsAPISuspended(context.Context) (bool, error) {
	return s.suspended, nil
}

func enableSmartTestEndpoints(c *Client, keys ...string) *smartFleetControls {
	s := &smartFleetControls{config: settingsmodel.DefaultPollingConfig()}
	s.config.SmartEndpoints = make(map[string]bool)
	for _, key := range keys {
		s.config.SmartEndpoints[key] = true
	}
	c.SetEndpointControlsReader(s)
	return s
}

func TestSmartFleetRoutesFailClosedWithoutAffectingManualOrPolling(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	c := newTestClient(server)
	ctx := t.Context()
	smart := smartFeaturesContext(ctx)
	deny := func(ctx context.Context, path string) {
		t.Helper()
		before := calls.Load()
		if _, status, err := c.doRequest(ctx, http.MethodGet, path, nil); status != http.StatusForbidden || !errors.Is(err, ErrEndpointDisabled) || calls.Load() != before {
			t.Fatalf("disabled %s reached transport or returned wrong status: %d %v", path, status, err)
		}
	}
	allow := func(ctx context.Context, path string) {
		t.Helper()
		before := calls.Load()
		if _, status, err := c.doRequest(ctx, http.MethodGet, path, nil); status != http.StatusOK || err != nil || calls.Load() != before+1 {
			t.Fatalf("enabled %s did not reach transport: %d %v", path, status, err)
		}
	}
	const list = "/api/1/vehicles"
	const bundle = "/api/1/vehicles/SYNTHETIC/vehicle_data?endpoints=charge_state;drive_state"
	deny(smart, list)
	flags := enableSmartTestEndpoints(c)
	flags.config.AutoPollingEnabled = true
	allow(ctx, list)
	allow(AutomaticPollingContext(ctx), list)
	deny(smart, list)
	flags.config.SmartEndpoints["vehicle_data.charge_state"] = true
	deny(smart, bundle)
	flags.config.SmartEndpoints["vehicle_data.drive_state"] = true
	allow(smart, bundle)
	flags.config.FleetEndpoints = map[string]bool{"vehicle_data.drive_state": false}
	deny(smart, bundle)
	flags.config.SmartEndpoints["vehicles.list"] = true
	flags.suspended = true
	deny(smart, list)
	allow(ctx, list)
}

func TestFleetEndpointGuardRunsBeforeRequestAndProxy(t *testing.T) {
	pc := settingsmodel.DefaultPollingConfig()
	pc.Commands = false
	pc.OnDemandVehicleDiscovery = false
	pc.VehicleDiscovery = true
	pc.AutoPollingEnabled = true
	reader := endpointControlsReaderFunc(func(context.Context) (settingsmodel.LegacyPollingConfig, error) { return pc, nil })
	c := NewClient(config.TeslaConfig{BaseURL: "http://127.0.0.1:1", CommandProxyURL: "http://127.0.0.1:1", Timeout: time.Second})
	c.SetEndpointControlsReader(reader)
	if _, _, err := c.doRequest(context.Background(), http.MethodGet, "/api/1/vehicles", nil); !errors.Is(err, ErrEndpointDisabled) {
		t.Fatalf("manual discovery: %v", err)
	}
	if _, _, err := c.doRequest(context.Background(), http.MethodPost, "/api/1/vehicles/VIN/command/lock", nil); !errors.Is(err, ErrEndpointDisabled) {
		t.Fatalf("direct command: %v", err)
	}
	if err := c.doProxyRequest(context.Background(), "/api/1/vehicles/VIN/command/lock", nil); !errors.Is(err, ErrEndpointDisabled) {
		t.Fatalf("proxy command: %v", err)
	}
	if err := c.checkEndpointControls(AutomaticPollingContext(context.Background()), http.MethodGet, "/api/1/vehicles"); !errors.Is(err, ErrEndpointDisabled) {
		t.Fatalf("disabled discovery cannot participate in polling: %v", err)
	}
	pc.FleetEndpoints = map[string]bool{"vehicles.list": true}
	pc.AutoEndpoints = map[string]bool{"vehicles.list": false}
	if err := c.checkEndpointControls(context.Background(), http.MethodGet, "/api/1/vehicles"); err != nil {
		t.Fatalf("enabled discovery must work on demand: %v", err)
	}
	if err := c.checkEndpointControls(AutomaticPollingContext(context.Background()), http.MethodGet, "/api/1/vehicles"); !errors.Is(err, ErrEndpointDisabled) {
		t.Fatalf("enabled discovery with auto-poll off must not poll: %v", err)
	}
	pc.AutoEndpoints["vehicles.list"] = true
	if err := c.checkEndpointControls(AutomaticPollingContext(context.Background()), http.MethodGet, "/api/1/vehicles"); err != nil {
		t.Fatalf("enabled and selected discovery should poll: %v", err)
	}
	c.SetEndpointControlsReader(endpointControlsReaderFunc(func(context.Context) (settingsmodel.LegacyPollingConfig, error) {
		return pc, errors.New("settings offline")
	}))
	if err := c.checkEndpointControls(context.Background(), http.MethodPost, "/api/1/vehicles/VIN/command/lock"); err == nil {
		t.Fatal("settings failure must fail closed")
	}
}
