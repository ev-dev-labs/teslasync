// Package provider defines the hexagonal port for every AI capability
// in TeslaSync.
//
// Every feature talks to the [Provider] interface. Concrete adapters
// (Ollama, OpenAI-compatible, Anthropic, mock) implement the port and
// live in subpackages (./ollama, ./openai, ./anthropic, ./mock). Feature
// code never imports a concrete adapter — it goes through the Registry.
//
// This package also owns the cross-cutting concerns that wrap every
// provider call:
//
//  1. [WithTrace]    — OTel span per call.
//  2. RedactionDecorator — strips PII per feature policy.
//  3. RateLimitDecorator — token-bucket per (user, feature).
//  4. CostCapDecorator — daily $ cap; degrade to baseline.
//  5. AuditDecorator   — writes ai_call_log row.
//
// Order is fixed in [Chain] callers (Trace → Audit → CostCap → RateLimit
// → Redaction → base). Adapters never know about decorators.
//
// Local-mode safety lives in [ValidateLocal]. When the
// user has chosen ai_mode='local', any base_url whose host does NOT
// resolve to an RFC1918 / loopback / link-local / ULA address is
// rejected at config-save time, and the resolved IP is pinned so a
// later DNS rebinding to a public IP is detected at request time.
//
// ADR-015 §I1 (default-off) is enforced upstream by internal/ai/guard;
// this package's [Registry.For] returns [ErrProviderDisabled] when
// AI mode is off so a misconfigured handler that bypasses the guard
// still cannot egress to a provider.
//
// Layer: port
package provider
