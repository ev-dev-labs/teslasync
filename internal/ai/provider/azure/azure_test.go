package azure

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

// newAdapter builds an [Adapter] backed by an httptest server. flavor
// selects between OpenAI Service and Foundry. The test handler runs
// against srv.URL so URL composition is exercised end-to-end.
func newAdapter(t *testing.T, flavor string, h http.Handler) *Adapter {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	a, err := New(provider.ProviderConfig{
		BaseURL:        srv.URL,
		Model:          "gpt-4o-mini",
		EmbeddingModel: "text-embedding-3-small",
		APIKey:         "azure-test-key",
		APIVersion:     "2024-10-21",
		Flavor:         flavor,
	}, WithHTTPClient(srv.Client()))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return a
}

// TestNew_Validation covers the construction guards: missing
// base_url, missing api_key, unknown flavor, and the happy default.
func TestNew_Validation(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		cfg     provider.ProviderConfig
		wantErr string // substring; "" means no error
	}{
		{
			name:    "empty base_url",
			cfg:     provider.ProviderConfig{APIKey: "k"},
			wantErr: "empty base_url",
		},
		{
			name:    "empty api_key",
			cfg:     provider.ProviderConfig{BaseURL: "https://x.openai.azure.com"},
			wantErr: "empty api_key",
		},
		{
			name: "unknown flavor",
			cfg: provider.ProviderConfig{
				BaseURL: "https://x.openai.azure.com",
				APIKey:  "k",
				Flavor:  "bogus",
			},
			wantErr: "unknown flavor",
		},
		{
			name: "happy default flavor + version",
			cfg: provider.ProviderConfig{
				BaseURL: "https://x.openai.azure.com",
				APIKey:  "k",
			},
		},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			a, err := New(c.cfg)
			if c.wantErr == "" {
				if err != nil {
					t.Fatalf("New: %v", err)
				}
				if a.cfg.Flavor != provider.AzureFlavorOpenAI {
					t.Errorf("default flavor = %q, want %q", a.cfg.Flavor, provider.AzureFlavorOpenAI)
				}
				if a.cfg.APIVersion != provider.DefaultAzureAPIVersion {
					t.Errorf("default api_version = %q, want %q", a.cfg.APIVersion, provider.DefaultAzureAPIVersion)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("err = %v, want substring %q", err, c.wantErr)
			}
		})
	}
}

func TestAzure_Name(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, provider.AzureFlavorOpenAI, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	if a.Name() != provider.NameAzure {
		t.Fatalf("Name = %q, want %q", a.Name(), provider.NameAzure)
	}
}

// TestOpenAIFlavor_Chat_URLAndAuth asserts the Azure OpenAI Service
// URL shape, the api-key header (NOT Authorization Bearer), and the
// body-omits-model invariant.
func TestOpenAIFlavor_Chat_URLAndAuth(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, provider.AzureFlavorOpenAI, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// URL: /openai/deployments/{deployment}/chat/completions?api-version=…
		if !strings.HasSuffix(r.URL.Path, "/openai/deployments/gpt-4o-mini/chat/completions") {
			t.Errorf("path=%s", r.URL.Path)
		}
		if got := r.URL.Query().Get("api-version"); got != "2024-10-21" {
			t.Errorf("api-version=%q", got)
		}
		// Auth: api-key header set, Authorization not set.
		if got := r.Header.Get("api-key"); got != "azure-test-key" {
			t.Errorf("api-key header=%q", got)
		}
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("Authorization header should be empty, got %q", got)
		}
		// Body: must NOT include "model" — Azure OpenAI rejects
		// requests where a body model disagrees with the deployment.
		body, _ := io.ReadAll(r.Body)
		var probe map[string]any
		_ = json.Unmarshal(body, &probe)
		if _, has := probe["model"]; has {
			t.Errorf("body should not include model field, got: %s", string(body))
		}
		_, _ = io.WriteString(w, `{"choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"hi"}}],"usage":{"prompt_tokens":3,"completion_tokens":1}}`)
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
	if resp.InputTokens != 3 || resp.OutputTokens != 1 {
		t.Fatalf("tokens=%d/%d", resp.InputTokens, resp.OutputTokens)
	}
}

