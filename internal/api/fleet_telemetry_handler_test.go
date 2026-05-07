package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// Phase-43a / 0002 — tests for the Fleet Telemetry Coverage handler.
//
// The handler is package-derived (router.LoadMap + protomodel.Signals +
// teslaconfig.Builder) and DB-free, so these tests do NOT require a
// database, mqtt client, or tesla client. They exercise the embedded
// routing.yaml directly.

// newFleetTelemetryHandlerForTest builds a Coverage handler with a
// minimal config. The handler does not need any FleetTelemetry-specific
// config values to compute the package-derived snapshot.
func newFleetTelemetryHandlerForTest(t *testing.T) *FleetTelemetryHandler {
	t.Helper()
	cfg := &config.Config{}
	return NewFleetTelemetryHandler(cfg)
}

// TestFleetTelemetryCoverage_HappyPath asserts the handler returns 200
// with a populated, sorted, non-empty coverage response sourced from the
// embedded routing.yaml. This is the contract the frontend
// useFleetTelemetryCoverage hook relies on.
func TestFleetTelemetryCoverage_HappyPath(t *testing.T) {
	h := newFleetTelemetryHandlerForTest(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tesla/fleet-telemetry/coverage", nil)
	rec := httptest.NewRecorder()

	h.Coverage(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want %q", ct, "application/json; charset=utf-8")
	}

	var body coverageResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v (raw=%s)", err, rec.Body.String())
	}

	if len(body.Categories) == 0 {
		t.Fatalf("Categories is empty — embedded routing.yaml is expected to have entries; raw=%s", rec.Body.String())
	}
	if len(body.DestinationTotals) == 0 {
		t.Fatalf("DestinationTotals is empty — embedded routing.yaml is expected to route to multiple destinations; raw=%s", rec.Body.String())
	}

	// Categories must be sorted alphabetically — the handler does this
	// before returning so the frontend can render a stable order. A
	// sort regression here would cause UI flicker.
	for i := 1; i < len(body.Categories); i++ {
		if body.Categories[i-1].Category > body.Categories[i].Category {
			t.Errorf("Categories not sorted: %q before %q",
				body.Categories[i-1].Category, body.Categories[i].Category)
			break
		}
	}

	// Within a category, fields must also be sorted alphabetically.
	// Picking the first non-empty category keeps the test resilient to
	// future routing.yaml additions reordering top-level categories.
	for _, cat := range body.Categories {
		if len(cat.Fields) < 2 {
			continue
		}
		for i := 1; i < len(cat.Fields); i++ {
			if cat.Fields[i-1].Field > cat.Fields[i].Field {
				t.Errorf("category %q: fields not sorted: %q before %q",
					cat.Category, cat.Fields[i-1].Field, cat.Fields[i].Field)
			}
		}
		// TotalFields must equal len(Fields). A drift here means the
		// handler's per-category bookkeeping is broken.
		if cat.TotalFields != len(cat.Fields) {
			t.Errorf("category %q: TotalFields=%d, len(Fields)=%d", cat.Category, cat.TotalFields, len(cat.Fields))
		}
		break
	}
}

// TestFleetTelemetryCoverage_DestinationTotalsCount verifies that
// destination_totals reflects the actual routing.yaml fan-out — at a
// minimum, the signal_log destination must appear because phase-42
// routing covers >100 fields routed there. A regression here would
// surface as a frontend "destinations: { signal_log: 0 }" stat.
func TestFleetTelemetryCoverage_DestinationTotalsCount(t *testing.T) {
	h := newFleetTelemetryHandlerForTest(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tesla/fleet-telemetry/coverage", nil)
	rec := httptest.NewRecorder()
	h.Coverage(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var body coverageResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if got := body.DestinationTotals["signal_log"]; got <= 0 {
		t.Errorf("destination_totals[signal_log] = %d, want > 0 (phase-42 routes >100 fields to signal_log)", got)
	}
}

// TestFleetTelemetryCoverage_JSONShapeMatchesFrontendContract pins the
// camelCase/snake_case keys the frontend hook contract depends on. A
// rename of any of these JSON tags would silently break the
// useFleetTelemetryCoverage hook in production — this test is a
// contract guard.
func TestFleetTelemetryCoverage_JSONShapeMatchesFrontendContract(t *testing.T) {
	h := newFleetTelemetryHandlerForTest(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tesla/fleet-telemetry/coverage", nil)
	rec := httptest.NewRecorder()
	h.Coverage(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var raw map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if _, ok := raw["categories"]; !ok {
		t.Errorf(`top-level key "categories" missing — frontend hook expects it`)
	}
	if _, ok := raw["destination_totals"]; !ok {
		t.Errorf(`top-level key "destination_totals" missing — frontend hook expects it`)
	}

	cats, ok := raw["categories"].([]any)
	if !ok || len(cats) == 0 {
		t.Fatalf(`"categories" is not a non-empty array; got %T`, raw["categories"])
	}
	first, ok := cats[0].(map[string]any)
	if !ok {
		t.Fatalf("first category is not an object; got %T", cats[0])
	}
	for _, key := range []string{"category", "total_fields", "destinations", "fields"} {
		if _, ok := first[key]; !ok {
			t.Errorf(`category object missing key %q (frontend hook contract)`, key)
		}
	}
	fields, ok := first["fields"].([]any)
	if !ok || len(fields) == 0 {
		t.Fatalf(`"fields" is not a non-empty array; got %T`, first["fields"])
	}
	firstField, ok := fields[0].(map[string]any)
	if !ok {
		t.Fatalf("first field is not an object; got %T", fields[0])
	}
	for _, key := range []string{"field", "destination", "subscribed"} {
		if _, ok := firstField[key]; !ok {
			t.Errorf(`field object missing required key %q (frontend hook contract)`, key)
		}
	}
}
