// Package dispatch is the AI tool-use chat loop.
//
// The dispatcher orchestrates a single feature run:
//
//  1. Strategy.Context builds the per-turn message prefix.
//  2. Strategy.Tools is intersected with the tool registry to
//     produce a per-feature ToolSpec list (a strategy CANNOT
//     invoke tools it did not declare).
//  3. The provider streams a response.
//  4. If the response proposes a tool call:
//     a. The dispatcher Validates the arguments against the
//     tool's input schema.
//     b. For mutating tools, it pauses and asks the embedded
//     ConfirmFn for user approval. Approval state is persisted
//     in the continuations table so an SSE round-trip can
//     resume the dispatcher after the human clicks Confirm.
//     c. The tool is Executed. Its output becomes the next
//     "tool" message in the conversation.
//     d. Loop back to step 3.
//  5. The loop terminates when the provider returns FinishStop,
//     when MaxIterations is exceeded, or on any error.
//
// The dispatcher OWNS the tool-call validation gate: a provider
// can ONLY mutate state through a registered Tool whose Validate
// accepts the LLM-emitted JSON. There is no fall-through path
// from the LLM to db.Exec — that's P2 enforced by code.
//
// ADR-015: every dispatcher run is bounded (MaxIterations), every
// mutating tool requires user confirmation, and every output is
// streamed verbatim through the StreamWriter — no hidden side
// effects, no unguarded auto-execution, no background "agentic"
// loops.
package dispatch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/ai/limit"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// DefaultMaxIterations is the loop cap the dispatcher uses when
// none is supplied. Eight iterations comfortably covers the
// longest realistic chained tool-call sequence (typical: 1–3,
// outlier: 6) and bounds latency + cost.
const DefaultMaxIterations = 8

// ErrConfirmationDenied is returned by Run when a user explicitly
// rejects a mutating tool call via ConfirmFn. The caller (an SSE
// endpoint, typically) translates this into a "user cancelled"
// frame on the wire.
var ErrConfirmationDenied = errors.New("dispatch: user denied tool-call confirmation")

// ErrMaxIterations is returned when the chat loop hits the
// MaxIterations cap. The caller should surface this as a
// "conversation got stuck" message, not a hard error.
var ErrMaxIterations = errors.New("dispatch: max iterations reached")

// ErrStreamIncomplete means a provider stream closed without its terminal
// Done chunk. Treating this as success would persist a truncated answer and
// falsely present it as complete.
var ErrStreamIncomplete = errors.New("dispatch: provider stream ended without a terminal chunk")

// ConfirmDecision is the outcome of a user-confirm round-trip for
// a mutating tool call.
type ConfirmDecision int

const (
	// ConfirmApproved means: execute the tool with the proposed
	// arguments.
	ConfirmApproved ConfirmDecision = iota
	// ConfirmDenied means: do not execute; surface
	// ErrConfirmationDenied to the user. The conversation may
	// continue with a "user cancelled" message.
	ConfirmDenied
)

// ConfirmRequest is the payload the dispatcher hands to ConfirmFn
// for a mutating tool call. The frontend renders these fields in
// the AI ConfirmDialog.
type ConfirmRequest struct {
	ToolName        string          `json:"tool_name"`
	ToolDescription string          `json:"tool_description"`
	Arguments       json.RawMessage `json:"arguments"`
}

// ConfirmFn is the user-confirm hook. Production wiring wraps an
// SSE round-trip: the dispatcher emits a confirm_request frame,
// the frontend renders <ConfirmDialog>, the user clicks
// Confirm/Cancel, the frontend POSTs to a continuation endpoint,
// and the registered ConfirmFn returns the user's choice.
//
// Tests pass a synchronous fake (e.g., always-approve or
// always-deny).
//
// A nil ConfirmFn is treated as "auto-approve everything", which
// is ONLY safe in tests. Production wiring MUST always set this.
type ConfirmFn func(ctx context.Context, req ConfirmRequest) (ConfirmDecision, error)

