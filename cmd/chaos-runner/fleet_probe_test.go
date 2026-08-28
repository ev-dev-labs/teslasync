package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestVerifyFleetStateRecovered_ReturnsFirstVehicleID(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/vehicles/states" {
			t.Errorf("path = %q, want /api/v1/vehicles/states", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"vehicles":[{"vehicle_id":7},{"vehicle_id":8}]}}`))
	}))
	t.Cleanup(srv.Close)

	hc := &http.Client{Timeout: time.Second}
	id, err := verifyFleetStateRecovered(context.Background(), hc, srv.URL, nil)
	if err != nil {
		t.Fatalf("verifyFleetStateRecovered() error = %v", err)
	}
	if id != 7 {
		t.Errorf("id = %d, want 7 (first vehicle in the response)", id)
	}
}

func TestVerifyFleetStateRecovered_EmptyFleetIsNotAnError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"vehicles":[]}}`))
	}))
	t.Cleanup(srv.Close)

	hc := &http.Client{Timeout: time.Second}
	id, err := verifyFleetStateRecovered(context.Background(), hc, srv.URL, nil)
	if err != nil {
		t.Fatalf("verifyFleetStateRecovered() error = %v, want nil for an empty (but healthy) fleet", err)
	}
	if id != 0 {
		t.Errorf("id = %d, want 0", id)
	}
}

func TestVerifyFleetStateRecovered_EmptyFleetCannotSatisfyExpectedLiveBatteryEvidence(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"vehicles":[]}}`))
	}))
	t.Cleanup(srv.Close)

	hc := &http.Client{Timeout: time.Second}
	expected := 73
	if _, err := verifyFleetStateRecovered(context.Background(), hc, srv.URL, &expected); err == nil {
		t.Fatal("empty fleet satisfied the required live battery evidence")
	}
}

func TestVerifyFleetStateRecovered_NonOKStatusIsAnError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(srv.Close)

	hc := &http.Client{Timeout: time.Second}
	if _, err := verifyFleetStateRecovered(context.Background(), hc, srv.URL, nil); err == nil {
		t.Fatal("verifyFleetStateRecovered() error = nil, want error for a 503")
	}
}

func TestVerifyFleetStateRecovered_MalformedBodyIsAnError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`not json`))
	}))
	t.Cleanup(srv.Close)

	hc := &http.Client{Timeout: time.Second}
	if _, err := verifyFleetStateRecovered(context.Background(), hc, srv.URL, nil); err == nil {
		t.Fatal("verifyFleetStateRecovered() error = nil, want error for a malformed body")
	}
}

func TestVerifyFleetStateRecovered_InvalidVehicleIDIsAnError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"vehicles":[{"vehicle_id":0}]}}`))
	}))
	t.Cleanup(srv.Close)

	hc := &http.Client{Timeout: time.Second}
	if _, err := verifyFleetStateRecovered(context.Background(), hc, srv.URL, nil); err == nil {
		t.Fatal("verifyFleetStateRecovered() error = nil, want invalid vehicle_id error")
	}
}

func TestVerifyFleetStateRecovered_RejectsMissingOrNullFleetMembers(t *testing.T) {
	t.Parallel()
	for _, body := range []string{
		`null`,
		`{}`,
		`{"data":null}`,
		`{"data":{}}`,
		`{"data":{"vehicles":null}}`,
	} {
		body := body
		t.Run(body, func(t *testing.T) {
			t.Parallel()
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(body))
			}))
			t.Cleanup(srv.Close)

			hc := &http.Client{Timeout: time.Second}
			if _, err := verifyFleetStateRecovered(context.Background(), hc, srv.URL, nil); err == nil {
				t.Fatalf("body %s was accepted as an empty fleet", body)
			}
		})
	}
}

