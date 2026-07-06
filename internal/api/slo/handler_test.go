package slo

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	slopkg "github.com/ev-dev-labs/teslasync/internal/slo"
)

// fakeSnapshotter is an in-package test double for the snapshotter port.
// It records how it was invoked so tests can assert context + catalog
// propagation, and can be primed to return either a snapshot or an error.
type fakeSnapshotter struct {
	snap   *slopkg.Snapshot
	err    error
	calls  int
	gotCtx context.Context
	gotCat *slopkg.Catalog
}

func (f *fakeSnapshotter) Snapshot(ctx context.Context, catalog *slopkg.Catalog) (*slopkg.Snapshot, error) {
	f.calls++
	f.gotCtx = ctx
	f.gotCat = catalog
	if f.err != nil {
		return nil, f.err
	}
	return f.snap, nil
}

// The fake must satisfy the same port the handler consumes.
var _ snapshotter = (*fakeSnapshotter)(nil)

type ctxKey string

const propagationKey ctxKey = "slo-test-propagation"

func sampleCatalog() *slopkg.Catalog {
	return &slopkg.Catalog{Version: 1, SLOs: []slopkg.SLO{{
		Name: "api_availability", Description: "API stays up", Objective: 99.5,
		Window: "30d", Owner: "platform", Tags: []string{"tier1"},
		SLI: slopkg.SLI{GoodEvents: "sum(rate(good[5m]))", ValidEvents: "sum(rate(valid[5m]))"},
	}}}
}

func sloRequest() *http.Request {
	return httptest.NewRequest(http.MethodGet, "/admin/observability/slo", nil)
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode body: %v\nbody=%s", err, rec.Body.String())
	}
	return m
}

// ---------- NewHandler ----------

// The typed-nil trap: NewHandler takes a concrete *slopkg.Tracker, but the
// field is an interface. A nil tracker must leave the interface field nil
// so the Snapshot guard keeps firing — assigning a typed nil pointer would
// make the interface non-nil and quietly break the 503 contract.
func TestNewHandler_FieldWiring(t *testing.T) {
	t.Parallel()
	cat := sampleCatalog()
	tr, err := slopkg.NewTracker("")
	if err != nil {
		t.Fatalf("NewTracker: %v", err)
	}

	cases := []struct {
		name        string
		catalog     *slopkg.Catalog
		tracker     *slopkg.Tracker
		wantCatalog bool
		wantTracker bool
	}{
		{"both wired", cat, tr, true, true},
		{"nil catalog", nil, tr, false, true},
		{"nil tracker", cat, nil, true, false},
		{"both nil", nil, nil, false, false},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			h := NewHandler(c.catalog, c.tracker)
			if h == nil {
				t.Fatal("NewHandler returned nil")
			}
			if (h.catalog != nil) != c.wantCatalog {
				t.Errorf("catalog set = %v, want %v", h.catalog != nil, c.wantCatalog)
			}
			if (h.tracker != nil) != c.wantTracker {
				t.Errorf("tracker set = %v, want %v (typed-nil must NOT be stored)", h.tracker != nil, c.wantTracker)
			}
		})
	}
}

// ---------- 503 SUBSYSTEM_NOT_CONFIGURED guards ----------

