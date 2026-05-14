package ollama

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

func newAdapter(t *testing.T, h http.Handler) (*Adapter, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	a, err := New(provider.ProviderConfig{
		BaseURL:        srv.URL,
		Model:          "llama3.1",
		EmbeddingModel: "nomic-embed-text",
	}, WithHTTPClient(srv.Client()))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return a, srv
}

func TestOllama_Chat_HappyPath(t *testing.T) {
	t.Parallel()
	a, _ := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/chat" {
			t.Errorf("path=%s", r.URL.Path)
		}
		_, _ = io.WriteString(w, `{
			"model":"llama3.1","message":{"role":"assistant","content":"hi"},
			"done":true,"prompt_eval_count":3,"eval_count":1
		}`)
	}))
	resp, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "hello"}},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Message.Content != "hi" || resp.InputTokens != 3 || resp.OutputTokens != 1 {
		t.Fatalf("response=%+v", resp)
	}
}

func TestOllama_Chat_StatusErrorWraps(t *testing.T) {
	t.Parallel()
	a, _ := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = io.WriteString(w, "upstream sad")
	}))
	_, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "hi"}},
	})
	if !errors.Is(err, provider.ErrUpstream) {
		t.Fatalf("want ErrUpstream, got %v", err)
	}
	if !strings.Contains(err.Error(), "502") {
		t.Fatalf("status missing from error: %v", err)
	}
}

func TestOllama_Stream_NDJSON(t *testing.T) {
	t.Parallel()
	a, _ := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		_, _ = io.WriteString(w, `{"message":{"role":"assistant","content":"he"},"done":false}
{"message":{"role":"assistant","content":"llo"},"done":false}
{"message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":2,"eval_count":2}
`)
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
			t.Fatalf("stream chunk err: %v", c.Err)
		}
		if c.Done {
			doneSeen = true
			continue
		}
		got += c.Delta
	}
	if got != "hello" {
		t.Fatalf("stream payload = %q", got)
	}
	if !doneSeen {
		t.Fatalf("done chunk not emitted")
	}
}

func TestOllama_Embed_BatchSequential(t *testing.T) {
	t.Parallel()
	calls := 0
	a, _ := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/embeddings" {
			t.Errorf("path=%s", r.URL.Path)
		}
		calls++
		_, _ = io.WriteString(w, `{"embedding":[0.1,0.2,0.3]}`)
	}))
	resp, err := a.Embed(context.Background(), provider.EmbedRequest{
		Input: []string{"a", "b", "c"},
	})
	if err != nil {
		t.Fatalf("Embed: %v", err)
	}
	if calls != 3 {
		t.Fatalf("Embed should make 3 sequential calls, got %d", calls)
	}
	if len(resp.Vectors) != 3 || len(resp.Vectors[0]) != 3 {
		t.Fatalf("vectors=%+v", resp.Vectors)
	}
}

