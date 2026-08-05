// Package openai is the OpenAI-compatible [provider.Provider] adapter.
//
// The wire format is the OpenAI Chat Completions / Embeddings API
// (https://platform.openai.com/docs/api-reference). Any server that
// implements the same surface — vLLM, LiteLLM, Together, Groq,
// Cloudflare Workers AI — works through this adapter unchanged
// because the only thing that varies is the cfg.BaseURL.
//
// Azure has its own dedicated adapter
// ([github.com/ev-dev-labs/teslasync/internal/ai/provider/azure])
// because Azure OpenAI Service routes by deployment-name in the URL
// path, uses an `api-key` header instead of `Authorization: Bearer`,
// and requires an `api-version` query parameter — three departures
// that this package does not cover.
package openai

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
	defaultTimeout   = 120 * time.Second
	chatPath         = "/v1/chat/completions"
	embedPath        = "/v1/embeddings"
	streamSentinel   = "[DONE]"
	streamPrefixData = "data: "
)

// Adapter is the OpenAI-compatible [provider.Provider]. Construct via
// [New]; safe for concurrent use across goroutines.
type Adapter struct {
	cfg    provider.ProviderConfig
	client *http.Client
}

// Option configures an [Adapter] at construction.
type Option func(*Adapter)

// WithHTTPClient overrides the default [http.Client]. Tests use this
// to inject a httptest-backed client.
func WithHTTPClient(c *http.Client) Option {
	return func(a *Adapter) { a.client = c }
}

// New constructs an [Adapter]. Returns an error if base_url is empty;
// API key is allowed to be empty so a self-hosted endpoint that does
// not require auth (vLLM, Ollama-compat) works.
func New(cfg provider.ProviderConfig, opts ...Option) (*Adapter, error) {
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return nil, fmt.Errorf("openai: empty base_url")
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
func (a *Adapter) Name() string { return provider.NameOpenAI }

// Capabilities implements [provider.Provider]. The OpenAI surface
// supports tools + streaming + embeddings.
func (a *Adapter) Capabilities() provider.Capabilities {
	return provider.Capabilities{
		Tools:      true,
		Streaming:  true,
		Embeddings: true,
		MaxContext: 128_000,
	}
}

// Chat implements [provider.Provider] non-streaming completion.
func (a *Adapter) Chat(ctx context.Context, req provider.ChatRequest) (*provider.ChatResponse, error) {
	body, err := encodeChatRequest(a.cfg, req, false)
	if err != nil {
		return nil, err
	}
	httpReq, err := a.newRequest(ctx, http.MethodPost, chatPath, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	resp, err := a.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: openai chat: %v", provider.ErrUpstream, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("%w: openai chat status %d: %s", provider.ErrUpstream, resp.StatusCode, string(raw))
	}
	var wire openAIChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&wire); err != nil {
		return nil, fmt.Errorf("%w: openai chat decode: %v", provider.ErrUpstream, err)
	}
	return wire.toChatResponse(), nil
}

// Stream implements [provider.Provider] streaming completion.
func (a *Adapter) Stream(ctx context.Context, req provider.ChatRequest) (<-chan provider.Chunk, error) {
	body, err := encodeChatRequest(a.cfg, req, true)
	if err != nil {
		return nil, err
	}
	httpReq, err := a.newRequest(ctx, http.MethodPost, chatPath, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Accept", "text/event-stream")
	resp, err := a.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: openai stream: %v", provider.ErrUpstream, err)
	}
	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		_ = resp.Body.Close()
		return nil, fmt.Errorf("%w: openai stream status %d: %s", provider.ErrUpstream, resp.StatusCode, string(raw))
	}
	out := make(chan provider.Chunk, 8)
	go relayStream(ctx, resp.Body, out)
	return out, nil
}

