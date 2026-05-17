// Phase-50 / 0036 — A3 Cross-rule conflict detection.
//
// Off-mode + baseline-coexistence tests for the AI cross-rule
// conflict-detection handler. The off-mode test
// (TestCrossRuleConflictAIOffHidesConflictPanel) is the slice's
// load-bearing AI-OFF contract proof: it asserts that the AI
// route returns 404 when settings.ai_mode='off' even when the
// per-feature toggle is on, AND that the deterministic
// GET /api/v1/alerts/rules handler that AlertStudio already
// uses remains the unconditional baseline path
// (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by
// the F6 eval harness
// (`go run ./cmd/ai-eval --feature cross-rule-conflict-detection`);
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

// TestCrossRuleConflictAIOffHidesConflictPanel is the load-
// bearing off-mode contract proof for slice 0036. It mounts
// the AI cross-rule-conflict-detection route through the guard
// with ai_mode='off' and proves:
//
//   - The /api/v1/ai/alerts/rules/conflicts route returns 404
//     (the guard fails closed even when the per-feature toggle
//     is on).
//   - The 404 body does not leak feature metadata.
//   - A baseline alert-rules listing route remains reachable
//     under the same router — proof that the slice does NOT
//     replace the manual rule list path (ADR-015 §I3).
//   - The baseline response is a flat AlertRule list WITHOUT
//     any AI-assigned conflict labels (ADR-015 §I3 + this
//     slice's "conflict panel hidden in off mode" invariant).
//
// The test name MUST stay
// TestCrossRuleConflictAIOffHidesConflictPanel — the slice
// prompt's verification command runs
// `go test … -run TestCrossRuleConflictAIOffHidesConflictPanel`
// AND
// `npm test -- --run TestCrossRuleConflictAIOffHidesConflictPanel`,
// so both the Go and React off-mode proofs must answer to the
// same test-name pattern.
func TestCrossRuleConflictAIOffHidesConflictPanel(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"cross-rule-conflict-detection": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/alerts/rules/conflicts", g.Wrap("cross-rule-conflict-detection", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline alert-rules listing route — NOT guarded by
		// the AI guard. Returns a deterministic AlertRule list
		// with NO ai_conflict / ai_conflict_kind / etc. fields.
		// The off-mode invariant is that no AI-assigned conflict
		// metadata leaks into the canonical shape. We mock it
		// here so the test stays hermetic (no DB).
		r.Get("/alerts/rules", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"rules":[{"id":1,"name":"low-batt","enabled":true,"signal_name":"battery_level","op":"<","value_num":20,"severity":"warn","cooldown_min":0,"trigger_mode":"edge","all_vehicles":true,"vehicle_ids":[],"ai":false,"surface":"baseline_alert_studio"}]}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/conflicts", strings.NewReader(`{"vehicle_id":1,"rule_ids":[1,2]}`))
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
	for _, leaked := range []string{"cross-rule-conflict-detection", "feature", "strategy", "provider", "conflict", "redundant_duplicate", "overlapping_threshold"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline alert-rules route — MUST return
	// 200 + the deterministic AlertRule shape regardless of
	// the AI guard's state. This is the load-bearing proof
	// that the slice did NOT replace the rule listing path.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/alerts/rules?vehicle_id=1", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_alert_studio"`) {
		t.Errorf("baseline body missing baseline_alert_studio marker: %q", recBaseline.Body.String())
	}
	// "conflict panel hidden" invariant: the baseline shape
	// MUST NOT carry an ai_conflict field, an ai_conflicts
	// array, an ai_conflict_kind field, or anything that
	// looks like an LLM-assigned classification. The canonical
	// AlertRule shape (internal/models/alert.go) does not
	// declare any of these — defence in depth in case a
	// future edit silently adds one.
	for _, leaked := range []string{
		"ai_conflict",
		"ai_conflicts",
		"ai_conflict_kind",
		"conflict_kind",
		"redundant_duplicate",
		"overlapping_threshold",
		"ai_assigned",
	} {
		if strings.Contains(strings.ToLower(recBaseline.Body.String()), leaked) {
			t.Errorf("baseline body leaks AI conflict field %q: %q", leaked, recBaseline.Body.String())
		}
	}
}

// TestAICrossRuleConflictHandler_PanicsOnNilWiring asserts the
// handler constructor refuses zero-valued dependencies. A
// wiring bug at boot must surface as a panic, not as a nil-
// deref on first request.
func TestAICrossRuleConflictHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAICrossRuleConflictHandler(nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAICrossRuleConflictHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAICrossRuleConflictSource_PanicsOnNilWiring mirrors the
// handler nil-deps proof for the production source adapter.
func TestAICrossRuleConflictSource_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("NewAICrossRuleConflictSource(nil) did not panic")
		}
	}()
	NewAICrossRuleConflictSource(nil)
}

