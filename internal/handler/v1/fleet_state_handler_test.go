package v1

// Wire-contract + input-validation coverage for GET /api/v1/vehicles/states.
//
// The batch endpoint is the single source of fleet posture for the SPA, so the
// contract these tests pin is deliberately strict: snake_case keys, an
// explicit per-item outcome, provenance on EVERY item, and no internal error
// text on the wire.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/fleetstatesvc"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/service"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type stubRoster struct {
	vehicles []*vehiclemodel.Vehicle
	err      error
}

func (s stubRoster) GetAll(context.Context) ([]*vehiclemodel.Vehicle, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.vehicles, nil
}

type stubResolver struct {
	failFor map[int64]bool
	nilFor  map[int64]bool
}

func (s stubResolver) ResolveCurrentState(
	_ context.Context,
	vehicle *vehiclemodel.Vehicle,
	_ signal.LiveSignalStore,
	now time.Time,
) (service.CurrentState, error) {
	if s.failFor[vehicle.ID] {
		return service.CurrentState{}, errors.New("dsn=postgres://user:hunter2@db:5432 timed out")
	}
	if s.nilFor[vehicle.ID] {
		return service.CurrentState{}, nil
	}
	observed := now.Add(-3 * time.Second)
	return service.CurrentState{
		State: &vehiclemodel.VehicleState{
			VehicleID:    vehicle.ID,
			State:        "charging",
			BatteryLevel: 71,
			IsCharging:   true,
		},
		Live:           true,
		DataSource:     service.DataSourceLiveSignalStore,
		ObservedAt:     &observed,
		Freshness:      service.FreshnessFresh,
		VerifiedFields: []string{"battery_level", "is_charging", "state"},
	}, nil
}

func newFleetStateHandler(vehicles []*vehiclemodel.Vehicle, resolver stubResolver) *FleetStateHandler {
	return NewFleetStateHandler(fleetstatesvc.New(fleetstatesvc.Options{
		Vehicles: stubRoster{vehicles: vehicles},
		Resolver: resolver,
		Now:      func() time.Time { return time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC) },
	}))
}

func doGet(t *testing.T, h *FleetStateHandler, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)
	return rec
}

// decodeBatch unwraps the platform `{data: ...}` envelope into raw maps so the
// assertions read the ACTUAL JSON keys rather than re-using the Go struct
// tags (which would make the contract test tautological).
func decodeBatch(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode body %s: %v", rec.Body.String(), err)
	}
	if envelope.Data == nil {
		t.Fatalf("response carried no data envelope: %s", rec.Body.String())
	}
	return envelope.Data
}

func TestFleetStateHandlerReturnsProvenanceForEveryVehicle(t *testing.T) {
	h := newFleetStateHandler([]*vehiclemodel.Vehicle{{ID: 1}, {ID: 2}}, stubResolver{})
	rec := doGet(t, h, "/api/v1/vehicles/states")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	data := decodeBatch(t, rec)
	for _, key := range []string{"now", "total", "limit", "offset", "counts", "vehicles"} {
		if _, ok := data[key]; !ok {
			t.Fatalf("batch missing snake_case key %q: %v", key, data)
		}
	}
	items, ok := data["vehicles"].([]any)
	if !ok || len(items) != 2 {
		t.Fatalf("vehicles = %v, want 2 items", data["vehicles"])
	}
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("item is not an object: %v", raw)
		}
		for _, key := range []string{
			"vehicle_id", "outcome", "state", "live", "data_source",
			"observed_at", "freshness", "verified_fields",
		} {
			if _, present := item[key]; !present {
				t.Fatalf("item missing provenance key %q: %v", key, item)
			}
		}
		if item["outcome"] != fleetstatesvc.OutcomeResolved {
			t.Fatalf("outcome = %v, want resolved", item["outcome"])
		}
		if item["freshness"] != string(service.FreshnessFresh) {
			t.Fatalf("freshness = %v, want fresh", item["freshness"])
		}
		if _, isArray := item["verified_fields"].([]any); !isArray {
			t.Fatalf("verified_fields = %v, want a JSON array", item["verified_fields"])
		}
	}
}

