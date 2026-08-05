// Package mock implements a deterministic [provider.Provider] for tests
// and the eval harness.
//
// Responses are keyed by sha256(request) so the same input yields the
// same output across runs — the eval harness can assert "model produced
// X" without flake. Tests that want to script specific responses
// register a [Reply] keyed by the input prompt.
package mock

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

// Reply is a canned response for a [Mock] adapter. ChatResponse is
// returned from [Mock.Chat]; the same Content streams back from
// [Mock.Stream] one rune at a time. Embedding produces Vectors.
type Reply struct {
	ChatResponse provider.ChatResponse
	Embedding    [][]float32
	Err          error
}

// Mock is a deterministic [provider.Provider] for tests and eval.
//
// Lookup order on Chat / Stream:
//  1. exact-match by sha256 of the canonical request JSON,
//  2. exact-match by the last user message's Content,
//  3. fallback to [Mock.Default].
type Mock struct {
	mu       sync.RWMutex
	byHash   map[string]Reply
	byPrompt map[string]Reply
	Default  Reply
	caps     provider.Capabilities
}

// New returns a Mock with the supplied capabilities. Use
// [Mock.SetReply] to script responses.
func New(caps provider.Capabilities) *Mock {
	return &Mock{
		byHash:   map[string]Reply{},
		byPrompt: map[string]Reply{},
		caps:     caps,
		Default: Reply{
			ChatResponse: provider.ChatResponse{
				Message: provider.Message{
					Role:    provider.RoleAssistant,
					Content: "ok",
				},
				FinishReason: provider.FinishStop,
			},
		},
	}
}

func (m *Mock) Name() string { return provider.NameMock }

func (m *Mock) Capabilities() provider.Capabilities { return m.caps }

// SetReplyByPrompt scripts a reply when the last user message in the
// chat request equals prompt. Used by the eval harness to seed
// per-golden expectations.
func (m *Mock) SetReplyByPrompt(prompt string, r Reply) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.byPrompt[prompt] = r
}

// SetReplyByHash scripts a reply keyed by the canonical hash of req.
// The hash is sha256(json(req)) so test code that wants a guaranteed
// match can pre-hash with [HashRequest] and store the result.
func (m *Mock) SetReplyByHash(req provider.ChatRequest, r Reply) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.byHash[HashRequest(req)] = r
}

// HashRequest is the canonical request hasher used by [Mock]. Exposed
// so tests can pre-compute the key.
func HashRequest(req provider.ChatRequest) string {
	blob, _ := json.Marshal(req)
	sum := sha256.Sum256(blob)
	return hex.EncodeToString(sum[:])
}

func (m *Mock) Chat(ctx context.Context, req provider.ChatRequest) (*provider.ChatResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r := m.lookup(req)
	if r.Err != nil {
		return nil, r.Err
	}
	resp := r.ChatResponse
	return &resp, nil
}

// Stream emits the canned response one rune per chunk so tests can
// assert backpressure behaviour without coupling to a provider's frame
// boundaries.
func (m *Mock) Stream(ctx context.Context, req provider.ChatRequest) (<-chan provider.Chunk, error) {
	if !m.caps.Streaming {
		return nil, provider.ErrCapabilityNotSupported
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r := m.lookup(req)
	out := make(chan provider.Chunk, 8)
	go func() {
		defer close(out)
		if r.Err != nil {
			select {
			case out <- provider.Chunk{Err: r.Err}:
			case <-ctx.Done():
			}
			return
		}
		for _, ru := range r.ChatResponse.Message.Content {
			select {
			case <-ctx.Done():
				return
			case out <- provider.Chunk{Delta: string(ru)}:
			}
		}
		for _, call := range r.ChatResponse.ToolCalls {
			callCopy := call
			select {
			case <-ctx.Done():
				return
			case out <- provider.Chunk{ToolDelta: &callCopy}:
			}
		}
		select {
		case <-ctx.Done():
		case out <- provider.Chunk{Done: true}:
		}
	}()
	return out, nil
}

// Embed returns the Reply.Embedding from the matched canned reply.
// If none exists, it returns a deterministic 8-dim vector per input
// derived from sha256 so tests can assert
// repeatability without specifying exact floats.
func (m *Mock) Embed(ctx context.Context, req provider.EmbedRequest) (*provider.EmbedResponse, error) {
	if !m.caps.Embeddings {
		return nil, provider.ErrCapabilityNotSupported
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	vectors := make([][]float32, len(req.Input))
	for i, in := range req.Input {
		key := fmt.Sprintf("%s\x00%s", req.Model, in)
		sum := sha256.Sum256([]byte(key))
		v := make([]float32, 8)
		for j := 0; j < 8; j++ {
			v[j] = float32(sum[j]) / 255.0
		}
		vectors[i] = v
	}
	return &provider.EmbedResponse{Vectors: vectors}, nil
}

func (m *Mock) lookup(req provider.ChatRequest) Reply {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if r, ok := m.byHash[HashRequest(req)]; ok {
		return r
	}
	for i := len(req.Messages) - 1; i >= 0; i-- {
		if req.Messages[i].Role == provider.RoleUser {
			if r, ok := m.byPrompt[req.Messages[i].Content]; ok {
				return r
			}
			break
		}
	}
	return m.Default
}

// Compile-time assertion the adapter satisfies the port.
var _ provider.Provider = (*Mock)(nil)
