// AI-off contract tests.
//
// This test is the canonical Go-side proof of ADR-015 §I6 ("off mode
// handlers return 404") for every feature in the registry. It walks
// every Backend route from features.Registry and asserts:
//
//  1. With ai_mode = "off", the wrapped handler returns 404.
//  2. With ai_mode = "local" but the per-feature toggle = false, the
//     wrapped handler still returns 404 (ADR-015 §I7 "per-feature
//     opt-in inside non-off modes").
//  3. With ai_mode = "local" AND the feature toggle = true, the
//     wrapped handler is reached (proving the gate is correctly
//     open in the on case — without this assertion the test could
//     pass by always returning 404).
//
// The test uses a deterministic in-memory fake of the Settings
// interface so it has no DB / network / time dependency.
package guard

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/features"
)

// fakeSettings is the deterministic in-memory Settings fake. mode is
// set per test case; enabled is keyed by feature ID and defaults to
// false (matching ADR-015 §I7).
type fakeSettings struct {
	mode    string
	enabled map[string]bool
	err     error
}

func (f *fakeSettings) AIMode(_ context.Context) (string, error) {
	if f.err != nil {
		return "off", f.err
	}
	if f.mode == "" {
		return "off", nil
	}
	return f.mode, nil
}

func (f *fakeSettings) AIFeatureEnabled(_ context.Context, id string) (bool, error) {
	if f.err != nil {
		return false, f.err
	}
	if f.mode == "off" {
		return false, nil
	}
	return f.enabled[id], nil
}

// reachable is the sentinel handler used to detect when the guard
// passes the request through to the underlying handler.
func reachable(hits *atomic.Int32) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"ok":true}`)
	}
}

// TestGuard_OffModeReturns404 walks every registered feature and
// confirms the guard returns 404 when ai_mode='off'. This is the
// ADR-015 §I6 invariant the final-gate Playwright walk asserts at
// the system level — this test asserts it at the unit level so the
// invariant holds even when the SPA isn't built.
func TestGuard_OffModeReturns404(t *testing.T) {
	g := New(&fakeSettings{mode: "off"})
	hits := &atomic.Int32{}

	for _, id := range features.IDs() {
		f, _ := features.Get(id)
		for _, route := range f.Routes.Backend {
			t.Run(id+"/"+route, func(t *testing.T) {
				method, path := splitRoute(t, route)
				handler := g.Wrap(id, reachable(hits))

				rec := httptest.NewRecorder()
				req := httptest.NewRequest(method, path, nil)
				handler(rec, req)

				if rec.Code != http.StatusNotFound {
					t.Fatalf("ADR-015 §I6: expected 404 in off mode for %s, got %d (body=%q)",
						route, rec.Code, rec.Body.String())
				}
			})
		}
	}

	if got := hits.Load(); got != 0 {
		t.Fatalf("inner handler reached %d times in off mode; ADR-015 §I4 requires zero", got)
	}
}

// TestGuard_PerFeatureOptInRequired covers ADR-015 §I7: even when
// ai_mode is non-off, each feature must be individually opted in
// before its route returns anything other than 404.
func TestGuard_PerFeatureOptInRequired(t *testing.T) {
	// Local mode still requires an explicit per-feature opt-in.
	g := New(&fakeSettings{mode: "local", enabled: map[string]bool{}})
	hits := &atomic.Int32{}

	for _, id := range features.IDs() {
		f, _ := features.Get(id)
		for _, route := range f.Routes.Backend {
			method, path := splitRoute(t, route)
			handler := g.Wrap(id, reachable(hits))

			rec := httptest.NewRecorder()
			req := httptest.NewRequest(method, path, nil)
			handler(rec, req)

			if rec.Code != http.StatusNotFound {
				t.Fatalf("ADR-015 §I7: %s expected 404 when feature toggle off in local mode, got %d",
					route, rec.Code)
			}
		}
	}

	if got := hits.Load(); got != 0 {
		t.Fatalf("inner handler reached %d times with per-feature toggle off", got)
	}
}

// TestGuard_OnPathReachesHandler is the positive control: without it
// the off-mode test could pass simply because the guard always
// returns 404. Pick the canonical chatbot-llm seed feature, enable it,
// and confirm the inner handler runs.
func TestGuard_OnPathReachesHandler(t *testing.T) {
	g := New(&fakeSettings{
		mode:    "local",
		enabled: map[string]bool{"chatbot-llm": true},
	})
	hits := &atomic.Int32{}
	handler := g.Wrap("chatbot-llm", reachable(hits))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/chatbot", nil)
	handler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("on-path: expected 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if hits.Load() != 1 {
		t.Fatalf("on-path: expected inner handler to run exactly once, got %d hits", hits.Load())
	}
}

// TestGuard_FailClosedOnSettingsError covers the contract that any
// settings error resolves to 404 (fail-closed). A flaky DB must not
// open the gate for AI traffic.
func TestGuard_FailClosedOnSettingsError(t *testing.T) {
	g := New(&fakeSettings{err: errors.New("synthetic db outage")})
	hits := &atomic.Int32{}
	handler := g.Wrap("chatbot-llm", reachable(hits))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/chatbot", nil)
	handler(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("fail-closed: expected 404 on settings error, got %d", rec.Code)
	}
	if hits.Load() != 0 {
		t.Fatalf("fail-closed: inner handler must not run on error, got %d hits", hits.Load())
	}
}

// TestGuard_UnknownFeaturePanics covers the boot-time fail-fast
// contract. A typo in the feature ID at router-construction time
// MUST surface as an immediate panic, not as a 404 served to the
// user weeks later.
func TestGuard_UnknownFeaturePanics(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic for unknown feature ID")
		}
	}()
	g := New(&fakeSettings{mode: "local"})
	_ = g.Wrap("definitely-not-a-real-feature", reachable(&atomic.Int32{}))
}

// TestGuard_NewRejectsNilSettings covers the boot-time guard against
// a misconfigured constructor.
func TestGuard_NewRejectsNilSettings(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic when New is called with nil Settings")
		}
	}()
	_ = New(nil)
}

// splitRoute parses "METHOD /path" into ("METHOD", "/path") for use
// with httptest.NewRequest. It fails the test on a malformed entry so
// a future garbled registry entry surfaces as a clear test failure.
func splitRoute(t *testing.T, route string) (method, path string) {
	t.Helper()
	parts := strings.SplitN(route, " ", 2)
	if len(parts) != 2 {
		t.Fatalf("malformed route %q (want %q-format)", route, "METHOD /path")
	}
	return parts[0], parts[1]
}
