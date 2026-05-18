// Package tools is the canonical tool-use surface for AI features
// (Phase-50 / 0005, F4).
//
// Methodology principle P2 says every state mutation an LLM proposes
// MUST flow through a typed, validated, audit-logged tool — never raw
// SQL, never hand-rolled prompt parsing, never `db.Exec`. This package
// is the only sanctioned implementation of that contract.
//
// # Surface overview
//
//   - [Tool] is the per-tool interface. Each tool advertises a Name,
//     a Description (LLM-visible), an [InputSchema] (JSON Schema for
//     the provider's tool-use payload), an [OutputSchema] (advisory),
//     a [Mutates] flag (controls confirm gate in the dispatcher), a
//     [RequiredScope] (RBAC), a [Validate] step that parses raw JSON
//     into the tool's typed input, and an [Execute] step that runs
//     the tool against its injected dependencies.
//
//   - [Registry] holds the registered tools by Name, and serializes
//     them as [provider.ToolSpec] for the LLM. [Registry.Filter]
//     produces an RBAC-aware subset.
//
//   - [Generate] reflects a Go struct annotated with `validate:"..."`
//     tags into a JSON-Schema document. The same struct + tags are
//     consumed by [ValidateStruct], so the schema the LLM sees and
//     the validator the dispatcher runs cannot drift (R2 mitigation).
//
//   - The 12 built-in tools at the bottom of this package are thin
//     wrappers over existing repository methods — no new SQL is
//     written. They seed the dispatcher with a usable read-only set
//     so later conversational slices have something to call. Mutating
//     tools are deliberately NOT shipped here; they belong with the
//     features that use them (N1, N2, etc.).
//
// # Why "tools" and not "actions" / "functions"
//
// "Tool" matches the OpenAI / Anthropic vendor terminology so the
// provider adapters can serialize directly without a translation
// layer. The vendor's tool_call payload is the same JSON our
// [Tool.Validate] consumes.
//
// # ADR-015 invariants
//
// This package never makes outbound network calls and never persists
// rows on its own. Tool [Execute] methods are responsible for their
// own context propagation and IO; the registry + dispatcher only
// shuffle bytes. AI-off mode reaches this package only because the
// dispatcher (which DOES check the off gate) refuses to call into it.
//
// Layer: platform
package tools