// Embed implements [provider.Provider]. OpenAI accepts a true batch in
// one round-trip, so we send req.Input as a single array.
func (a *Adapter) Embed(ctx context.Context, req provider.EmbedRequest) (*provider.EmbedResponse, error) {
	model := req.Model
	if model == "" {
		model = a.cfg.EmbeddingModel
	}
	if model == "" {
		return nil, fmt.Errorf("openai: empty embedding model")
	}
	body, err := json.Marshal(map[string]any{
		"model": model,
		"input": req.Input,
	})
	if err != nil {
		return nil, err
	}
	httpReq, err := a.newRequest(ctx, http.MethodPost, embedPath, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	resp, err := a.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: openai embed: %v", provider.ErrUpstream, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("%w: openai embed status %d: %s", provider.ErrUpstream, resp.StatusCode, string(raw))
	}
	var wire struct {
		Data []struct {
			Embedding []float32 `json:"embedding"`
			Index     int       `json:"index"`
		} `json:"data"`
		Usage struct {
			PromptTokens int `json:"prompt_tokens"`
		} `json:"usage"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&wire); err != nil {
		return nil, fmt.Errorf("%w: openai embed decode: %v", provider.ErrUpstream, err)
	}
	out := &provider.EmbedResponse{
		Vectors:     make([][]float32, len(wire.Data)),
		InputTokens: wire.Usage.PromptTokens,
	}
	for _, d := range wire.Data {
		if d.Index >= 0 && d.Index < len(out.Vectors) {
			out.Vectors[d.Index] = d.Embedding
		}
	}
	return out, nil
}

func (a *Adapter) newRequest(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, a.cfg.BaseURL+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if a.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+a.cfg.APIKey)
	}
	return req, nil
}

// --- wire types --------------------------------------------------------

type openAIChatRequest struct {
	Model       string           `json:"model"`
	Messages    []openAIWireMsg  `json:"messages"`
	Tools       []openAIWireTool `json:"tools,omitempty"`
	Stream      bool             `json:"stream,omitempty"`
	Temperature float32          `json:"temperature,omitempty"`
	MaxTokens   int              `json:"max_tokens,omitempty"`
}

type openAIWireMsg struct {
	Role string `json:"role"`
	// Content is intentionally NOT `omitempty`: an assistant
	// message that proposes tool_calls is allowed to have empty
	// content per the OpenAI spec, but the field MUST be present
	// in the JSON payload — otherwise OpenAI rejects the next
	// turn with `messages.[N].content: expected a string, got
	// null`. Always emitting `"content": ""` is valid for all
	// roles. (See azure.go for the same rationale.)
	Content    string               `json:"content"`
	Name       string               `json:"name,omitempty"`
	ToolCallID string               `json:"tool_call_id,omitempty"`
	ToolCalls  []openAIWireToolCall `json:"tool_calls,omitempty"`
}

type openAIWireToolCall struct {
	Index    int    `json:"index,omitempty"`
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type openAIWireTool struct {
	Type     string `json:"type"`
	Function struct {
		Name        string          `json:"name"`
		Description string          `json:"description,omitempty"`
		Parameters  json.RawMessage `json:"parameters,omitempty"`
	} `json:"function"`
}

type openAIChatResponse struct {
	ID      string `json:"id"`
	Choices []struct {
		Index        int           `json:"index"`
		Message      openAIWireMsg `json:"message"`
		FinishReason string        `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

type openAIStreamFrame struct {
	Choices []struct {
		Index int `json:"index"`
		Delta struct {
			Content   string               `json:"content,omitempty"`
			ToolCalls []openAIWireToolCall `json:"tool_calls,omitempty"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason,omitempty"`
	} `json:"choices"`
}

func encodeChatRequest(cfg provider.ProviderConfig, req provider.ChatRequest, stream bool) ([]byte, error) {
	model := req.Model
	if model == "" {
		model = cfg.Model
	}
	if model == "" {
		return nil, fmt.Errorf("openai: empty model")
	}
	wireMsgs := make([]openAIWireMsg, 0, len(req.Messages))
	for _, m := range req.Messages {
		wm := openAIWireMsg{Role: m.Role, Content: m.Content, Name: m.Name, ToolCallID: m.ToolID}
		// Legacy singular tool field (legacy callers and tests).
		if m.Tool != nil {
			tc := openAIWireToolCall{ID: m.Tool.ID, Type: "function"}
			tc.Function.Name = m.Tool.Name
			tc.Function.Arguments = string(m.Tool.Arguments)
			wm.ToolCalls = append(wm.ToolCalls, tc)
		}
		// Plural tool_calls — round-tripped from the prior
		// assistant turn by dispatch.go (see provider.Message).
		for _, mc := range m.ToolCalls {
			tc := openAIWireToolCall{ID: mc.ID, Type: "function"}
			tc.Function.Name = mc.Name
			tc.Function.Arguments = string(mc.Arguments)
			wm.ToolCalls = append(wm.ToolCalls, tc)
		}
		wireMsgs = append(wireMsgs, wm)
	}
	wireTools := make([]openAIWireTool, 0, len(req.Tools))
	for _, t := range req.Tools {
		wt := openAIWireTool{Type: "function"}
		wt.Function.Name = t.Name
		wt.Function.Description = t.Description
		wt.Function.Parameters = t.Parameters
		wireTools = append(wireTools, wt)
	}
	wire := openAIChatRequest{
		Model:       model,
		Messages:    wireMsgs,
		Tools:       wireTools,
		Stream:      stream,
		Temperature: req.Temperature,
		MaxTokens:   req.MaxTokens,
	}
	if len(wireTools) == 0 {
		wire.Tools = nil
	}
	return json.Marshal(wire)
}

func (r *openAIChatResponse) toChatResponse() *provider.ChatResponse {
	out := &provider.ChatResponse{
		InputTokens:  r.Usage.PromptTokens,
		OutputTokens: r.Usage.CompletionTokens,
		FinishReason: provider.FinishStop,
	}
	if len(r.Choices) == 0 {
		return out
	}
	c := r.Choices[0]
	out.Message = provider.Message{
		Role:    c.Message.Role,
		Content: c.Message.Content,
		Name:    c.Message.Name,
		ToolID:  c.Message.ToolCallID,
	}
	switch c.FinishReason {
	case "stop":
		out.FinishReason = provider.FinishStop
	case "length":
		out.FinishReason = provider.FinishLength
	case "tool_calls":
		out.FinishReason = provider.FinishToolCalls
	case "content_filter":
		out.FinishReason = provider.FinishContentFilter
	}
	for _, tc := range c.Message.ToolCalls {
		out.ToolCalls = append(out.ToolCalls, provider.ToolCall{
			ID:        tc.ID,
			Name:      tc.Function.Name,
			Arguments: json.RawMessage(tc.Function.Arguments),
		})
	}
	return out
}

func relayStream(ctx context.Context, body io.ReadCloser, out chan<- provider.Chunk) {
	defer close(out)
	defer body.Close()
	var toolCalls provider.ToolCallAccumulator
	emitToolCalls := func() {
		for _, call := range toolCalls.Calls() {
			callCopy := call
			send(ctx, out, provider.Chunk{ToolDelta: &callCopy})
		}
	}
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return
		default:
		}
		raw := strings.TrimSpace(scanner.Text())
		if raw == "" {
			continue
		}
		if !strings.HasPrefix(raw, streamPrefixData) {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(raw, streamPrefixData))
		if payload == streamSentinel {
			emitToolCalls()
			send(ctx, out, provider.Chunk{Done: true})
			return
		}
		var frame openAIStreamFrame
		if err := json.Unmarshal([]byte(payload), &frame); err != nil {
			send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: openai stream decode: %v", provider.ErrUpstream, err)})
			return
		}
		if len(frame.Choices) == 0 {
			continue
		}
		ch := frame.Choices[0]
		if ch.Delta.Content != "" {
			send(ctx, out, provider.Chunk{Delta: ch.Delta.Content})
		}
		for _, tc := range ch.Delta.ToolCalls {
			toolCalls.Add(tc.Index, tc.ID, tc.Function.Name, tc.Function.Arguments)
		}
		if ch.FinishReason != "" {
			emitToolCalls()
			send(ctx, out, provider.Chunk{Done: true})
			return
		}
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, io.EOF) {
		send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: openai stream read: %v", provider.ErrUpstream, err)})
	}
}

func send(ctx context.Context, out chan<- provider.Chunk, c provider.Chunk) {
	select {
	case <-ctx.Done():
	case out <- c:
	}
}

var _ provider.Provider = (*Adapter)(nil)
