package status

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/resilience"
)

// stubIncidentStore lets the StatusV1 tests assert the snapshot
// includes whatever the store returns, without spinning up a real DB.
type stubIncidentStore struct {
	rows []StatusIncident
	err  error
}

func (s *stubIncidentStore) ListActive(ctx context.Context) ([]StatusIncident, error) {
	return s.rows, s.err
}

func newStatusV1TestHandler(t *testing.T, hm *resilience.HealthMonitor, store StatusIncidentStore) *StatusV1Handler {
	t.Helper()
	return NewStatusV1Handler(StatusV1Config{
		Health:        hm,
		AppVersion:    "test-version",
		IncidentStore: store,
		StartedAt:     time.Now().Add(-5 * time.Minute),
	})
}

func TestStatusV1_Overall_HealthyEmpty(t *testing.T) {
	hm := resilience.NewHealthMonitor()
	h := newStatusV1TestHandler(t, hm, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/status", nil)
	w := httptest.NewRecorder()
	h.Overall(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var snap StatusSnapshot
	if err := json.Unmarshal(w.Body.Bytes(), &snap); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if snap.Status != "operational" {
		t.Fatalf("status = %q, want operational", snap.Status)
	}
	if snap.Version.Build != "test-version" {
		t.Fatalf("version = %q", snap.Version.Build)
	}
	if snap.Incidents == nil {
		t.Fatalf("incidents must be non-nil array")
	}
	if snap.Resources.Goroutines <= 0 {
		t.Fatalf("expected goroutines > 0")
	}
	if snap.Resources.UptimeSeconds < 0 {
		t.Fatalf("uptime should be non-negative, got %f", snap.Resources.UptimeSeconds)
	}
}

func TestStatusV1_Overall_DegradedRollUp(t *testing.T) {
	hm := resilience.NewHealthMonitor()
	hm.Register("db")
	hm.Register("tesla")
	hm.RecordSuccess("db")
	hm.RecordFailure("tesla", nil)
	hm.RecordFailure("tesla", nil)
	hm.RecordFailure("tesla", nil)
	h := newStatusV1TestHandler(t, hm, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/status", nil)
	w := httptest.NewRecorder()
	h.Overall(w, req)
	var snap StatusSnapshot
	_ = json.Unmarshal(w.Body.Bytes(), &snap)
	if snap.Status != "degraded" && snap.Status != "down" {
		t.Fatalf("expected degraded/down, got %q", snap.Status)
	}
	if snap.Counts.ComponentsTotal != 2 {
		t.Fatalf("expected 2 components, got %d", snap.Counts.ComponentsTotal)
	}
	if snap.Counts.ComponentsHealthy != 1 {
		t.Fatalf("expected 1 healthy, got %d", snap.Counts.ComponentsHealthy)
	}
}

func TestStatusV1_Components_ReturnsAllComponents(t *testing.T) {
	hm := resilience.NewHealthMonitor()
	hm.Register("db")
	hm.Register("mqtt")
	hm.RecordSuccess("db")
	hm.RecordSuccess("mqtt")
	h := newStatusV1TestHandler(t, hm, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/status/components", nil)
	w := httptest.NewRecorder()
	h.Components(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var body struct {
		Components []StatusComponent `json:"components"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if len(body.Components) != 2 {
		t.Fatalf("expected 2 components, got %d", len(body.Components))
	}
}

func TestStatusV1_Uptime_ValidatesWindow(t *testing.T) {
	h := newStatusV1TestHandler(t, resilience.NewHealthMonitor(), nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/status/uptime?window=banana", nil)
	w := httptest.NewRecorder()
	h.Uptime(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestStatusV1_Uptime_DefaultWindow(t *testing.T) {
	hm := resilience.NewHealthMonitor()
	hm.Register("db")
	hm.RecordSuccess("db")
	h := newStatusV1TestHandler(t, hm, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/status/uptime", nil)
	w := httptest.NewRecorder()
	h.Uptime(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var body StatusUptimeWindow
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body.Window != "30d" {
		t.Fatalf("expected default window 30d, got %q", body.Window)
	}
	if body.HistoricalSource != "current_snapshot" {
		t.Fatalf("expected current_snapshot disclosure, got %q", body.HistoricalSource)
	}
}

func TestStatusV1_Resources_HasGoVersion(t *testing.T) {
	h := newStatusV1TestHandler(t, resilience.NewHealthMonitor(), nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/status/resources", nil)
	w := httptest.NewRecorder()
	h.Resources(w, req)
	var body struct {
		Resources StatusResources `json:"resources"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body.Resources.GoVersion == "" {
		t.Fatalf("expected go_version to be set")
	}
}

func TestStatusV1_Snapshot_IncludesIncidentsFromStore(t *testing.T) {
	store := &stubIncidentStore{rows: []StatusIncident{
		{ID: "1", Title: "test inc", Status: "investigating", Severity: "minor", StartedAt: time.Now().UTC()},
	}}
	h := newStatusV1TestHandler(t, resilience.NewHealthMonitor(), store)
	snap := h.snapshot(context.Background())
	if len(snap.Incidents) != 1 {
		t.Fatalf("expected 1 incident, got %d", len(snap.Incidents))
	}
	if snap.Incidents[0].Title != "test inc" {
		t.Fatalf("title = %q", snap.Incidents[0].Title)
	}
}

func TestStatusV1_Live_StreamsInitialSnapshot(t *testing.T) {
	SetStatusV1LivePushInterval(50 * time.Millisecond)
	defer SetStatusV1LivePushInterval(0)

	hm := resilience.NewHealthMonitor()
	hm.Register("db")
	hm.RecordSuccess("db")
	h := newStatusV1TestHandler(t, hm, nil)

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/status/live", nil).WithContext(ctx)
	w := httptest.NewRecorder()
	h.Live(w, req)

	body := w.Body.String()
	if !contains(body, "event: status") {
		t.Fatalf("expected `event: status` in stream, got %q", body)
	}
	if !contains(body, "operational") {
		t.Fatalf("expected snapshot status in stream, got %q", body)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