// TestOpenAIFlavor_DeploymentOverride asserts cfg.Deployment overrides
// cfg.Model for the URL deployment segment when set.
func TestOpenAIFlavor_DeploymentOverride(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/openai/deployments/prod-chat-deployment/chat/completions") {
			t.Errorf("path=%s, want prod-chat-deployment in URL", r.URL.Path)
		}
		_, _ = io.WriteString(w, `{"choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"ok"}}]}`)
	}))
	t.Cleanup(srv.Close)
	a, err := New(provider.ProviderConfig{
		BaseURL:    srv.URL,
		Model:      "gpt-4o-mini",
		Deployment: "prod-chat-deployment",
		APIKey:     "k",
		APIVersion: "2024-10-21",
		Flavor:     provider.AzureFlavorOpenAI,
	}, WithHTTPClient(srv.Client()))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "x"}},
	}); err != nil {
		t.Fatalf("Chat: %v", err)
	}
}

// TestFoundryFlavor_Chat_URLAndModelInBody asserts the Foundry URL
// shape (no /openai/deployments/ prefix), the api-key header, and the
// model-in-body routing.
func TestFoundryFlavor_Chat_URLAndModelInBody(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, provider.AzureFlavorFoundry, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/chat/completions") || strings.Contains(r.URL.Path, "/deployments/") {
			t.Errorf("foundry path=%s, want /chat/completions without deployments segment", r.URL.Path)
		}
		if got := r.URL.Query().Get("api-version"); got != "2024-10-21" {
			t.Errorf("api-version=%q", got)
		}
		if got := r.Header.Get("api-key"); got != "azure-test-key" {
			t.Errorf("api-key header=%q", got)
		}
		body, _ := io.ReadAll(r.Body)
		var probe map[string]any
		_ = json.Unmarshal(body, &probe)
		if got, _ := probe["model"].(string); got != "gpt-4o-mini" {
			t.Errorf("body model=%q, want gpt-4o-mini", got)
		}
		_, _ = io.WriteString(w, `{"choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"ok"}}]}`)
	}))
	if _, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "hi"}},
	}); err != nil {
		t.Fatalf("Chat: %v", err)
	}
}

// TestChat_ToolCallsParsed asserts tool-calls survive the JSON
// envelope round-trip on both flavors (envelope is identical).
func TestChat_ToolCallsParsed(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, provider.AzureFlavorOpenAI, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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
	if string(resp.ToolCalls[0].Arguments) != `{"city":"PDX"}` {
		t.Fatalf("args=%s", string(resp.ToolCalls[0].Arguments))
	}
}

// TestChat_ContentFilterMappedToFinishReason asserts Azure's content-
// filter finish_reason maps to the canonical [provider.FinishContentFilter].
func TestChat_ContentFilterMappedToFinishReason(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, provider.AzureFlavorOpenAI, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"choices":[{"index":0,"finish_reason":"content_filter","message":{"role":"assistant","content":""}}]}`)
	}))
	resp, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "x"}},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.FinishReason != provider.FinishContentFilter {
		t.Fatalf("finish=%q, want %q", resp.FinishReason, provider.FinishContentFilter)
	}
}

// TestChat_UpstreamError surfaces non-2xx response bodies as
// [provider.ErrUpstream] so the dispatch layer can branch on it.
func TestChat_UpstreamError(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, provider.AzureFlavorOpenAI, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"code":"401","message":"unauthorized"}}`)
	}))
	_, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "x"}},
	})
	if !errors.Is(err, provider.ErrUpstream) {
		t.Fatalf("err=%v, want ErrUpstream", err)
	}
	if !strings.Contains(err.Error(), "401") {
		t.Fatalf("err=%v should preserve status code", err)
	}
}

// TestStream_HappyPath relays the standard SSE wire format.
func TestStream_HappyPath(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, provider.AzureFlavorOpenAI, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"he\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"llo\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"finish_reason\":\"stop\",\"delta\":{}}]}\n\n")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	ch, err := a.Stream(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	var content string
	var done bool
	for c := range ch {
		if c.Err != nil {
			t.Fatalf("chunk err: %v", c.Err)
		}
		content += c.Delta
		if c.Done {
			done = true
		}
	}
	if !done {
		t.Fatal("expected Done chunk")
	}
	if content != "hello" {
		t.Fatalf("content=%q", content)
	}
}