// StreamWriter is the dispatcher's outbound channel. F5 will
// implement an SSE-backed writer; the F4 dispatcher uses it as a
// pure forwarder for provider deltas + structural events.
//
// Implementations MUST be safe for serial use from a single
// goroutine (the dispatcher).
type StreamWriter interface {
	// WriteDelta forwards a token-by-token text fragment to the
	// caller. Empty strings are skipped by the dispatcher.
	WriteDelta(s string) error

	// WriteToolCall announces that the provider proposed a tool
	// call. Surfaces the tool name + arguments to the UI BEFORE
	// the dispatcher requests confirmation.
	WriteToolCall(call provider.ToolCall) error

	// WriteToolResult announces that a tool finished successfully.
	// The arguments mirror what the LLM proposed; result is the
	// tool's Execute return value (after JSON marshalling).
	WriteToolResult(name string, result json.RawMessage) error

	// WriteToolError announces that a tool's Validate or Execute
	// returned an error.
	WriteToolError(name string, err error) error

	// WriteDone closes the stream. The dispatcher always calls
	// this exactly once before Run returns (success or failure).
	WriteDone() error
}

// LimitErrorEmitter is the OPTIONAL interface a [StreamWriter] may
// implement to receive structured rate-limiter / cost-cap rejection
// payloads. The dispatcher type-asserts on it after detecting a
// [*limit.LimitError] from the provider chain (R8 mitigation, F9):
//
//   - If the writer satisfies this interface, the dispatcher calls
//     EmitLimitError with the message + the structured fields and
//     RETURNS NIL from Run() — the limit case is a normal terminal
//     event on the SSE wire, not a Run error.
//   - If the writer does NOT satisfy this interface, the dispatcher
//     bubbles the LimitError up its return chain. Production wiring
//     uses [*stream.Writer], which DOES satisfy it.
//
// Method takes individual scalars rather than a struct so the
// stream package can implement it without importing the dispatch
// package — no shared type, no import cycle, no leak of dispatch
// concepts down the layer stack.
type LimitErrorEmitter interface {
	// EmitLimitError writes a terminal error frame carrying the
	// structured limit payload + a human message. The writer MUST
	// close the underlying stream after returning.
	//
	// Field semantics (match [limit.Decision]):
	//   message            — human-readable error string
	//   reason             — stable lowercase token taxonomy
	//   retryAfterS        — seconds until safe to retry; 0 = never
	//   bannerLevel        — "warn" | "critical" | "" (none)
	//   baselineAvailable  — true when feature has a non-AI fallback
	EmitLimitError(message, reason string, retryAfterS int, bannerLevel string, baselineAvailable bool) error
}

// Dispatcher orchestrates the chat loop for one feature run. It
// is constructed once at boot and is safe for concurrent use:
// fields are immutable after construction and Run owns its own
// transient state.
type Dispatcher struct {
	reg           *tools.Registry
	provider      provider.Provider
	confirm       ConfirmFn
	maxIterations int
}

// New constructs a Dispatcher. Pass the per-feature provider
// (already resolved by the AI feature registry) and the
// process-wide tool registry. Optional knobs are zero-value:
//
//   - confirm == nil  → mutating tools auto-approve (TESTS ONLY)
//   - max == 0        → DefaultMaxIterations
func New(reg *tools.Registry, p provider.Provider, confirm ConfirmFn, max int) *Dispatcher {
	if max <= 0 {
		max = DefaultMaxIterations
	}
	return &Dispatcher{reg: reg, provider: p, confirm: confirm, maxIterations: max}
}

