package openai

import (
	"context"
	"encoding/json"
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
		BaseURL:        srv.URL,
		Model:          "gpt-4o-mini",
		EmbeddingModel: "text-embedding-3-small",
		APIKey:         "sk-test",
	}, WithHTTPClient(srv.Client()))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return a
}

func TestOpenAI_Chat_HappyPath(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != chatPath {
			t.Errorf("path=%s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer sk-test" {
			t.Errorf("auth header=%q", got)
		}
		_, _ = io.WriteString(w, `{
			"id":"x","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"hi"}}],
			"usage":{"prompt_tokens":4,"completion_tokens":1}
		}`)
	}))
	resp, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "hello"}},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Message.Content != "hi" {
		t.Fatalf("content=%q", resp.Message.Content)
	}
	if resp.FinishReason != provider.FinishStop {
		t.Fatalf("finish=%q", resp.FinishReason)
	}
	if resp.InputTokens != 4 || resp.OutputTokens != 1 {
		t.Fatalf("tokens=%d/%d", resp.InputTokens, resp.OutputTokens)
	}
}

func TestOpenAI_Chat_ToolCallsParsed(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{
			"choices":[{"index":0,"finish_reason":"tool_calls","message":{
				"role":"assistant",
				"tool_calls":[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"PDX\"}"}}]
			}}]
		}`)
	}))
	resp, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "weather"}},
		Tools:    []provider.ToolSpec{{Name: "get_weather", Description: "weather", Parameters: json.RawMessage(`{"type":"object"}`)}},
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

func TestOpenAI_Chat_StatusError(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":"bad key"}`)
	}))
	_, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "hi"}},
	})
	if !errors.Is(err, provider.ErrUpstream) {
		t.Fatalf("want ErrUpstream, got %v", err)
	}
	if !strings.Contains(err.Error(), "401") {
		t.Fatalf("status missing: %v", err)
	}
}

func TestOpenAI_Stream_SSE(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"he\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"llo\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	out, err := a.Stream(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	got := ""
	doneSeen := false
	for c := range out {
		if c.Err != nil {
			t.Fatalf("stream err: %v", c.Err)
		}
		if c.Done {
			doneSeen = true
			continue
		}
		got += c.Delta
	}
	if got != "hello" {
		t.Fatalf("stream payload=%q", got)
	}
	if !doneSeen {
		t.Fatalf("done not emitted")
	}
}

func TestOpenAI_Stream_AssemblesToolCallFragments(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, `data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"query_battery_status","arguments":"{\"vehicle"}}]}}]}`+"\n\n")
		_, _ = io.WriteString(w, `data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"_id\":42}"}}]},"finish_reason":"tool_calls"}]}`+"\n\n")
	}))
	out, err := a.Stream(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "battery"}},
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
	if calls[0].ID != "call_1" || calls[0].Name != "query_battery_status" ||
		string(calls[0].Arguments) != `{"vehicle_id":42}` {
		t.Fatalf("assembled call = %+v", calls[0])
	}
}

func TestOpenAI_Embed_BatchedRequest(t *testing.T) {
	t.Parallel()
	calls := 0
	a := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != embedPath {
			t.Errorf("path=%s", r.URL.Path)
		}
		calls++
		var body struct {
			Input []string `json:"input"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if len(body.Input) != 3 {
			t.Errorf("expected batched input of 3, got %d", len(body.Input))
		}
		_, _ = io.WriteString(w, `{
			"data":[
				{"index":0,"embedding":[0.1]},
				{"index":1,"embedding":[0.2]},
				{"index":2,"embedding":[0.3]}
			],"usage":{"prompt_tokens":9}
		}`)
	}))
	resp, err := a.Embed(context.Background(), provider.EmbedRequest{
		Input: []string{"a", "b", "c"},
	})
	if err != nil {
		t.Fatalf("Embed: %v", err)
	}
	if calls != 1 {
		t.Fatalf("expected exactly 1 batched call, got %d", calls)
	}
	if len(resp.Vectors) != 3 || resp.InputTokens != 9 {
		t.Fatalf("response=%+v", resp)
	}
}

func TestOpenAI_NameAndCapabilities(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{}`)
	}))
	if a.Name() != provider.NameOpenAI {
		t.Fatalf("name=%q", a.Name())
	}
	c := a.Capabilities()
	if !c.Tools || !c.Streaming || !c.Embeddings || c.MaxContext == 0 {
		t.Fatalf("capabilities=%+v", c)
	}
}

func TestOpenAI_New_RejectsEmptyBaseURL(t *testing.T) {
	t.Parallel()
	if _, err := New(provider.ProviderConfig{}); err == nil {
		t.Fatal("expected error")
	}
}

func TestOpenAI_BuilderSatisfiesPort(t *testing.T) {
	t.Parallel()
	p, err := Builder(provider.ProviderConfig{BaseURL: "https://api.openai.com", Model: "x"})
	if err != nil {
		t.Fatalf("Builder: %v", err)
	}
	if p.Name() != provider.NameOpenAI {
		t.Fatalf("name=%q", p.Name())
	}
}