func TestSnapshot_ServiceUnavailable(t *testing.T) {
	t.Parallel()
	cat := sampleCatalog()

	cases := []struct {
		name  string
		build func() (*Handler, *fakeSnapshotter)
	}{
		{"nil handler", func() (*Handler, *fakeSnapshotter) { return nil, nil }},
		{"nil catalog", func() (*Handler, *fakeSnapshotter) {
			f := &fakeSnapshotter{snap: &slopkg.Snapshot{}}
			return &Handler{catalog: nil, tracker: f}, f
		}},
		{"nil tracker", func() (*Handler, *fakeSnapshotter) {
			return &Handler{catalog: cat, tracker: nil}, nil
		}},
		{"both nil", func() (*Handler, *fakeSnapshotter) { return &Handler{}, nil }},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			h, fake := c.build()
			rec := httptest.NewRecorder()
			h.Snapshot(rec, sloRequest())

			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want 503 (body=%s)", rec.Code, rec.Body.String())
			}
			body := decodeBody(t, rec)
			if body["error"] != "SUBSYSTEM_NOT_CONFIGURED" {
				t.Errorf("error = %v, want SUBSYSTEM_NOT_CONFIGURED", body["error"])
			}
			if body["code"] != "SERVICE_UNAVAILABLE" {
				t.Errorf("code = %v, want SERVICE_UNAVAILABLE", body["code"])
			}
			if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
				t.Errorf("content-type = %q, want application/json", ct)
			}
			// The tracker must never be consulted once a guard trips.
			if fake != nil && fake.calls != 0 {
				t.Errorf("tracker called %d times, want 0 (guard must short-circuit)", fake.calls)
			}
		})
	}
}

// ---------- 200 success path ----------

func TestSnapshot_Success(t *testing.T) {
	t.Parallel()
	cat := sampleCatalog()
	ratio := 0.999
	budget := 0.8
	fake := &fakeSnapshotter{snap: &slopkg.Snapshot{
		GeneratedAt:   time.Date(2026, 7, 4, 12, 0, 0, 0, time.UTC),
		PromAvailable: true,
		SLOs: []slopkg.Status{{
			Name: "api_availability", Description: "API stays up", Objective: 99.5,
			Window: "30d", Owner: "platform", Tags: []string{"tier1"},
			CurrentRatio: &ratio, ErrorBudgetRemaining: &budget,
			Tiers: []slopkg.TierStatus{
				{Tier: slopkg.Tiers()[0], Threshold: 0.072, Firing: false},
				{Tier: slopkg.Tiers()[1], Threshold: 0.03, Firing: false},
			},
			HighestSeverity: "none",
		}},
	}}
	h := &Handler{catalog: cat, tracker: fake}

	req := sloRequest()
	req = req.WithContext(context.WithValue(req.Context(), propagationKey, "carried"))
	rec := httptest.NewRecorder()
	h.Snapshot(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if fake.calls != 1 {
		t.Fatalf("tracker called %d times, want 1", fake.calls)
	}
	// The handler must forward the exact catalog + request context.
	if fake.gotCat != cat {
		t.Error("handler passed a different catalog pointer to the tracker")
	}
	if fake.gotCtx == nil || fake.gotCtx.Value(propagationKey) != "carried" {
		t.Error("handler did not forward the request context to the tracker")
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("content-type = %q, want application/json; charset=utf-8", ct)
	}

	// Wire-shape: snake_case top-level keys the SPA reads.
	raw := decodeBody(t, rec)
	for _, k := range []string{"generated_at", "slos", "prom_available"} {
		if _, ok := raw[k]; !ok {
			t.Errorf("missing top-level key %q in body=%s", k, rec.Body.String())
		}
	}
	if raw["prom_available"] != true {
		t.Errorf("prom_available = %v, want true", raw["prom_available"])
	}

	// Typed decode to assert values survive marshalling.
	var got slopkg.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("typed decode: %v", err)
	}
	if len(got.SLOs) != 1 {
		t.Fatalf("slos len = %d, want 1", len(got.SLOs))
	}
	s := got.SLOs[0]
	if s.Name != "api_availability" || s.Objective != 99.5 || s.Window != "30d" {
		t.Errorf("slo scalar fields wrong: %+v", s)
	}
	if s.CurrentRatio == nil || *s.CurrentRatio != ratio {
		t.Errorf("current_ratio = %v, want %v", s.CurrentRatio, ratio)
	}
	if s.ErrorBudgetRemaining == nil || *s.ErrorBudgetRemaining != budget {
		t.Errorf("error_budget_remaining = %v, want %v", s.ErrorBudgetRemaining, budget)
	}
	if len(s.Tiers) != 2 {
		t.Errorf("tiers len = %d, want 2", len(s.Tiers))
	}
	if s.HighestSeverity != "none" {
		t.Errorf("highest_severity = %q, want none", s.HighestSeverity)
	}
}