// Run executes the chat loop until the provider returns
// FinishStop, MaxIterations is exceeded, the user denies a
// mutating call, or any error surfaces. The streaming output is
// forwarded to w; w.WriteDone is called exactly once before Run
// returns.
func (d *Dispatcher) Run(ctx context.Context, s strategy.Strategy, in strategy.StrategyInput, w StreamWriter) (rerr error) {
	defer func() {
		if cerr := w.WriteDone(); cerr != nil && rerr == nil {
			rerr = cerr
		}
	}()

	if d.reg == nil {
		return fmt.Errorf("dispatch: nil tool registry")
	}
	if d.provider == nil {
		return fmt.Errorf("dispatch: nil provider")
	}
	if s == nil {
		return fmt.Errorf("dispatch: nil strategy")
	}

	// F8: install the strategy's redaction policy in ctx so the
	// redact decorator (innermost in the provider chain) can pull
	// it on every Chat/Stream/Embed. Strategies that have not yet
	// migrated to redactadapter.Wrap return strategy.NoRedaction,
	// which redactadapter.From maps to redact.DefaultPolicy
	// (deny-all) — that is the safe default per ADR-015 §I9.
	ctx = redact.WithPolicy(ctx, redactadapter.From(s.RedactionPolicy()))

	// 1) Build the per-feature tool spec list. Strategy.Tools is
	// the whitelist; the dispatcher refuses to expose any tool
	// the strategy did not declare (defence-in-depth: even if
	// the LLM hallucinates a tool name, the validator below
	// rejects unknown names).
	allowedTools := map[string]struct{}{}
	for _, n := range s.Tools() {
		allowedTools[n] = struct{}{}
	}
	specs := make([]provider.ToolSpec, 0, len(s.Tools()))
	for _, name := range s.Tools() {
		t, ok := d.reg.Get(name)
		if !ok {
			return fmt.Errorf("dispatch: strategy %q references unregistered tool %q", s.FeatureID(), name)
		}
		specs = append(specs, provider.ToolSpec{
			Name:        t.Name(),
			Description: t.Description(),
			Parameters:  t.InputSchema(),
		})
	}

	// 2) Seed the message log: optional system prompt → strategy
	// context → caller-supplied history.
	msgs := make([]provider.Message, 0, 4+len(in.History))
	if sys := s.System(); sys != "" {
		msgs = append(msgs, provider.Message{Role: provider.RoleSystem, Content: sys})
	}
	// Inject the user's display-unit preferences (Miles vs km,
	// °F vs °C, decimal precision, currency, locale) as a SECOND
	// system message right after the strategy's prompt. The
	// userPrefsMiddleware in package api populates ctx once per
	// request from the global Settings repo; tests and code paths
	// that do not install prefs see a zero UserPrefs and the
	// dispatcher skips this step (UserPrefs.SystemMessage returns
	// "" for the zero value). See dispatch/prefs.go for the
	// full rationale.
	if prefs, ok := UserPrefsFromContext(ctx); ok {
		if hint := prefs.SystemMessage(); hint != "" {
			msgs = append(msgs, provider.Message{Role: provider.RoleSystem, Content: hint})
		}
	}
	// Apply the product-wide quality floor after feature-specific format
	// instructions and display preferences. Every Helix surface therefore
	// inherits evidence discipline without duplicating prompt text across
	// dozens of strategies.
	msgs = append(msgs, provider.Message{
		Role:    provider.RoleSystem,
		Content: IntelligenceContract,
	})
	ctxMsgs, err := s.Context(ctx, in)
	if err != nil {
		return fmt.Errorf("dispatch: strategy context: %w", err)
	}
	msgs = append(msgs, ctxMsgs...)
	msgs = append(msgs, in.History...)
	// Append the synthesised "current turn" user message. Every AI
	// handler in this codebase passes the per-request prompt via
	// StrategyInput.LastMessage (see ai_drive_coach_handler.go and
	// peers); without this step the model only sees the system
	// prompt + context and hallucinates a reply with no anchor.
	// Empty LastMessage is allowed (e.g. resume-after-confirmation
	// paths where History already terminates with a user turn).
	if in.LastMessage != "" {
		msgs = append(msgs, provider.Message{Role: provider.RoleUser, Content: in.LastMessage})
	}

	// 3) Loop: chat → on tool_call validate+execute → repeat.
	for iter := 0; iter < d.maxIterations; iter++ {
		req := provider.ChatRequest{
			Messages: msgs,
			Tools:    specs,
		}
		turn, operation, err := d.completeTurn(ctx, req, w)
		if err != nil {
			if handled, limitErr := emitLimitError(w, err, operation, iter); handled {
				return limitErr
			}
			return fmt.Errorf("dispatch: provider %s (iter %d): %w", operation, iter, err)
		}

		// No tool calls? Loop is done.
		if len(turn.toolCalls) == 0 {
			return nil
		}
		normalizeToolCalls(turn.toolCalls, iter)

		// Append the assistant's tool-call message to history so
		// the next provider call sees the proposal. Carry the
		// proposed tool calls into the message itself so provider
		// encoders can re-emit them on the wire — strict providers
		// (OpenAI / Azure) reject the next turn with
		// `messages.[N].content: expected string, got null` when
		// the assistant message lacks both content AND tool_calls.
		// Ollama is more lenient but the same fix is harmless there.
		asst := turn.message
		if len(turn.toolCalls) > 0 {
			asst.ToolCalls = append([]provider.ToolCall(nil), turn.toolCalls...)
		}
		msgs = append(msgs, asst)

		// Process each proposed tool call serially. (Parallel
		// execution is intentionally not supported in F4 — every
		// mutation must be observable to the user before the
		// next runs.)
		for _, call := range turn.toolCalls {
			if strings.TrimSpace(call.Name) == "" {
				return fmt.Errorf("dispatch: provider emitted a tool call with no name")
			}
			toolMsg, derr := d.runOneToolCall(ctx, call, allowedTools, w)
			if derr != nil {
				return derr
			}
			msgs = append(msgs, toolMsg)
		}
	}
	return ErrMaxIterations
}

