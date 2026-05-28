// Package ai holds the AI-subsystem audit + continuation repositories.
//
// Layer: adapter
//
// Carved files (Phase R4.15 — bounded-context restructure per ADR-011):
//
//   - call_log_repo.go             (was internal/database/ai_call_log_repo.go)
//     Append-only AI-call audit log (per-feature usage + redaction-bypass
//     records). Backs /api/v1/ai/admin/usage.
//   - chat_continuations_repo.go   (was internal/database/ai_chat_continuations_repo.go)
//     Short-lived multi-turn chat continuation state (TTL-bound).
//
// Aggregate root: AICallLog. ChatContinuations is a sibling read/write
// projection over the AI-execution flow.
//
// Cross-package wiring: callers import this subpkg as `aidb` per the
// ADR-011 alias convention (e.g.
// `aidb "github.com/ev-dev-labs/teslasync/internal/database/ai"`).
//
// NOTE (ADR-015): the AI-Off contract still applies. This subpkg is
// adapter-layer persistence only; runtime AI execution flows through
// internal/ai/{features,tools,provider,limit,...}.
package ai
