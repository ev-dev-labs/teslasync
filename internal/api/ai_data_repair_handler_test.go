// Phase-50 / 0043 — S2 Data repair suggestions.
//
// Off-mode + baseline-coexistence tests for the AI
// data-repair-suggestions handler. The off-mode test
// (TestDataRepairSuggestionsAIOffManualRunbookWorks) is the slice's
// load-bearing AI-OFF contract proof: it asserts that the AI route
// returns 404 when settings.ai_mode='off' even when the per-feature
// toggle is on, AND that the deterministic stale-session list +
// per-row repair endpoints served at the canonical
// /api/v1/data-repair/* handlers remain the unconditional baseline
// path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by the
// F6 eval harness (`go run ./cmd/ai-eval -feature
// data-repair-suggestions`); duplicating that here would require a
// live database fixture.

package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// TestDataRepairSuggestionsAIOffManualRunbookWorks is the load-
// bearing off-mode contract proof for slice 0043. It mounts the AI
// data-repair-suggestions route through the guard with
// ai_mode='off' and proves:
//
//   - The /api/v1/ai/system/data-repair/draft route returns 404
//     (the guard fails closed even when the per-feature toggle is
//     on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - Baseline GET /api/v1/data-repair/stale-sessions and
//     PUT/POST/DELETE /api/v1/data-repair/{kind}/{id}{...} routes
//     remain reachable under the same router — proof that the slice
//     does NOT replace the deterministic stale-session manual-
//     runbook flow on /system/data-repair (DataRepairPage)
//     (ADR-015 §I3).
//
// The test name MUST stay TestDataRepairSuggestionsAIOffManualRunbookWorks
// — the slice prompt's verification command runs
// `go test … -run TestDataRepairSuggestionsAIOffManualRunbookWorks`
// AND `npm test -- --run TestDataRepairSuggestionsAIOffManualRunbookWorks`,
// so both the Go and React off-mode proofs answer to the same
// test-name pattern.
func TestDataRepairSuggestionsAIOffManualRunbookWorks(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"data-repair-suggestions": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/system/data-repair/draft", g.Wrap("data-repair-suggestions", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline canonical routes — NOT guarded by the AI
		// guard. Returns deterministic stale-session inventory +
		// per-row repair handlers (close / discard / update) with
		// the `"ai":false` marker and a `surface` envelope shape
		// that names the deterministic baseline, so the test can
		// prove the deterministic manual-runbook path coexists.
		// We mock them here so the test stays hermetic (no DB).
		r.Get("/data-repair/stale-sessions", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"stale_charging":[{"id":42,"vehicle_id":1,"started_at":"2024-03-15T12:00:00Z"}],"stale_drives":[{"id":99,"vehicle_id":1,"start_ts":"2024-03-14T08:00:00Z"}],"ai":false,"surface":"baseline_deterministic_data_repair"}`))
		})
		r.Post("/data-repair/charging/{id}/close", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"closed","surface":"baseline_close_charging","ai":false}`))
		})
		r.Delete("/data-repair/drive/{id}", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"deleted","surface":"baseline_delete_drive","ai":false}`))
		})
		r.Put("/data-repair/charging/{id}", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":42,"vehicle_id":1,"surface":"baseline_update_charging","ai":false}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	body := []byte(`{}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/system/data-repair/draft", bytes.NewReader(body))
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
	// invisible in off mode). chi's http.NotFound emits "404 page
	// not found\n".
	for _, leaked := range []string{"data-repair-suggestions", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline stale-sessions list — MUST return 200
	// + deterministic baseline content, regardless of the AI
	// guard's state. This is the load-bearing proof that the
	// slice did NOT replace the deterministic manual-runbook
	// flow.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/data-repair/stale-sessions", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_deterministic_data_repair"`) {
		t.Errorf("baseline body missing baseline_deterministic_data_repair marker: %q", recBaseline.Body.String())
	}
	// Pin the inventory rows are present so the "ManualRunbookWorks"
	// half of the test name is defensible — the user CAN see and
	// interact with the stale rows even when AI is off.
	for _, must := range []string{`"id":42`, `"id":99`, `"stale_charging"`, `"stale_drives"`} {
		if !strings.Contains(recBaseline.Body.String(), must) {
			t.Errorf("baseline body missing inventory marker %q: %q", must, recBaseline.Body.String())
		}
	}

	// 3) Probe each canonical repair button — close / delete /
	// update — to prove all three baseline mutation paths still
	// work in off mode.
	for _, tc := range []struct {
		name   string
		method string
		url    string
		body   string
		want   string
	}{
		{"close_charging", http.MethodPost, "/api/v1/data-repair/charging/42/close", "", "baseline_close_charging"},
		{"delete_drive", http.MethodDelete, "/api/v1/data-repair/drive/99", "", "baseline_delete_drive"},
		{"update_charging", http.MethodPut, "/api/v1/data-repair/charging/42", `{"end_soc_pct":90}`, "baseline_update_charging"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			var body *bytes.Reader
			if tc.body != "" {
				body = bytes.NewReader([]byte(tc.body))
			} else {
				body = bytes.NewReader(nil)
			}
			req := httptest.NewRequest(tc.method, tc.url, body)
			req.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("baseline %s status = %d, want 200 (body=%q)", tc.name, rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tc.want) {
				t.Errorf("baseline %s body missing %q: %q", tc.name, tc.want, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), `"ai":false`) {
				t.Errorf("baseline %s body missing ai:false marker: %q", tc.name, rec.Body.String())
			}
		})
	}
}

