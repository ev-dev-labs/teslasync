package tools

import (
	"context"
	"encoding/json"
)

// Tool is the per-tool contract. Every concrete tool — read-only or
// mutating — implements this interface. The dispatcher only ever
// holds a [Tool], never a concrete type, so adding a new tool means
// adding one struct + a [Registry.Register] call.
//
// Implementations MUST be safe for concurrent use. The dispatcher may
// call [Validate] and [Execute] from different goroutines (one per
// tool_call in a multi-tool turn).
type Tool interface {
	// Name is the LLM-visible canonical identifier. MUST be lower
	// snake_case (matches the OpenAI / Anthropic convention) and
	// stable — once an LLM has been trained on a name, renaming
	// breaks every cached call template.
	Name() string

	// Description is the one-line LLM-visible hint. Short enough to
	// fit in the system prompt's tool catalogue but specific enough
	// that the model can pick the right tool without ambiguity.
	Description() string

	// InputSchema is the JSON-Schema document that constrains the
	// tool's input. The schema is generated from the input DTO via
	// [Generate] (reflection on `validate:"..."` tags) so the
	// validator and the schema cannot drift.
	InputSchema() json.RawMessage

	// OutputSchema is the advisory JSON-Schema for the tool's
	// return value. May be nil when the output shape is documented
	// only in the Description (e.g. a free-form summary). Providers
	// use this only as a hint; the dispatcher does not enforce it.
	OutputSchema() json.RawMessage

	// Mutates reports whether [Execute] changes server-side state.
	// True ⇒ the dispatcher pauses for user confirmation before
	// invoking the tool (per ADR-015). False ⇒ the
	// dispatcher runs the tool unattended.
	Mutates() bool

	// RequiredScope is the RBAC scope a caller must hold to invoke
	// the tool. Empty string ⇒ no extra scope (every authenticated
	// caller may invoke). Non-empty ⇒ the [Registry.Filter] strips
	// the tool from any caller that does not present the scope.
	//
	// The scope vocabulary mirrors the existing handler-side scopes
	// (read.vehicles, write.alerts, etc.) so a tool's required
	// scope tracks the underlying handler's required scope by
	// construction.
	RequiredScope() string

	// Validate parses raw against [InputSchema] and returns a typed
	// value of the tool's input type. Implementations MUST mirror
	// every constraint advertised in the schema — the
	// TestEverySchemaMatchesValidate fuzz pin asserts the two are
	// equivalent. Returning a nil error with a nil value is a
	// programming error.
	Validate(raw json.RawMessage) (any, error)

	// Execute runs the tool with the validated input. For mutating
	// tools, this is invoked ONLY after the user has confirmed via
	// the dispatcher's ConfirmFn. Implementations MUST honour
	// ctx cancellation and MUST NOT panic — return errors, the
	// dispatcher wraps them into a structured error message that
	// the LLM can read on the next turn.
	//
	// The returned value is JSON-marshalled by the dispatcher and
	// fed back to the LLM as the tool's reply message. Callers
	// SHOULD return small, JSON-friendly shapes (no internal types,
	// no time.Time without a layout, no func/chan).
	Execute(ctx context.Context, in any) (any, error)
}

// Definition is the metadata-only view of a [Tool], used by the
// dispatcher for serialization to the provider and by tests + the
// confirm dialog for human-readable rendering. It deliberately omits
// [Tool.Validate] and [Tool.Execute] so it is safe to share across
// goroutines without holding a reference to the concrete tool.
type Definition struct {
	Name          string          `json:"name"`
	Description   string          `json:"description"`
	InputSchema   json.RawMessage `json:"input_schema"`
	OutputSchema  json.RawMessage `json:"output_schema,omitempty"`
	Mutates       bool            `json:"mutates"`
	RequiredScope string          `json:"required_scope,omitempty"`
}

// DefinitionOf is a convenience that snapshots a tool's metadata.
// Cheap to call (no IO).
func DefinitionOf(t Tool) Definition {
	return Definition{
		Name:          t.Name(),
		Description:   t.Description(),
		InputSchema:   t.InputSchema(),
		OutputSchema:  t.OutputSchema(),
		Mutates:       t.Mutates(),
		RequiredScope: t.RequiredScope(),
	}
}