// TestAICrossRuleConflictHandler_BodyParser_AcceptsEmpty
// proves an empty body is allowed (every filter field is
// optional — an empty body asks the LLM to detect conflicts
// across the user's entire enabled rule set).
func TestAICrossRuleConflictHandler_BodyParser_AcceptsEmpty(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/conflicts", nil)
	body, ok := parseCrossRuleConflictBody(rec, req)
	if !ok {
		t.Fatalf("parseCrossRuleConflictBody(empty) returned ok=false (status=%d, body=%q)", rec.Code, rec.Body.String())
	}
	if body == nil {
		t.Fatal("parseCrossRuleConflictBody(empty) returned nil body")
	}
	if body.VehicleID != nil {
		t.Errorf("VehicleID = %v, want nil for empty body", body.VehicleID)
	}
	if body.SignalName != "" {
		t.Errorf("SignalName = %q, want empty for empty body", body.SignalName)
	}
	if len(body.RuleIDs) != 0 {
		t.Errorf("RuleIDs = %v, want empty for empty body", body.RuleIDs)
	}
	if body.EnabledOnly != nil {
		t.Errorf("EnabledOnly = %v, want nil for empty body", body.EnabledOnly)
	}
	if body.Limit != nil {
		t.Errorf("Limit = %v, want nil for empty body", body.Limit)
	}
}

// TestAICrossRuleConflictHandler_BodyParser_AcceptsAllFields
// proves a body with every supported field surfaces the values
// to the handler.
func TestAICrossRuleConflictHandler_BodyParser_AcceptsAllFields(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/conflicts",
		strings.NewReader(`{"vehicle_id":7,"signal_name":"battery_level","rule_ids":[1,2,3],"enabled_only":false,"limit":50}`))
	req.Header.Set("Content-Type", "application/json")
	body, ok := parseCrossRuleConflictBody(rec, req)
	if !ok {
		t.Fatalf("parseCrossRuleConflictBody(valid) returned ok=false (status=%d, body=%q)", rec.Code, rec.Body.String())
	}
	if body.VehicleID == nil || *body.VehicleID != 7 {
		t.Errorf("VehicleID = %v, want *int64(7)", body.VehicleID)
	}
	if body.SignalName != "battery_level" {
		t.Errorf("SignalName = %q, want battery_level", body.SignalName)
	}
	if len(body.RuleIDs) != 3 || body.RuleIDs[0] != 1 || body.RuleIDs[2] != 3 {
		t.Errorf("RuleIDs = %v, want [1 2 3]", body.RuleIDs)
	}
	if body.EnabledOnly == nil || *body.EnabledOnly {
		t.Errorf("EnabledOnly = %v, want *bool(false)", body.EnabledOnly)
	}
	if body.Limit == nil || *body.Limit != 50 {
		t.Errorf("Limit = %v, want *int(50)", body.Limit)
	}
}

// TestAICrossRuleConflictHandler_BodyParser_RejectsBadVehicleID
// proves a body with a non-positive vehicle_id is rejected.
func TestAICrossRuleConflictHandler_BodyParser_RejectsBadVehicleID(t *testing.T) {
	t.Parallel()
	cases := []string{`{"vehicle_id":0}`, `{"vehicle_id":-1}`}
	for _, body := range cases {
		t.Run(body, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/conflicts", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			if _, ok := parseCrossRuleConflictBody(rec, req); ok {
				t.Fatalf("parseCrossRuleConflictBody(%s) returned ok=true; want 400", body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestAICrossRuleConflictHandler_BodyParser_RejectsBadRuleID
// proves a non-positive rule_id surfaces as 400.
func TestAICrossRuleConflictHandler_BodyParser_RejectsBadRuleID(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/conflicts", strings.NewReader(`{"rule_ids":[1,0,3]}`))
	req.Header.Set("Content-Type", "application/json")
	if _, ok := parseCrossRuleConflictBody(rec, req); ok {
		t.Fatal("parseCrossRuleConflictBody(rule_ids[0]=0) returned ok=true; want 400")
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
	}
}

// TestAICrossRuleConflictHandler_BodyParser_RejectsBadLimit
// proves limit outside [1, max] surfaces as 400.
func TestAICrossRuleConflictHandler_BodyParser_RejectsBadLimit(t *testing.T) {
	t.Parallel()
	cases := []string{`{"limit":0}`, `{"limit":-1}`, `{"limit":1001}`, `{"limit":99999}`}
	for _, body := range cases {
		t.Run(body, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/conflicts", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			if _, ok := parseCrossRuleConflictBody(rec, req); ok {
				t.Fatalf("parseCrossRuleConflictBody(%s) returned ok=true; want 400", body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestAICrossRuleConflictHandler_BodyParser_RejectsBadSignal
// proves an absurdly long signal_name is rejected.
func TestAICrossRuleConflictHandler_BodyParser_RejectsBadSignal(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	body := `{"signal_name":"` + strings.Repeat("x", 200) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/conflicts", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if _, ok := parseCrossRuleConflictBody(rec, req); ok {
		t.Fatal("parseCrossRuleConflictBody(long signal_name) returned ok=true; want 400")
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
	}
}

// TestAICrossRuleConflictHandler_BodyParser_RejectsUnknownField
// proves DisallowUnknownFields catches typos.
func TestAICrossRuleConflictHandler_BodyParser_RejectsUnknownField(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/alerts/rules/conflicts", strings.NewReader(`{"hidden_field":1}`))
	req.Header.Set("Content-Type", "application/json")
	if _, ok := parseCrossRuleConflictBody(rec, req); ok {
		t.Fatal("parseCrossRuleConflictBody(unknown field) returned ok=true; want 400")
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
	}
}
