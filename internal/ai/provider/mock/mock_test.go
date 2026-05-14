package mock

import (
	"context"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

func TestMock_DefaultReply(t *testing.T) {
	t.Parallel()
	m := New(provider.Capabilities{Streaming: true, Embeddings: true})
	resp, err := m.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "hi"}},
	})
	if err != nil {
		t.Fatalf("Chat: %v", err)
	}
	if resp.Message.Content != "ok" {
		t.Fatalf("default content = %q", resp.Message.Content)
	}
}

func TestMock_PromptOverride(t *testing.T) {
	t.Parallel()
	m := New(provider.Capabilities{})
	m.SetReplyByPrompt("battery health", Reply{
		ChatResponse: provider.ChatResponse{
			Message: provider.Message{Role: provider.RoleAssistant, Content: "98%"},
		},
	})
	resp, _ := m.Chat(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "battery health"}},
	})
	if resp.Message.Content != "98%" {
		t.Fatalf("prompt override ignored: %q", resp.Message.Content)
	}
}

func TestMock_HashOverrideBeatsPrompt(t *testing.T) {
	t.Parallel()
	m := New(provider.Capabilities{})
	req := provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "tell me"}},
	}
	m.SetReplyByPrompt("tell me", Reply{
		ChatResponse: provider.ChatResponse{Message: provider.Message{Content: "by-prompt"}},
	})
	m.SetReplyByHash(req, Reply{
		ChatResponse: provider.ChatResponse{Message: provider.Message{Content: "by-hash"}},
	})
	resp, _ := m.Chat(context.Background(), req)
	if resp.Message.Content != "by-hash" {
		t.Fatalf("hash override should win, got %q", resp.Message.Content)
	}
}

func TestMock_StreamRunesOut(t *testing.T) {
	t.Parallel()
	m := New(provider.Capabilities{Streaming: true})
	m.SetReplyByPrompt("ping", Reply{
		ChatResponse: provider.ChatResponse{Message: provider.Message{Content: "pong"}},
	})
	out, err := m.Stream(context.Background(), provider.ChatRequest{
		Messages: []provider.Message{{Role: provider.RoleUser, Content: "ping"}},
	})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	got := ""
	for c := range out {
		if c.Done {
			break
		}
		got += c.Delta
	}
	if got != "pong" {
		t.Fatalf("stream content = %q", got)
	}
}

func TestMock_StreamCapabilityGate(t *testing.T) {
	t.Parallel()
	m := New(provider.Capabilities{Streaming: false})
	_, err := m.Stream(context.Background(), provider.ChatRequest{})
	if !errors.Is(err, provider.ErrCapabilityNotSupported) {
		t.Fatalf("want ErrCapabilityNotSupported, got %v", err)
	}
}

func TestMock_EmbedDeterminism(t *testing.T) {
	t.Parallel()
	m := New(provider.Capabilities{Embeddings: true})
	req := provider.EmbedRequest{Model: "test", Input: []string{"alpha", "beta"}}
	a, _ := m.Embed(context.Background(), req)
	b, _ := m.Embed(context.Background(), req)
	if len(a.Vectors) != 2 || len(b.Vectors) != 2 {
		t.Fatalf("vector counts: %d / %d", len(a.Vectors), len(b.Vectors))
	}
	for i := range a.Vectors {
		if len(a.Vectors[i]) != 8 {
			t.Fatalf("embed dim = %d", len(a.Vectors[i]))
		}
		for j := range a.Vectors[i] {
			if a.Vectors[i][j] != b.Vectors[i][j] {
				t.Fatalf("non-deterministic embed at i=%d j=%d", i, j)
			}
		}
	}
}

func TestMock_EmbedCapabilityGate(t *testing.T) {
	t.Parallel()
	m := New(provider.Capabilities{Embeddings: false})
	_, err := m.Embed(context.Background(), provider.EmbedRequest{Input: []string{"x"}})
	if !errors.Is(err, provider.ErrCapabilityNotSupported) {
		t.Fatalf("want ErrCapabilityNotSupported, got %v", err)
	}
}

func TestMock_NameAndCapabilities(t *testing.T) {
	t.Parallel()
	caps := provider.Capabilities{Tools: true, Streaming: true, Embeddings: true, MaxContext: 4096}
	m := New(caps)
	if m.Name() != provider.NameMock {
		t.Fatalf("Name() = %q", m.Name())
	}
	if m.Capabilities() != caps {
		t.Fatalf("Capabilities() = %+v", m.Capabilities())
	}
}