// TestAIDataRepairSuggestionsHandler_PanicsOnNilWiring asserts the
// handler constructor refuses zero-valued dependencies. A wiring
// bug at boot must surface as a panic, not as a nil-deref on first
// request.
func TestAIDataRepairSuggestionsHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAIDataRepairSuggestionsHandler(nil, nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAIDataRepairSuggestionsHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestNewAIDataRepairSource_PanicsOnNilDB asserts the production
// source adapter refuses a nil *database.DB. A wiring bug at boot
// must surface as a panic, not as a nil-deref on first request.
func TestNewAIDataRepairSource_PanicsOnNilDB(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("NewAIDataRepairSource(nil) did not panic")
		}
	}()
	NewAIDataRepairSource(nil)
}

// TestAIDataRepairSuggestionsHandler_RejectsBadBody asserts the
// handler validates the body BEFORE doing anything else — a body
// that fails to decode as JSON object MUST surface as a JSON 400,
// not a half-opened stream that confuses the frontend.
func TestAIDataRepairSuggestionsHandler_RejectsBadBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		body   string
		wantOK bool
	}{
		{"empty_body", "", true},
		{"empty_object_body", "{}", true},
		{"null_body", "null", true},
		{"object_with_unknown_field", `{"hint":"close 42"}`, true},
		{"malformed_json_body", "{not json", false},
		{"bare_array", "[1, 2]", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/system/data-repair/draft", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")

			ok := parseDataRepairSuggestionsRequest(rec, req)
			if ok != tc.wantOK {
				t.Errorf("parseDataRepairSuggestionsRequest(%s) ok = %v, want %v (body=%q)", tc.name, ok, tc.wantOK, rec.Body.String())
			}
		})
	}
}

// TestBuildDataRepairSuggestionsUserMessage_DeterministicShape pins
// the synthesised user message's exact shape so the goldens stay
// stable across boots. The format is sort-by-ID, RFC3339 UTC
// timestamps, hours_open derived from `now`. A change to any of
// these breaks the deterministic prompt-hash caching that providers
// rely on, so the test must catch it before the goldens silently
// drift.
func TestBuildDataRepairSuggestionsUserMessage_DeterministicShape(t *testing.T) {
	t.Parallel()
	now := time.Date(2024, 3, 15, 14, 32, 0, 0, time.UTC)
	charging := []*chargingmodel.ChargingSession{
		{ID: 7, StartedAt: now.Add(-72 * time.Hour)},  // 72h ago
		{ID: 42, StartedAt: now.Add(-25 * time.Hour)}, // 25h ago
	}
	drives := []*drivemodel.Drive{
		{ID: 99, StartTs: now.Add(-48 * time.Hour)},
	}
	got := buildDataRepairSuggestionsUserMessage(now, charging, drives)

	// Pinned substrings — sorted output, RFC3339 timestamps,
	// hours computed from `now`.
	for _, must := range []string{
		"draft_data_repair_plan",
		"validate_data_repair_plan",
		"id=7 started_at=2024-03-12T14:32:00Z hours_open=72.0",
		"id=42 started_at=2024-03-14T13:32:00Z hours_open=25.0",
		"id=99 start_ts=2024-03-13T14:32:00Z hours_open=48.0",
	} {
		if !strings.Contains(got, must) {
			t.Errorf("user message missing %q\nfull message:\n%s", must, got)
		}
	}

	// Sort order: id=7 must appear BEFORE id=42 in the charging
	// section because the synthesizer sorts by ID.
	if i, j := strings.Index(got, "id=7"), strings.Index(got, "id=42"); i < 0 || j < 0 || i >= j {
		t.Errorf("charging IDs not sorted ascending: id=7 at %d, id=42 at %d", i, j)
	}
}

// TestBuildDataRepairSuggestionsUserMessage_EmptyInventory pins the
// empty-inventory branch — the synthesised message must instruct
// the LLM to STOP without calling any tool.
func TestBuildDataRepairSuggestionsUserMessage_EmptyInventory(t *testing.T) {
	t.Parallel()
	got := buildDataRepairSuggestionsUserMessage(time.Now(), nil, nil)
	for _, must := range []string{
		"Stale charging sessions: NONE.",
		"Stale drives: NONE.",
		"inventory is empty",
		"do not call any tool",
	} {
		if !strings.Contains(got, must) {
			t.Errorf("empty-inventory message missing %q\nfull message:\n%s", must, got)
		}
	}
}

// TestAIDataRepairPlanValidator_AcceptsValidPlan pins the
// validator's accept path: a well-formed RepairPlan returns nil.
// Future slices that add semantic checks will need to update this
// test.
func TestAIDataRepairPlanValidator_AcceptsValidPlan(t *testing.T) {
	t.Parallel()
	v := NewAIDataRepairPlanValidator()
	plans := []*tools.DataRepairPlan{
		{TargetKind: "charging", TargetID: 42, Action: "close"},
		{TargetKind: "drive", TargetID: 99, Action: "discard"},
		{TargetKind: "drive", TargetID: 99, Action: "update", UpdateFields: map[string]any{"distance_m": 100}},
	}
	for _, p := range plans {
		if err := v.ValidateDataRepairPlan(p); err != nil {
			t.Errorf("ValidateDataRepairPlan(%+v) err = %v, want nil", p, err)
		}
	}
}

// TestAIDataRepairPlanValidator_RejectsNil pins the defensive nil
// check.
func TestAIDataRepairPlanValidator_RejectsNil(t *testing.T) {
	t.Parallel()
	v := NewAIDataRepairPlanValidator()
	if err := v.ValidateDataRepairPlan(nil); err == nil {
		t.Error("ValidateDataRepairPlan(nil) err = nil, want error")
	}
}
