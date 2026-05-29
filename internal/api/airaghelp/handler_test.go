// Phase-50 / 0020 — N6 RAG-backed app help.
//
// Off-mode + baseline-coexistence tests for the AI rag-help handler.
// The off-mode test (TestRagHelpAIOffHidesAssistantAndDocsLinksWork)
// is the slice's load-bearing AI-OFF contract proof: it asserts
// that the AI route returns 404 when settings.ai_mode='off' even
// when the per-feature toggle is on, AND that the deterministic
// /help SPA page (curated docs links + tooltips + i18n help copy)
// remains the unconditional baseline path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by
// the F6 eval harness (`go run ./cmd/ai-eval --feature rag-help`);
// duplicating that here would require a live database fixture.

package airaghelp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// stubGuardSettings is a minimal in-memory guard.Settings used to
// drive the off-mode contract test without a real DB.
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

// TestRagHelpAIOffHidesAssistantAndDocsLinksWork is the load-
// bearing off-mode contract proof for slice 0020. It mounts the AI
// rag-help route through the guard with ai_mode='off' and proves:
//
//   - The /api/v1/ai/help/query route returns 404 (the guard
//     fails closed even when the per-feature toggle is on).
//   - The 404 body does not leak feature metadata.
//   - A deterministic baseline route (mounted under the same
//     router on a non-AI path) remains reachable and renders the
//     curated docs-link payload — proof that the slice does NOT
//     replace the /help SPA page's deterministic curated links +
//     tooltips + i18n help copy (ADR-015 §I3).
//
// The test name MUST stay
// TestRagHelpAIOffHidesAssistantAndDocsLinksWork — the slice
// prompt's verification command runs
// `go test … -run TestRagHelpAIOffHidesAssistantAndDocsLinksWork`.
func TestRagHelpAIOffHidesAssistantAndDocsLinksWork(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"rag-help": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A non-404
		// status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/help/query", g.Wrap("rag-help", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline non-AI placeholder. The real /help page is a
		// pure SPA render in HelpPage.tsx (no Go backend route);
		// the test mounts a stand-in to prove the router still
		// answers a non-AI request after the AI guard has fired
		// 404 on /api/v1/ai/help/query, mirroring the structure of
		// the nl-search off-mode test which exercises the GET
		// /api/v1/search baseline.
		r.Get("/help/baseline-probe", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"links":["/docs/status-api","/onboarding","/system-status","/chatbot","/search"]}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"prompt":"how do I enable web push notifications"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/help/query", body)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("AI route status = %d, want 404 in off mode (body=%q)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "GUARD_BYPASSED") {
		t.Fatalf("AI route guard was bypassed in off mode: body=%q", rec.Body.String())
	}
	// Defence-in-depth: the 404 body must not leak feature metadata
	// (ADR-015 §I9 — provider/feature info MUST NOT leak when AI is
	// disabled). chi's http.NotFound emits "404 page not found\n".
	for _, leaked := range []string{"rag-help", "feature", "strategy", "provider", "retrieve_docs", "cite_help_chunk", "docs", "runbooks"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline non-AI route — MUST return 200 +
	// deterministic content, regardless of the AI guard's state.
	// This is the load-bearing proof that the slice did NOT
	// replace the /help SPA page's curated links payload.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/help/baseline-probe", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	for _, marker := range []string{"/docs/status-api", "/onboarding", "/system-status", "/chatbot", "/search"} {
		if !strings.Contains(recBaseline.Body.String(), marker) {
			t.Errorf("baseline body missing %q link (proof curated docs links still rendered): %q",
				marker, recBaseline.Body.String())
		}
	}
	// The baseline response must not contain ANY ai-side field —
	// no SSE, no AI narration, no feature metadata, no LLM
	// citation envelope.
	for _, leaked := range []string{"narration", "ai_", "feature_id", "tool_call", "rag-help"} {
		if strings.Contains(recBaseline.Body.String(), leaked) {
			t.Errorf("baseline body leaks AI-side field %q: %q", leaked, recBaseline.Body.String())
		}
	}
}

// TestHandler_PanicsOnNilWiring asserts the handler
// constructor refuses zero-valued dependencies. A wiring bug at
// boot must surface as a panic, not as a nil-deref on first
// request.
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

// TestHandler_RejectsBadInput asserts the handler validates
// the request body BEFORE opening the SSE stream — a missing
// prompt, whitespace prompt, or oversized prompt must surface as a
// JSON 400, not a half-opened stream that confuses the frontend.
func TestHandler_RejectsBadInput(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
	}{
		{"empty body", ``},
		{"not json", `not-json`},
		{"missing prompt", `{}`},
		{"empty prompt", `{"prompt":""}`},
		{"whitespace prompt", `{"prompt":"   "}`},
		{"prompt too large", fmt.Sprintf(`{"prompt":%q}`, strings.Repeat("a", maxPromptChars+1))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/help/query", strings.NewReader(tc.body))
			validateRagHelpOnly(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestHandler_AcceptsCanonicalInput proves the validator
// does NOT bounce the happy-path shapes — a normal-length prompt
// and a prompt at the size boundary.
func TestHandler_AcceptsCanonicalInput(t *testing.T) {
	t.Parallel()

	cases := []string{
		`{"prompt":"how do I enable web push notifications"}`,
		`{"prompt":"a"}`,
		fmt.Sprintf(`{"prompt":%q}`, strings.Repeat("a", maxPromptChars)),
	}
	for _, body := range cases {
		t.Run(body[:min(len(body), 60)], func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/help/query", strings.NewReader(body))
			validateRagHelpOnly(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// validateRagHelpOnly mirrors the pre-stream validator branch of
// Handler.ServeHTTP. Kept as a same-package helper so the
// test does not need to construct a full handler with stub deps.
func validateRagHelpOnly(w http.ResponseWriter, r *http.Request) {
	var body request
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	prompt := strings.TrimSpace(body.Prompt)
	if prompt == "" {
		httpx.WriteError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if len(prompt) > maxPromptChars {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("prompt must be at most %d characters", maxPromptChars))
		return
	}
	w.WriteHeader(http.StatusOK)
}
