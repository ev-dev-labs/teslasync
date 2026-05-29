// Phase-50 / 0051 — M3 Software update changelog summarizer.
//
// Off-mode tests prove the AI route fails closed while raw firmware history stays available.
// Streaming coverage lives in the F6 eval harness; duplicating it here would require a live fixture.

package aiswupd

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

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

// TestSoftwareUpdateSummaryAIOffShowsRawChangelogOnly is the slice 0051 off-mode contract proof.
// The name is pinned by Go and React verification commands, so keep it stable.
func TestSoftwareUpdateSummaryAIOffShowsRawChangelogOnly(t *testing.T) {
	t.Parallel()

	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"software-update-changelog-summarizer": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// The guarded handler must not be reached in off mode.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/software-updates/summarize", g.Wrap("software-update-changelog-summarizer", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Mock the baseline firmware-history route so the test stays hermetic while proving raw changelog access.
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
	// Off-mode 404s must not leak provider or feature metadata.
	for _, leaked := range []string{"software-update-changelog-summarizer", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// Baseline firmware history must remain reachable and renderable regardless of AI guard state.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/vehicles/42/software-updates", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	// Pin version entries so the raw changelog claim is testable.
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

// TestHandler_PanicsOnNilWiring proves wiring bugs fail at boot.
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

// TestHandler_RejectsBadBody proves invalid bodies return JSON 400 before SSE starts.
func TestHandler_RejectsBadBody(t *testing.T) {
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

// TestBuildSoftwareUpdateChangelogSummarizerUserMessage pins the scope and honesty directives.
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

// TestNewVehicleSoftwareSource_PanicsOnNilRepo asserts the
// production source constructor refuses a nil repo. Wiring
// bugs surface at boot, not as nil-derefs on first request.
func TestNewVehicleSoftwareSource_PanicsOnNilRepo(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("NewVehicleSoftwareSource(nil) did not panic")
		}
	}()
	NewVehicleSoftwareSource(nil)
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
