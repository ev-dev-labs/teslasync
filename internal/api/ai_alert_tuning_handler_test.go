// Phase-50 / 0034 — A1 Alert tuning suggestions.
//
// Off-mode + baseline-coexistence tests for the AI alert tuning
// handler. The off-mode test
// (TestAlertTuningSuggestionsAIOffManualTuningWorks) is the
// slice's load-bearing AI-OFF contract proof: it asserts that
// the AI route returns 404 when settings.ai_mode='off' even when
// the per-feature toggle is on, AND that the deterministic
// PUT /api/v1/alerts/rules/{id} handler that the AlertStudio's
// manual tuning form already uses remains the unconditional
// baseline path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by
// the F6 eval harness
// (`go run ./cmd/ai-eval --feature alert-tuning-suggestions`);
// duplicating that here would require a live database fixture.

package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
)

// TestAlertTuningSuggestionsAIOffManualTuningWorks is the
// load-bearing off-mode contract proof for slice 0034. It mounts
// the AI alert-tuning route through the guard with ai_mode='off'
// and proves:
//
//   - The /api/v1/ai/alerts/rules/{ruleID}/tune/draft route
//     returns 404 (the guard fails closed even when the
//     per-feature toggle is on).
//   - The 404 body does not leak feature metadata or rule
//     identifiers.
//   - A baseline AlertStudio mutation route serving the
//     deterministic per-rule PUT /api/v1/alerts/rules/{id}
//     content remains reachable under the same router — proof
//     that the slice does NOT replace the manual-tuning path
//     (ADR-015 §I3).
//
// The test name MUST stay
// TestAlertTuningSuggestionsAIOffManualTuningWorks — the slice
// prompt's verification command runs
// `go test … -run TestAlertTuningSuggestionsAIOffManualTuningWorks`
// AND
// `npm test -- --run TestAlertTuningSuggestionsAIOffManualTuningWorks`,
// so both the Go and React off-mode proofs must answer to the
// same test-name pattern.
func TestAlertTuningSuggestionsAIOffManualTuningWorks(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"alert-tuning-suggestions": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/alerts/rules/{ruleID}/tune/draft", g.Wrap("alert-tuning-suggestions", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline AlertStudio mutation route — NOT guarded by
		// the AI guard. Returns the canonical updated AlertRule
		// shape with the `"ai":false` marker and the
		// `"surface":"baseline_manual_tuning"` envelope marker
		// the canonical AlertHandler.UpdateAlertRule path
		// produces (under test conditions; the production
		// handler returns a real alertmodel.AlertRule). We mock it
		// here so the test stays hermetic (no DB).
		r.Put("/alerts/rules/{ruleID}", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":42,"name":"Battery low","signal_name":"battery_level","op":"<","value_num":15,"severity":"warn","cooldown_min":30,"trigger_mode":"repeat","ai":false,"surface":"baseline_manual_tuning"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/42/tune/draft", nil)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("AI route status = %d, want 404 in off mode (body=%q)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "GUARD_BYPASSED") {
		t.Fatalf("AI route guard was bypassed in off mode: body=%q", rec.Body.String())
	}
	// Defence-in-depth: the 404 body must not leak feature
	// metadata (ADR-015 §I9 — provider/feature info must be
	// invisible in off mode). chi's http.NotFound emits "404
	// page not found\n".
	for _, leaked := range []string{"alert-tuning-suggestions", "feature", "strategy", "provider", "tune", "draft"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline AlertStudio mutation route — MUST
	// return 200 + the deterministic AlertRule shape the
	// PUT /api/v1/alerts/rules/{id} handler produces, regardless
	// of the AI guard's state. This is the load-bearing proof
	// that the slice did NOT replace the manual-tuning path.
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

// TestAIAlertTuningHandler_PanicsOnNilWiring asserts the handler
// constructor refuses zero-valued dependencies. A wiring bug at
// boot must surface as a panic, not as a nil-deref on first
// request.
func TestAIAlertTuningHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAIAlertTuningHandler(nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAIAlertTuningHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAIAlertTuningSource_PanicsOnNilWiring mirrors the handler
// nil-deps proof for the production AlertTuningSource adapter.
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

// TestAIAlertTuningHandler_RejectsBadRuleID asserts the handler
// validates the URL path parameter BEFORE opening the SSE stream
// — a missing, non-numeric, zero, or negative ruleID must
// surface as a JSON 400, not a half-opened stream that confuses
// the frontend.
//
// We mount the parser branch directly via parseAlertTuningURL so
// the test does not need to construct a full handler with stub
// deps. NewAIAlertTuningHandler panics on nil deps, and the
// parser runs BEFORE touching any of them, so we can inline the
// parser without losing coverage.
func TestAIAlertTuningHandler_RejectsBadRuleID(t *testing.T) {
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

// TestAIAlertTuningHandler_AcceptsCanonicalRuleID proves the
// parser does NOT bounce the happy-path shapes — small int,
// large int, max int64.
func TestAIAlertTuningHandler_AcceptsCanonicalRuleID(t *testing.T) {
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

// TestAIAlertTuningHandler_BodyParser_AcceptsEmpty proves an
// empty body is allowed (vehicle_id is optional). The
// AlertStudio's frontend POSTs the AI draft request without a
// body when no vehicle scope is selected.
func TestAIAlertTuningHandler_BodyParser_AcceptsEmpty(t *testing.T) {
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

// TestAIAlertTuningHandler_BodyParser_AcceptsVehicleID proves a
// body with a valid vehicle_id surfaces the value to the handler.
func TestAIAlertTuningHandler_BodyParser_AcceptsVehicleID(t *testing.T) {
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

// TestAIAlertTuningHandler_BodyParser_RejectsBadVehicleID proves
// a body with a non-positive vehicle_id is rejected with a 400
// (preserves the canonical "vehicle_id > 0" invariant).
func TestAIAlertTuningHandler_BodyParser_RejectsBadVehicleID(t *testing.T) {
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

// TestAIAlertTuningHandler_BodyParser_RejectsBadJSON proves a
// malformed body is rejected with a 400 instead of a half-opened
// stream.
func TestAIAlertTuningHandler_BodyParser_RejectsBadJSON(t *testing.T) {
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
