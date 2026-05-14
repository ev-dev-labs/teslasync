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
