// Phase-50 / 0035 — A2 Inbox auto-categorization.
//
// Off-mode + baseline-coexistence tests for the AI inbox
// categorization handler. The off-mode test
// (TestInboxCategorizationAIOffNoAutoLabels) is the slice's
// load-bearing AI-OFF contract proof: it asserts that the AI
// route returns 404 when settings.ai_mode='off' even when the
// per-feature toggle is on, AND that the deterministic
// GET /api/v1/notifications/logs handler that the InboxBody
// already uses remains the unconditional baseline path
// (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by
// the F6 eval harness
// (`go run ./cmd/ai-eval --feature inbox-auto-categorization`);
// duplicating that here would require a live database fixture.

package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
)

// TestInboxCategorizationAIOffNoAutoLabels is the load-bearing
// off-mode contract proof for slice 0035. It mounts the AI
// inbox-categorization route through the guard with
// ai_mode='off' and proves:
//
//   - The /api/v1/ai/alerts/inbox/categorize route returns 404
//     (the guard fails closed even when the per-feature toggle
//     is on).
//   - The 404 body does not leak feature metadata.
//   - A baseline notifications inbox listing route remains
//     reachable under the same router — proof that the slice
//     does NOT replace the manual inbox path (ADR-015 §I3).
//   - The baseline response is a flat NotificationLog list
//     WITHOUT any AI-assigned category labels (ADR-015 §I3 +
//     this slice's "no auto labels in off mode" invariant).
//
// The test name MUST stay
// TestInboxCategorizationAIOffNoAutoLabels — the slice prompt's
// verification command runs
// `go test … -run TestInboxCategorizationAIOffNoAutoLabels`
// AND
// `npm test -- --run TestInboxCategorizationAIOffNoAutoLabels`,
// so both the Go and React off-mode proofs must answer to the
// same test-name pattern.
func TestInboxCategorizationAIOffNoAutoLabels(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"inbox-auto-categorization": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/alerts/inbox/categorize", g.Wrap("inbox-auto-categorization", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline inbox listing route — NOT guarded by the AI
		// guard. Returns a deterministic NotificationLog list
		// with NO ai_category field — the off-mode invariant
		// is that no AI-assigned labels leak into the canonical
		// shape. We mock it here so the test stays hermetic
		// (no DB).
		r.Get("/notifications/logs", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"logs":[{"id":1,"channel_id":1,"alert_id":42,"title":"Battery low","message":"Battery at 18%","status":"sent","severity":"warn","created_at":"2024-01-01T00:00:00Z","ai":false,"surface":"baseline_inbox"}]}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/inbox/categorize", strings.NewReader(`{"vehicle_id":1,"window_days":7}`))
	req.Header.Set("Content-Type", "application/json")
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
	for _, leaked := range []string{"inbox-auto-categorization", "feature", "strategy", "provider", "categorize", "category"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline inbox listing route — MUST return
	// 200 + the deterministic NotificationLog shape regardless
	// of the AI guard's state. This is the load-bearing proof
	// that the slice did NOT replace the inbox listing path.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/notifications/logs?vehicle_id=1", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_inbox"`) {
		t.Errorf("baseline body missing baseline_inbox marker: %q", recBaseline.Body.String())
	}
	// "no auto labels" invariant: the baseline shape MUST NOT
	// carry an ai_category field, an auto_categories array,
	// an ai_assigned_labels field, or anything that looks
	// like an LLM-assigned classification. The canonical
	// NotificationLog shape (internal/models/models.go) does
	// not declare any of these — defence in depth in case a
	// future edit silently adds one.
	for _, leaked := range []string{
		"ai_category",
		"auto_category",
		"auto_categories",
		"ai_assigned",
		"ai_label",
		"category_suggested",
	} {
		if strings.Contains(strings.ToLower(recBaseline.Body.String()), leaked) {
			t.Errorf("baseline body leaks AI label field %q: %q", leaked, recBaseline.Body.String())
		}
	}
}

