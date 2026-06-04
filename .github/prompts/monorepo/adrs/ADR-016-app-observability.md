# ADR-016 — In-app telemetry/observability (crash, analytics, diagnostics)

**Status:** Accepted · 2026-06 · Supersedes: none

## Context

A polished, long-lived app needs crash reporting, basic usage analytics, and diagnostic
logging — without violating the project's PII rules (never log VIN, tokens, precise
location). The backend uses zerolog + Prometheus; the apps need their own client-side story.

## Decision

- **Crash reporting:** a privacy-respecting crash reporter per platform (e.g. self-hostable
  **Sentry** across all three, or platform-native: App Center/Crashlytics/MetricKit) — choice
  pinned in P0; default **Sentry self-hosted** to keep data in-house (matches self-hosted ethos).
- **Analytics:** minimal, opt-in, event-based product analytics routed to a self-hosted sink;
  **no third-party ad SDKs**; respect platform tracking-consent (ATT on iOS).
- **Diagnostic logging:** structured, leveled logging in the shared core (mirrors zerolog
  intent). **PII redaction is mandatory** — VIN, tokens, exact coordinates never logged;
  a redaction helper in the shared core is the only sanctioned logger.
- **Opt-out:** a Settings toggle disables analytics/crash upload; respects OS privacy settings.

## Consequences

- ✅ Production diagnosability; crash-free-rate tracking; honors self-hosted + privacy ethos.
- ✅ One redacting logger in the shared core; Windows mirrors it.
- ⚠️ Self-hosting the crash/analytics sink is infra work (Helm/config) scheduled in P5.
- ⚠️ Store privacy disclosures (App Store privacy nutrition labels, Play Data Safety) must
  reflect actual collection — authored in P5 release prompts.

## Alternatives rejected

- **Third-party analytics/ad SDKs:** conflict with self-hosted/privacy stance.
- **No client telemetry:** blind to field crashes; unacceptable for a polished product.
