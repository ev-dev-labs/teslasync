package tesla

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	settingsmodel "github.com/ev-dev-labs/teslasync/internal/models/settings"
)

type endpointControlsReaderFunc func(context.Context) (settingsmodel.LegacyPollingConfig, error)

func (f endpointControlsReaderFunc) GetEndpointControls(ctx context.Context) (settingsmodel.LegacyPollingConfig, error) {
	return f(ctx)
}

func TestFleetEndpointGuardRunsBeforeRequestAndProxy(t *testing.T) {
	pc := settingsmodel.DefaultPollingConfig()
	pc.Commands = false
	pc.OnDemandVehicleDiscovery = false
	pc.VehicleDiscovery = true
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
	if err := c.checkEndpointControls(AutomaticPollingContext(context.Background()), http.MethodGet, "/api/1/vehicles"); err != nil {
		t.Fatalf("automatic discovery must retain its separate flag: %v", err)
	}
	c.SetEndpointControlsReader(endpointControlsReaderFunc(func(context.Context) (settingsmodel.LegacyPollingConfig, error) {
		return pc, errors.New("settings offline")
	}))
	if err := c.checkEndpointControls(context.Background(), http.MethodPost, "/api/1/vehicles/VIN/command/lock"); err == nil {
		t.Fatal("settings failure must fail closed")
	}
}
