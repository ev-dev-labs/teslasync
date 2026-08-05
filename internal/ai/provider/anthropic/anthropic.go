// Package anthropic is the [provider.Provider] adapter for the
// Anthropic Messages API (https://docs.anthropic.com/en/api/messages).
//
// Anthropic does NOT offer an embeddings API; [Adapter.Embed] returns
// [provider.ErrCapabilityNotSupported] and [Adapter.Capabilities]
// reports Embeddings=false so feature code can fail loudly at
// registration rather than at call time.
package anthropic

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
	defaultTimeout    = 120 * time.Second
	messagesPath      = "/v1/messages"
	apiVersionHeader  = "2023-06-01"
	streamPrefixData  = "data: "
	streamPrefixEvent = "event: "
)

// Adapter is the Anthropic Messages [provider.Provider]. Construct via
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

// New constructs an [Adapter]. Returns an error if base_url is empty.
func New(cfg provider.ProviderConfig, opts ...Option) (*Adapter, error) {
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return nil, fmt.Errorf("anthropic: empty base_url")
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
func (a *Adapter) Name() string { return provider.NameAnthropic }

// Capabilities implements [provider.Provider]. Embeddings is false —
// Anthropic does not offer an embeddings endpoint.
func (a *Adapter) Capabilities() provider.Capabilities {
	return provider.Capabilities{
		Tools:      true,
		Streaming:  true,
		Embeddings: false,
		MaxContext: 200_000,
	}
}

// Chat implements [provider.Provider] non-streaming completion.
func (a *Adapter) Chat(ctx context.Context, req provider.ChatRequest) (*provider.ChatResponse, error) {
	body, err := encodeMessagesRequest(a.cfg, req, false)
	if err != nil {
		return nil, err
	}
	httpReq, err := a.newRequest(ctx, http.MethodPost, messagesPath, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	resp, err := a.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: anthropic chat: %v", provider.ErrUpstream, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("%w: anthropic chat status %d: %s", provider.ErrUpstream, resp.StatusCode, string(raw))
	}
	var wire anthropicMessagesResponse
	if err := json.NewDecoder(resp.Body).Decode(&wire); err != nil {
		return nil, fmt.Errorf("%w: anthropic chat decode: %v", provider.ErrUpstream, err)
	}
	return wire.toChatResponse(), nil
}

// Stream implements [provider.Provider] streaming completion.
func (a *Adapter) Stream(ctx context.Context, req provider.ChatRequest) (<-chan provider.Chunk, error) {
	body, err := encodeMessagesRequest(a.cfg, req, true)
	if err != nil {
		return nil, err
	}
	httpReq, err := a.newRequest(ctx, http.MethodPost, messagesPath, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Accept", "text/event-stream")
	resp, err := a.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: anthropic stream: %v", provider.ErrUpstream, err)
	}
	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		_ = resp.Body.Close()
		return nil, fmt.Errorf("%w: anthropic stream status %d: %s", provider.ErrUpstream, resp.StatusCode, string(raw))
	}
	out := make(chan provider.Chunk, 8)
	go relayStream(ctx, resp.Body, out)
	return out, nil
}

// Embed implements [provider.Provider]. Always returns
// [provider.ErrCapabilityNotSupported].
func (a *Adapter) Embed(_ context.Context, _ provider.EmbedRequest) (*provider.EmbedResponse, error) {
	return nil, provider.ErrCapabilityNotSupported
}

func (a *Adapter) newRequest(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, a.cfg.BaseURL+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("anthropic-version", apiVersionHeader)
	if a.cfg.APIKey != "" {
		req.Header.Set("x-api-key", a.cfg.APIKey)
	}
	return req, nil
}

// --- wire types --------------------------------------------------------

type anthropicMessagesRequest struct {
	Model       string              `json:"model"`
	System      string              `json:"system,omitempty"`
	Messages    []anthropicWireMsg  `json:"messages"`
	Tools       []anthropicWireTool `json:"tools,omitempty"`
	Stream      bool                `json:"stream,omitempty"`
	Temperature float32             `json:"temperature,omitempty"`
	MaxTokens   int                 `json:"max_tokens"`
}

type anthropicWireMsg struct {
	Role    string               `json:"role"`
	Content []anthropicWireBlock `json:"content"`
}

type anthropicWireBlock struct {
	Type      string          `json:"type"`
	Text      string          `json:"text,omitempty"`
	ID        string          `json:"id,omitempty"`
	Name      string          `json:"name,omitempty"`
	Input     json.RawMessage `json:"input,omitempty"`
	ToolUseID string          `json:"tool_use_id,omitempty"`
	Content   json.RawMessage `json:"content,omitempty"`
}

type anthropicWireTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"input_schema"`
}

type anthropicMessagesResponse struct {
	ID         string               `json:"id"`
	Role       string               `json:"role"`
	Content    []anthropicWireBlock `json:"content"`
	StopReason string               `json:"stop_reason"`
	Usage      struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
}

type anthropicStreamFrame struct {
	Type  string `json:"type"`
	Index int    `json:"index"`
	Delta struct {
		Type        string `json:"type"`
		Text        string `json:"text"`
		StopReason  string `json:"stop_reason"`
		PartialJSON string `json:"partial_json"`
	} `json:"delta"`
	ContentBlock anthropicWireBlock `json:"content_block"`
}

func encodeMessagesRequest(cfg provider.ProviderConfig, req provider.ChatRequest, stream bool) ([]byte, error) {
	model := req.Model
	if model == "" {
		model = cfg.Model
	}
	if model == "" {
		return nil, fmt.Errorf("anthropic: empty model")
	}
	max := req.MaxTokens
	if max == 0 {
		// Anthropic requires max_tokens to be set; pick a reasonable
		// default that covers normal chat completions.
		max = 1024
	}
	wireMsgs := make([]anthropicWireMsg, 0, len(req.Messages))
	systemPrompt := ""
	for _, m := range req.Messages {
		if m.Role == provider.RoleSystem {
			if systemPrompt != "" {
				systemPrompt += "\n\n"
			}
			systemPrompt += m.Content
			continue
		}
		blocks := []anthropicWireBlock{}
		if m.Role == provider.RoleTool {
			blocks = append(blocks, anthropicWireBlock{
				Type:      "tool_result",
				ToolUseID: m.ToolID,
				Content:   json.RawMessage(jsonString(m.Content)),
			})
		} else if m.Tool != nil || len(m.ToolCalls) > 0 {
			// Anthropic encodes assistant tool proposals as one
			// `tool_use` block per call. Emit text first if the
			// model also produced commentary alongside the call.
			if m.Content != "" {
				blocks = append(blocks, anthropicWireBlock{Type: "text", Text: m.Content})
			}
			// Preserve support for callers that still send the singular tool field.
			if m.Tool != nil {
				blocks = append(blocks, anthropicWireBlock{
					Type:  "tool_use",
					ID:    m.Tool.ID,
					Name:  m.Tool.Name,
					Input: m.Tool.Arguments,
				})
			}
			// Plural tool_calls — round-tripped from prior turn
			// by dispatch.go (see provider.Message.ToolCalls).
			for _, mc := range m.ToolCalls {
				blocks = append(blocks, anthropicWireBlock{
					Type:  "tool_use",
					ID:    mc.ID,
					Name:  mc.Name,
					Input: mc.Arguments,
				})
			}
		} else {
			blocks = append(blocks, anthropicWireBlock{Type: "text", Text: m.Content})
		}
		role := m.Role
		if role == provider.RoleTool {
			role = provider.RoleUser
		}
		wireMsgs = append(wireMsgs, anthropicWireMsg{Role: role, Content: blocks})
	}
	wireTools := make([]anthropicWireTool, 0, len(req.Tools))
	for _, t := range req.Tools {
		wireTools = append(wireTools, anthropicWireTool{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: t.Parameters,
		})
	}
	wire := anthropicMessagesRequest{
		Model:       model,
		System:      systemPrompt,
		Messages:    wireMsgs,
		Tools:       wireTools,
		Stream:      stream,
		Temperature: req.Temperature,
		MaxTokens:   max,
	}
	if len(wireTools) == 0 {
		wire.Tools = nil
	}
	return json.Marshal(wire)
}

func jsonString(s string) []byte {
	b, _ := json.Marshal(s)
	return b
}

func (r *anthropicMessagesResponse) toChatResponse() *provider.ChatResponse {
	out := &provider.ChatResponse{
		InputTokens:  r.Usage.InputTokens,
		OutputTokens: r.Usage.OutputTokens,
		FinishReason: provider.FinishStop,
	}
	switch r.StopReason {
	case "end_turn", "stop_sequence":
		out.FinishReason = provider.FinishStop
	case "max_tokens":
		out.FinishReason = provider.FinishLength
	case "tool_use":
		out.FinishReason = provider.FinishToolCalls
	}
	textParts := []string{}
	for _, b := range r.Content {
		switch b.Type {
		case "text":
			textParts = append(textParts, b.Text)
		case "tool_use":
			out.ToolCalls = append(out.ToolCalls, provider.ToolCall{
				ID:        b.ID,
				Name:      b.Name,
				Arguments: b.Input,
			})
		}
	}
	out.Message = provider.Message{Role: r.Role, Content: strings.Join(textParts, "")}
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
		if raw == "" || strings.HasPrefix(raw, streamPrefixEvent) {
			continue
		}
		if !strings.HasPrefix(raw, streamPrefixData) {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(raw, streamPrefixData))
		var frame anthropicStreamFrame
		if err := json.Unmarshal([]byte(payload), &frame); err != nil {
			send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: anthropic stream decode: %v", provider.ErrUpstream, err)})
			return
		}
		switch frame.Type {
		case "content_block_delta":
			if frame.Delta.Text != "" {
				send(ctx, out, provider.Chunk{Delta: frame.Delta.Text})
			}
			if frame.Delta.PartialJSON != "" {
				toolCalls.Add(frame.Index, "", "", frame.Delta.PartialJSON)
			}
		case "content_block_start":
			if frame.ContentBlock.Type == "tool_use" {
				toolCalls.Add(frame.Index, frame.ContentBlock.ID, frame.ContentBlock.Name, "")
			}
		case "message_stop":
			emitToolCalls()
			send(ctx, out, provider.Chunk{Done: true})
			return
		case "error":
			send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: anthropic stream error frame", provider.ErrUpstream)})
			return
		}
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, io.EOF) {
		send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: anthropic stream read: %v", provider.ErrUpstream, err)})
	}
}

func send(ctx context.Context, out chan<- provider.Chunk, c provider.Chunk) {
	select {
	case <-ctx.Done():
	case out <- c:
	}
}

var _ provider.Provider = (*Adapter)(nil)
