package azure

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

func TestNeedsResponsesAPI(t *testing.T) {
	t.Parallel()
	if !needsResponsesAPI("gpt-5.6-sol") {
		t.Fatal("gpt-5.6-sol")
	}
	if !needsResponsesAPI("gpt-6-astra") {
		t.Fatal("gpt-6-astra")
	}
	if needsResponsesAPI("gpt-5") {
		t.Fatal("gpt-5 uses chat completions + max_completion_tokens")
	}
	if needsResponsesAPI("gpt-4o") {
		t.Fatal("gpt-4o")
	}
}

func TestChat_Gpt56Sol_UsesFoundryResponsesAPI(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/openai/v1/responses" {
			t.Errorf("path=%s want /openai/v1/responses", r.URL.Path)
		}
		if r.URL.RawQuery != "" {
			t.Errorf("query=%s, Foundry v1 omits api-version", r.URL.RawQuery)
		}
		if got := r.Header.Get("api-key"); got != "k" {
			t.Errorf("api-key=%q", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer k" {
			t.Errorf("Authorization=%q", got)
		}
		body, _ := io.ReadAll(r.Body)
		var probe map[string]any
		_ = json.Unmarshal(body, &probe)
		if got, _ := probe["model"].(string); got != "gpt-5.6-sol" {
			t.Errorf("model=%q", got)
		}
		if _, has := probe["temperature"]; has {
			t.Errorf("reasoning models must omit temperature: %s", body)
		}
		if _, has := probe["max_tokens"]; has {
			t.Errorf("must not send max_tokens: %s", body)
		}
		got, _ := probe["max_output_tokens"].(float64)
		if int(got) != defaultMaxCompletionTokens {
			t.Errorf("max_output_tokens=%v", probe["max_output_tokens"])
		}
		if _, has := probe["messages"]; has {
			t.Errorf("Responses API uses input, not messages: %s", body)
		}
		_, _ = io.WriteString(w, `{
			"id":"resp_test",
			"status":"completed",
			"output_text":"Foundry hello",
			"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Foundry hello"}]}],
			"usage":{"input_tokens":8,"output_tokens":3}
		}`)
	}))
	t.Cleanup(srv.Close)
	a, err := New(provider.ProviderConfig{
		BaseURL: srv.URL,
		Model:   "gpt-5.6-sol",
		APIKey:  "k",
		Flavor:  provider.AzureFlavorOpenAI,
	}, WithHTTPClient(srv.Client()))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	resp, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleSystem, Content: "be brief"},
			{Role: provider.RoleUser, Content: "hi"},
		},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Message.Content != "Foundry hello" {
		t.Fatalf("content=%q", resp.Message.Content)
	}
	if resp.InputTokens != 8 || resp.OutputTokens != 3 {
		t.Fatalf("usage=%d/%d", resp.InputTokens, resp.OutputTokens)
	}
}

func TestChat_Gpt56Sol_ResponsesTools(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/openai/v1/responses") {
			t.Errorf("path=%s", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		var probe map[string]any
		_ = json.Unmarshal(body, &probe)
		tools, _ := probe["tools"].([]any)
		if len(tools) != 1 {
			t.Fatalf("tools=%s", body)
		}
		tool, _ := tools[0].(map[string]any)
		if tool["type"] != "function" || tool["name"] != "lookup" {
			t.Errorf("tool=%v", tool)
		}
		if _, nested := tool["function"]; nested {
			t.Errorf("Responses tools are flat, not nested under function: %s", body)
		}
		_, _ = io.WriteString(w, `{
			"status":"completed",
			"output":[{
				"type":"function_call",
				"call_id":"call_1",
				"name":"lookup",
				"arguments":"{\"q\":\"soc\"}"
			}],
			"usage":{"input_tokens":4,"output_tokens":2}
		}`)
	}))
	t.Cleanup(srv.Close)
	a, err := New(provider.ProviderConfig{
		BaseURL: srv.URL + "/openai/v1",
		Model:   "gpt-5.6-sol",
		APIKey:  "k",
	}, WithHTTPClient(srv.Client()))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	resp, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "lookup SOC"}},
		Tools: []provider.ToolSpec{{
			Name:        "lookup",
			Description: "look up a signal",
			Parameters:  json.RawMessage(`{"type":"object"}`),
		}},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.FinishReason != provider.FinishToolCalls {
		t.Fatalf("finish=%q", resp.FinishReason)
	}
	if len(resp.ToolCalls) != 1 || resp.ToolCalls[0].Name != "lookup" {
		t.Fatalf("tools=%+v", resp.ToolCalls)
	}
}

func TestStream_Gpt56Sol_SynthesizesFromResponses(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/responses") {
			t.Errorf("path=%s", r.URL.Path)
		}
		_, _ = io.WriteString(w, `{"status":"completed","output_text":"streamed","usage":{"input_tokens":1,"output_tokens":1}}`)
	}))
	t.Cleanup(srv.Close)
	a, err := New(provider.ProviderConfig{
		BaseURL: srv.URL,
		Model:   "gpt-5.6-sol",
		APIKey:  "k",
	}, WithHTTPClient(srv.Client()))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ch, err := a.Stream(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	var content string
	for c := range ch {
		if c.Err != nil {
			t.Fatalf("chunk err: %v", c.Err)
		}
		content += c.Delta
	}
	if content != "streamed" {
		t.Fatalf("content=%q", content)
	}
}

func TestEncodeResponsesRequest_SystemBecomesInstructions(t *testing.T) {
	t.Parallel()
	body, err := encodeResponsesRequest(provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleSystem, Content: "you are helix"},
			{Role: provider.RoleUser, Content: "propose a template"},
		},
		MaxTokens: 1,
	}, "gpt-5.6-sol")
	if err != nil {
		t.Fatal(err)
	}
	var probe map[string]any
	if err := json.Unmarshal(body, &probe); err != nil {
		t.Fatal(err)
	}
	if probe["instructions"] != "you are helix" {
		t.Errorf("instructions=%v", probe["instructions"])
	}
	input, _ := probe["input"].([]any)
	if len(input) != 1 {
		t.Fatalf("input=%s", body)
	}
	if int(probe["max_output_tokens"].(float64)) != defaultMaxCompletionTokens {
		t.Errorf("max_output_tokens floored from 1: %v", probe["max_output_tokens"])
	}
}
