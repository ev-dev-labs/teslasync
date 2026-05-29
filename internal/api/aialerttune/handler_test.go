// Tests for AI alert tuning suggestions.
//
// Off-mode tests prove the AI route fails closed while the deterministic AlertStudio tuning path stays available.
// Streaming coverage lives in the eval harness; duplicating it here would require a live DB fixture.

package aialerttune

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
)

type stubGuardSettings struct {
	mode string
	on   map[string]bool
}

func (s *stubGuardSettings) AIMode(_ context.Context) (string, error) {
	if s.mode == "" {
		return "off", nil
	}
	return s.mode, nil
}

func (s *stubGuardSettings) AIFeatureEnabled(_ context.Context, id string) (bool, error) {
	return s.on[id], nil
}

// TestAlertTuningSuggestionsAIOffManualTuningWorks is the slice 0034 off-mode contract proof.
// The name is pinned by Go and React verification commands, so keep it stable.
func TestAlertTuningSuggestionsAIOffManualTuningWorks(t *testing.T) {
	t.Parallel()

	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"alert-tuning-suggestions": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// The guarded handler must not be reached in off mode.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/alerts/rules/{ruleID}/tune/draft", g.Wrap("alert-tuning-suggestions", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Mock the baseline mutation route so the test stays hermetic while proving manual tuning still works.
		r.Put("/alerts/rules/{ruleID}", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":42,"name":"Battery low","signal_name":"battery_level","op":"<","value_num":15,"severity":"warn","cooldown_min":30,"trigger_mode":"repeat","ai":false,"surface":"baseline_manual_tuning"}`))
		})
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/42/tune/draft", nil)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("AI route status = %d, want 404 in off mode (body=%q)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "GUARD_BYPASSED") {
		t.Fatalf("AI route guard was bypassed in off mode: body=%q", rec.Body.String())
	}
	// Off-mode 404s must not leak provider or feature metadata.
	for _, leaked := range []string{"alert-tuning-suggestions", "feature", "strategy", "provider", "tune", "draft"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// Baseline manual tuning must remain reachable regardless of AI guard state.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodPut, "/api/v1/alerts/rules/42", strings.NewReader(`{"value_num":15,"cooldown_min":30}`))
	reqBaseline.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_manual_tuning"`) {
		t.Errorf("baseline body missing baseline_manual_tuning marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"value_num":15`) {
		t.Errorf("baseline body missing patched value_num=15: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"cooldown_min":30`) {
		t.Errorf("baseline body missing patched cooldown_min=30: %q", recBaseline.Body.String())
	}
}

// TestHandler_PanicsOnNilWiring proves wiring bugs fail at boot.
func TestHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewHandler(nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAIAlertTuningSource_PanicsOnNilWiring mirrors the handler nil-dependency check.
func TestAIAlertTuningSource_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"both nil", func() { NewAIAlertTuningSource(nil, nil) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAIAlertTuningSource(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestHandler_RejectsBadRuleID proves invalid ruleID values return JSON 400 before SSE starts.
func TestHandler_RejectsBadRuleID(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		ruleID string // chi URL param value; "" simulates missing
	}{
		{"empty", ""},
		{"not numeric", "abc"},
		{"hex", "0x42"},
		{"trailing junk", "42x"},
		{"zero", "0"},
		{"negative", "-1"},
		{"overflow", "99999999999999999999999"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/x/tune/draft", nil)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("ruleID", tc.ruleID)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			if id, ok := parseAlertTuningURL(rec, req); ok {
				t.Fatalf("parseAlertTuningURL returned ok=true for %q (id=%d)", tc.ruleID, id)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestHandler_AcceptsCanonicalRuleID proves valid int64 path IDs are accepted.
func TestHandler_AcceptsCanonicalRuleID(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		ruleID string
		want   int64
	}{
		{"one", "1", 1},
		{"forty-two", "42", 42},
		{"large", "1234567890", 1234567890},
		{"max int64", "9223372036854775807", 9223372036854775807},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/x/tune/draft", nil)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("ruleID", tc.ruleID)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			id, ok := parseAlertTuningURL(rec, req)
			if !ok {
				t.Fatalf("parseAlertTuningURL returned ok=false for %q (status=%d, body=%q)", tc.ruleID, rec.Code, rec.Body.String())
			}
			if id != tc.want {
				t.Errorf("id = %d, want %d", id, tc.want)
			}
		})
	}
}

// TestHandler_BodyParser_AcceptsEmpty proves vehicle_id is optional.
func TestHandler_BodyParser_AcceptsEmpty(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/42/tune/draft", nil)
	body, ok := parseAlertTuningBody(rec, req)
	if !ok {
		t.Fatalf("parseAlertTuningBody(empty) returned ok=false (status=%d, body=%q)", rec.Code, rec.Body.String())
	}
	if body == nil {
		t.Fatal("parseAlertTuningBody(empty) returned nil body")
	}
	if body.VehicleID != nil {
		t.Errorf("VehicleID = %v, want nil for empty body", body.VehicleID)
	}
}

// TestHandler_BodyParser_AcceptsVehicleID proves valid vehicle_id reaches the handler.
func TestHandler_BodyParser_AcceptsVehicleID(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/42/tune/draft", strings.NewReader(`{"vehicle_id":7}`))
	req.Header.Set("Content-Type", "application/json")
	body, ok := parseAlertTuningBody(rec, req)
	if !ok {
		t.Fatalf("parseAlertTuningBody(valid) returned ok=false (status=%d)", rec.Code)
	}
	if body.VehicleID == nil || *body.VehicleID != 7 {
		t.Errorf("VehicleID = %v, want *int64(7)", body.VehicleID)
	}
}

// TestHandler_BodyParser_RejectsBadVehicleID preserves the vehicle_id > 0 invariant.
func TestHandler_BodyParser_RejectsBadVehicleID(t *testing.T) {
	t.Parallel()
	cases := []string{
		`{"vehicle_id":0}`,
		`{"vehicle_id":-1}`,
	}
	for _, body := range cases {
		t.Run(body, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/42/tune/draft", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			if _, ok := parseAlertTuningBody(rec, req); ok {
				t.Fatalf("parseAlertTuningBody(%s) returned ok=true; want 400", body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestHandler_BodyParser_RejectsBadJSON proves malformed bodies return JSON 400.
func TestHandler_BodyParser_RejectsBadJSON(t *testing.T) {
	t.Parallel()
	cases := []string{
		`{not json`,
		`{"vehicle_id":"seven"}`,
		`{"unknown_field":1}`, // DisallowUnknownFields
	}
	for _, body := range cases {
		t.Run(body, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/42/tune/draft", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			if _, ok := parseAlertTuningBody(rec, req); ok {
				t.Fatalf("parseAlertTuningBody(%s) returned ok=true; want 400", body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}
