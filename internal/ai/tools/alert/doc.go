// Package alert hosts the AI tool implementations for alert-rule
// management: drafting new rules from natural-language prompts and
// tuning existing rules based on firing history.
//
// Two tools:
//   - alert_builder: drafts an AlertRule from a NL goal, then a
//     companion validate tool runs the canonical validator
//     before persistence.
//   - alert_tuning: proposes a patch to an existing rule based on
//     its recent firing history (false-positive reduction or
//     sensitivity boost).
//
// They share `*alertmodel.AlertRule` plus the validate-then-draft
// two-step pattern, so they live together in this subpkg per
// ADR-011 §2 — bounded-context grouping wins over per-tool
// granularity when tools share non-trivial helper surface.
//
// Layer: adapter
//
// ADR-011 §3 alias convention: callers importing this package
// alongside the parent ai/tools should use the alias `alertaitools`.
// At single-import callsites no alias is required.
//
// Both /api/v1/ai/alert-builder and /api/v1/ai/alert-tuning-suggestions
// re-check ai_mode and per-feature toggles before running, returning a skipped
// result with no side effects when AI is off.
//
// Shared test fixtures belong in internal/ai/tools/toolstest instead of being
// inlined repeatedly across tool packages.
package alert
