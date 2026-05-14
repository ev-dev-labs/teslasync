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

// Dispatcher orchestrates the chat loop for one feature run. It
// is constructed once at boot and is safe for concurrent use:
// fields are immutable after construction and Run owns its own
// transient state.
type Dispatcher struct {
	reg            *tools.Registry
	provider       provider.Provider
	confirm        ConfirmFn
	maxIterations  int
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
	ctxMsgs, err := s.Context(ctx, in)
	if err != nil {
		return fmt.Errorf("dispatch: strategy context: %w", err)
	}
	msgs = append(msgs, ctxMsgs...)
	msgs = append(msgs, in.History...)

	// 3) Loop: chat → on tool_call validate+execute → repeat.
	for iter := 0; iter < d.maxIterations; iter++ {
		req := provider.ChatRequest{
			Messages: msgs,
			Tools:    specs,
		}
		resp, err := d.provider.Chat(ctx, req)
		if err != nil {
			return fmt.Errorf("dispatch: provider chat (iter %d): %w", iter, err)
		}

		// Forward any text content as a single delta. A future
		// streaming-aware Run (F5) will replace this with
		// per-chunk forwarding via Provider.Stream.
		if resp.Message.Content != "" {
			if err := w.WriteDelta(resp.Message.Content); err != nil {
				return fmt.Errorf("dispatch: write delta: %w", err)
			}
		}

		// No tool calls? Loop is done.
		if len(resp.ToolCalls) == 0 {
			return nil
		}

		// Append the assistant's tool-call message to history so
		// the next provider call sees the proposal.
		msgs = append(msgs, resp.Message)

		// Process each proposed tool call serially. (Parallel
		// execution is intentionally not supported in F4 — every
		// mutation must be observable to the user before the
		// next runs.)
		for _, call := range resp.ToolCalls {
			toolMsg, derr := d.runOneToolCall(ctx, call, allowedTools, w)
			if derr != nil {
				return derr
			}
			msgs = append(msgs, toolMsg)
		}
	}
	return ErrMaxIterations
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
