// Package azure implements Microsoft Foundry OpenAI v1.
// Auto tries Chat Completions then one Responses fallback on a structured
// unsupported-operation / not-found error. Explicit protocols never negotiate.
// https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses
package azure

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

const (
	defaultTimeout   = 120 * time.Second
	streamSentinel   = "[DONE]"
	streamPrefixData = "data:"
)

// Adapter is the Azure AI [provider.Provider]. Construct via
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

// New constructs an [Adapter]. Returns an error when:
//
//   - cfg.BaseURL is empty (the resource endpoint is required and has
//     no sensible default — Azure resources are per-tenant).
//   - cfg.APIKey is empty (Azure rejects unauthenticated requests with
//     a 401; failing fast at construction beats a confusing runtime
//     error).
//   - cfg.BaseURL fails to parse as a URL.
//
// Resource roots are normalized to /openai/v1. Other API paths are rejected,
// rather than silently changing the target surface.
func New(cfg provider.ProviderConfig, opts ...Option) (*Adapter, error) {
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return nil, fmt.Errorf("azure: empty base_url")
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, fmt.Errorf("azure: empty api_key")
	}
	u, err := url.Parse(strings.TrimSpace(cfg.BaseURL))
	if err != nil {
		return nil, fmt.Errorf("azure: parse base_url: %w", err)
	}
	if (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("azure: base_url must be a Foundry resource URL without credentials, query or fragment")
	}
	switch strings.TrimRight(u.Path, "/") {
	case "", "/openai/v1":
		u.Path = "/openai/v1"
	default:
		return nil, fmt.Errorf("azure: use the Foundry /openai/v1 base URL; other API paths are not supported")
	}
	cfg.BaseURL = u.String()
	if cfg.APIProtocol == "" {
		cfg.APIProtocol = provider.FoundryProtocolAuto
	}
	switch cfg.APIProtocol {
	case provider.FoundryProtocolAuto, provider.FoundryProtocolChat, provider.FoundryProtocolResponses:
	default:
		return nil, fmt.Errorf("azure: unknown api_protocol %q", cfg.APIProtocol)
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

func (a *Adapter) Name() string { return provider.NameAzure }

// Responses streaming is buffered; Chat Completions uses native SSE.
func (a *Adapter) Capabilities() provider.Capabilities {
	return provider.Capabilities{
		Tools:      true,
		Streaming:  true,
		Embeddings: true,
		MaxContext: 128_000,
	}
}

func (a *Adapter) Chat(ctx context.Context, req provider.ChatRequest) (*provider.ChatResponse, error) {
	if a.cfg.APIProtocol == provider.FoundryProtocolResponses {
		return a.chatViaResponses(ctx, req)
	}
	out, err := a.doChatCompletions(ctx, req)
	if err == nil {
		return out, nil
	}
	if a.cfg.APIProtocol == provider.FoundryProtocolAuto && canTryResponses(err) && ctx.Err() == nil {
		fallback, fallbackErr := a.chatViaResponses(ctx, req)
		if fallbackErr != nil {
			return nil, errors.Join(err, fallbackErr)
		}
		return fallback, nil
	}
	return nil, err
}

func (a *Adapter) doChatCompletions(ctx context.Context, req provider.ChatRequest) (*provider.ChatResponse, error) {
	endpoint, modelInBody, err := a.chatEndpoint(req)
	if err != nil {
		return nil, err
	}
	body, err := encodeChatRequest(req, modelInBody, false)
	if err != nil {
		return nil, err
	}
	httpReq, err := a.newRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	resp, err := a.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: azure chat: %w", provider.ErrUpstream, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 4096))
		if readErr != nil {
			return nil, fmt.Errorf("%w: azure chat error response: %w", provider.ErrUpstream, readErr)
		}
		return nil, newOperationError("chat", resp.StatusCode, raw)
	}
	var wire azureChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&wire); err != nil {
		return nil, fmt.Errorf("%w: azure chat decode: %w", provider.ErrUpstream, err)
	}
	return wire.toChatResponse()
}