func TestOllama_NameAndCapabilities(t *testing.T) {
	t.Parallel()
	a, _ := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{}`)
	}))
	if a.Name() != provider.NameOllama {
		t.Fatalf("name=%q", a.Name())
	}
	c := a.Capabilities()
	if !c.Tools || !c.Streaming || !c.Embeddings || c.MaxContext == 0 {
		t.Fatalf("capabilities=%+v", c)
	}
}

func TestOllama_New_RejectsEmptyBaseURL(t *testing.T) {
	t.Parallel()
	if _, err := New(provider.ProviderConfig{BaseURL: ""}); err == nil {
		t.Fatal("expected error on empty base_url")
	}
}

func TestOllama_BuilderSatisfiesPort(t *testing.T) {
	t.Parallel()
	p, err := Builder(provider.ProviderConfig{BaseURL: "http://localhost:11434", Model: "x"})
	if err != nil {
		t.Fatalf("Builder: %v", err)
	}
	if p.Name() != provider.NameOllama {
		t.Fatalf("name=%q", p.Name())
	}
}

// TestOllama_Chat_ToolsWireFormat regression test for the bug where
// ToolSpec was serialised flat instead of inside the OpenAI-style
// {type:"function",function:{...}} envelope. Qwen2.5 (and llama3.x
// post-0.3) require the envelope; without it the model returns
// tool_calls with an empty function.name, which the dispatcher then
// rejects with `tool "" not allowed for this strategy`.
func TestOllama_Chat_ToolsWireFormat(t *testing.T) {
	t.Parallel()
	var capturedBody []byte
	a, _ := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		_, _ = io.WriteString(w, `{
			"model":"llama3.1","message":{"role":"assistant","content":"","tool_calls":[
				{"id":"call_abc","function":{"name":"query_drive_detail","arguments":{"drive_id":"3"}}}
			]},"done":true,"done_reason":"stop"
		}`)
	}))
	resp, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "hi"}},
		Tools: []provider.ToolSpec{{
			Name:        "query_drive_detail",
			Description: "Get drive details",
			Parameters:  []byte(`{"type":"object","properties":{"drive_id":{"type":"string"}}}`),
		}},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	// Verify the wire body wraps tools in {type:"function",function:{...}}.
	body := string(capturedBody)
	if !strings.Contains(body, `"type":"function"`) {
		t.Fatalf("wire body missing OpenAI-style tool envelope; got: %s", body)
	}
	if !strings.Contains(body, `"function":{"name":"query_drive_detail"`) {
		t.Fatalf("wire body missing wrapped function.name; got: %s", body)
	}
	// Verify the response decoder propagates ID + Name from the model.
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("want 1 tool call, got %d", len(resp.ToolCalls))
	}
	tc := resp.ToolCalls[0]
	if tc.ID != "call_abc" {
		t.Fatalf("want ID=call_abc, got %q", tc.ID)
	}
	if tc.Name != "query_drive_detail" {
		t.Fatalf("want Name=query_drive_detail, got %q", tc.Name)
	}
	if resp.FinishReason != provider.FinishToolCalls {
		t.Fatalf("want FinishToolCalls, got %q", resp.FinishReason)
	}
}

// TestOllama_Chat_HistoryRoundTrip verifies multi-iteration tool-call
// flows preserve assistant tool_calls + tool tool_call_id linkage in
// the history sent to Ollama. Without this round-trip the second
// iteration sees an orphaned tool result message with no preceding
// tool_calls reference, which causes small models like qwen2.5:7b to
// "retry" with hallucinated arguments instead of narrating the result.
func TestOllama_Chat_HistoryRoundTrip(t *testing.T) {
	t.Parallel()
	var capturedBody []byte
	a, _ := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBody, _ = io.ReadAll(r.Body)
		_, _ = io.WriteString(w, `{"message":{"role":"assistant","content":"ok"},"done":true}`)
	}))
	toolCall := &provider.ToolCall{
		ID:        "call_abc",
		Name:      "query_drive_detail",
		Arguments: []byte(`{"drive_id":3}`),
	}
	_, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleSystem, Content: "be brief"},
			{Role: provider.RoleUser, Content: "coach drive 3"},
			{Role: provider.RoleAssistant, Content: "", Tool: toolCall},
			{Role: provider.RoleTool, Name: "query_drive_detail", ToolID: "call_abc", Content: `{"drive_id":3,"distance_m":5000}`},
		},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	body := string(capturedBody)
	for _, want := range []string{
		`"tool_calls":[`,
		`"id":"call_abc"`,
		`"name":"query_drive_detail"`,
		`"tool_call_id":"call_abc"`,
		`"role":"tool"`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("history wire body missing %q; got: %s", want, body)
		}
	}
}

// TestOllama_Stream_ForwardsToolCalls regression test that streamed
// tool_calls reach consumers as ToolDelta chunks. The dispatcher's F4
// non-streaming Run does not exercise this path, but capabilities
// advertise Streaming=true so consumers in F5+ rely on tool deltas.
func TestOllama_Stream_ForwardsToolCalls(t *testing.T) {
	t.Parallel()
	a, _ := newAdapter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		_, _ = io.WriteString(w, `{"message":{"role":"assistant","content":"","tool_calls":[{"id":"call_x","function":{"name":"do_it","arguments":{"k":1}}}]},"done":false}
{"message":{"role":"assistant","content":""},"done":true}
`)
	}))
	out, err := a.Stream(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	var gotTool *provider.ToolCall
	doneSeen := false
	for c := range out {
		if c.Err != nil {
			t.Fatalf("stream err: %v", c.Err)
		}
		if c.ToolDelta != nil {
			tc := *c.ToolDelta
			gotTool = &tc
		}
		if c.Done {
			doneSeen = true
		}
	}
	if !doneSeen {
		t.Fatal("done chunk missing")
	}
	if gotTool == nil {
		t.Fatal("tool_call not forwarded via streaming")
	}
	if gotTool.ID != "call_x" || gotTool.Name != "do_it" {
		t.Fatalf("tool delta lost fields: %+v", gotTool)
	}
}
