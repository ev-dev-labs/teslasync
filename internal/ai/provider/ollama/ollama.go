// Package ollama is the [provider.Provider] adapter for an Ollama
// server (https://github.com/ollama/ollama).
//
// Ollama exposes /api/chat for chat completions (with optional
// streaming) and /api/embeddings for vector generation. Both routes
// are unauthenticated by default; the local-mode validator
// (provider.ValidateLocal) keeps the user from pointing it at a
// public host.
package ollama

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

const (
	defaultTimeout = 120 * time.Second
	chatPath       = "/api/chat"
	embedPath      = "/api/embeddings"
)

// Adapter is the Ollama-backed [provider.Provider]. Construct via
// [New]; safe for concurrent use across goroutines.
type Adapter struct {
	cfg    provider.ProviderConfig
	client *http.Client
}

// Option configures an [Adapter] at construction. Used by tests to
// inject an [http.Client] backed by httptest.
type Option func(*Adapter)

// WithHTTPClient overrides the default [http.Client]. The default has
// a 120s timeout and uses [httputil.NewHTTPClient] so OTel spans are
// instrumented automatically.
func WithHTTPClient(c *http.Client) Option {
	return func(a *Adapter) { a.client = c }
}

// New constructs an [Adapter] from a typed [provider.ProviderConfig].
// Returned adapter has Streaming + Embeddings + Tools advertised on
// [provider.Capabilities]; tool-call routing is per-model so this is
// best-effort; the dispatcher falls back gracefully.
func New(cfg provider.ProviderConfig, opts ...Option) (*Adapter, error) {
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return nil, fmt.Errorf("ollama: empty base_url")
	}
	a := &Adapter{cfg: cfg}
	for _, opt := range opts {
		opt(a)
	}
	if a.client == nil {
		a.client = httputil.NewHTTPClient(defaultTimeout)
	}
	return a, nil
}

// Builder is the registry-compatible factory for [Adapter].
func Builder(cfg provider.ProviderConfig) (provider.Provider, error) { return New(cfg) }

// Name implements [provider.Provider].
func (a *Adapter) Name() string { return provider.NameOllama }

// Capabilities implements [provider.Provider]. Ollama servers ≥ 0.3 with
// llama3.x-class models support tool calling; we advertise it as true
// and let the dispatcher handle "model returned no tool_calls"
// gracefully.
func (a *Adapter) Capabilities() provider.Capabilities {
	return provider.Capabilities{
		Tools:      true,
		Streaming:  true,
		Embeddings: true,
		MaxContext: 8192,
	}
}

// Chat implements [provider.Provider] non-streaming completion.
func (a *Adapter) Chat(ctx context.Context, req provider.ChatRequest) (*provider.ChatResponse, error) {
	body, err := encodeChatRequest(a.cfg, req, false)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.BaseURL+chatPath, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: ollama chat: %v", provider.ErrUpstream, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("%w: ollama chat status %d: %s", provider.ErrUpstream, resp.StatusCode, string(raw))
	}
	var wire ollamaChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&wire); err != nil {
		return nil, fmt.Errorf("%w: ollama chat decode: %v", provider.ErrUpstream, err)
	}
	return wire.toChatResponse(), nil
}

// Stream implements [provider.Provider] streaming completion.
func (a *Adapter) Stream(ctx context.Context, req provider.ChatRequest) (<-chan provider.Chunk, error) {
	body, err := encodeChatRequest(a.cfg, req, true)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.BaseURL+chatPath, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: ollama stream: %v", provider.ErrUpstream, err)
	}
	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		_ = resp.Body.Close()
		return nil, fmt.Errorf("%w: ollama stream status %d: %s", provider.ErrUpstream, resp.StatusCode, string(raw))
	}
	out := make(chan provider.Chunk, 8)
	go a.relayStream(ctx, resp.Body, out)
	return out, nil
}

