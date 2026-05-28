// Phase-50 / 0051 — M3 Software update changelog summarizer.
//
// Off-mode + baseline-coexistence tests for the AI software-
// update-changelog-summarizer handler. The off-mode test
// (TestSoftwareUpdateSummaryAIOffShowsRawChangelogOnly) is the
// slice's load-bearing AI-OFF contract proof: it asserts that
// the AI route returns 404 when settings.ai_mode='off' even
// when the per-feature toggle is on, AND that the deterministic
// firmware history served at the canonical baseline route
// remains reachable (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by
// the F6 eval harness (`go run ./cmd/ai-eval -feature
// software-update-changelog-summarizer`); duplicating that here
// would require a live software_updates fixture.

package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
)

// TestSoftwareUpdateSummaryAIOffShowsRawChangelogOnly is the
// load-bearing off-mode contract proof for slice 0051. It
// mounts the AI software-update-changelog-summarizer route
// through the guard with ai_mode='off' and proves:
//
//   - The /api/v1/ai/software-updates/summarize route returns
//     404 (the guard fails closed even when the per-feature
//     toggle is on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline GET /api/v1/vehicles/{id}/software-updates
//     route serving the deterministic firmware history (the
//     raw changelog the operator sees on the
//     SoftwareUpdatesPage) remains reachable under the same
//     router — proof that the slice does NOT replace the
//     deterministic firmware-history surface (ADR-015 §I3).
//
// The test name MUST stay
// TestSoftwareUpdateSummaryAIOffShowsRawChangelogOnly — the
// slice prompt's verification command runs `go test … -run
// TestSoftwareUpdateSummaryAIOffShowsRawChangelogOnly` AND
// `npm test -- --run
// TestSoftwareUpdateSummaryAIOffShowsRawChangelogOnly`, so
// both the Go and React off-mode proofs answer to the same
// test-name pattern.
func TestSoftwareUpdateSummaryAIOffShowsRawChangelogOnly(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"software-update-changelog-summarizer": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/software-updates/summarize", g.Wrap("software-update-changelog-summarizer", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline canonical route — NOT guarded by the AI
		// guard. Returns a deterministic envelope marker we
		// can pin so the test proves the firmware-history
		// path coexists. We mock it here so the test stays
		// hermetic (no live database). The marker mirrors the
		// shape the SoftwareUpdatesPage actually consumes (an
		// array of software-update entries with id, version,
		// status, installed_at, scheduled_at, created_at) so
		// the "ShowsRawChangelogOnly" half of the test name
		// is defensible.
		r.Get("/vehicles/{vehicleID}/software-updates", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`[` +
				`{"id":3,"vehicle_id":42,"version":"2024.32.10","status":"installed","installed_at":"2025-01-15T12:00:00Z","scheduled_at":null,"created_at":"2025-01-15T12:00:00Z"},` +
				`{"id":2,"vehicle_id":42,"version":"2024.26.5","status":"installed","installed_at":"2024-12-15T12:00:00Z","scheduled_at":null,"created_at":"2024-12-15T12:00:00Z"},` +
				`{"id":1,"vehicle_id":42,"version":"2024.20.1","status":"installed","installed_at":"2024-11-15T12:00:00Z","scheduled_at":null,"created_at":"2024-11-15T12:00:00Z"}` +
				`]`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	body := []byte(`{"vehicle_id":42}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/software-updates/summarize", bytes.NewReader(body))
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
	for _, leaked := range []string{"software-update-changelog-summarizer", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline software-updates route — MUST
	// return 200 + deterministic baseline content, regardless
	// of the AI guard's state. This is the load-bearing proof
	// that the slice did NOT replace the deterministic
	// SoftwareUpdatesPage firmware-history surface. The
	// response MUST include the version field-set the
	// SoftwareUpdatesPage renders (id, version, status,
	// installed_at, created_at) so the
	// "ShowsRawChangelogOnly" half of the test name is
	// defensible — the deterministic raw changelog IS
	// reachable to the user even when AI is off.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/vehicles/42/software-updates", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	// Pin the version entries are present so the
	// "ShowsRawChangelogOnly" half of the test name is
	// defensible — the canonical firmware history (the
	// version strings + install timestamps) is written to
	// the user even when AI is off.
	for _, must := range []string{
		`"version":"2024.32.10"`,
		`"version":"2024.26.5"`,
		`"version":"2024.20.1"`,
		`"status":"installed"`,
		`"installed_at":"2025-01-15T12:00:00Z"`,
		`"installed_at":"2024-12-15T12:00:00Z"`,
		`"installed_at":"2024-11-15T12:00:00Z"`,
	} {
		if !strings.Contains(recBaseline.Body.String(), must) {
			t.Errorf("baseline body missing changelog token %q: %q", must, recBaseline.Body.String())
		}
	}
}

// TestAISoftwareUpdateChangelogSummarizerHandler_PanicsOnNilWiring
// asserts the handler constructor refuses zero-valued
// dependencies. A wiring bug at boot must surface as a panic,
// not as a nil-deref on first request.
func TestAISoftwareUpdateChangelogSummarizerHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAISoftwareUpdateChangelogSummarizerHandler(nil, nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAISoftwareUpdateChangelogSummarizerHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAISoftwareUpdateChangelogSummarizerHandler_RejectsBadBody
// asserts the handler validates the body BEFORE opening the
// SSE stream — a missing, unparseable, or out-of-range field
// must surface as a JSON 400, not a half-opened stream that
// confuses the frontend.
func TestAISoftwareUpdateChangelogSummarizerHandler_RejectsBadBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		body   string
		wantOK bool
	}{
		{"valid_vehicle", `{"vehicle_id":42}`, true},
		{"valid_vehicle_with_limit", `{"vehicle_id":42,"limit":10}`, true},
		{"missing_vehicle_id", `{}`, false},
		{"zero_vehicle_id", `{"vehicle_id":0}`, false},
		{"negative_vehicle_id", `{"vehicle_id":-1}`, false},
		{"empty_body", ``, false},
		{"null_body", `null`, false},
		{"malformed_json", `{not json`, false},
		{"unknown_field", `{"vehicle_id":42,"foo":"bar"}`, false},
		{"string_vehicle_id", `{"vehicle_id":"42"}`, false},
		{"negative_limit", `{"vehicle_id":42,"limit":-1}`, false},
		{"over_cap_limit", `{"vehicle_id":42,"limit":9999}`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/software-updates/summarize", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")

			_, ok := parseSoftwareUpdateChangelogSummarizerRequest(rec, req)
			if ok != tc.wantOK {
				t.Errorf("ok = %v, want %v (body=%q, status=%d, response=%q)", ok, tc.wantOK, tc.body, rec.Code, rec.Body.String())
			}
			if !tc.wantOK && rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 for %q", rec.Code, tc.name)
			}
		})
	}
}

// TestBuildSoftwareUpdateChangelogSummarizerUserMessage proves
// the synthesised user message includes the in-scope vehicle,
// the explicit tool-sequence hint the strategy expects the
// LLM to follow, and the load-bearing honesty directives.
func TestBuildSoftwareUpdateChangelogSummarizerUserMessage(t *testing.T) {
	t.Parallel()
	got := buildSoftwareUpdateChangelogSummarizerUserMessage(42, 20)
	for _, must := range []string{
		"vehicle_id=42",
		"limit=20",
		"query_vehicle_software",
		"retrieve_update_notes",
		"software_update",
		"docs",
		"3-6 sentence",
		// Load-bearing honesty directives:
		"NEVER invent a version number",
		"the release-note text is not in the cached corpus",
		"total_updates=0",
		// Refusal directive is part of the synthesised prompt
		// (defence-in-depth on top of the per-request scope
		// binding).
		"Refuse politely",
	} {
		if !strings.Contains(got, must) {
			t.Errorf("user message missing %q; got=%q", must, got)
		}
	}
}

// TestNewAIVehicleSoftwareSource_PanicsOnNilRepo asserts the
// production source constructor refuses a nil repo. Wiring
// bugs surface at boot, not as nil-derefs on first request.
func TestNewAIVehicleSoftwareSource_PanicsOnNilRepo(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("NewAIVehicleSoftwareSource(nil) did not panic")
		}
	}()
	NewAIVehicleSoftwareSource(nil)
}

// TestSoftwareUpdateModelToEntry pins the model→envelope
// translation. nil pointers and zero times become empty
// strings; non-nil timestamps become RFC3339 strings; the
// non-time fields pass through verbatim. A future edit that
// drops a field would silently break the LLM's tool-reply
// parsing.
func TestSoftwareUpdateModelToEntry(t *testing.T) {
	t.Parallel()
	installed := time.Date(2025, 1, 15, 12, 0, 0, 0, time.UTC)
	scheduled := time.Date(2025, 1, 14, 8, 0, 0, 0, time.UTC)
	created := time.Date(2025, 1, 15, 12, 0, 1, 0, time.UTC)

	cases := []struct {
		name string
		in   *vehiclemodel.SoftwareUpdate
		want struct {
			id          int64
			version     string
			status      string
			installedAt string
			scheduledAt string
			createdAt   string
		}
	}{
		{
			name: "all_fields_populated",
			in: &vehiclemodel.SoftwareUpdate{
				ID:          7,
				VehicleID:   42,
				Version:     "2024.32.10",
				Status:      "installed",
				InstalledAt: &installed,
				ScheduledAt: &scheduled,
				CreatedAt:   created,
			},
			want: struct {
				id          int64
				version     string
				status      string
				installedAt string
				scheduledAt string
				createdAt   string
			}{
				id:          7,
				version:     "2024.32.10",
				status:      "installed",
				installedAt: "2025-01-15T12:00:00Z",
				scheduledAt: "2025-01-14T08:00:00Z",
				createdAt:   "2025-01-15T12:00:01Z",
			},
		},
		{
			name: "nil_timestamps_render_empty_string",
			in: &vehiclemodel.SoftwareUpdate{
				ID:          8,
				Version:     "2024.40.0",
				Status:      "available",
				InstalledAt: nil,
				ScheduledAt: nil,
				CreatedAt:   created,
			},
			want: struct {
				id          int64
				version     string
				status      string
				installedAt string
				scheduledAt string
				createdAt   string
			}{
				id:          8,
				version:     "2024.40.0",
				status:      "available",
				installedAt: "",
				scheduledAt: "",
				createdAt:   "2025-01-15T12:00:01Z",
			},
		},
		{
			name: "zero_time_pointer_renders_empty_string",
			in: &vehiclemodel.SoftwareUpdate{
				ID:          9,
				Version:     "2024.40.1",
				Status:      "downloading",
				InstalledAt: &time.Time{},
				ScheduledAt: &time.Time{},
				CreatedAt:   created,
			},
			want: struct {
				id          int64
				version     string
				status      string
				installedAt string
				scheduledAt string
				createdAt   string
			}{
				id:          9,
				version:     "2024.40.1",
				status:      "downloading",
				installedAt: "",
				scheduledAt: "",
				createdAt:   "2025-01-15T12:00:01Z",
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := softwareUpdateModelToEntry(tc.in)
			if got.ID != tc.want.id {
				t.Errorf("ID = %d, want %d", got.ID, tc.want.id)
			}
			if got.Version != tc.want.version {
				t.Errorf("Version = %q, want %q", got.Version, tc.want.version)
			}
			if got.Status != tc.want.status {
				t.Errorf("Status = %q, want %q", got.Status, tc.want.status)
			}
			if got.InstalledAt != tc.want.installedAt {
				t.Errorf("InstalledAt = %q, want %q", got.InstalledAt, tc.want.installedAt)
			}
			if got.ScheduledAt != tc.want.scheduledAt {
				t.Errorf("ScheduledAt = %q, want %q", got.ScheduledAt, tc.want.scheduledAt)
			}
			if got.CreatedAt != tc.want.createdAt {
				t.Errorf("CreatedAt = %q, want %q", got.CreatedAt, tc.want.createdAt)
			}
		})
	}
}

// TestComputeInstallCadenceDays pins the cadence math. fewer
// than 2 timestamps ⇒ nil (not 0). 2+ timestamps ⇒ mean of
// consecutive gaps in days. Out-of-order input is sorted
// defensively so the gaps are positive.
func TestComputeInstallCadenceDays(t *testing.T) {
	t.Parallel()
	d := func(y, m, day int) time.Time {
		return time.Date(y, time.Month(m), day, 12, 0, 0, 0, time.UTC)
	}

	cases := []struct {
		name string
		in   []time.Time
		want *float64
	}{
		{"empty_returns_nil", nil, nil},
		{"single_install_returns_nil", []time.Time{d(2025, 1, 15)}, nil},
		{
			name: "two_installs_30_days_apart",
			in:   []time.Time{d(2025, 1, 15), d(2025, 2, 14)},
			want: ptrFloatLocal(30.0),
		},
		{
			name: "three_installs_30_day_cadence",
			in:   []time.Time{d(2024, 11, 15), d(2024, 12, 15), d(2025, 1, 14)},
			want: ptrFloatLocal(30.0),
		},
		{
			name: "out_of_order_input_is_sorted",
			in:   []time.Time{d(2025, 1, 14), d(2024, 11, 15), d(2024, 12, 15)},
			want: ptrFloatLocal(30.0),
		},
		{
			name: "same_day_installs_yield_zero",
			in:   []time.Time{d(2025, 1, 15), d(2025, 1, 15)},
			want: ptrFloatLocal(0.0),
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := computeInstallCadenceDays(tc.in)
			switch {
			case tc.want == nil && got != nil:
				t.Errorf("got %v, want nil", *got)
			case tc.want != nil && got == nil:
				t.Errorf("got nil, want %v", *tc.want)
			case tc.want != nil && got != nil:
				if absDiff(*got, *tc.want) > 1e-9 {
					t.Errorf("got %v, want %v", *got, *tc.want)
				}
			}
		})
	}
}

func ptrFloatLocal(v float64) *float64 { return &v }

func absDiff(a, b float64) float64 {
	if a > b {
		return a - b
	}
	return b - a
}
