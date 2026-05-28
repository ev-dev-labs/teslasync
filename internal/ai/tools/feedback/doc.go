// Package feedback hosts the AI-attributed feedback-queue-triage
// tool family — three propose-only LLM tools wired into the AI
// dispatcher's per-request scope (ADR-015 §I12):
//
//   - draft_feedback_triage    — load + scope-check the in-scope
//     row; return a normalized envelope
//     for human review.
//   - validate_feedback_triage — closed-enum + scope check; pure
//     DTO transform with no IO.
//   - retrieve_feedback_chunks — F7 retrieval over the per-feature
//     source-type allowlist
//     {feedback_item, audit_log}.
//
// Layer: domain (LLM tool implementations). The package depends
// on:
//
//   - the parent registry: internal/ai/tools (for Registry,
//     ValidateStruct, NewRegistry)
//   - the RAG retriever port: internal/ai/rag
//   - the AI provider envelope: internal/ai/provider
//
// Bounded-context subpkg per ADR-011 §2 — alias suffix is
// `feedbackaitools` when imported at composition roots that also
// import a sibling-named package (e.g. internal/database/feedback):
//
//	import (
//	    feedbackaitools "github.com/ev-dev-labs/teslasync/internal/ai/tools/feedback"
//	    feedbackdb      "github.com/ev-dev-labs/teslasync/internal/database/feedback"
//	)
//
// When this package is the sole `feedback` import at a callsite
// the alias is not required — `feedback.RegisterFeedbackQueueTriageTools(...)`
// reads cleanly.
//
// ADR-015 amendment (Phase R6) contract preserved verbatim across
// the carve:
//
//   - pure file relocation. No tool name (Name() return value)
//     changed. No InputSchema / OutputSchema JSON changed.
//     No Validate / Execute body semantics changed.
//   - the AI guard wrapping (the dispatcher's per-request scope
//     installation via WithScopedFeedback, the AI handler's
//     panic-on-nil wiring) is unchanged. `make ai-vet` MUST
//     continue to pass after every R6 ai/tools commit.
//   - tool registration ordering is preserved — the parent
//     internal/api/router.go still calls
//     RegisterFeedbackQueueTriageTools at the same point in the
//     boot sequence; the underlying Registry.Register order
//     determines the LLM tool-call manifest order and MUST NOT
//     drift.
package feedback