func TestStream_AssemblesToolCallFragments(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, provider.AzureFlavorOpenAI, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"query_drives_recent","arguments":"{\"vehicle_id\":"}}]}}]}`+"\n\n")
		_, _ = io.WriteString(w, `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"7,\"limit\":5}"}}]},"finish_reason":"tool_calls"}]}`+"\n\n")
	}))
	ch, err := a.Stream(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "drives"}},
	})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	var calls []provider.ToolCall
	for chunk := range ch {
		if chunk.Err != nil {
			t.Fatalf("chunk err: %v", chunk.Err)
		}
		if chunk.ToolDelta != nil {
			calls = append(calls, *chunk.ToolDelta)
		}
	}
	if len(calls) != 1 {
		t.Fatalf("tool calls = %+v, want one assembled call", calls)
	}
	if calls[0].Name != "query_drives_recent" ||
		string(calls[0].Arguments) != `{"vehicle_id":7,"limit":5}` {
		t.Fatalf("assembled call = %+v", calls[0])
	}
}

// TestStream_MidStreamErrorSurfaced asserts the relay propagates a
// structured error frame instead of silently swallowing it.
func TestStream_MidStreamErrorSurfaced(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, provider.AzureFlavorOpenAI, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"part\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: {\"error\":{\"code\":\"content_filter\",\"message\":\"blocked\"}}\n\n")
	}))
	ch, err := a.Stream(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "x"}},
	})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	var sawErr bool
	for c := range ch {
		if c.Err != nil {
			sawErr = true
			if !strings.Contains(c.Err.Error(), "content_filter") {
				t.Errorf("err missing code: %v", c.Err)
			}
		}
	}
	if !sawErr {
		t.Fatal("expected error chunk to be surfaced")
	}
}

// TestStream_EmptyChoicesSkipped asserts content-filter / annotation
// frames with no choices do not stop the stream.
func TestStream_EmptyChoicesSkipped(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, provider.AzureFlavorOpenAI, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"prompt_filter_results\":[]}\n\n")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: {\"choices\":[]}\n\n")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	ch, err := a.Stream(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "x"}},
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
	if content != "ok" {
		t.Fatalf("content=%q", content)
	}
}

// TestEmbed_OpenAIFlavor_DeploymentInURL asserts the embedding URL
// includes the embedding deployment segment.
func TestEmbed_OpenAIFlavor_DeploymentInURL(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/openai/deployments/embed-deployment/embeddings") {
			t.Errorf("path=%s, want /openai/deployments/embed-deployment/embeddings", r.URL.Path)
		}
		_, _ = io.WriteString(w, `{"data":[{"embedding":[0.1,0.2],"index":0}],"usage":{"prompt_tokens":5}}`)
	}))
	t.Cleanup(srv.Close)
	a, err := New(provider.ProviderConfig{
		BaseURL:             srv.URL,
		Model:               "gpt-4o-mini",
		EmbeddingModel:      "text-embedding-3-small",
		EmbeddingDeployment: "embed-deployment",
		APIKey:              "k",
		Flavor:              provider.AzureFlavorOpenAI,
	}, WithHTTPClient(srv.Client()))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	resp, err := a.Embed(context.Background(), provider.EmbedRequest{Input: []string{"hi"}})
	if err != nil {
		t.Fatalf("Embed: %v", err)
	}
	if len(resp.Vectors) != 1 || len(resp.Vectors[0]) != 2 {
		t.Fatalf("vectors=%v", resp.Vectors)
	}
}

// TestEmbed_FoundryFlavor_ModelInBody asserts the Foundry embeddings
// path uses /embeddings (no deployment segment) and ships the model
// in the body.
func TestEmbed_FoundryFlavor_ModelInBody(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, provider.AzureFlavorFoundry, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/embeddings") || strings.Contains(r.URL.Path, "/deployments/") {
			t.Errorf("path=%s, want /embeddings without deployment segment", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		var probe map[string]any
		_ = json.Unmarshal(body, &probe)
		if got, _ := probe["model"].(string); got != "text-embedding-3-small" {
			t.Errorf("body model=%q", got)
		}
		_, _ = io.WriteString(w, `{"data":[{"embedding":[0.5],"index":0}],"usage":{"prompt_tokens":2}}`)
	}))
	resp, err := a.Embed(context.Background(), provider.EmbedRequest{Input: []string{"hi"}})
	if err != nil {
		t.Fatalf("Embed: %v", err)
	}
	if len(resp.Vectors) != 1 || resp.InputTokens != 2 {
		t.Fatalf("resp=%+v", resp)
	}
}

// TestEmbed_MissingDeployment fails fast when no embedding deployment
// or model is configured.
func TestEmbed_MissingDeployment(t *testing.T) {
	t.Parallel()
	a, err := New(provider.ProviderConfig{
		BaseURL: "https://x.openai.azure.com",
		APIKey:  "k",
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	_, err = a.Embed(context.Background(), provider.EmbedRequest{Input: []string{"x"}})
	if err == nil || !strings.Contains(err.Error(), "embedding") {
		t.Fatalf("err=%v, want missing-embedding error", err)
	}
}

// TestCapabilities sanity-checks the static surface.
func TestCapabilities(t *testing.T) {
	t.Parallel()
	a := newAdapter(t, provider.AzureFlavorOpenAI, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	caps := a.Capabilities()
	if !caps.Tools || !caps.Streaming || !caps.Embeddings {
		t.Fatalf("capabilities=%+v", caps)
	}
}

// TestBuilder asserts the registry-compatible factory wires through.
func TestBuilder(t *testing.T) {
	t.Parallel()
	p, err := Builder(provider.ProviderConfig{
		BaseURL: "https://x.openai.azure.com",
		APIKey:  "k",
	})
	if err != nil {
		t.Fatalf("Builder: %v", err)
	}
	if p.Name() != provider.NameAzure {
		t.Fatalf("Name=%q", p.Name())
	}
}

// TestBuildURL_TrailingSlashSafe covers the net/url composition for
// edge cases the rubber-duck flagged: trailing slash on base_url and
// deployment names with characters that need percent-encoding.
func TestBuildURL_TrailingSlashSafe(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Must not produce a double slash.
		if strings.Contains(r.URL.Path, "//") {
			t.Errorf("double slash in path: %s", r.URL.Path)
		}
		_, _ = io.WriteString(w, `{"choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"x"}}]}`)
	}))
	t.Cleanup(srv.Close)
	a, err := New(provider.ProviderConfig{
		BaseURL: srv.URL + "/", // trailing slash
		Model:   "gpt-4o-mini",
		APIKey:  "k",
	}, WithHTTPClient(srv.Client()))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := a.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "x"}},
	}); err != nil {
		t.Fatalf("Chat: %v", err)
	}
}

