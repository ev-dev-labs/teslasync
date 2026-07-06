// Synthetic-board handler tests. These exercise the read endpoint
// end-to-end through httptest (and once through chi, mirroring the
// production route wiring in internal/api/router.go) using a
// deterministic in-package Probe double so no real HTTP, DB, or Tesla
// API is touched and every assertion is race-free.

package synthetic

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	synthrun "github.com/ev-dev-labs/teslasync/internal/synthetic"
)

// stubProbe is a deterministic synthrun.Probe test double: it returns a
// fixed error (nil == success) without any I/O, so a runner tick is
// instantaneous and free of sleep-based flakiness.
type stubProbe struct {
	name string
	err  error
}

func (s stubProbe) Name() string                { return s.name }
func (s stubProbe) Run(_ context.Context) error { return s.err }

// runnerWith builds a runner registered with the given probes. The long
// interval keeps the ticker dormant for the test window; the short
// timeout bounds each (instantaneous) stub invocation.
func runnerWith(probes ...synthrun.Probe) *synthrun.Runner {
	return synthrun.NewRunner(probes, time.Hour, time.Second)
}

// runOnce starts the runner — which executes exactly one immediate tick
// before arming its (dormant) ticker — then stops it. Stop blocks until
// the in-flight tick finishes, so on return every probe has recorded
// precisely one outcome. Fully deterministic; no sleeps.
func runOnce(t *testing.T, r *synthrun.Runner) {
	t.Helper()
	r.Start(context.Background())
	r.Stop()
}

const wantContentType = "application/json; charset=utf-8"

func TestNewHandler_NeverNil(t *testing.T) {
	t.Parallel()
	if NewHandler(nil) == nil {
		t.Error("NewHandler(nil) = nil, want non-nil handler that degrades to 503")
	}
	if NewHandler(runnerWith()) == nil {
		t.Error("NewHandler(runner) = nil, want non-nil handler")
	}
}

// TestHandler_Snapshot_StatusMatrix covers the full status surface:
// the nil-receiver guard, the unwired-runner 503, and the two
// configured (empty / populated) success shapes.
func TestHandler_Snapshot_StatusMatrix(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		handler    func() *Handler
		wantStatus int
		wantErr    string // expected "error" body value on 503; "" => success
	}{
		{
			name:       "nil handler pointer",
			handler:    func() *Handler { return nil },
			wantStatus: http.StatusServiceUnavailable,
			wantErr:    "SUBSYSTEM_NOT_CONFIGURED",
		},
		{
			name:       "nil runner",
			handler:    func() *Handler { return NewHandler(nil) },
			wantStatus: http.StatusServiceUnavailable,
			wantErr:    "SUBSYSTEM_NOT_CONFIGURED",
		},
		{
			name:       "empty runner",
			handler:    func() *Handler { return NewHandler(runnerWith()) },
			wantStatus: http.StatusOK,
		},
		{
			name:       "runner with probes",
			handler:    func() *Handler { return NewHandler(runnerWith(stubProbe{name: "canary_ingest"})) },
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			h := tt.handler()
			rec := httptest.NewRecorder()
			h.Snapshot(rec, httptest.NewRequest(http.MethodGet, "/admin/observability/synthetic", nil))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, tt.wantStatus, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); ct != wantContentType {
				t.Errorf("Content-Type = %q, want %q", ct, wantContentType)
			}
			if tt.wantErr == "" {
				return
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("error body not JSON: %v (%s)", err, rec.Body.String())
			}
			if body["error"] != tt.wantErr {
				t.Errorf("error = %q, want %q", body["error"], tt.wantErr)
			}
			// WriteError derives the machine code from the status, so a
			// 503 must carry SERVICE_UNAVAILABLE for the SPA contract.
			if body["code"] != "SERVICE_UNAVAILABLE" {
				t.Errorf("code = %q, want SERVICE_UNAVAILABLE", body["code"])
			}
		})
	}
}

// TestHandler_Snapshot_EmptyRunnerBody pins the empty-board wire shape:
// results MUST serialize as [] (not null) so the SPA can .map() it
// without a null guard, and generated_at MUST be populated.
func TestHandler_Snapshot_EmptyRunnerBody(t *testing.T) {
	t.Parallel()
	h := NewHandler(runnerWith())
	rec := httptest.NewRecorder()
	h.Snapshot(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if raw := rec.Body.String(); !strings.Contains(raw, `"results":[]`) {
		t.Errorf("body = %s, want results encoded as an empty array", raw)
	}

	var snap synthrun.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatalf("body is not a synthrun.Snapshot: %v", err)
	}
	if len(snap.Results) != 0 {
		t.Errorf("Results len = %d, want 0", len(snap.Results))
	}
	if snap.GeneratedAt.IsZero() {
		t.Error("GeneratedAt is zero, want a populated timestamp")
	}
}

