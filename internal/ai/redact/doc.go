// Package redact is the Phase-50 / F8 PII redaction layer.
//
// Cloud AI providers see whatever the application sends them. Without a
// structured redactor, a single accidental `%v` of a vehicle state
// floods OpenAI / Anthropic / Google with VINs, GPS coordinates, street
// addresses, and email addresses. ADR-015 §I9 ("Provider keys never
// leak in off mode") and the spirit of §I4 ("zero outbound egress in
// off mode") demand a default-deny redaction stance for every cloud
// call: the redact decorator (internal/ai/provider/redact_decorator.go)
// strips PII as the very last thing before the outbound HTTP. Each
// Strategy declares which PII classes it explicitly opts back in via
// [Policy.Allow]; everything else is replaced with round-trippable
// tokens.
//
// # Architecture
//
//	┌──────────────┐  ┌──────────────┐  ┌────────────────┐  ┌──────┐
//	│  Strategy    │→ │ dispatch.Run │→ │ redact decorator│→ │ wire │
//	│ Redaction    │  │ ctx.WithPolicy │ │  Apply, Record │  │      │
//	│   Policy     │  │              │  │     Meta       │  │      │
//	└──────────────┘  └──────────────┘  └────────┬───────┘  └──────┘
//	                                             │
//	                                             ▼
//	                                  ┌──────────────────────┐
//	                                  │ ai_call_log row gets │
//	                                  │ redacted_classes +   │
//	                                  │ redaction_bypass     │
//	                                  └──────────────────────┘
//
// # Operation
//
//   - [Apply] runs every detector ([Detect]) over the input text and
//     returns ([]Span, Manifest). Spans whose [PIIClass] is NOT in the
//     [Policy.Allow] set are replaced according to [Policy.Mode].
//   - [Restore] is the inverse — given the LLM's response and the
//     [Manifest] produced by [Apply], it stitches the original PII
//     values back in. Used for round-tripping a chatbot answer to the
//     same user the data came from.
//   - The decorator records ([]PIIClass, bypass bool) per call into a
//     process-global side channel ([RecordMeta] / [ConsumeMeta]) so the
//     repo can populate the new ai_call_log columns at insert time
//     without changing the [provider.AuditRecord] struct (which lives
//     outside this slice's allowed-files list).
//
// # ADR-015 alignment
//
//   - I4 zero egress  — when ai_mode='off' the registry never builds a
//     provider; the decorator therefore never runs and the side-channel
//     map stays empty.
//   - I9 provider keys/PII never leak — the [DefaultPolicy] denies every
//     class; opting a class back in is an explicit per-feature act.
//   - I10 type-system enforcement — every [strategy.Strategy] returns a
//     [strategy.RedactionPolicy]. The dispatcher converts that into a
//     concrete [Policy] via [FromStrategyPolicy] and threads it through
//     ctx so the decorator cannot be reached without a policy in scope.
//
// # Manifest hygiene
//
// Manifests are in-process only: never persisted, never sent to the
// provider, never serialised to disk. They go out of scope as soon as
// the request handler returns. A handler that calls [Restore] on a
// fresh response (rather than the one that produced the manifest) gets
// the response back unchanged — there is no token table to consult.
package redact
