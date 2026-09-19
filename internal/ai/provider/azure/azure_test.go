package azure

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

func TestNewFoundryValidation(t *testing.T) {
	for _, base := range []string{"https://resource.services.ai.azure.com", "https://resource.openai.azure.com/", "https://resource.services.ai.azure.com/openai/v1/"} {
		a, err := New(provider.ProviderConfig{BaseURL: base, APIKey: "k"})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasSuffix(a.cfg.BaseURL, "/openai/v1") || a.cfg.APIProtocol != provider.FoundryProtocolAuto {
			t.Fatalf("cfg=%+v", a.cfg)
		}
		if a.Name() != provider.NameAzure || !a.Capabilities().Tools || !a.Capabilities().Streaming || !a.Capabilities().Embeddings {
			t.Fatalf("capabilities=%+v", a.Capabilities())
		}
	}
	for _, base := range []string{"", "not-a-url", "ftp://resource", "https://u:p@resource", "https://resource/models",
		"https://resource/openai/deployments/a", "https://resource/openai/v10", "https://resource/openai/v1?api-version=old",
		"https://resource/openai/v1#fragment"} {
		if _, err := New(provider.ProviderConfig{BaseURL: base, APIKey: "k"}); err == nil {
			t.Errorf("accepted unsupported endpoint %s", base)
		}
	}
	if _, err := New(provider.ProviderConfig{BaseURL: "https://resource", APIKey: "k", APIProtocol: "bogus"}); err == nil {
		t.Fatal("accepted unknown protocol")
	}
	if _, err := Builder(provider.ProviderConfig{BaseURL: "https://resource"}); err == nil {
		t.Fatal("accepted missing key")
	}
	p, err := Builder(provider.ProviderConfig{BaseURL: "https://resource", APIKey: "k"})
	if err != nil || p.Name() != provider.NameAzure {
		t.Fatalf("builder=%v err=%v", p, err)
	}
}

func TestFoundryChatFinishReasons(t *testing.T) {
	for _, finish := range []string{provider.FinishStop, provider.FinishLength, provider.FinishContentFilter} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"text"},"finish_reason":"`+finish+`"}]}`)
		}))
		a, err := New(provider.ProviderConfig{BaseURL: srv.URL, APIKey: "k", Model: "any"})
		if err != nil {
			t.Fatal(err)
		}
		resp, err := a.Chat(context.Background(), provider.ChatRequest{})
		srv.Close()
		if err != nil || resp.FinishReason != finish || resp.Message.Content != "text" {
			t.Fatalf("finish=%s resp=%+v err=%v", finish, resp, err)
		}
	}
}

func TestFoundryChatTokenBudgets(t *testing.T) {
	for _, budget := range []int{0, 1, 73} {
		raw, err := encodeChatRequest(provider.ChatRequest{MaxTokens: budget}, "any", false)
		if err != nil {
			t.Fatal(err)
		}
		var body azureChatRequest
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Fatal(err)
		}
		want := budget
		if want == 0 {
			want = defaultMaxCompletionTokens
		}
		if body.MaxCompletionTokens != want {
			t.Fatalf("budget=%d wire=%s", budget, raw)
		}
	}
}

func TestExplicitProtocolsNeverNegotiate(t *testing.T) {
	for _, protocol := range []string{provider.FoundryProtocolChat, provider.FoundryProtocolResponses} {
		for _, stream := range []bool{false, true} {
			var calls atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				want := "/openai/v1/chat/completions"
				if protocol == provider.FoundryProtocolResponses {
					want = "/openai/v1/responses"
				}
				if r.URL.Path != want || r.URL.RawQuery != "" {
					t.Errorf("url=%s want=%s", r.URL.String(), want)
				}
				w.WriteHeader(404)
				_, _ = io.WriteString(w, `{"error":{"code":"DeploymentNotFound"}}`)
			}))
			a, err := New(provider.ProviderConfig{BaseURL: srv.URL, APIKey: "k", Model: "arbitrary-name", APIProtocol: protocol})
			if err != nil {
				t.Fatal(err)
			}
			if stream {
				_, err = a.Stream(context.Background(), provider.ChatRequest{})
			} else {
				_, err = a.Chat(context.Background(), provider.ChatRequest{})
			}
			srv.Close()
			if !errors.Is(err, provider.ErrUpstream) || calls.Load() != 1 {
				t.Fatalf("protocol=%s calls=%d err=%v", protocol, calls.Load(), err)
			}
		}
	}
}

func TestFoundryEmbeddingsIndependentOfProtocol(t *testing.T) {
	for _, protocol := range []string{provider.FoundryProtocolAuto, provider.FoundryProtocolChat, provider.FoundryProtocolResponses} {
		for _, override := range []string{"", "request-embedding"} {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/openai/v1/embeddings" || r.URL.RawQuery != "" ||
					r.Header.Get("api-key") != "k" || r.Header.Get("Authorization") != "Bearer k" {
					t.Errorf("wrong endpoint/auth: %s", r.URL.String())
				}
				var body struct {
					Model string   `json:"model"`
					Input []string `json:"input"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				want := "saved-embedding"
				if override != "" {
					want = override
				}
				if body.Model != want || len(body.Input) != 1 || body.Input[0] != "hi" {
					t.Errorf("body=%+v", body)
				}
				_, _ = io.WriteString(w, `{"data":[{"index":0,"embedding":[0.5,0.25]}],"usage":{"prompt_tokens":2}}`)
			}))
			a, err := New(provider.ProviderConfig{BaseURL: srv.URL + "/openai/v1/", APIKey: "k", APIProtocol: protocol, EmbeddingModel: "saved-embedding"})
			if err != nil {
				t.Fatal(err)
			}
			resp, err := a.Embed(context.Background(), provider.EmbedRequest{Model: override, Input: []string{"hi"}})
			srv.Close()
			if err != nil || len(resp.Vectors) != 1 || len(resp.Vectors[0]) != 2 || resp.Vectors[0][0] != 0.5 || resp.InputTokens != 2 {
				t.Fatalf("resp=%+v err=%v", resp, err)
			}
		}
	}
	a, _ := New(provider.ProviderConfig{BaseURL: "https://resource", APIKey: "k"})
	if _, err := a.Embed(context.Background(), provider.EmbedRequest{}); err == nil {
		t.Fatal("missing embedding name accepted")
	}
}