// Embed implements [provider.Provider].
//
// Ollama's /api/embeddings only accepts one input per call so we batch
// into N sequential requests. Adapters that proxy a true batch endpoint
// (e.g. OpenAI) override this in their package.
func (a *Adapter) Embed(ctx context.Context, req provider.EmbedRequest) (*provider.EmbedResponse, error) {
	model := req.Model
	if model == "" {
		model = a.cfg.EmbeddingModel
	}
	if model == "" {
		return nil, fmt.Errorf("ollama: empty embedding model")
	}
	out := &provider.EmbedResponse{Vectors: make([][]float32, len(req.Input))}
	for i, in := range req.Input {
		body, err := json.Marshal(map[string]any{"model": model, "prompt": in})
		if err != nil {
			return nil, err
		}
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, a.cfg.BaseURL+embedPath, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		httpReq.Header.Set("Content-Type", "application/json")
		resp, err := a.client.Do(httpReq)
		if err != nil {
			return nil, fmt.Errorf("%w: ollama embed: %v", provider.ErrUpstream, err)
		}
		if resp.StatusCode/100 != 2 {
			raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
			_ = resp.Body.Close()
			return nil, fmt.Errorf("%w: ollama embed status %d: %s", provider.ErrUpstream, resp.StatusCode, string(raw))
		}
		var wire struct {
			Embedding []float32 `json:"embedding"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&wire); err != nil {
			_ = resp.Body.Close()
			return nil, fmt.Errorf("%w: ollama embed decode: %v", provider.ErrUpstream, err)
		}
		_ = resp.Body.Close()
		out.Vectors[i] = wire.Embedding
	}
	return out, nil
}

// relayStream parses Ollama's NDJSON stream and forwards Chunks. The
// terminal frame from Ollama has Done=true; we forward it and close.
func (a *Adapter) relayStream(ctx context.Context, body io.ReadCloser, out chan<- provider.Chunk) {
	defer close(out)
	defer body.Close()
	dec := bufio.NewScanner(body)
	dec.Buffer(make([]byte, 0, 64*1024), 1<<20)
	var toolCalls provider.ToolCallAccumulator
	for dec.Scan() {
		select {
		case <-ctx.Done():
			return
		default:
		}
		line := bytes.TrimSpace(dec.Bytes())
		if len(line) == 0 {
			continue
		}
		var frame ollamaStreamFrame
		if err := json.Unmarshal(line, &frame); err != nil {
			send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: ollama stream decode: %v", provider.ErrUpstream, err)})
			return
		}
		if frame.Message.Content != "" {
			send(ctx, out, provider.Chunk{Delta: frame.Message.Content})
		}
		for index, tc := range frame.Message.ToolCalls {
			toolCalls.Add(index, tc.ID, tc.Function.Name, string(tc.Function.Arguments))
		}
		if frame.Done {
			finishReason := provider.NormalizeFinishReason(frame.DoneReason)
			calls := toolCalls.Calls()
			if len(calls) > 0 && finishReason != provider.FinishLength {
				finishReason = provider.FinishToolCalls
				for _, call := range calls {
					callCopy := call
					send(ctx, out, provider.Chunk{ToolDelta: &callCopy})
				}
			}
			if finishReason == "" {
				finishReason = provider.FinishStop
			}
			send(ctx, out, provider.Chunk{
				Done:         true,
				FinishReason: finishReason,
				InputTokens:  frame.PromptEvalCount,
				OutputTokens: frame.EvalCount,
			})
			return
		}
	}
	if err := dec.Err(); err != nil && !errors.Is(err, io.EOF) {
		send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: ollama stream read: %v", provider.ErrUpstream, err)})
	}
}

func send(ctx context.Context, out chan<- provider.Chunk, c provider.Chunk) {
	select {
	case <-ctx.Done():
	case out <- c:
	}
}

// --- wire types --------------------------------------------------------

type ollamaChatRequest struct {
	Model    string           `json:"model"`
	Messages []ollamaMsg      `json:"messages"`
	Tools    []ollamaWireTool `json:"tools,omitempty"`
	Stream   bool             `json:"stream"`
	Options  map[string]any   `json:"options,omitempty"`
}

// ollamaWireTool is the OpenAI-style tool-declaration envelope that
// Ollama's /api/chat expects. Sending bare {name, description,
// parameters} causes qwen2.5-class models to return tool_calls with an
// empty function.name field (the model can no longer match the call to
// the declared tool), which downstream surfaces as the dispatcher
// rejecting every invocation with `tool "" not allowed for this
// strategy`. The wrapper format is the same shape OpenAI and Anthropic
// emit, so the registry's [provider.ToolSpec] is portable to any
// adapter once each adapter wraps it correctly.
type ollamaWireTool struct {
	Type     string             `json:"type"`
	Function ollamaWireToolFunc `json:"function"`
}

type ollamaWireToolFunc struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters"`
}

type ollamaMsg struct {
	Role       string               `json:"role"`
	Content    string               `json:"content"`
	ToolCalls  []ollamaToolCallWire `json:"tool_calls,omitempty"`
	Name       string               `json:"name,omitempty"`
	ToolCallID string               `json:"tool_call_id,omitempty"`
}

type ollamaToolCallWire struct {
	ID       string `json:"id,omitempty"`
	Function struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	} `json:"function"`
}

type ollamaChatResponse struct {
	Model           string    `json:"model"`
	CreatedAt       time.Time `json:"created_at"`
	Message         ollamaMsg `json:"message"`
	Done            bool      `json:"done"`
	DoneReason      string    `json:"done_reason,omitempty"`
	PromptEvalCount int       `json:"prompt_eval_count"`
	EvalCount       int       `json:"eval_count"`
}

type ollamaStreamFrame struct {
	Model           string    `json:"model"`
	CreatedAt       time.Time `json:"created_at"`
	Message         ollamaMsg `json:"message"`
	Done            bool      `json:"done"`
	DoneReason      string    `json:"done_reason,omitempty"`
	PromptEvalCount int       `json:"prompt_eval_count"`
	EvalCount       int       `json:"eval_count"`
}

func encodeChatRequest(cfg provider.ProviderConfig, req provider.ChatRequest, stream bool) ([]byte, error) {
	model := req.Model
	if model == "" {
		model = cfg.Model
	}
	if model == "" {
		return nil, fmt.Errorf("ollama: empty model")
	}
	wireMsgs := make([]ollamaMsg, 0, len(req.Messages))
	for _, m := range req.Messages {
		wm := ollamaMsg{
			Role:       m.Role,
			Content:    m.Content,
			Name:       m.Name,
			ToolCallID: m.ToolID,
		}
		// Legacy singular tool field — kept for backward
		// compatibility with callers / tests that built Message
		// values by hand before the plural form existed. Ollama itself is
		// lenient about a missing
		// tool_calls array on the wire (unlike OpenAI / Azure)
		// but the round-trip is structurally the same as those
		// providers — see provider.Message.ToolCalls and
		// internal/ai/dispatch/dispatch.go.
		if m.Tool != nil {
			tc := ollamaToolCallWire{ID: m.Tool.ID}
			tc.Function.Name = m.Tool.Name
			tc.Function.Arguments = m.Tool.Arguments
			wm.ToolCalls = append(wm.ToolCalls, tc)
		}
		// Plural tool_calls — set by dispatch.go when copying
		// resp.ToolCalls onto the assistant history message.
		for _, mc := range m.ToolCalls {
			tc := ollamaToolCallWire{ID: mc.ID}
			tc.Function.Name = mc.Name
			tc.Function.Arguments = mc.Arguments
			wm.ToolCalls = append(wm.ToolCalls, tc)
		}
		wireMsgs = append(wireMsgs, wm)
	}
	opts := map[string]any{}
	if req.Temperature > 0 {
		opts["temperature"] = req.Temperature
	}
	if req.MaxTokens > 0 {
		opts["num_predict"] = req.MaxTokens
	}
	wireTools := make([]ollamaWireTool, 0, len(req.Tools))
	for _, t := range req.Tools {
		wireTools = append(wireTools, ollamaWireTool{
			Type: "function",
			Function: ollamaWireToolFunc{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  t.Parameters,
			},
		})
	}
	wire := ollamaChatRequest{
		Model:    model,
		Messages: wireMsgs,
		Tools:    wireTools,
		Stream:   stream,
		Options:  opts,
	}
	if len(opts) == 0 {
		wire.Options = nil
	}
	if len(wireTools) == 0 {
		wire.Tools = nil
	}
	return json.Marshal(wire)
}

func (r *ollamaChatResponse) toChatResponse() *provider.ChatResponse {
	out := &provider.ChatResponse{
		Message: provider.Message{
			Role:    r.Message.Role,
			Content: r.Message.Content,
			Name:    r.Message.Name,
		},
		InputTokens:  r.PromptEvalCount,
		OutputTokens: r.EvalCount,
		FinishReason: provider.FinishStop,
	}
	if r.DoneReason == "length" {
		out.FinishReason = provider.FinishLength
	}
	for _, tc := range r.Message.ToolCalls {
		out.ToolCalls = append(out.ToolCalls, provider.ToolCall{
			ID:        tc.ID,
			Name:      tc.Function.Name,
			Arguments: tc.Function.Arguments,
		})
	}
	if len(out.ToolCalls) > 0 {
		out.FinishReason = provider.FinishToolCalls
	}
	return out
}

// Compile-time interface assertion.
var _ provider.Provider = (*Adapter)(nil)