// TestHandler_Snapshot_RegisteredProbesPreRun proves the board lists
// every registered probe in its "never run" state before the first
// tick — the SPA relies on this so an operator sees the full canary
// roster immediately after deploy rather than an empty board.
func TestHandler_Snapshot_RegisteredProbesPreRun(t *testing.T) {
	t.Parallel()
	h := NewHandler(runnerWith(
		stubProbe{name: "canary_ingest"},
		stubProbe{name: "canary_readpath"},
	))
	rec := httptest.NewRecorder()
	h.Snapshot(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var snap synthrun.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(snap.Results) != 2 {
		t.Fatalf("Results len = %d, want 2", len(snap.Results))
	}

	byName := make(map[string]synthrun.Result, len(snap.Results))
	for _, res := range snap.Results {
		byName[res.Name] = res
	}
	for _, name := range []string{"canary_ingest", "canary_readpath"} {
		res, ok := byName[name]
		if !ok {
			t.Fatalf("probe %q missing from snapshot", name)
		}
		if res.OK {
			t.Errorf("probe %q OK = true before first run, want false", name)
		}
		if res.TotalRuns != 0 {
			t.Errorf("probe %q TotalRuns = %d before first run, want 0", name, res.TotalRuns)
		}
		if res.Streak != 0 {
			t.Errorf("probe %q Streak = %d before first run, want 0", name, res.Streak)
		}
	}
}

// TestHandler_Snapshot_SurfacesSuccessfulRun verifies the handler
// faithfully surfaces a probe's post-success state (ok/streak/totals).
func TestHandler_Snapshot_SurfacesSuccessfulRun(t *testing.T) {
	t.Parallel()
	r := runnerWith(stubProbe{name: "canary_ingest"})
	runOnce(t, r)
	h := NewHandler(r)

	rec := httptest.NewRecorder()
	h.Snapshot(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	var snap synthrun.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(snap.Results) != 1 {
		t.Fatalf("Results len = %d, want 1", len(snap.Results))
	}
	res := snap.Results[0]
	if res.Name != "canary_ingest" {
		t.Errorf("Name = %q, want canary_ingest", res.Name)
	}
	if !res.OK {
		t.Error("OK = false, want true after a passing run")
	}
	if res.Streak != 1 {
		t.Errorf("Streak = %d, want 1", res.Streak)
	}
	if res.TotalRuns != 1 {
		t.Errorf("TotalRuns = %d, want 1", res.TotalRuns)
	}
	if res.TotalFailed != 0 {
		t.Errorf("TotalFailed = %d, want 0", res.TotalFailed)
	}
	if res.LastError != "" {
		t.Errorf("LastError = %q, want empty", res.LastError)
	}
	if res.LastRunAt.IsZero() {
		t.Error("LastRunAt is zero, want a populated timestamp after a run")
	}
}

// TestHandler_Snapshot_SurfacesFailedRun verifies the handler surfaces a
// probe's failure — including the leaf error message and negative
// streak — so operators can pinpoint a regressed stage from the board.
func TestHandler_Snapshot_SurfacesFailedRun(t *testing.T) {
	t.Parallel()
	r := runnerWith(stubProbe{name: "canary_ingest", err: errors.New("pipeline stalled")})
	runOnce(t, r)
	h := NewHandler(r)

	rec := httptest.NewRecorder()
	h.Snapshot(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	var snap synthrun.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(snap.Results) != 1 {
		t.Fatalf("Results len = %d, want 1", len(snap.Results))
	}
	res := snap.Results[0]
	if res.OK {
		t.Error("OK = true, want false after a failing run")
	}
	if res.Streak != -1 {
		t.Errorf("Streak = %d, want -1", res.Streak)
	}
	if res.TotalRuns != 1 {
		t.Errorf("TotalRuns = %d, want 1", res.TotalRuns)
	}
	if res.TotalFailed != 1 {
		t.Errorf("TotalFailed = %d, want 1", res.TotalFailed)
	}
	if res.LastError != "pipeline stalled" {
		t.Errorf("LastError = %q, want %q", res.LastError, "pipeline stalled")
	}
}

// TestHandler_Snapshot_ViaChiRouter drives the handler through a chi
// router mounted exactly as router.go wires it, proving the method +
// path binding resolves to a 200 with a decodable board.
func TestHandler_Snapshot_ViaChiRouter(t *testing.T) {
	t.Parallel()
	h := NewHandler(runnerWith(stubProbe{name: "canary_ingest"}))
	router := chi.NewRouter()
	router.Get("/admin/observability/synthetic", h.Snapshot)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/admin/observability/synthetic", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	var snap synthrun.Snapshot
	if err := json.Unmarshal(rec.Body.Bytes(), &snap); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(snap.Results) != 1 {
		t.Errorf("Results len = %d, want 1", len(snap.Results))
	}
}

// TestHandler_Snapshot_IgnoresRequestShape documents that the read
// handler is intentionally request-agnostic: it never inspects method,
// query, or body, so any invocation against a configured runner yields
// the same 200 board. (Method restriction is enforced upstream by the
// chi Get binding, verified separately above.)
func TestHandler_Snapshot_IgnoresRequestShape(t *testing.T) {
	t.Parallel()
	h := NewHandler(runnerWith(stubProbe{name: "canary_ingest"}))
	reqs := []*http.Request{
		httptest.NewRequest(http.MethodGet, "/", nil),
		httptest.NewRequest(http.MethodHead, "/admin/observability/synthetic?foo=bar", nil),
		httptest.NewRequest(http.MethodPost, "/anything", strings.NewReader("ignored body")),
	}
	for i, req := range reqs {
		rec := httptest.NewRecorder()
		h.Snapshot(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("req %d (%s %s): status = %d, want 200 (body=%s)",
				i, req.Method, req.URL, rec.Code, rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); ct != wantContentType {
			t.Errorf("req %d: Content-Type = %q, want %q", i, ct, wantContentType)
		}
	}
}