func (a *Adapter) Stream(ctx context.Context, req provider.ChatRequest) (chunks <-chan provider.Chunk, err error) {
	defer func() {
		if err != nil {
			err = errors.Join(provider.ErrStreamFinal, err)
		}
	}()
	if a.cfg.APIProtocol == provider.FoundryProtocolResponses {
		resp, err := a.chatViaResponses(ctx, req)
		if err != nil {
			return nil, err
		}
		return chatResponseAsStream(ctx, resp), nil
	}
	endpoint, modelInBody, err := a.chatEndpoint(req)
	if err != nil {
		return nil, err
	}
	body, err := encodeChatRequest(req, modelInBody, true)
	if err != nil {
		return nil, err
	}
	httpReq, err := a.newRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Accept", "text/event-stream")
	resp, err := a.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: azure stream: %w", provider.ErrUpstream, err)
	}
	if resp.StatusCode/100 != 2 {
		raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 4096))
		_ = resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("%w: azure stream error response: %w", provider.ErrUpstream, readErr)
		}
		streamErr := newOperationError("stream", resp.StatusCode, raw)
		if a.cfg.APIProtocol == provider.FoundryProtocolAuto && canTryResponses(streamErr) && ctx.Err() == nil {
			chatResp, fallbackErr := a.chatViaResponses(ctx, req)
			if fallbackErr != nil {
				return nil, errors.Join(streamErr, fallbackErr)
			}
			return chatResponseAsStream(ctx, chatResp), nil
		}
		return nil, streamErr
	}
	out := make(chan provider.Chunk, 8)
	go relayStream(ctx, resp.Body, out)
	return out, nil
}

// chatResponseAsStream turns a completed Chat response into the
// Stream channel shape dispatch already consumes.
func chatResponseAsStream(ctx context.Context, resp *provider.ChatResponse) <-chan provider.Chunk {
	out := make(chan provider.Chunk, 8)
	go func() {
		defer close(out)
		if resp == nil {
			send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: azure stream fallback returned nil chat", provider.ErrUpstream)})
			return
		}
		if resp.Message.Content != "" {
			send(ctx, out, provider.Chunk{Delta: resp.Message.Content})
		}
		for i := range resp.ToolCalls {
			call := resp.ToolCalls[i]
			send(ctx, out, provider.Chunk{ToolDelta: &call})
		}
		finish := resp.FinishReason
		if finish == "" {
			if len(resp.ToolCalls) > 0 {
				finish = provider.FinishToolCalls
			} else {
				finish = provider.FinishStop
			}
		}
		send(ctx, out, provider.Chunk{
			Done:          true,
			FinishReason:  finish,
			InputTokens:   resp.InputTokens,
			OutputTokens:  resp.OutputTokens,
			ProviderState: resp.Message.ProviderState,
		})
	}()
	return out
}

