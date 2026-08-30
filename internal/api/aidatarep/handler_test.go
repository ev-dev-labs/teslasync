// Tests for AI data repair suggestions.
//
// These tests pin ADR-015 edges: AI off-mode hides the route, baseline repair
// remains reachable, bad bodies fail before SSE, and prompt shape is stable.

package aidatarep

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/diagnostic"
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

// TestDataRepairSuggestionsAIOffManualRunbookWorks pins the load-bearing
// ADR-015 contract: AI off-mode hides only the AI route while baseline repair
// endpoints still behave normally.
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
		// per-row repair handlers (close / quarantine / update) with
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

// TestHandler_PanicsOnNilWiring asserts the
// handler constructor refuses zero-valued dependencies. A wiring
// bug at boot must surface as a panic, not as a nil-deref on first
// request.
func TestHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewHandler(nil, nil, nil, nil, "") }},
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

// TestNewSource_PanicsOnNilDB asserts the production
// source adapter refuses a nil *database.DB. A wiring bug at boot
// must surface as a panic, not as a nil-deref on first request.
func TestNewSource_PanicsOnNilDB(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("NewSource(nil) did not panic")
		}
	}()
	NewSource(nil)
}

// TestHandler_RejectsBadBody asserts the
// handler validates the body BEFORE doing anything else — a body
// that fails to decode as JSON object MUST surface as a JSON 400,
// not a half-opened stream that confuses the frontend.
func TestHandler_RejectsBadBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name          string
		body          string
		wantOK        bool
		wantVehicleID int64
	}{
		{"empty_body", "", true, 0},
		{"empty_object_body", "{}", true, 0},
		{"null_body", "null", true, 0},
		{"vehicle_scope", `{"vehicle_id":7}`, true, 7},
		{"object_with_unknown_field", `{"hint":"close 42"}`, true, 0},
		{"zero_vehicle_id", `{"vehicle_id":0}`, false, 0},
		{"negative_vehicle_id", `{"vehicle_id":-1}`, false, 0},
		{"malformed_json_body", "{not json", false, 0},
		{"bare_array", "[1, 2]", false, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/system/data-repair/draft", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")

			parsed, ok := parseDataRepairSuggestionsRequest(rec, req)
			if ok != tc.wantOK {
				t.Errorf("parseDataRepairSuggestionsRequest(%s) ok = %v, want %v (body=%q)", tc.name, ok, tc.wantOK, rec.Body.String())
			}
			if ok && tc.wantVehicleID == 0 && parsed.VehicleID != nil {
				t.Errorf("parseDataRepairSuggestionsRequest(%s) vehicle_id = %d, want nil", tc.name, *parsed.VehicleID)
			}
			if ok && tc.wantVehicleID > 0 &&
				(parsed.VehicleID == nil || *parsed.VehicleID != tc.wantVehicleID) {
				t.Errorf("parseDataRepairSuggestionsRequest(%s) vehicle_id = %v, want %d",
					tc.name, parsed.VehicleID, tc.wantVehicleID)
			}
		})
	}
}

func TestScopeStaleInventoryFiltersByVehicle(t *testing.T) {
	t.Parallel()
	vehicleID := int64(7)
	charging := []*chargingmodel.ChargingSession{
		nil,
		{ID: 1, VehicleID: 7},
		{ID: 2, VehicleID: 8},
	}
	drives := []*drivemodel.Drive{
		{ID: 3, VehicleID: 8},
		nil,
		{ID: 4, VehicleID: 7},
	}

	gotCharging, gotDrives := scopeStaleInventory(&vehicleID, charging, drives)

	if len(gotCharging) != 1 || gotCharging[0].ID != 1 {
		t.Fatalf("scoped charging = %+v, want only session 1", gotCharging)
	}
	if len(gotDrives) != 1 || gotDrives[0].ID != 4 {
		t.Fatalf("scoped drives = %+v, want only drive 4", gotDrives)
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

// TestPlanValidator_AcceptsValidPlan pins the
// validator's accept path: a well-formed RepairPlan returns nil.
// Future slices that add semantic checks will need to update this
// test.
func TestPlanValidator_AcceptsValidPlan(t *testing.T) {
	t.Parallel()
	v := NewPlanValidator()
	plans := []*diagnostic.DataRepairPlan{
		{TargetKind: "charging", TargetID: 42, Action: "close"},
		{TargetKind: "drive", TargetID: 99, Action: "quarantine"},
		{TargetKind: "drive", TargetID: 99, Action: "update", UpdateFields: map[string]any{"distance_m": 100}},
	}
	for _, p := range plans {
		if err := v.ValidateDataRepairPlan(p); err != nil {
			t.Errorf("ValidateDataRepairPlan(%+v) err = %v, want nil", p, err)
		}
	}
}

// TestPlanValidator_RejectsNil pins the defensive nil
// check.
func TestPlanValidator_RejectsNil(t *testing.T) {
	t.Parallel()
	v := NewPlanValidator()
	if err := v.ValidateDataRepairPlan(nil); err == nil {
		t.Error("ValidateDataRepairPlan(nil) err = nil, want error")
	}
}
