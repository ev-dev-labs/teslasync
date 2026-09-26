package settings

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	settingsmodel "github.com/ev-dev-labs/teslasync/internal/models/settings"
)

type memoryEndpointControls struct {
	config settingsmodel.LegacyPollingConfig
	err    error
	writes int
}

func (s *memoryEndpointControls) GetEndpointControls(context.Context) (settingsmodel.LegacyPollingConfig, error) {
	return s.config, s.err
}

func (s *memoryEndpointControls) UpsertEndpointControls(_ context.Context, pc settingsmodel.LegacyPollingConfig) error {
	if s.err != nil {
		return s.err
	}
	s.config = pc
	s.writes++
	return nil
}

func TestEndpointControlsHandlersPersistRoundTrip(t *testing.T) {
	store := &memoryEndpointControls{config: settingsmodel.DefaultPollingConfig()}
	h := &SettingsHandler{endpointControls: store}
	pc := store.config
	pc.ChargeState = false
	pc.OnDemandVehicleDiscovery = false
	raw, _ := json.Marshal(pc)
	w := httptest.NewRecorder()
	h.UpdatePollingConfig(w, httptest.NewRequest(http.MethodPut, "/settings/polling-config", strings.NewReader(string(raw))))
	if w.Code != http.StatusOK || store.writes != 1 {
		t.Fatalf("PUT status=%d, writes=%d, body=%s", w.Code, store.writes, w.Body.String())
	}
	w = httptest.NewRecorder()
	h.GetPollingConfig(w, httptest.NewRequest(http.MethodGet, "/settings/polling-config", nil))
	var got settingsmodel.LegacyPollingConfig
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("GET status=%d, config=%+v, decode=%v", w.Code, got, err)
	}
	if len(got.FleetEndpoints) <= 20 || len(got.AutoEndpoints) != 7 || !got.FleetEndpoints["command.door_lock"] {
		t.Fatal("GET must include each implemented route and its effective flags")
	}
	got.FleetEndpoints, got.AutoEndpoints = nil, nil
	if !reflect.DeepEqual(got, pc) {
		t.Fatalf("GET legacy switches changed: got %+v, want %+v", got, pc)
	}
	store.err = errors.New("database unavailable")
	w = httptest.NewRecorder()
	h.GetPollingConfig(w, httptest.NewRequest(http.MethodGet, "/settings/polling-config", nil))
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("GET database error status=%d", w.Code)
	}
	w = httptest.NewRecorder()
	h.UpdatePollingConfig(w, httptest.NewRequest(http.MethodPut, "/settings/polling-config", strings.NewReader(string(raw))))
	if w.Code != http.StatusInternalServerError || store.writes != 1 {
		t.Fatalf("PUT database error status=%d, writes=%d", w.Code, store.writes)
	}
}

func TestEndpointControlsRejectUnsupportedCapture(t *testing.T) {
	store := &memoryEndpointControls{config: settingsmodel.DefaultPollingConfig()}
	h := &SettingsHandler{endpointControls: store}
	pc := store.config
	pc.TelemetryCapture = true
	raw, _ := json.Marshal(pc)
	w := httptest.NewRecorder()
	h.UpdatePollingConfig(w, httptest.NewRequest(http.MethodPut, "/settings/polling-config", strings.NewReader(string(raw))))
	if w.Code != http.StatusBadRequest || store.writes != 0 {
		t.Fatalf("unsupported capture status=%d, writes=%d", w.Code, store.writes)
	}
}

func TestEndpointControlsRejectUnknownAndInvalidPollingSelections(t *testing.T) {
	tests := []struct {
		name   string
		change func(*settingsmodel.LegacyPollingConfig)
	}{
		{"unknown route", func(pc *settingsmodel.LegacyPollingConfig) {
			pc.FleetEndpoints = map[string]bool{"unknown.route": true}
		}},
		{"command cannot poll", func(pc *settingsmodel.LegacyPollingConfig) {
			pc.AutoEndpoints = map[string]bool{"command.door_lock": true}
		}},
		{"disabled route cannot poll", func(pc *settingsmodel.LegacyPollingConfig) {
			pc.FleetEndpoints = map[string]bool{"vehicle_data.charge_state": false}
			pc.AutoEndpoints = map[string]bool{"vehicle_data.charge_state": true}
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &memoryEndpointControls{config: settingsmodel.DefaultPollingConfig()}
			pc := store.config
			tt.change(&pc)
			raw, err := json.Marshal(pc)
			if err != nil {
				t.Fatal(err)
			}
			w := httptest.NewRecorder()
			(&SettingsHandler{endpointControls: store}).UpdatePollingConfig(
				w, httptest.NewRequest(http.MethodPut, "/settings/polling-config", strings.NewReader(string(raw))),
			)
			if w.Code != http.StatusBadRequest || store.writes != 0 {
				t.Fatalf("status=%d, writes=%d, body=%s", w.Code, store.writes, w.Body.String())
			}
		})
	}
}
