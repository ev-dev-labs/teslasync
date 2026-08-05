// Package azure is the Azure AI [provider.Provider] adapter.
//
// Microsoft hosts AI inference behind two distinct surfaces and this
// adapter supports both via the [provider.ProviderConfig.Flavor] knob:
//
//  1. Azure OpenAI Service ([provider.AzureFlavorOpenAI], the default).
//     Hosts the OpenAI model family (gpt-4o, gpt-4-turbo,
//     text-embedding-3-*, etc.). Routes by *deployment name* in the URL
//     path:
//
//     {base_url}/openai/deployments/{deployment}/chat/completions
//     ?api-version={version}
//
//     where {base_url} is the resource endpoint
//     (https://{resource}.openai.azure.com). The request body MUST
//     omit the "model" field — Azure rejects requests where the body
//     model disagrees with the deployment.
//
//  2. Azure AI Foundry / Inference API ([provider.AzureFlavorFoundry]).
//     The unified multi-vendor surface — hosts Llama, Mistral, Cohere,
//     Phi, OpenAI models, and others through one endpoint:
//
//     {base_url}/chat/completions?api-version={version}
//     {base_url}/embeddings?api-version={version}
//
//     Routes by *model* in the request body. Use this flavor when you
//     have provisioned a Foundry endpoint or a serverless deployment
//     of a non-OpenAI model.
//
// Both flavors share:
//   - Auth: "api-key: {key}" header (NOT Authorization Bearer; that
//     reserved name is used by the Microsoft Entra ID auth path which
//     this adapter does not yet support).
//   - Required "?api-version=" query parameter.
//   - The OpenAI Chat Completions JSON envelope (messages, tools,
//     tool_calls, SSE streaming format).
//
// The wire types here mirror openai/openai.go because the JSON
// envelope is identical. They are re-declared rather than imported so
// either adapter can drift independently if Azure ever breaks parity.
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
	"path"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

const (
	defaultTimeout   = 120 * time.Second
	streamSentinel   = "[DONE]"
	streamPrefixData = "data: "
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
// Empty Flavor / APIVersion are filled from [provider.DefaultAzureFlavor]
// and [provider.DefaultAzureAPIVersion] respectively. Flavor must be
// one of [provider.AzureFlavorOpenAI] or [provider.AzureFlavorFoundry];
// any other value is rejected.
func New(cfg provider.ProviderConfig, opts ...Option) (*Adapter, error) {
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return nil, fmt.Errorf("azure: empty base_url")
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, fmt.Errorf("azure: empty api_key")
	}
	if _, err := url.Parse(cfg.BaseURL); err != nil {
		return nil, fmt.Errorf("azure: parse base_url: %w", err)
	}
	if cfg.APIVersion == "" {
		cfg.APIVersion = provider.DefaultAzureAPIVersion
	}
	if cfg.Flavor == "" {
		cfg.Flavor = provider.DefaultAzureFlavor
	}
	switch cfg.Flavor {
	case provider.AzureFlavorOpenAI, provider.AzureFlavorFoundry:
		// ok
	default:
		return nil, fmt.Errorf("azure: unknown flavor %q (want %q or %q)",
			cfg.Flavor, provider.AzureFlavorOpenAI, provider.AzureFlavorFoundry)
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

// Both Azure flavors support tools and streaming. Embeddings are
// advertised true; the per-call
// path returns an error when no embedding deployment / model is
// configured.
func (a *Adapter) Capabilities() provider.Capabilities {
	return provider.Capabilities{
		Tools:      true,
		Streaming:  true,
		Embeddings: true,
		MaxContext: 128_000,
	}
}

func (a *Adapter) Chat(ctx context.Context, req provider.ChatRequest) (*provider.ChatResponse, error) {
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
		return nil, fmt.Errorf("%w: azure chat: %v", provider.ErrUpstream, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("%w: azure chat status %d: %s", provider.ErrUpstream, resp.StatusCode, string(raw))
	}
	var wire azureChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&wire); err != nil {
		return nil, fmt.Errorf("%w: azure chat decode: %v", provider.ErrUpstream, err)
	}
	return wire.toChatResponse(), nil
}

func (a *Adapter) Stream(ctx context.Context, req provider.ChatRequest) (<-chan provider.Chunk, error) {
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
		return nil, fmt.Errorf("%w: azure stream: %v", provider.ErrUpstream, err)
	}
	if resp.StatusCode/100 != 2 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		_ = resp.Body.Close()
		return nil, fmt.Errorf("%w: azure stream status %d: %s", provider.ErrUpstream, resp.StatusCode, string(raw))
	}
	out := make(chan provider.Chunk, 8)
	go relayStream(ctx, resp.Body, out)
	return out, nil
}