// Embed always uses Foundry v1 embeddings, independently of the chat protocol.
func (a *Adapter) Embed(ctx context.Context, req provider.EmbedRequest) (*provider.EmbedResponse, error) {
	identity := a.embedIdentity(req)
	if identity == "" {
		return nil, fmt.Errorf("azure: empty embedding deployment / model")
	}
	endpoint, err := a.buildOpenAIV1URL("embeddings")
	if err != nil {
		return nil, err
	}
	payload := map[string]any{"input": req.Input, "model": identity}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	httpReq, err := a.newRequest(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	resp, err := a.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: azure embed: %w", provider.ErrUpstream, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("%w: azure embed status %d: %s", provider.ErrUpstream, resp.StatusCode, string(raw))
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
		return nil, fmt.Errorf("%w: azure embed decode: %w", provider.ErrUpstream, err)
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

func (a *Adapter) chatEndpoint(req provider.ChatRequest) (endpoint string, modelInBody string, err error) {
	identity := a.chatDeployment(req)
	if identity == "" {
		return "", "", fmt.Errorf("azure: empty Foundry deployment name")
	}
	u, err := a.buildOpenAIV1URL("chat", "completions")
	return u, identity, err
}

func (a *Adapter) chatDeployment(req provider.ChatRequest) string {
	if req.Model != "" {
		return req.Model
	}
	return a.cfg.Model
}

func (a *Adapter) embedIdentity(req provider.EmbedRequest) string {
	if req.Model != "" {
		return req.Model
	}
	return a.cfg.EmbeddingModel
}

const defaultMaxCompletionTokens = 8192

func (a *Adapter) buildOpenAIV1URL(segments ...string) (string, error) {
	return url.JoinPath(a.cfg.BaseURL, segments...)
}

func (a *Adapter) newRequest(ctx context.Context, method, urlStr string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, urlStr, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api-key", a.cfg.APIKey)
	req.Header.Set("Authorization", "Bearer "+a.cfg.APIKey)
	return req, nil
}

// Wire types.
//
// Mirror openai/openai.go because Azure's chat completions JSON shape
// is identical to OpenAI's. Re-declared here (rather than imported)
// to keep the two adapters independent — a future Azure schema drift
// can be absorbed without breaking the openai adapter.

type azureChatRequest struct {
	Model               string          `json:"model,omitempty"`
	Messages            []azureWireMsg  `json:"messages"`
	Tools               []azureWireTool `json:"tools,omitempty"`
	Stream              bool            `json:"stream,omitempty"`
	MaxCompletionTokens int             `json:"max_completion_tokens,omitempty"`
}

type azureWireMsg struct {
	Role string `json:"role"`
	// Content is intentionally NOT `omitempty`: an assistant
	// message that proposes tool_calls is allowed to have empty
	// content per the OpenAI/Azure spec, but the field MUST be
	// present in the JSON payload — otherwise Azure rejects the
	// next turn with `messages.[N].content: expected a string,
	// got null`. Always emitting `"content": ""` is valid for all
	// roles (system / user / assistant / tool).
	Content    string              `json:"content"`
	Name       string              `json:"name,omitempty"`
	ToolCallID string              `json:"tool_call_id,omitempty"`
	ToolCalls  []azureWireToolCall `json:"tool_calls,omitempty"`
	Refusal    string              `json:"refusal,omitempty"`
}

type azureWireToolCall struct {
	Index    int    `json:"index,omitempty"`
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type azureWireTool struct {
	Type     string `json:"type"`
	Function struct {
		Name        string          `json:"name"`
		Description string          `json:"description,omitempty"`
		Parameters  json.RawMessage `json:"parameters,omitempty"`
	} `json:"function"`
}

type azureChatResponse struct {
	ID      string `json:"id"`
	Choices []struct {
		Index        int          `json:"index"`
		Message      azureWireMsg `json:"message"`
		FinishReason string       `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

type azureStreamFrame struct {
	Choices []struct {
		Index int `json:"index"`
		Delta struct {
			Content   string              `json:"content,omitempty"`
			ToolCalls []azureWireToolCall `json:"tool_calls,omitempty"`
			Refusal   string              `json:"refusal,omitempty"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason,omitempty"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
	// Error is the wrapped error payload some Azure deployments
	// emit mid-stream when the upstream guard rails kick in. The
	// outer envelope is a normal `data: {…}` SSE frame so a relay
	// that only inspects choices will silently drop the error.
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func encodeChatRequest(req provider.ChatRequest, modelInBody string, stream bool) ([]byte, error) {
	wireMsgs := make([]azureWireMsg, 0, len(req.Messages))
	for _, m := range req.Messages {
		wm := azureWireMsg{Role: m.Role, Content: m.Content, Name: m.Name, ToolCallID: m.ToolID}
		// Legacy singular tool field, still honored for callers that build
		// Message values by hand.
		if m.Tool != nil {
			tc := azureWireToolCall{ID: m.Tool.ID, Type: "function"}
			tc.Function.Name = m.Tool.Name
			tc.Function.Arguments = string(m.Tool.Arguments)
			wm.ToolCalls = append(wm.ToolCalls, tc)
		}
		// Plural tool_calls — what dispatch.go now copies from
		// resp.ToolCalls into the assistant message before
		// appending to history. This is the round-trip path that
		// makes multi-iteration tool dispatching work.
		for _, mc := range m.ToolCalls {
			tc := azureWireToolCall{ID: mc.ID, Type: "function"}
			tc.Function.Name = mc.Name
			tc.Function.Arguments = string(mc.Arguments)
			wm.ToolCalls = append(wm.ToolCalls, tc)
		}
		wireMsgs = append(wireMsgs, wm)
	}
	wireTools := make([]azureWireTool, 0, len(req.Tools))
	for _, t := range req.Tools {
		wt := azureWireTool{Type: "function"}
		wt.Function.Name = t.Name
		wt.Function.Description = t.Description
		wt.Function.Parameters = t.Parameters
		wireTools = append(wireTools, wt)
	}
	wire := azureChatRequest{
		Model:    modelInBody,
		Messages: wireMsgs,
		Tools:    wireTools,
		Stream:   stream,
	}
	n := req.MaxTokens
	if n <= 0 {
		n = defaultMaxCompletionTokens
	}
	wire.MaxCompletionTokens = n
	if len(wireTools) == 0 {
		wire.Tools = nil
	}
	return json.Marshal(wire)
}

func (r *azureChatResponse) toChatResponse() (*provider.ChatResponse, error) {
	out := &provider.ChatResponse{
		InputTokens:  r.Usage.PromptTokens,
		OutputTokens: r.Usage.CompletionTokens,
		FinishReason: provider.FinishStop,
	}
	if len(r.Choices) == 0 {
		return nil, fmt.Errorf("%w: azure chat returned no choices", provider.ErrUpstream)
	}
	c := r.Choices[0]
	if c.Message.Refusal != "" {
		return nil, fmt.Errorf("%w: azure chat refusal: %s", provider.ErrUpstream, c.Message.Refusal)
	}
	out.Message = provider.Message{
		Role:    c.Message.Role,
		Content: c.Message.Content,
		Name:    c.Message.Name,
		ToolID:  c.Message.ToolCallID,
	}
	out.FinishReason = provider.NormalizeFinishReason(c.FinishReason)
	if out.FinishReason == "" {
		return nil, fmt.Errorf("%w: azure chat returned unknown finish reason %q", provider.ErrUpstream, c.FinishReason)
	}
	for _, tc := range c.Message.ToolCalls {
		if out.FinishReason == provider.FinishLength || out.FinishReason == provider.FinishContentFilter {
			break
		}
		out.ToolCalls = append(out.ToolCalls, provider.ToolCall{
			ID:        tc.ID,
			Name:      tc.Function.Name,
			Arguments: json.RawMessage(tc.Function.Arguments),
		})
	}
	if err := validateCompletedTools(out.ToolCalls, out.FinishReason); err != nil {
		return nil, err
	}
	if out.FinishReason == provider.FinishStop && strings.TrimSpace(out.Message.Content) == "" {
		return nil, fmt.Errorf("%w: azure chat completed without content", provider.ErrUpstream)
	}
	return out, nil
}

func relayStream(ctx context.Context, body io.ReadCloser, out chan<- provider.Chunk) {
	defer close(out)
	defer body.Close()
	stopClose := context.AfterFunc(ctx, func() { _ = body.Close() })
	defer stopClose()
	var toolCalls provider.ToolCallAccumulator
	var finishReason string
	var inputTokens, outputTokens int
	var hasContent bool
	emitTerminal := func() {
		calls := toolCalls.Calls()
		if finishReason == "" {
			send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: azure stream ended without a finish reason", provider.ErrUpstream)})
			return
		}
		if finishReason == provider.FinishLength || finishReason == provider.FinishContentFilter {
			calls = nil
		}
		if err := validateCompletedTools(calls, finishReason); err != nil {
			send(ctx, out, provider.Chunk{Err: err})
			return
		}
		if finishReason == provider.FinishStop && !hasContent {
			send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: azure stream completed without content", provider.ErrUpstream)})
			return
		}
		if finishReason == provider.FinishToolCalls {
			for _, call := range calls {
				callCopy := call
				send(ctx, out, provider.Chunk{ToolDelta: &callCopy})
			}
		}
		send(ctx, out, provider.Chunk{
			Done:         true,
			FinishReason: finishReason,
			InputTokens:  inputTokens,
			OutputTokens: outputTokens,
		})
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
			emitTerminal()
			return
		}
		var frame azureStreamFrame
		if err := json.Unmarshal([]byte(payload), &frame); err != nil {
			send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: azure stream decode: %v", provider.ErrUpstream, err)})
			return
		}
		// Azure can emit a structured error mid-stream — surface it
		// rather than silently swallow when there are no choices.
		if frame.Error != nil {
			send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: azure stream %s: %s",
				provider.ErrUpstream, frame.Error.Code, frame.Error.Message)})
			return
		}
		if frame.Usage.PromptTokens > 0 {
			inputTokens = frame.Usage.PromptTokens
		}
		if frame.Usage.CompletionTokens > 0 {
			outputTokens = frame.Usage.CompletionTokens
		}
		if len(frame.Choices) == 0 {
			// Azure also emits content-filter / annotation frames
			// with empty choices that carry no usable delta. Skip
			// silently — the next data frame will carry content.
			continue
		}
		ch := frame.Choices[0]
		if ch.Delta.Refusal != "" {
			send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: azure stream refusal: %s", provider.ErrUpstream, ch.Delta.Refusal)})
			return
		}
		if ch.Delta.Content != "" {
			hasContent = hasContent || strings.TrimSpace(ch.Delta.Content) != ""
			send(ctx, out, provider.Chunk{Delta: ch.Delta.Content})
		}
		for _, tc := range ch.Delta.ToolCalls {
			toolCalls.Add(tc.Index, tc.ID, tc.Function.Name, tc.Function.Arguments)
		}
		if ch.FinishReason != "" {
			finishReason = provider.NormalizeFinishReason(ch.FinishReason)
			if finishReason == "" {
				send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: azure returned unknown finish reason %q", provider.ErrUpstream, ch.FinishReason)})
				return
			}
		}
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, io.EOF) {
		send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: azure stream read: %w", provider.ErrUpstream, err)})
		return
	}
	emitTerminal()
}

func send(ctx context.Context, out chan<- provider.Chunk, c provider.Chunk) {
	if ctx.Err() != nil {
		return
	}
	select {
	case <-ctx.Done():
	case out <- c:
	}
}

func validateCompletedTools(calls []provider.ToolCall, finish string) error {
	if (len(calls) > 0) != (finish == provider.FinishToolCalls) {
		return fmt.Errorf("%w: azure tool calls inconsistent with finish reason %q", provider.ErrUpstream, finish)
	}
	seen := make(map[string]bool, len(calls))
	for _, call := range calls {
		var args map[string]json.RawMessage
		if strings.TrimSpace(call.ID) == "" || strings.TrimSpace(call.Name) == "" || seen[call.ID] ||
			json.Unmarshal(call.Arguments, &args) != nil || args == nil {
			return fmt.Errorf("%w: azure invalid or duplicate function call", provider.ErrUpstream)
		}
		seen[call.ID] = true
	}
	return nil
}

var _ provider.Provider = (*Adapter)(nil)