func TestChatEncoderPreservesToolHistoryAndBudget(t *testing.T) {
	req := provider.ChatRequest{MaxTokens: 1, Messages: []provider.Message{
		{Role: provider.RoleSystem, Content: "be brief"},
		{Role: provider.RoleUser, Content: "calculate"},
		{Role: provider.RoleAssistant, ToolCalls: []provider.ToolCall{{ID: "call_abc", Name: "calc", Arguments: json.RawMessage(`{"expr":"2+2"}`)}}},
		{Role: provider.RoleTool, ToolID: "call_abc", Content: `{"result":4}`},
	}}
	body, err := encodeChatRequest(req, "arbitrary-deployment", false)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Model    string                       `json:"model"`
		Messages []map[string]json.RawMessage `json:"messages"`
		Cap      int                          `json:"max_completion_tokens"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Model != "arbitrary-deployment" || decoded.Cap != 1 || len(decoded.Messages) != 4 ||
		string(decoded.Messages[2]["content"]) != `""` ||
		!strings.Contains(string(decoded.Messages[2]["tool_calls"]), `"call_abc"`) ||
		string(decoded.Messages[3]["tool_call_id"]) != `"call_abc"` {
		t.Fatalf("wire=%s", body)
	}
	if strings.Contains(string(body), `"max_tokens"`) {
		t.Fatalf("old token parameter: %s", body)
	}
}

func TestFoundrySSESemantics(t *testing.T) {
	for _, tc := range []struct {
		name, frames, text, finish, arguments string
		wantErr                               bool
		in, out                               int
	}{
		{"text", "data: {\"choices\":[{\"delta\":{\"content\":\"he\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"llo\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":3}}\n\ndata: [DONE]\n\n", "hello", provider.FinishStop, "", false, 11, 3},
		{"tools", `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"lookup","arguments":"{\"q\":"}}]}}]}` + "\n\n" + `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"soc\"}"}}]},"finish_reason":"tool_calls"}]}` + "\n\n", "", provider.FinishToolCalls, `{"q":"soc"}`, false, 0, 0},
		{"annotation", "data: {\"prompt_filter_results\":[]}\n\ndata: {\"choices\":[]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n", "ok", provider.FinishStop, "", false, 0, 0},
		{"error", "data: {\"error\":{\"code\":\"OperationNotSupported\",\"message\":\"blocked\"}}\n\n", "", "", "", true, 0, 0},
		{"malformed", "data: {bad}\n\n", "", "", "", true, 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.URL.Path != "/openai/v1/chat/completions" {
					t.Errorf("path=%s", r.URL.Path)
				}
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = io.WriteString(w, tc.frames)
			}))
			defer srv.Close()
			a, _ := New(provider.ProviderConfig{BaseURL: srv.URL, APIKey: "k", Model: "any"})
			ch, err := a.Stream(context.Background(), provider.ChatRequest{})
			if err != nil {
				t.Fatal(err)
			}
			var text string
			var terminal provider.Chunk
			var tools []provider.ToolCall
			var sawErr bool
			for chunk := range ch {
				if chunk.Err != nil {
					sawErr = true
				}
				text += chunk.Delta
				if chunk.ToolDelta != nil {
					tools = append(tools, *chunk.ToolDelta)
				}
				if chunk.Done {
					terminal = chunk
				}
			}
			if sawErr != tc.wantErr || text != tc.text || terminal.FinishReason != tc.finish ||
				terminal.InputTokens != tc.in || terminal.OutputTokens != tc.out || calls.Load() != 1 || terminal.Done == tc.wantErr {
				t.Fatalf("text=%s terminal=%+v err=%v calls=%d", text, terminal, sawErr, calls.Load())
			}
			if tc.arguments != "" && (len(tools) != 1 || tools[0].ID != "call_1" || tools[0].Name != "lookup" || string(tools[0].Arguments) != tc.arguments) {
				t.Fatalf("tools=%+v", tools)
			}
		})
	}
}
