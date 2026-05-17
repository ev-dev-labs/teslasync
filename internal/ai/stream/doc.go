// Package stream is the canonical SSE writer for AI feature responses
// (Phase-50 / F5).
//
// It is the single sanctioned way an AI handler emits token-by-token,
// tool-call, tool-result, confirm-request, and terminal-frame events
// to the SPA. Pattern P3 mandates one streaming primitive across the
// entire AI surface — the ESLint rule
// `teslasync/no-raw-fetch-stream-for-ai` rejects any frontend code
// that opens its own `fetch + ReadableStream` for an `/api/v1/ai/...`
// endpoint, and aivet rejects any backend AI handler that writes
// `text/event-stream` headers without going through this package.
//
// Back-pressure (R4)
// ------------------
// The Writer holds a bounded channel (cap=64) between the producer
// (the dispatcher / handler goroutine) and the consumer (an internal
// pump goroutine that owns the http.ResponseWriter + Flusher). Send
// BLOCKS the producer until the consumer drains a slot. We do NOT
// drop frames: a dropped delta corrupts the user-visible text; a
// dropped tool_call corrupts the conversation; a dropped done event
// strands the SPA in the streaming state. R4 prefers an explicit
// stall failure over silent corruption.
//
// If the consumer cannot drain a slot within the configured stall
// timeout (default 5s; tune via [WithStallTimeout]) the Writer:
//
//  1. Cancels the upstream context (handed back from [New]). The
//     dispatcher's provider call observes ctx.Done() and unwinds
//     promptly.
//  2. Best-effort emits a single terminal error frame
//     `{type:"error", message:"stream_stalled"}`.
//  3. Closes the producer channel. Subsequent Send calls return
//     [ErrWriterClosed].
//  4. Returns [ErrStallTimeout] from the offending Send so the
//     handler can surface a baseline-fallback (R8) banner.
//
// ADR-015 invariants
// ------------------
//   - I4 (zero egress): the Writer never touches an upstream provider
//     directly. It is a sink for the dispatcher, which itself is gated
//     by guard.Wrap. In off-mode no Writer is ever constructed.
//   - I6 (404 routes): the handler that owns the Writer is wrapped by
//     guard.Wrap. The Writer is only reached after the gate opens.
//   - I12 #4 (baseline routes byte-identical): the Writer is mounted
//     ONLY on /api/v1/ai/* routes. No baseline endpoint imports this
//     package.
package stream
