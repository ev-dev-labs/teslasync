package synthetic

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestJourneyProbe_AllStepsSucceed(t *testing.T) {
	t.Parallel()
	var gotPaths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-Synthetic-Test"); got != "operator-chain" {
			t.Errorf("X-Synthetic-Test = %q, want operator-chain", got)
		}
		gotPaths = append(gotPaths, r.URL.Path+"?"+r.URL.RawQuery)
		switch r.URL.Path {
		case "/api/v1/vehicles/states":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"vehicles": []map[string]any{{"vehicle_id": 42}},
				},
			})
		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	t.Cleanup(srv.Close)

	probe := NewJourneyProbe("operator_chain", srv.URL+"///", OperatorChainJourneySteps(), nil).
		WithHeader("X-Synthetic-Test", "operator-chain")
	if err := probe.Run(context.Background()); err != nil {
		t.Fatalf("Run() error = %v, want nil", err)
	}

	results := probe.LastStepResults()
	if len(results) != 4 {
		t.Fatalf("got %d step results, want 4: %+v", len(results), results)
	}
	for _, r := range results {
		if !r.OK || r.Skipped {
			t.Errorf("step %q: OK=%v Skipped=%v Error=%q, want OK and not skipped", r.Name, r.OK, r.Skipped, r.Error)
		}
	}
	wantOrder := []string{"fleet_state", "vehicle_inspect", "battery_health", "charging_history"}
	for i, name := range wantOrder {
		if results[i].Name != name {
			t.Errorf("step[%d].Name = %q, want %q", i, results[i].Name, name)
		}
	}
	if len(gotPaths) != 4 {
		t.Fatalf("server saw %d requests, want 4: %v", len(gotPaths), gotPaths)
	}
	if gotPaths[1] != "/api/v1/vehicles/42?" {
		t.Errorf("vehicle_inspect path = %q, want /api/v1/vehicles/42", gotPaths[1])
	}
	if gotPaths[2] != "/api/v1/vehicles/42/battery?" {
		t.Errorf("battery_health path = %q, want /api/v1/vehicles/42/battery", gotPaths[2])
	}
	if gotPaths[0] != "/api/v1/vehicles/states?limit=1" {
		t.Errorf("fleet_state path = %q, want /api/v1/vehicles/states?limit=1", gotPaths[0])
	}
	if gotPaths[3] != "/api/v1/charging?vehicle_id=42&limit=1" {
		t.Errorf("charging_history path = %q, want /api/v1/charging?vehicle_id=42&limit=1", gotPaths[3])
	}
}

