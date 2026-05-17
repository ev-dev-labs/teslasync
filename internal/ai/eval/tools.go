package eval

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// stubTool is a no-op [tools.Tool] used by the eval harness so the
// dispatcher's tool-whitelist gate accepts a feature's declared tool
// names without requiring a real implementation.
//
// Execute returns `{"ok": true, "tool": <name>}` so a multi-turn
// golden's second canned response sees a deterministic tool result
// in its message history (the runner builds the message list itself
// during canned replay, so the actual content is never inspected by
// the LLM — but the dispatcher requires SOMETHING serialisable).
type stubTool struct {
	name        string
	mutates     bool
	description string
	inputSchema json.RawMessage
}

// newStubTool returns a stub matching the given name.
func newStubTool(name string, mutates bool) *stubTool {
	return &stubTool{
		name:        name,
		mutates:     mutates,
		description: "eval-harness stub for " + name,
		// The schema is permissive — any object is accepted. The
		// dispatcher's Validate path is exercised but never trips
		// because the canned replies' tool-call arguments are
		// hand-authored to be valid JSON objects.
		inputSchema: json.RawMessage(`{"type":"object","additionalProperties":true}`),
	}
}

// Name implements tools.Tool.
func (t *stubTool) Name() string { return t.name }

// Description implements tools.Tool.
func (t *stubTool) Description() string { return t.description }

// InputSchema implements tools.Tool.
func (t *stubTool) InputSchema() json.RawMessage { return t.inputSchema }

// OutputSchema implements tools.Tool.
func (t *stubTool) OutputSchema() json.RawMessage { return nil }

// Mutates implements tools.Tool.
func (t *stubTool) Mutates() bool { return t.mutates }

// RequiredScope implements tools.Tool.
func (t *stubTool) RequiredScope() string { return "" }

// Validate implements tools.Tool. Accepts any well-formed JSON object
// (including empty input) — the eval canned files own the
// argument-validation contract, not the stub.
func (t *stubTool) Validate(raw json.RawMessage) (any, error) {
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	var v map[string]any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, fmt.Errorf("stubTool %s: invalid arguments JSON: %w", t.name, err)
	}
	if v == nil {
		v = map[string]any{}
	}
	return v, nil
}

// Execute implements tools.Tool. Always returns an "ok" envelope.
func (t *stubTool) Execute(ctx context.Context, in any) (any, error) {
	return map[string]any{"ok": true, "tool": t.name}, nil
}

var _ tools.Tool = (*stubTool)(nil)

// buildStubRegistry returns a fresh tools.Registry populated with one
// stubTool per name in the spec. Names listed in spec.MutatingTools
// have Mutates() = true so the dispatcher's confirm gate is exercised
// (the runner's auto-approve confirm function passes them through).
func buildStubRegistry(spec FeatureSpec) *tools.Registry {
	reg := tools.NewRegistry()
	mutating := map[string]struct{}{}
	for _, name := range spec.MutatingTools {
		mutating[name] = struct{}{}
	}
	for _, name := range spec.Tools {
		_, isMut := mutating[name]
		reg.Register(newStubTool(name, isMut))
	}
	return reg
}
