package aialertpacks

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	alerttools "github.com/ev-dev-labs/teslasync/internal/ai/tools/alert"
)

type settings struct {
	mode    string
	enabled bool
}

func (s settings) AIMode(context.Context) (string, error)                   { return s.mode, nil }
func (s settings) AIFeatureEnabled(context.Context, string) (bool, error)   { return s.enabled, nil }
func (s settings) AIProviderConfig(context.Context) (map[string]any, error) { return nil, nil }

type proposalProvider struct {
	calls   int
	invalid bool
}

func (*proposalProvider) Name() string { return "ollama" }
func (*proposalProvider) Capabilities() provider.Capabilities {
	return provider.Capabilities{Tools: true}
}
func (*proposalProvider) Stream(context.Context, provider.ChatRequest) (<-chan provider.Chunk, error) {
	return nil, provider.ErrCapabilityNotSupported
}
func (*proposalProvider) Embed(context.Context, provider.EmbedRequest) (*provider.EmbedResponse, error) {
	return nil, provider.ErrCapabilityNotSupported
}
func (p *proposalProvider) Chat(_ context.Context, req provider.ChatRequest) (*provider.ChatResponse, error) {
	p.calls++
	if p.calls == 1 {
		id := "charge-complete"
		if p.invalid {
			id = "invented"
		}
		return &provider.ChatResponse{FinishReason: provider.FinishToolCalls, ToolCalls: []provider.ToolCall{{
			ID: "proposal-1", Name: "propose_alert_pack",
			Arguments: []byte(`{"name":"Weekend","template_ids":["battery-low","` + id + `"],"rationale":"Low-noise reminders."}`),
		}}}, nil
	}
	return &provider.ChatResponse{FinishReason: provider.FinishStop, Message: provider.Message{Role: provider.RoleAssistant, Content: "Review the proposed group before installing."}}, nil
}

func TestProposalDispatchRoundTrip(t *testing.T) {
	for _, invalid := range []bool{false, true} {
		p := &proposalProvider{invalid: invalid}
		registry := provider.NewRegistry(settings{"local", true})
		registry.Register("ollama", func(provider.ProviderConfig) (provider.Provider, error) { return p, nil })
		toolRegistry := tools.NewRegistry()
		alerttools.RegisterAlertPackTools(toolRegistry)
		rec := httptest.NewRecorder()
		NewHandler(registry, toolRegistry, "").ServeHTTP(rec, httptest.NewRequest("POST", "/", strings.NewReader(`{"goal":"battery and charging reminders"}`)))
		if rec.Code != 200 || p.calls != 2 || !strings.Contains(rec.Header().Get("Content-Type"), "text/event-stream") {
			t.Fatalf("status=%d calls=%d body=%s", rec.Code, p.calls, rec.Body.String())
		}
		body := rec.Body.String()
		if !strings.Contains(body, `"name":"propose_alert_pack"`) {
			t.Fatal("missing typed proposal event")
		}
		if invalid && strings.Contains(body, `"status":"ok"`) {
			t.Fatal("invented rule returned a valid proposal")
		}
		if !invalid && !strings.Contains(body, `"status":"ok"`) {
			t.Fatalf("valid proposal missing: %s", body)
		}
	}
}

func TestGuardPreventsProviderAccess(t *testing.T) {
	for _, s := range []settings{{"off", true}, {"cloud", false}} {
		rec := httptest.NewRecorder()
		handler := NewHandler(nil, nil, "")
		guard.New(s).Wrap("alert-pack-builder", handler.ServeHTTP)(rec, httptest.NewRequest("POST", "/", strings.NewReader(`{"goal":"battery reminders"}`)))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("AI disabled returned %d", rec.Code)
		}
	}
}

func TestInvalidGoalRejectedBeforeProvider(t *testing.T) {
	h := NewHandler(nil, nil, "")
	for _, body := range []string{`{}`, `{`, `{"goal":"    "}`, `{"goal":"tiny"}`, `{"goal":"` + strings.Repeat("a", 2001) + `"}`,
		`{"goal":"charge reminders","install":true}`, `{"goal":"charge reminders"} {}`, `{"goal":"charge reminders"}` + strings.Repeat(" ", 16*1024)} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("POST", "/", strings.NewReader(body)))
		if rec.Code != 400 {
			t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
		}
	}
}