func TestJourneyProbe_RejectsInvalidFleetVehicleID(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"vehicles":[{"vehicle_id":0}]}}`))
	}))
	t.Cleanup(srv.Close)

	probe := NewJourneyProbe("operator_chain", srv.URL, OperatorChainJourneySteps(), nil)
	if err := probe.Run(context.Background()); err == nil {
		t.Fatal("Run() error = nil, want invalid vehicle_id error")
	}

	results := probe.LastStepResults()
	if len(results) != 1 || results[0].Name != "fleet_state" || results[0].OK {
		t.Fatalf("unexpected results: %+v", results)
	}
}

func TestJourneyProbe_RejectsMissingOrNullFleetMembers(t *testing.T) {
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

			probe := NewJourneyProbe("operator_chain", srv.URL, OperatorChainJourneySteps(), nil)
			if err := probe.Run(context.Background()); err == nil {
				t.Fatalf("body %s was accepted as an empty fleet", body)
			}
			results := probe.LastStepResults()
			if len(results) != 1 || results[0].Name != "fleet_state" || results[0].OK {
				t.Fatalf("unexpected results for body %s: %+v", body, results)
			}
		})
	}
}

func TestJourneyProbe_MissingURLBuilderFailsWithoutPanic(t *testing.T) {
	t.Parallel()
	probe := NewJourneyProbe("chain", "http://example.invalid", []JourneyStep{{Name: "invalid"}}, nil)
	if err := probe.Run(context.Background()); err == nil {
		t.Fatal("Run() error = nil, want missing URL builder error")
	}
}

func TestJourneyProbe_EmptyFleetSkipsDownstreamSteps(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{"vehicles": []map[string]any{}},
		})
	}))
	t.Cleanup(srv.Close)

	probe := NewJourneyProbe("operator_chain", srv.URL, OperatorChainJourneySteps(), nil)
	if err := probe.Run(context.Background()); err != nil {
		t.Fatalf("Run() error = %v, want nil (skip is not a failure)", err)
	}

	results := probe.LastStepResults()
	if !results[0].OK || results[0].Skipped {
		t.Errorf("fleet_state should succeed without skipping, got %+v", results[0])
	}
	for _, name := range []string{"vehicle_inspect", "battery_health", "charging_history"} {
		found := false
		for _, r := range results {
			if r.Name == name {
				found = true
				if !r.Skipped || !r.OK {
					t.Errorf("step %q: want Skipped=true OK=true, got %+v", name, r)
				}
			}
		}
		if !found {
			t.Errorf("missing step %q in results", name)
		}
	}
}

func TestJourneyProbe_AbortsOnFirstFailure(t *testing.T) {
	t.Parallel()
	var callCount int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)

	steps := []JourneyStep{
		{Name: "step1", BuildURL: func(base string, _ *JourneyContext) (string, error) { return base + "/one", nil }},
		{Name: "step2", BuildURL: func(base string, _ *JourneyContext) (string, error) { return base + "/two", nil }},
	}
	probe := NewJourneyProbe("chain", srv.URL, steps, nil)
	err := probe.Run(context.Background())
	if err == nil {
		t.Fatal("Run() error = nil, want an error from step1's 500")
	}
	if callCount != 1 {
		t.Errorf("server received %d requests, want 1 (step2 must not run after step1 fails)", callCount)
	}
	results := probe.LastStepResults()
	if len(results) != 1 || results[0].Name != "step1" || results[0].OK {
		t.Errorf("unexpected results: %+v", results)
	}
}

func TestJourneyProbe_StepTimeoutIsBounded(t *testing.T) {
	t.Parallel()
	block := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-block
	}))
	// Cleanups run LIFO: close(block) MUST run before srv.Close(), or
	// Close() deadlocks forever waiting for the still-blocked handler
	// goroutine to finish its connection.
	t.Cleanup(srv.Close)
	t.Cleanup(func() { close(block) })

	steps := []JourneyStep{
		{
			Name:    "slow",
			Timeout: 50 * time.Millisecond,
			BuildURL: func(base string, _ *JourneyContext) (string, error) {
				return base + "/slow", nil
			},
		},
	}
	probe := NewJourneyProbe("chain", srv.URL, steps, nil)
	start := time.Now()
	err := probe.Run(context.Background())
	elapsed := time.Since(start)
	if err == nil {
		t.Fatal("Run() error = nil, want timeout error")
	}
	if elapsed > 2*time.Second {
		t.Fatalf("step timeout was not bounded: took %v", elapsed)
	}
}

func TestJourneyProbe_ObserverIsCalledPerStep(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	var observed []JourneyStepResult
	steps := []JourneyStep{
		{Name: "a", BuildURL: func(base string, _ *JourneyContext) (string, error) { return base + "/a", nil }},
		{Name: "b", BuildURL: func(base string, _ *JourneyContext) (string, error) { return base + "/b", nil }},
	}
	probe := NewJourneyProbe("chain", srv.URL, steps, nil).WithObserver(func(journey string, step JourneyStepResult) {
		if journey != "chain" {
			t.Errorf("observer journey = %q, want chain", journey)
		}
		observed = append(observed, step)
	})
	if err := probe.Run(context.Background()); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if len(observed) != 2 {
		t.Fatalf("observer called %d times, want 2", len(observed))
	}
}

func TestJourneyProbe_RejectsEmptyBaseURL(t *testing.T) {
	t.Parallel()
	probe := NewJourneyProbe("chain", "", nil, nil)
	if err := probe.Run(context.Background()); err == nil {
		t.Fatal("Run() error = nil, want error for empty base url")
	}
}

func TestRunner_SurfacesStepReporterOnResult(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{"vehicles": []map[string]any{}},
		})
	}))
	t.Cleanup(srv.Close)

	probe := NewJourneyProbe("operator_chain", srv.URL, OperatorChainJourneySteps(), nil)
	r := NewRunner([]Probe{probe}, time.Hour, 5*time.Second)
	r.runAll(context.Background())
	snap := r.Snapshot()
	if len(snap.Results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(snap.Results))
	}
	if len(snap.Results[0].Steps) != 4 {
		t.Fatalf("expected Result.Steps to carry 4 journey steps, got %d: %+v", len(snap.Results[0].Steps), snap.Results[0].Steps)
	}
	snap.Results[0].Steps[0].Name = "mutated"
	if got := r.Snapshot().Results[0].Steps[0].Name; got != "fleet_state" {
		t.Fatalf("Snapshot returned shared step storage: got %q", got)
	}
}