type turnResult struct {
	message   provider.Message
	toolCalls []provider.ToolCall
}

// completeTurn uses the provider's real streaming path whenever advertised.
// Capability drift falls back to Chat only when Stream refuses synchronously,
// before any frame has been consumed.
func (d *Dispatcher) completeTurn(
	ctx context.Context,
	req provider.ChatRequest,
	w StreamWriter,
) (turnResult, string, error) {
	if d.provider.Capabilities().Streaming {
		turn, consumed, err := d.streamTurn(ctx, req, w)
		if err == nil {
			return turn, "stream", nil
		}
		if consumed || !errors.Is(err, provider.ErrCapabilityNotSupported) {
			return turnResult{}, "stream", err
		}
	}

	resp, err := d.provider.Chat(ctx, req)
	if err != nil {
		return turnResult{}, "chat", err
	}
	if resp == nil {
		return turnResult{}, "chat", errors.New("provider returned a nil chat response")
	}
	if resp.Message.Content != "" {
		if err := w.WriteDelta(resp.Message.Content); err != nil {
			return turnResult{}, "chat", fmt.Errorf("write delta: %w", err)
		}
	}
	return turnResult{
		message:   resp.Message,
		toolCalls: append([]provider.ToolCall(nil), resp.ToolCalls...),
	}, "chat", nil
}

func (d *Dispatcher) streamTurn(
	ctx context.Context,
	req provider.ChatRequest,
	w StreamWriter,
) (turnResult, bool, error) {
	chunks, err := d.provider.Stream(ctx, req)
	if err != nil {
		return turnResult{}, false, err
	}
	if chunks == nil {
		return turnResult{}, false, errors.New("provider returned a nil stream")
	}

	var content strings.Builder
	toolCalls := make([]provider.ToolCall, 0, 2)
	consumed := false
	done := false
	for chunk := range chunks {
		consumed = true
		switch {
		case chunk.Err != nil:
			return turnResult{}, consumed, chunk.Err
		case chunk.Delta != "":
			content.WriteString(chunk.Delta)
			if err := w.WriteDelta(chunk.Delta); err != nil {
				return turnResult{}, consumed, fmt.Errorf("write delta: %w", err)
			}
		case chunk.ToolDelta != nil:
			toolCalls = append(toolCalls, *chunk.ToolDelta)
		case chunk.Done:
			done = true
		}
	}
	if !done {
		return turnResult{}, consumed, ErrStreamIncomplete
	}
	return turnResult{
		message: provider.Message{
			Role:    provider.RoleAssistant,
			Content: content.String(),
		},
		toolCalls: toolCalls,
	}, consumed, nil
}

func emitLimitError(w StreamWriter, err error, operation string, iter int) (bool, error) {
	var le *limit.LimitError
	if !errors.As(err, &le) {
		return false, nil
	}
	if emitter, ok := w.(LimitErrorEmitter); ok {
		if emitErr := emitter.EmitLimitError(
			le.Error(),
			le.Decision.Reason,
			int(le.Decision.RetryAfter.Seconds()),
			le.Decision.BannerLevel,
			le.Decision.BaselineAvailable,
		); emitErr != nil {
			return true, fmt.Errorf("dispatch: emit limit error (iter %d): %w", iter, emitErr)
		}
		return true, nil
	}
	return true, fmt.Errorf("dispatch: provider %s (iter %d): %w", operation, iter, err)
}