// A 200 with an empty catalog must still emit `"slos":[]` (never null) so
// the SPA's array helpers don't choke.
func TestSnapshot_Success_EmptySLOsMarshalAsArray(t *testing.T) {
	t.Parallel()
	fake := &fakeSnapshotter{snap: &slopkg.Snapshot{
		GeneratedAt:   time.Unix(0, 0).UTC(),
		PromAvailable: false,
		SLOs:          []slopkg.Status{},
	}}
	h := &Handler{catalog: sampleCatalog(), tracker: fake}
	rec := httptest.NewRecorder()
	h.Snapshot(rec, sloRequest())

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"slos":[]`) {
		t.Errorf("body must contain `\"slos\":[]`, got: %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `"slos":null`) {
		t.Errorf("body must not contain `\"slos\":null`, got: %s", rec.Body.String())
	}
}

// ---------- 500 error path ----------

func TestSnapshot_TrackerError(t *testing.T) {
	t.Parallel()
	cat := sampleCatalog()
	fake := &fakeSnapshotter{err: errors.New("prometheus: dial tcp 10.0.0.5:9090: connection refused")}
	h := &Handler{catalog: cat, tracker: fake}
	rec := httptest.NewRecorder()
	h.Snapshot(rec, sloRequest())

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	if fake.calls != 1 {
		t.Errorf("tracker called %d times, want 1", fake.calls)
	}
	body := decodeBody(t, rec)
	if body["code"] != "INTERNAL_ERROR" {
		t.Errorf("code = %v, want INTERNAL_ERROR", body["code"])
	}
	msg, _ := body["error"].(string)
	if msg == "" {
		t.Error("error message must be present")
	}
	// The raw internal error (host/port, driver detail) must not leak.
	if strings.Contains(msg, "connection refused") || strings.Contains(msg, "10.0.0.5") {
		t.Errorf("error message leaks internals: %q", msg)
	}
}

// ---------- integration with the concrete *slopkg.Tracker ----------

// Exercises the production wiring: NewHandler with a real Tracker built
// against an empty base URL (nil Prometheus client) must degrade to a 200
// that carries catalog metadata + a per-SLO "unconfigured" error, so the
// SPA renders a banner instead of a blank panel.
func TestSnapshot_RealTracker_Unconfigured(t *testing.T) {
	t.Parallel()
	cat := sampleCatalog()
	tr, err := slopkg.NewTracker("")
	if err != nil {
		t.Fatalf("NewTracker: %v", err)
	}
	h := NewHandler(cat, tr)
	rec := httptest.NewRecorder()
	h.Snapshot(rec, sloRequest())

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var got slopkg.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.PromAvailable {
		t.Error("prom_available = true, want false when Prometheus unconfigured")
	}
	if len(got.SLOs) != 1 {
		t.Fatalf("slos len = %d, want 1", len(got.SLOs))
	}
	if got.SLOs[0].Name != "api_availability" {
		t.Errorf("slo name = %q, want api_availability", got.SLOs[0].Name)
	}
	if got.SLOs[0].Error == "" {
		t.Error("expected a per-SLO error explaining Prometheus is unconfigured")
	}
}

// Loads the real slo/catalog.yaml through the handler to confirm the
// production catalogue serializes cleanly. Skips (never fails) if the file
// isn't reachable from the test's working directory.
func TestSnapshot_ProductionCatalog(t *testing.T) {
	t.Parallel()
	cat, err := slopkg.LoadCatalog("../../../slo/catalog.yaml")
	if err != nil {
		t.Skipf("production catalog unavailable from test cwd: %v", err)
	}
	tr, err := slopkg.NewTracker("")
	if err != nil {
		t.Fatalf("NewTracker: %v", err)
	}
	h := NewHandler(cat, tr)
	rec := httptest.NewRecorder()
	h.Snapshot(rec, sloRequest())

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var got slopkg.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.SLOs) == 0 {
		t.Error("expected at least one SLO from the production catalog")
	}
}
