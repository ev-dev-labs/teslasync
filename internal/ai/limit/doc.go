// Package limit is the AI rate-limiter + cost-cap layer that sits in
// front of every provider call. It is the F9 slice of Phase-50.
//
// Why this lives in its own package
// ---------------------------------
// Two cross-cutting concerns share a common Decision shape:
//
//   - Token bucket per (subject, feature) — bounds inflight + per-minute
//   - per-day call volume.
//   - Daily cost cap per subject — bounds dollar spend on cloud
//     providers.
//
// Both are wired into the provider chain via the F9 decorators
// (internal/ai/provider/{ratelimit,cost}_decorator.go). The decorators
// translate a [Decision] with Allowed=false into a typed [LimitError]
// the dispatcher catches and surfaces as a structured SSE error frame
// (R8 mitigation) so the frontend can pivot to its non-AI baseline.
//
// ADR-015 invariants this package preserves
// -----------------------------------------
//   - §I1 default-off: the package is wired into the chain only when
//     the provider registry builds a chain at all, which only happens
//     after [provider.Registry.For] passes the off-mode + per-feature
//     gates. Limiter + CostCap are unreachable in off mode.
//   - §I3 baseline intact: a [Decision] with Allowed=false carries a
//     BaselineAvailable=true flag that the SSE writer + frontend
//     banner surface. Exhaustion never breaks the app.
//   - §I7 per-feature opt-in: every gate consults the canonical
//     [features.Registry] tier when picking a quota. Unknown or
//     missing feature IDs fail-loud (rubber-duck #6).
//   - §I8 data survives downgrade: limiter buckets are in-process
//     only — no persistence, no schema changes. The cost cap reads
//     from the existing ai_call_log; nothing is written from this
//     package.
//   - §I12 auditable: every Decision carries a Reason that flows into
//     the SSE error frame and (when the rate-limit decorator wraps the
//     audit decorator) into the audit row's error column.
//
// Strictness contract
// -------------------
// Per-call request quotas (BurstReq, PerMinute, PerDay) are HARD —
// rejected pre-call. Per-call TOKEN quotas (InTokensPM, OutTokensPM)
// are BEST-EFFORT — observed via [Limiter.Observe] AFTER the call
// completes. A single oversized prompt CAN exceed the per-minute token
// quota because the size isn't known pre-call. The token quotas exist
// to throttle a runaway loop of normal-sized requests, not to enforce
// per-call size limits — for that, configure MaxTokens at the
// strategy.
//
// Layer: platform
package limit
