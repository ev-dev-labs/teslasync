package provider

import (
	"context"
	"encoding/json"
)

// Role is the speaker role on a single chat turn. Values mirror the
// OpenAI/Anthropic conventions so adapter serialisation is a 1:1 copy.
const (
	RoleSystem    = "system"
	RoleUser      = "user"
	RoleAssistant = "assistant"
	RoleTool      = "tool"
)

// FinishReason is the why-the-model-stopped-generating signal. Adapters
// normalise their vendor-specific value to one of these so feature code
// can branch on a portable constant.
const (
	FinishStop          = "stop"
	FinishToolCalls     = "tool_calls"
	FinishLength        = "length"
	FinishContentFilter = "content_filter"
)

// Message is a single chat turn in a [ChatRequest] or [ChatResponse].
//
// Tool messages MUST set both Name (the tool that produced the result)
// and ToolID (the originating tool-call ID issued by the assistant).
// Assistant messages that propose a tool call set Tool to the parsed
// proposal; Content may be empty in that case.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Name    string `json:"name,omitempty"`
	ToolID  string `json:"tool_id,omitempty"`
	// Tool is the legacy single-tool-call carrier kept for callers
	// that built provider.Message values by hand (test fixtures and
	// older code). New code should use [ToolCalls] (plural)
	// because OpenAI / Azure / Anthropic all allow an assistant
	// message to propose multiple tool calls in one turn, and the
	// dispatcher must round-trip every one of them through the
	// conversation history (otherwise the next provider turn fails
	// with `messages.[N].content: expected string, got null` —
	// strict providers reject an assistant message that has neither
	// content nor tool_calls).
	Tool *ToolCall `json:"tool,omitempty"`
	// ToolCalls is the plural slice the dispatcher uses to copy
	// `ChatResponse.ToolCalls` back into the assistant message
	// before appending it to the conversation log. Each provider's
	// encoder iterates over both [Tool] (legacy) and [ToolCalls]
	// (new) so callers can use either; dispatch sets ToolCalls.
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
}

// ToolCall is the structural representation of a model-proposed tool
// invocation. Arguments is the raw JSON the model emitted; the dispatcher
// validates it against the registered tool's input schema before executing anything.
type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

// ToolSpec is the feature → provider declaration of an available tool.
// Parameters MUST be a JSON Schema document the underlying provider
// accepts unchanged. The schema is generated from the handler DTO via
// reflection so the validator is the same code the live handler runs.
type ToolSpec struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

// ChatRequest is the input to [Provider.Chat] / [Provider.Stream].
//
// Temperature is in [0, 2]; adapters clamp out-of-range values rather
// than reject (the user-facing impact of clamping is smaller than a
// hard failure mid-conversation). MaxTokens of zero means "use the
// adapter's default" so a feature that does not care about caps can
// leave the field unset.
type ChatRequest struct {
	Model       string
	Messages    []Message
	Tools       []ToolSpec
	Temperature float32
	MaxTokens   int
}

// ChatResponse is the result of a non-streaming [Provider.Chat].
//
// Token counts are best-effort: adapters that do not surface usage
// (e.g. some self-hosted runtimes) return zero. The audit decorator
// treats zero as "unknown" and records it without failing.
type ChatResponse struct {
	Message      Message
	ToolCalls    []ToolCall
	InputTokens  int
	OutputTokens int
	FinishReason string
}

// Chunk is one frame of a streaming response from [Provider.Stream].
//
// Exactly one of Delta, ToolDelta, Done=true, or Err non-nil is set on any
// single chunk. A Done chunk also carries normalized finish metadata and
// best-effort token usage. ToolDelta always carries one complete, executable
// tool call; provider adapters assemble vendor-specific argument fragments
// before emitting it. The producer closes the channel after the terminal chunk
// (Done or Err); consumers MUST drain on cancellation.
type Chunk struct {
	Delta        string
	ToolDelta    *ToolCall
	Done         bool
	FinishReason string
	InputTokens  int
	OutputTokens int
	Err          error
}

// EmbedRequest is the input to [Provider.Embed].
type EmbedRequest struct {
	Model string
	Input []string
}

// EmbedResponse is the result of [Provider.Embed]. Vectors[i] is the
// embedding of Input[i]; the lengths MUST match.
type EmbedResponse struct {
	Vectors     [][]float32
	InputTokens int
}

// Capabilities advertises what an adapter actually supports for the
// configured model. Features inspect this at registration time and
// fail loudly rather than at call time so a model swap that drops
// support for tools cannot regress a feature silently.
type Capabilities struct {
	Tools      bool
	Streaming  bool
	Embeddings bool
	MaxContext int
}

// Provider is the single hexagonal port. Every adapter implements this
// interface; every feature consumes it. Methods MUST honour ctx
// cancellation and MUST return promptly (≤ 1 RTT to the upstream) on
// ctx.Done — feature code uses ctx as the streaming kill-switch.
//
// Adapters return [ErrCapabilityNotSupported] for any method whose
// corresponding [Capabilities] field is false (e.g. Anthropic.Embed).
type Provider interface {
	// Name is a stable, lowercase identifier ("ollama", "openai",
	// "anthropic", "mock"). Used by the audit log + the Settings UI.
	Name() string

	// Chat performs a single non-streaming completion. The returned
	// [ChatResponse] is fully materialised before the call returns;
	// for token-by-token rendering use [Stream].
	Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error)

	// Stream returns a receive-only channel of [Chunk]. The producer
	// closes the channel after the terminal frame; consumers MUST
	// drain or call ctx-cancel to free the producer goroutine.
	// Adapters that do not support streaming MUST return
	// [ErrCapabilityNotSupported] (a nil channel never appears).
	Stream(ctx context.Context, req ChatRequest) (<-chan Chunk, error)

	// Embed batches input strings into vectors of the configured
	// model's dimensionality. Adapters that do not support
	// embeddings (e.g. Anthropic) return [ErrCapabilityNotSupported].
	Embed(ctx context.Context, req EmbedRequest) (*EmbedResponse, error)

	// Capabilities returns the static, configuration-time view of
	// what this adapter+model combination supports. Cached at
	// construction; never depends on the request.
	Capabilities() Capabilities
}