func TestVerifyFleetStateRecovered_RequiresExpectedLiveBatteryEvidence(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"data":{"vehicles":[{
				"vehicle_id":7,
				"state":{"battery_level":73},
				"data_source":"live_signal_store",
				"verified_fields":["battery_level"]
			}]}
		}`))
	}))
	t.Cleanup(srv.Close)

	hc := &http.Client{Timeout: time.Second}
	expected := 73
	id, err := verifyFleetStateRecovered(context.Background(), hc, srv.URL, &expected)
	if err != nil {
		t.Fatalf("verifyFleetStateRecovered() error = %v", err)
	}
	if id != 7 {
		t.Errorf("id = %d, want 7", id)
	}

	wrong := 72
	if _, err := verifyFleetStateRecovered(context.Background(), hc, srv.URL, &wrong); err == nil {
		t.Fatal("mismatched expected battery evidence was accepted")
	}
}

func TestVerifyBatteryRecovered(t *testing.T) {
	t.Parallel()
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	hc := &http.Client{Timeout: time.Second}
	if err := verifyBatteryRecovered(context.Background(), hc, srv.URL, 42); err != nil {
		t.Fatalf("verifyBatteryRecovered() error = %v", err)
	}
	if gotPath != "/api/v1/vehicles/42/battery" {
		t.Errorf("path = %q, want /api/v1/vehicles/42/battery", gotPath)
	}
}

func TestVerifyBatteryRecovered_NonOKStatusIsAnError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)

	hc := &http.Client{Timeout: time.Second}
	if err := verifyBatteryRecovered(context.Background(), hc, srv.URL, 42); err == nil {
		t.Fatal("verifyBatteryRecovered() error = nil, want error for a 500")
	}
}

func TestMakeFleetAwareProbeWithConfig_FullChainRecovered(t *testing.T) {
	t.Parallel()
	var sawHealthz, sawFleetState, sawBattery bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			sawHealthz = true
			w.WriteHeader(http.StatusOK)
		case "/api/v1/vehicles/states":
			sawFleetState = true
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":{"vehicles":[{"vehicle_id":42}]}}`))
		case "/api/v1/vehicles/42/battery":
			sawBattery = true
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)

	cfg := probeConfig{httpTimeout: time.Second, deadline: time.Second, interval: 10 * time.Millisecond}
	probe := makeFleetAwareProbeWithConfig(srv.URL, cfg)
	if err := probe(context.Background()); err != nil {
		t.Fatalf("probe() error = %v, want nil", err)
	}
	if !sawHealthz || !sawFleetState || !sawBattery {
		t.Errorf("probe did not exercise the full chain: healthz=%v fleet_state=%v battery=%v", sawHealthz, sawFleetState, sawBattery)
	}
}

func TestMakeFleetAwareProbeWithConfig_EmptyFleetSkipsBatteryButSucceeds(t *testing.T) {
	t.Parallel()
	var sawBattery bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.WriteHeader(http.StatusOK)
		case "/api/v1/vehicles/states":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":{"vehicles":[]}}`))
		default:
			sawBattery = true
			w.WriteHeader(http.StatusOK)
		}
	}))
	t.Cleanup(srv.Close)

	cfg := probeConfig{httpTimeout: time.Second, deadline: time.Second, interval: 10 * time.Millisecond}
	probe := makeFleetAwareProbeWithConfig(srv.URL, cfg)
	if err := probe(context.Background()); err != nil {
		t.Fatalf("probe() error = %v, want nil for an empty (but healthy) fleet", err)
	}
	if sawBattery {
		t.Error("probe should not have requested a battery report with zero vehicles")
	}
}

func TestMakeFleetAwareProbeWithConfig_FleetStateFailureFailsTheProbe(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}))
	t.Cleanup(srv.Close)

	cfg := probeConfig{httpTimeout: time.Second, deadline: time.Second, interval: 10 * time.Millisecond}
	probe := makeFleetAwareProbeWithConfig(srv.URL, cfg)
	if err := probe(context.Background()); err == nil {
		t.Fatal("probe() error = nil, want error when fleet-state is still 503 after healthz recovers")
	}
}

func TestMakeFleetAwareProbeWithConfig_RetriesTheFullReadPath(t *testing.T) {
	t.Parallel()
	var fleetCalls, batteryCalls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/healthz":
			w.WriteHeader(http.StatusOK)
		case "/api/v1/vehicles/states":
			fleetCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":{"vehicles":[{"vehicle_id":42}]}}`))
		case "/api/v1/vehicles/42/battery":
			if batteryCalls.Add(1) == 1 {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)

	cfg := probeConfig{httpTimeout: time.Second, deadline: time.Second, interval: 10 * time.Millisecond}
	if err := makeFleetAwareProbeWithConfig(srv.URL+"/", cfg)(context.Background()); err != nil {
		t.Fatalf("probe() error = %v, want recovery after retry", err)
	}
	if got := fleetCalls.Load(); got < 2 {
		t.Fatalf("fleet-state calls = %d, want at least 2 to prove the whole chain retried", got)
	}
	if got := batteryCalls.Load(); got != 2 {
		t.Fatalf("battery calls = %d, want 2", got)
	}
}
