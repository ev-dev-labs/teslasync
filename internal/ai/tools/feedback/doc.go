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
// Layer: domain
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
// Contract notes:
//
//   - tool names, JSON schemas, validation, and Execute semantics must
//     stay stable because the AI manifest and UI mirror depend on them.
//   - the dispatcher's per-request scope installation via
//     WithScopedFeedback and the handler's nil wiring guard must remain
//     intact.
//   - registration order matters because Registry.Register determines the
//     LLM tool-call manifest order.
package feedback