// Embed uses the Azure embeddings route. URL shape depends on flavor:
//
//   - OpenAI flavor:  {base}/openai/deployments/{depl}/embeddings?api-version=...
//   - Foundry flavor: {base}/embeddings?api-version=... (model in body)
func (a *Adapter) Embed(ctx context.Context, req provider.EmbedRequest) (*provider.EmbedResponse, error) {
	identity := a.embedIdentity(req)
	if identity == "" {
		return nil, fmt.Errorf("azure: empty embedding deployment / model")
	}
	endpoint, err := a.embedURL(identity)
	if err != nil {
		return nil, err
	}
	payload := map[string]any{"input": req.Input}
	if a.cfg.Flavor == provider.AzureFlavorFoundry {
		// Foundry routes embeddings by model in the request body, the
		// same way OpenAI's public endpoint does.
		payload["model"] = identity
	}
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
		return nil, fmt.Errorf("%w: azure embed: %v", provider.ErrUpstream, err)
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
		return nil, fmt.Errorf("%w: azure embed decode: %v", provider.ErrUpstream, err)
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

// chatEndpoint returns the absolute chat URL for this request and a
// boolean indicating whether the request body should include the
// "model" field. The body-model behaviour differs between flavors:
//
//   - OpenAI flavor: deployment encoded in URL → omit body model.
//   - Foundry flavor: shared endpoint → include body model so the
//     server can route to the right backing model.
func (a *Adapter) chatEndpoint(req provider.ChatRequest) (endpoint string, modelInBody string, err error) {
	switch a.cfg.Flavor {
	case provider.AzureFlavorFoundry:
		// Model identity for body — fall back to cfg.Model when the
		// caller does not pin a model. dispatch currently does not
		// pin one, so cfg.Model is the routing key in practice.
		identity := req.Model
		if identity == "" {
			identity = a.cfg.Model
		}
		if identity == "" {
			return "", "", fmt.Errorf("azure: empty foundry model")
		}
		u, err := a.buildURL("chat", "completions")
		if err != nil {
			return "", "", err
		}
		return u, identity, nil
	default: // AzureFlavorOpenAI
		deployment := a.chatDeployment(req)
		if deployment == "" {
			return "", "", fmt.Errorf("azure: empty chat deployment")
		}
		u, err := a.buildURL("openai", "deployments", deployment, "chat", "completions")
		if err != nil {
			return "", "", err
		}
		return u, "", nil
	}
}

// chatDeployment picks the OpenAI-flavor chat deployment name for a
// request. Per-request Model > cfg.Deployment > cfg.Model. The third
// fallback honours the common case where the user named their Azure
// deployment after the model identifier and stored it in the single
// "model" field.
func (a *Adapter) chatDeployment(req provider.ChatRequest) string {
	if req.Model != "" {
		return req.Model
	}
	if a.cfg.Deployment != "" {
		return a.cfg.Deployment
	}
	return a.cfg.Model
}

// embedIdentity is the model-or-deployment string used by the embed
// path. For the OpenAI flavor it becomes the URL deployment segment;
// for Foundry it goes into the request body. Per-request Model >
// cfg.EmbeddingDeployment > cfg.EmbeddingModel.
func (a *Adapter) embedIdentity(req provider.EmbedRequest) string {
	if req.Model != "" {
		return req.Model
	}
	if a.cfg.EmbeddingDeployment != "" {
		return a.cfg.EmbeddingDeployment
	}
	return a.cfg.EmbeddingModel
}

// embedURL builds the absolute embeddings URL for the configured
// flavor. identity is only used by the OpenAI flavor (URL-routed).
func (a *Adapter) embedURL(identity string) (string, error) {
	switch a.cfg.Flavor {
	case provider.AzureFlavorFoundry:
		return a.buildURL("embeddings")
	default:
		return a.buildURL("openai", "deployments", identity, "embeddings")
	}
}

// buildURL composes BaseURL + path segments + the api-version query
// parameter using net/url so deployment names with characters that
// require percent-encoding (rare but legal: digits, dashes, dots,
// underscores) round-trip correctly. The variadic segments are joined
// with path.Join after PathEscape so a user-typed deployment name
// containing a slash cannot escape the intended sub-tree.
func (a *Adapter) buildURL(segments ...string) (string, error) {
	u, err := url.Parse(a.cfg.BaseURL)
	if err != nil {
		return "", fmt.Errorf("azure: parse base_url: %w", err)
	}
	escaped := make([]string, 0, len(segments)+1)
	if u.Path != "" {
		escaped = append(escaped, u.Path)
	}
	for _, s := range segments {
		escaped = append(escaped, url.PathEscape(s))
	}
	u.Path = path.Join(escaped...)
	q := u.Query()
	q.Set("api-version", a.cfg.APIVersion)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func (a *Adapter) newRequest(ctx context.Context, method, urlStr string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, urlStr, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	// Azure uses the case-sensitive "api-key" header. The "Authorization:
	// Bearer …" form is reserved for Microsoft Entra ID token auth, which
	// this adapter does not yet support (V1 is api-key only).
	req.Header.Set("api-key", a.cfg.APIKey)
	return req, nil
}

// Wire types.
//
// Mirror openai/openai.go because Azure's chat completions JSON shape
// is identical to OpenAI's. Re-declared here (rather than imported)
// to keep the two adapters independent — a future Azure schema drift
// can be absorbed without breaking the openai adapter.

type azureChatRequest struct {
	Model       string          `json:"model,omitempty"`
	Messages    []azureWireMsg  `json:"messages"`
	Tools       []azureWireTool `json:"tools,omitempty"`
	Stream      bool            `json:"stream,omitempty"`
	Temperature float32         `json:"temperature,omitempty"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
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
		} `json:"delta"`
		FinishReason string `json:"finish_reason,omitempty"`
	} `json:"choices"`
	// Error is the wrapped error payload some Azure deployments
	// emit mid-stream when the upstream guard rails kick in. The
	// outer envelope is a normal `data: {…}` SSE frame so a relay
	// that only inspects choices will silently drop the error.
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// encodeChatRequest serialises a [provider.ChatRequest] into the
// Azure JSON envelope. modelInBody is non-empty only for the Foundry
// flavor; for Azure OpenAI Service the body MUST omit the model
// field (the deployment name in the URL is the routing key).
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
		Model:       modelInBody,
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

func (r *azureChatResponse) toChatResponse() *provider.ChatResponse {
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
		if len(frame.Choices) == 0 {
			// Azure also emits content-filter / annotation frames
			// with empty choices that carry no usable delta. Skip
			// silently — the next data frame will carry content.
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
		send(ctx, out, provider.Chunk{Err: fmt.Errorf("%w: azure stream read: %v", provider.ErrUpstream, err)})
	}
}

func send(ctx context.Context, out chan<- provider.Chunk, c provider.Chunk) {
	select {
	case <-ctx.Done():
	case out <- c:
	}
}

var _ provider.Provider = (*Adapter)(nil)
