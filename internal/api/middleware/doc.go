// Package middleware contains the cross-cutting HTTP middleware composed at the
// chi router boundary by internal/api/router.go.
//
// Layer: handler
//
// (These middlewares wrap http.Handler and have no knowledge of any specific
// resource — vehicles, drives, charging, etc. They are the first thing that
// runs on every API request, before any handler executes.)
//
// # What lives here
//
// Six observability + safety middlewares that are wired GLOBALLY by
// internal/api/router.go::NewRouter:
//
//   - Metrics         — RED metrics (rate / errors / duration) on the
//     teslasync_red_* Prometheus series with bounded status_class label.
//   - Logger          — per-request zerolog line; level escalates on 4xx/5xx;
//     sets X-Response-Time response header.
//   - Recovery        — converts panics into a structured 500 with stack trace.
//   - Tracing         — otelhttp inbound span "http.request" with method+path
//     formatter. Falls back to the noop tracer when OTel is not initialised.
//   - SecurityHeaders — pins API CSP / X-Content-Type-Options / X-Frame-
//     Options / X-XSS-Protection / Referrer-Policy / Permissions-Policy.
//     HSTS is emitted only by the TLS-terminating ingress.
//   - Prometheus      — legacy {method,path,status} HTTP metrics kept for
//     backwards-compatible Grafana dashboards during the RED migration window.
//     Mutually exclusive with Metrics at the data layer (two histograms ≠ one
//     ground truth), but BOTH are chained today because both metric families
//     are scraped. See the metrics conventions runbook.
//
// All exports drop the redundant "Middleware" suffix, matching chi's own
// convention (chi.middleware.Logger, chi.middleware.Recoverer). Call sites
// read as middleware.Metrics, middleware.Recovery, middleware.SecurityHeaders.
//
// # What does NOT live here
//
// These middlewares stay in the parent internal/api package because they have
// significant cross-coupling that pulls in handler-layer concerns:
//
//   - apikey / forward_auth / sudo — auth concerns; eligible for a future
//     internal/api/auth carve once the resource handlers stabilise.
//   - api_call_log_middleware     — depends on the APICallLogger interface
//   - DefaultAPILogSkip helper defined alongside admin handlers.
//   - error_tracker (ErrorTrackingMiddleware) — packaged with the ErrorTracker
//     struct that the /system/errors handler queries directly.
//   - router_middleware.go        — composition glue + RouterOptions struct.
//   - userPrefsMiddleware (in ai_routes.go) — handler-scoped, moves with the
//     AI handler when its resource subpackage is carved.
//
// # Wire-shape contract
//
// Recovery writes its 500 body via internal/api/httpx.WriteError to keep the
// flat error envelope {"error": "...", "code": 500} byte-compatible with the
// frontend resilience layer (web/src/lib/resilience.ts). See
// internal/api/httpx/doc.go for the full wire-shape contract.
//
// # Stability
//
// Same blast radius as the parent middleware.go / security.go that this
// package replaces: changing any of these middlewares is a global API change
// that affects EVERY HTTP request — the same Prometheus series, the same log
// fields, the same response headers. Treat additions as cross-cutting and
// land them through the same review process that gated the originals.
package middleware