func normalizeToolCalls(calls []provider.ToolCall, iter int) {
	for index := range calls {
		if calls[index].ID == "" {
			calls[index].ID = fmt.Sprintf("helix_call_%d_%d", iter+1, index+1)
		}
		if len(calls[index].Arguments) == 0 {
			calls[index].Arguments = json.RawMessage("{}")
		}
	}
}

// runOneToolCall validates the LLM-proposed call against the
// registered tool, optionally pauses for user confirmation, then
// executes. Returns the "tool" role message that should be appended
// to the conversation so the next provider turn sees the result.
func (d *Dispatcher) runOneToolCall(ctx context.Context, call provider.ToolCall, allowed map[string]struct{}, w StreamWriter) (provider.Message, error) {
	if err := w.WriteToolCall(call); err != nil {
		return provider.Message{}, fmt.Errorf("dispatch: write tool call: %w", err)
	}

	if _, ok := allowed[call.Name]; !ok {
		err := fmt.Errorf("tool %q not allowed for this strategy", call.Name)
		_ = w.WriteToolError(call.Name, err)
		return provider.Message{
			Role:    provider.RoleTool,
			Name:    call.Name,
			ToolID:  call.ID,
			Content: errorJSON(err),
		}, nil
	}

	tool, ok := d.reg.Get(call.Name)
	if !ok {
		err := fmt.Errorf("tool %q is not registered", call.Name)
		_ = w.WriteToolError(call.Name, err)
		return provider.Message{
			Role:    provider.RoleTool,
			Name:    call.Name,
			ToolID:  call.ID,
			Content: errorJSON(err),
		}, nil
	}

	in, err := tool.Validate(call.Arguments)
	if err != nil {
		_ = w.WriteToolError(call.Name, err)
		return provider.Message{
			Role:    provider.RoleTool,
			Name:    call.Name,
			ToolID:  call.ID,
			Content: errorJSON(err),
		}, nil
	}

	if tool.Mutates() {
		decision := ConfirmApproved
		if d.confirm != nil {
			d, derr := d.confirmCall(ctx, tool, call)
			if derr != nil {
				return provider.Message{}, derr
			}
			decision = d
		}
		if decision == ConfirmDenied {
			return provider.Message{}, ErrConfirmationDenied
		}
	}

	out, err := tool.Execute(ctx, in)
	if err != nil {
		_ = w.WriteToolError(call.Name, err)
		return provider.Message{
			Role:    provider.RoleTool,
			Name:    call.Name,
			ToolID:  call.ID,
			Content: errorJSON(err),
		}, nil
	}

	resJSON, mErr := json.Marshal(out)
	if mErr != nil {
		err := fmt.Errorf("tool %q result not JSON-serialisable: %w", call.Name, mErr)
		_ = w.WriteToolError(call.Name, err)
		return provider.Message{
			Role:    provider.RoleTool,
			Name:    call.Name,
			ToolID:  call.ID,
			Content: errorJSON(err),
		}, nil
	}
	if err := w.WriteToolResult(call.Name, resJSON); err != nil {
		return provider.Message{}, fmt.Errorf("dispatch: write tool result: %w", err)
	}
	return provider.Message{
		Role:    provider.RoleTool,
		Name:    call.Name,
		ToolID:  call.ID,
		Content: string(resJSON),
	}, nil
}

// confirmCall is split out so tests can hook the boundary.
func (dp *Dispatcher) confirmCall(ctx context.Context, t tools.Tool, call provider.ToolCall) (ConfirmDecision, error) {
	return dp.confirm(ctx, ConfirmRequest{
		ToolName:        t.Name(),
		ToolDescription: t.Description(),
		Arguments:       call.Arguments,
	})
}

// errorJSON renders an error as a {"error": "..."} JSON object,
// suitable for inclusion in a tool-role message back to the LLM.
// The LLM uses the message content as ground-truth so the format
// is intentionally simple.
func errorJSON(err error) string {
	b, _ := json.Marshal(map[string]string{"error": err.Error()})
	return string(b)
}
