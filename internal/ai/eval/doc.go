// Package eval is the AI eval harness for TeslaSync (Phase-50 / F6).
//
// One golden YAML per feature, one canned-reply YAML per golden, one
// runner that wires every registered Strategy through the dispatcher
// against a deterministic mock provider, and one CI gate that fails
// fast on regressions.
//
// Files of interest:
//
//   - types.go           — exported data types (GoldenSet, Result, …).
//   - golden.go          — YAML loader + Validate (used by
//                          tools/eval-schema-check too).
//   - strategy.go        — GenericStrategy adapter + a per-feature
//                          Strategy registry hook.
//   - tools.go           — stub tool registry (read-only no-ops).
//   - runner.go          — runs a GoldenSet end-to-end.
//   - judge.go           — LLM-as-judge with seeded provider.
//   - judge_prompt.tmpl  — pinned judge template.
//   - report.go          — text + JUnit XML output.
//
// ADR-015 ties:
//
//   - The harness NEVER touches a real provider in fast/full mode —
//     a missing canned reply is a hard failure.
//   - Goldens live in `internal/ai/strategies/<feature>/goldens.yaml`;
//     the final-gate prompt asserts every registered feature has ≥3.
//   - The harness is the regression detector for prompt churn: a
//     Strategy.System change that no canned reply covers fails
//     loudly here before it can ship.
//
// Layer: tool
package eval

// File-level doc only; concrete code lives in the per-file sources.