// TestEncodeChatRequest_AssistantToolCallRoundTrip is a wire-level
// regression test for the bug that caused Azure to reject iter 1 of
// a tool-using dispatch with:
//
//	azure chat status 400: Invalid value for 'content':
//	expected a string, got null. param: messages.[N].content
//
// After dispatch.go copies resp.ToolCalls onto Message.ToolCalls
// (plural), the encoder MUST:
//  1. emit `"content": ""` (NOT omit the field) for the assistant
//     message that proposes tool calls, because Azure's strict
//     OpenAI-spec enforcement rejects a missing content field, AND
//  2. emit the proposed tool_calls array so the next provider turn
//     sees the full pairing required when a tool result follows.
func TestEncodeChatRequest_AssistantToolCallRoundTrip(t *testing.T) {
	t.Parallel()
	req := provider.ChatRequest{
		Messages: []provider.Message{
			{Role: provider.RoleSystem, Content: "be brief"},
			{Role: provider.RoleUser, Content: "what is 2+2"},
			{
				Role: provider.RoleAssistant,
				ToolCalls: []provider.ToolCall{{
					ID:        "call_abc",
					Name:      "calc",
					Arguments: json.RawMessage(`{"expr":"2+2"}`),
				}},
			},
			{
				Role:    provider.RoleTool,
				ToolID:  "call_abc",
				Content: `{"result":4}`,
			},
		},
	}
	body, err := encodeChatRequest(req, "", false)
	if err != nil {
		t.Fatalf("encodeChatRequest: %v", err)
	}
	var decoded struct {
		Messages []map[string]any `json:"messages"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if len(decoded.Messages) != 4 {
		t.Fatalf("messages len = %d, want 4: %s", len(decoded.Messages), body)
	}
	asst := decoded.Messages[2]
	if _, present := asst["content"]; !present {
		t.Errorf("assistant message missing 'content' key (must be present, even if empty); got %s", body)
	}
	if got, want := asst["content"], any(""); got != want {
		t.Errorf("assistant content = %#v, want empty string; body=%s", got, body)
	}
	tcs, ok := asst["tool_calls"].([]any)
	if !ok || len(tcs) != 1 {
		t.Fatalf("assistant tool_calls missing or wrong shape: %#v; body=%s", asst["tool_calls"], body)
	}
	tc, _ := tcs[0].(map[string]any)
	if tc["id"] != "call_abc" {
		t.Errorf("tool_calls[0].id = %#v, want call_abc", tc["id"])
	}
	if fn, _ := tc["function"].(map[string]any); fn["name"] != "calc" {
		t.Errorf("tool_calls[0].function.name = %#v, want calc", fn["name"])
	}
}
