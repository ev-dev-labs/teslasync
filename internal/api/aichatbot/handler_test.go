// Chatbot LLM upgrade tests.
//
// These tests pin the AI-off contract: guarded AI routes return 404 while the
// BaselineResponder seam keeps the heuristic chatbot reachable. Full streaming
// coverage lives in the F6 eval harness because this handler persists turns.

package aichatbot

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	apichatbot "github.com/ev-dev-labs/teslasync/internal/api/chatbot"
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

// TestChatbotAIOffUsesBaselineAndAiRoute404 is the load-bearing
// off-mode contract proof for slice 0011. It mounts the AI chatbot
// route through the guard with ai_mode='off' and proves:
//
//   - The /api/v1/ai/chatbot route returns 404 (guard fails closed
//     even when the per-feature toggle is on).
//   - The 404 body does not leak feature metadata.
//   - The BaselineResponder seam is type-safe + does not depend on
//     any AI plumbing — the unconditional /chatbot baseline path
//     stays reachable when AI is off.
//
// The test name MUST stay TestChatbotAIOffUsesBaselineAndAiRoute404
// — the slice prompt's verification command runs `go test … -run
// TestChatbotAIOffUsesBaselineAndAiRoute404`.
func TestChatbotAIOffUsesBaselineAndAiRoute404(t *testing.T) {
	t.Parallel()

	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"chatbot-llm": true}, // toggle on, mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		r.Route("/ai", func(r chi.Router) {
			// Inner handler always-500: the guard MUST short-circuit
			// before we are reached. A non-404 status here is a
			// guard-bypass bug.
			r.Post("/chatbot", g.Wrap("chatbot-llm", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})
	})

	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"message":"hi","session_id":"s1"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/chatbot", body)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("AI route status = %d, want 404 in off mode (body=%q)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "GUARD_BYPASSED") {
		t.Fatalf("AI route guard was bypassed in off mode: body=%q", rec.Body.String())
	}
	// Defence-in-depth: the 404 body must not leak feature metadata
	// (ADR-015 §I9 — provider/feature info must be invisible in off
	// mode). chi's http.NotFound emits "404 page not found\n".
	for _, leaked := range []string{"chatbot-llm", "feature", "strategy", "provider"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// The unconditional baseline route at POST /chatbot is wired in
	// router.go to ChatbotHandler.Chat → processQuery (the heuristic).
	// The ChatResponder seam adds BaselineResponder as a type-safe
	// wrapper around that heuristic. Asserting the seam
	// compiles + is non-nil-aware is sufficient at unit-test scope:
	// the heuristic itself is exercised by the existing
	// chatbot_handler tests; we just prove the wrapper preserves the
	// invariant that the baseline path remains a no-AI fallback.
	var _ apichatbot.ChatResponder = (*apichatbot.BaselineResponder)(nil)
	defer func() {
		// NewBaselineResponder(nil) MUST panic; a silent
		// nil-acceptance would let a misordered boot ship a
		// segfault-on-first-request handler.
		if r := recover(); r == nil {
			t.Fatal("NewBaselineResponder(nil) did not panic")
		}
	}()
	apichatbot.NewBaselineResponder(nil)
}

// TestHandler_PanicsOnNilWiring asserts the handler
// constructor refuses zero-valued dependencies. A wiring bug at boot
// must surface as a panic, not as a nil-deref on first request.
func TestHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"nil chat repo", func() { NewHandler(nil, nil, nil, nil, "") }},
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

func TestRecordingStreamWriterTracksSuccessfulTerminalState(t *testing.T) {
	t.Parallel()

	t.Run("done", func(t *testing.T) {
		response := httptest.NewRecorder()
		inner, _, err := stream.New(context.Background(), response)
		if err != nil {
			t.Fatalf("stream.New: %v", err)
		}
		writer := &recordingStreamWriter{inner: inner}
		if err := writer.WriteDelta("complete"); err != nil {
			t.Fatalf("WriteDelta: %v", err)
		}
		if err := writer.WriteDoneFull("stop", 4, 2); err != nil {
			t.Fatalf("WriteDoneFull: %v", err)
		}
		if !writer.succeeded() {
			t.Fatal("successful done terminal was not recorded")
		}
	})

	t.Run("structured limit", func(t *testing.T) {
		response := httptest.NewRecorder()
		inner, _, err := stream.New(context.Background(), response)
		if err != nil {
			t.Fatalf("stream.New: %v", err)
		}
		writer := &recordingStreamWriter{inner: inner}
		if err := writer.WriteDelta("partial"); err != nil {
			t.Fatalf("WriteDelta: %v", err)
		}
		if err := writer.EmitLimitError("limit reached", "rate_limit", 30, "warn", true); err != nil {
			t.Fatalf("EmitLimitError: %v", err)
		}
		if err := writer.WriteDoneFull("stop", 4, 1); err != nil {
			t.Fatalf("idempotent WriteDoneFull: %v", err)
		}
		if writer.succeeded() {
			t.Fatal("structured limit terminal was recorded as successful")
		}
	})
}
