package notification

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	notifdispatch "github.com/ev-dev-labs/teslasync/internal/notification"
)

// TestEventTypesHandler_ReturnsSnakeCaseCatalog is the frontend-
// coordination regression test: the Channels UI needs a stable,
// snake_case, self-describing catalog to render toggles without
// hardcoding event_type strings.
func TestEventTypesHandler_ReturnsSnakeCaseCatalog(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/notifications/event-types", nil)
	EventTypesHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var raw []map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode response: %v (body=%s)", err, rec.Body.String())
	}
	if len(raw) != len(notifdispatch.EventCatalog) {
		t.Fatalf("response has %d entries, want %d", len(raw), len(notifdispatch.EventCatalog))
	}

	requiredKeys := []string{"event_type", "component", "transition", "default_enabled", "description"}
	for i, entry := range raw {
		for _, key := range requiredKeys {
			if _, ok := entry[key]; !ok {
				t.Errorf("entry %d missing required snake_case key %q: %+v", i, key, entry)
			}
		}
		// Guard against a camelCase regression (e.g. eventType instead
		// of event_type) slipping back in.
		if _, ok := entry["eventType"]; ok {
			t.Errorf("entry %d has camelCase key eventType; want snake_case event_type only", i)
		}
	}

	// Spot-check the first entry matches the exported constant exactly,
	// so the JSON contract is pinned to the Go source of truth.
	if got := raw[0]["event_type"]; got != notifdispatch.EventTelemetryOutage {
		t.Errorf("first entry event_type = %v, want %q", got, notifdispatch.EventTelemetryOutage)
	}
	if got := raw[0]["transition"]; got != string(notifdispatch.TransitionOutage) {
		t.Errorf("first entry transition = %v, want %q", got, notifdispatch.TransitionOutage)
	}
}
