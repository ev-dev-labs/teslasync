package anthropic

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

func newAdapter(t *testing.T, h http.Handler) *Adapter {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	a, err := New(provider.ProviderConfig{
		BaseURL: srv.URL,
		Model:   "claude-3-5-sonnet-20240620",
		APIKey:  "sk-ant-test",
	}, WithHTTPClient(srv.Client()))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return a
}

func TestAnthropic_Chat_HappyPath(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != messagesPath {
			t.Errorf("path=%s", r.URL.Path)
		}
		if got := r.Header.Get("x-api-key"); got != "sk-ant-test" {
			t.Errorf("x-api-key=%q", got)
		}
		if got := r.Header.Get("anthropic-version"); got != apiVersionHeader {
			t.Errorf("version header=%q", got)
		}
		_, _ = io.WriteString(w, `{
			"id":"msg_x","role":"assistant",
			"content":[{"type":"text","text":"hello world"}],
			"stop_reason":"end_turn",
			"usage":{"input_tokens":4,"output_tokens":2}
		}`)
	}))
	resp, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleSystem, Content: "be brief"},
			{Role: provider.RoleUser, Content: "hi"},
		},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Message.Content != "hello world" {
		t.Fatalf("content=%q", resp.Message.Content)
	}
	if resp.FinishReason != provider.FinishStop {
		t.Fatalf("finish=%q", resp.FinishReason)
	}
	if resp.InputTokens != 4 || resp.OutputTokens != 2 {
		t.Fatalf("tokens=%d/%d", resp.InputTokens, resp.OutputTokens)
	}
}

func TestAnthropic_Chat_ToolUseParsed(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{
			"id":"msg_x","role":"assistant",
			"content":[
				{"type":"text","text":"using tool"},
				{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{"city":"PDX"}}
			],
			"stop_reason":"tool_use",
			"usage":{"input_tokens":5,"output_tokens":3}
		}`)
	}))
	resp, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "weather"}},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.FinishReason != provider.FinishToolCalls {
		t.Fatalf("finish=%q", resp.FinishReason)
	}
	if len(resp.ToolCalls) != 1 || resp.ToolCalls[0].Name != "get_weather" {
		t.Fatalf("tool calls=%+v", resp.ToolCalls)
	}
}

func TestAnthropic_Chat_StatusError(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, `{"error":"forbidden"}`)
	}))
	_, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "hi"}},
	})
	if !errors.Is(err, provider.ErrUpstream) {
		t.Fatalf("want ErrUpstream, got %v", err)
	}
	if !strings.Contains(err.Error(), "403") {
		t.Fatalf("status missing: %v", err)
	}
}

func TestAnthropic_Stream_SSE(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "event: message_start\n")
		_, _ = io.WriteString(w, "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":5}}}\n\n")
		_, _ = io.WriteString(w, "event: content_block_delta\n")
		_, _ = io.WriteString(w, "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hel\"}}\n\n")
		_, _ = io.WriteString(w, "event: content_block_delta\n")
		_, _ = io.WriteString(w, "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"lo\"}}\n\n")
		_, _ = io.WriteString(w, "event: message_delta\n")
		_, _ = io.WriteString(w, "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":2}}\n\n")
		_, _ = io.WriteString(w, "event: message_stop\n")
		_, _ = io.WriteString(w, "data: {\"type\":\"message_stop\"}\n\n")
	}))
	out, err := a.Stream(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	got := ""
	var terminal provider.Chunk
	for c := range out {
		if c.Err != nil {
			t.Fatalf("stream err: %v", c.Err)
		}
		if c.Done {
			terminal = c
			continue
		}
		got += c.Delta
	}
	if got != "hello" {
		t.Fatalf("stream payload=%q", got)
	}
	if !terminal.Done {
		t.Fatalf("done chunk not emitted")
	}
	if terminal.FinishReason != provider.FinishStop ||
		terminal.InputTokens != 5 || terminal.OutputTokens != 2 {
		t.Fatalf("terminal = %+v", terminal)
	}
}

func TestAnthropic_Stream_AssemblesToolInputDeltas(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "event: content_block_start\n")
		_, _ = io.WriteString(w, `data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_1","name":"query_vehicle_state","input":{}}}`+"\n\n")
		_, _ = io.WriteString(w, "event: content_block_delta\n")
		_, _ = io.WriteString(w, `data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"vehicle"}}`+"\n\n")
		_, _ = io.WriteString(w, "event: content_block_delta\n")
		_, _ = io.WriteString(w, `data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"_id\":9}"}}`+"\n\n")
		_, _ = io.WriteString(w, "event: message_delta\n")
		_, _ = io.WriteString(w, `data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":8}}`+"\n\n")
		_, _ = io.WriteString(w, "event: message_stop\n")
		_, _ = io.WriteString(w, "data: {\"type\":\"message_stop\"}\n\n")
	}))
	out, err := a.Stream(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "state"}},
	})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	var calls []provider.ToolCall
	for chunk := range out {
		if chunk.Err != nil {
			t.Fatalf("stream err: %v", chunk.Err)
		}
		if chunk.ToolDelta != nil {
			calls = append(calls, *chunk.ToolDelta)
		}
	}
	if len(calls) != 1 {
		t.Fatalf("tool calls = %+v, want one assembled call", calls)
	}
	if calls[0].ID != "tool_1" || calls[0].Name != "query_vehicle_state" ||
		string(calls[0].Arguments) != `{"vehicle_id":9}` {
		t.Fatalf("assembled call = %+v", calls[0])
	}
}

func TestAnthropic_Embed_AlwaysReturnsCapabilityNotSupported(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Errorf("Embed must NOT make any HTTP call")
		w.WriteHeader(http.StatusInternalServerError)
	}))
	_, err := a.Embed(context.Background(), provider.EmbedRequest{Input: []string{"x"}})
	if !errors.Is(err, provider.ErrCapabilityNotSupported) {
		t.Fatalf("want ErrCapabilityNotSupported, got %v", err)
	}
}

func TestAnthropic_NameAndCapabilities(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{}`)
	}))
	if a.Name() != provider.NameAnthropic {
		t.Fatalf("name=%q", a.Name())
	}
	c := a.Capabilities()
	if !c.Tools || !c.Streaming || c.Embeddings || c.MaxContext == 0 {
		t.Fatalf("capabilities=%+v", c)
	}
}

func TestAnthropic_New_RejectsEmptyBaseURL(t *testing.T) {
	t.Parallel()
	if _, err := New(provider.ProviderConfig{}); err == nil {
		t.Fatal("expected error")
	}
}

func TestAnthropic_BuilderSatisfiesPort(t *testing.T) {
	t.Parallel()
	p, err := Builder(provider.ProviderConfig{BaseURL: "https://api.anthropic.com", Model: "x"})
	if err != nil {
		t.Fatalf("Builder: %v", err)
	}
	if p.Name() != provider.NameAnthropic {
		t.Fatalf("name=%q", p.Name())
	}
}