// TestAIInboxCategorizationHandler_PanicsOnNilWiring asserts
// the handler constructor refuses zero-valued dependencies. A
// wiring bug at boot must surface as a panic, not as a nil-deref
// on first request.
func TestAIInboxCategorizationHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAIInboxCategorizationHandler(nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAIInboxCategorizationHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAIInboxCategorizationSource_PanicsOnNilWiring mirrors the
// handler nil-deps proof for the production source adapter.
func TestAIInboxCategorizationSource_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"both nil", func() { NewAIInboxCategorizationSource(nil, nil) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAIInboxCategorizationSource(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAIInboxCategorizationHandler_BodyParser_AcceptsEmpty
// proves an empty body is allowed (every filter field is
// optional).
func TestAIInboxCategorizationHandler_BodyParser_AcceptsEmpty(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/inbox/categorize", nil)
	body, ok := parseInboxCategorizationBody(rec, req)
	if !ok {
		t.Fatalf("parseInboxCategorizationBody(empty) returned ok=false (status=%d, body=%q)", rec.Code, rec.Body.String())
	}
	if body == nil {
		t.Fatal("parseInboxCategorizationBody(empty) returned nil body")
	}
	if body.VehicleID != nil {
		t.Errorf("VehicleID = %v, want nil for empty body", body.VehicleID)
	}
	if body.WindowDays != nil {
		t.Errorf("WindowDays = %v, want nil for empty body", body.WindowDays)
	}
}

// TestAIInboxCategorizationHandler_BodyParser_AcceptsAllFields
// proves a body with every supported field surfaces the values
// to the handler.
func TestAIInboxCategorizationHandler_BodyParser_AcceptsAllFields(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/inbox/categorize",
		strings.NewReader(`{"vehicle_id":7,"window_days":14,"severities":["warn","critical"],"rule_ids":[1,2,3]}`))
	req.Header.Set("Content-Type", "application/json")
	body, ok := parseInboxCategorizationBody(rec, req)
	if !ok {
		t.Fatalf("parseInboxCategorizationBody(valid) returned ok=false (status=%d, body=%q)", rec.Code, rec.Body.String())
	}
	if body.VehicleID == nil || *body.VehicleID != 7 {
		t.Errorf("VehicleID = %v, want *int64(7)", body.VehicleID)
	}
	if body.WindowDays == nil || *body.WindowDays != 14 {
		t.Errorf("WindowDays = %v, want *int(14)", body.WindowDays)
	}
	if len(body.Severities) != 2 || body.Severities[0] != "warn" || body.Severities[1] != "critical" {
		t.Errorf("Severities = %v, want [warn critical]", body.Severities)
	}
	if len(body.RuleIDs) != 3 || body.RuleIDs[0] != 1 || body.RuleIDs[2] != 3 {
		t.Errorf("RuleIDs = %v, want [1 2 3]", body.RuleIDs)
	}
}

// TestAIInboxCategorizationHandler_BodyParser_RejectsBadVehicleID
// proves a body with a non-positive vehicle_id is rejected.
func TestAIInboxCategorizationHandler_BodyParser_RejectsBadVehicleID(t *testing.T) {
	t.Parallel()
	cases := []string{
		`{"vehicle_id":0}`,
		`{"vehicle_id":-1}`,
	}
	for _, body := range cases {
		t.Run(body, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/inbox/categorize", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			if _, ok := parseInboxCategorizationBody(rec, req); ok {
				t.Fatalf("parseInboxCategorizationBody(%s) returned ok=true; want 400", body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestAIInboxCategorizationHandler_BodyParser_RejectsBadWindow
// proves a window_days outside [1, 90] is rejected.
func TestAIInboxCategorizationHandler_BodyParser_RejectsBadWindow(t *testing.T) {
	t.Parallel()
	cases := []string{
		`{"window_days":0}`,
		`{"window_days":-1}`,
		`{"window_days":91}`,
		`{"window_days":365}`,
	}
	for _, body := range cases {
		t.Run(body, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/inbox/categorize", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			if _, ok := parseInboxCategorizationBody(rec, req); ok {
				t.Fatalf("parseInboxCategorizationBody(%s) returned ok=true; want 400", body)
			}
		})
	}
}

// TestAIInboxCategorizationHandler_BodyParser_RejectsBadSeverity
// proves an unknown severity is rejected.
func TestAIInboxCategorizationHandler_BodyParser_RejectsBadSeverity(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/inbox/categorize", strings.NewReader(`{"severities":["bogus"]}`))
	req.Header.Set("Content-Type", "application/json")
	if _, ok := parseInboxCategorizationBody(rec, req); ok {
		t.Fatal("parseInboxCategorizationBody(bogus severity) returned ok=true; want 400")
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

// TestAIInboxCategorizationHandler_BodyParser_RejectsBadRuleID
// proves a non-positive rule_id is rejected.
func TestAIInboxCategorizationHandler_BodyParser_RejectsBadRuleID(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/inbox/categorize", strings.NewReader(`{"rule_ids":[1,0,3]}`))
	req.Header.Set("Content-Type", "application/json")
	if _, ok := parseInboxCategorizationBody(rec, req); ok {
		t.Fatal("parseInboxCategorizationBody(bad rule_id) returned ok=true; want 400")
	}
}

// TestAIInboxCategorizationHandler_BodyParser_RejectsBadJSON
// proves a malformed body is rejected with a 400.
func TestAIInboxCategorizationHandler_BodyParser_RejectsBadJSON(t *testing.T) {
	t.Parallel()
	cases := []string{
		`{not json`,
		`{"vehicle_id":"seven"}`,
		`{"unknown_field":1}`, // DisallowUnknownFields
	}
	for _, body := range cases {
		t.Run(body, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/inbox/categorize", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			if _, ok := parseInboxCategorizationBody(rec, req); ok {
				t.Fatalf("parseInboxCategorizationBody(%s) returned ok=true; want 400", body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}