func TestFleetStateHandlerKeepsPartialFailuresPerItem(t *testing.T) {
	h := newFleetStateHandler(
		[]*vehiclemodel.Vehicle{{ID: 1}, {ID: 2}, {ID: 3}},
		stubResolver{failFor: map[int64]bool{2: true}, nilFor: map[int64]bool{3: true}},
	)
	rec := doGet(t, h, "/api/v1/vehicles/states")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — one bad live read must not fail the fleet read", rec.Code)
	}

	data := decodeBatch(t, rec)
	items := data["vehicles"].([]any)
	outcomes := make([]any, 0, len(items))
	for _, raw := range items {
		outcomes = append(outcomes, raw.(map[string]any)["outcome"])
	}
	want := []any{
		fleetstatesvc.OutcomeResolved,
		fleetstatesvc.OutcomeFailed,
		fleetstatesvc.OutcomeMissing,
	}
	for i := range want {
		if outcomes[i] != want[i] {
			t.Fatalf("outcomes = %v, want %v", outcomes, want)
		}
	}

	failed := items[1].(map[string]any)
	if failed["error"] != fleetstatesvc.ErrCodeStateUnavailable {
		t.Fatalf("error = %v, want the stable code", failed["error"])
	}
	if body := rec.Body.String(); strings.Contains(body, "hunter2") || strings.Contains(body, "postgres://") {
		t.Fatalf("response leaked internals: %s", body)
	}
	if failed["state"] != nil {
		t.Fatalf("failed item state = %v, want null", failed["state"])
	}

	counts := data["counts"].(map[string]any)
	if counts["resolved"] != float64(1) || counts["failed"] != float64(1) || counts["missing"] != float64(1) {
		t.Fatalf("counts = %v, want 1/1/1", counts)
	}
}

func TestFleetStateHandlerRejectsInvalidInput(t *testing.T) {
	h := newFleetStateHandler([]*vehiclemodel.Vehicle{{ID: 1}}, stubResolver{})
	cases := map[string]string{
		"non-numeric id":  "/api/v1/vehicles/states?vehicle_ids=abc",
		"zero id":         "/api/v1/vehicles/states?vehicle_ids=0",
		"negative id":     "/api/v1/vehicles/states?vehicle_ids=-4",
		"limit zero":      "/api/v1/vehicles/states?limit=0",
		"limit over cap":  "/api/v1/vehicles/states?limit=100000",
		"bad limit":       "/api/v1/vehicles/states?limit=many",
		"negative offset": "/api/v1/vehicles/states?offset=-1",
	}
	for name, target := range cases {
		rec := doGet(t, h, target)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, want 400 (body=%s)", name, rec.Code, rec.Body.String())
		}
	}
}

func TestFleetStateHandlerDeduplicatesRequestedIDs(t *testing.T) {
	h := newFleetStateHandler([]*vehiclemodel.Vehicle{{ID: 1}, {ID: 2}}, stubResolver{})
	rec := doGet(t, h, "/api/v1/vehicles/states?vehicle_ids=1,%201,2%20")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	items := decodeBatch(t, rec)["vehicles"].([]any)
	if len(items) != 2 {
		t.Fatalf("items = %d, want 2 after de-duplication", len(items))
	}
}

func TestFleetStateHandlerReports503WhenUnwired(t *testing.T) {
	h := NewFleetStateHandler(fleetstatesvc.New(fleetstatesvc.Options{}))
	rec := doGet(t, h, "/api/v1/vehicles/states")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

func TestFleetStateHandlerReports500OnRosterFailure(t *testing.T) {
	h := NewFleetStateHandler(fleetstatesvc.New(fleetstatesvc.Options{
		Vehicles: stubRoster{err: errors.New("pq: too many connections for role \"teslasync\"")},
		Resolver: stubResolver{},
	}))
	rec := doGet(t, h, "/api/v1/vehicles/states")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if body := rec.Body.String(); strings.Contains(body, "too many connections") {
		t.Fatalf("response leaked the driver error: %s", body)
	}
}

// TestFleetStateRouteResolvesAheadOfTheVehicleIDParam proves the static
// /states segment wins over /{vehicleID} in chi's trie — the exact routing
// conflict that would otherwise turn the batch read into a 400 "invalid
// vehicle ID".
func TestFleetStateRouteResolvesAheadOfTheVehicleIDParam(t *testing.T) {
	h := newFleetStateHandler([]*vehiclemodel.Vehicle{{ID: 1}}, stubResolver{})
	r := chi.NewRouter()
	r.Route("/vehicles", func(r chi.Router) {
		r.Get("/states", h.List)
		r.Get("/{vehicleID}", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusTeapot)
		})
	})

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/vehicles/states", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — /vehicles/states was captured by /{vehicleID}", rec.Code)
	}

	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/vehicles/42", nil))
	if rec.Code != http.StatusTeapot {
		t.Fatalf("status = %d, want the param route still reachable", rec.Code)
	}
}
