// Package webvitals owns the public Real-User-Monitoring ingest endpoint that
// accepts Core Web Vitals, SPA navigation timings and bounded UX events from
// the browser, and records them as privacy-safe, cardinality-bounded
// Prometheus series.
//
// It keeps browser-side performance telemetry isolated from the parent API
// router while preserving the anonymous, rate-limited POST /api/v1/web-vitals
// surface.
//
// Files:
//
//	handler.go              HTTP handler, wire contract, payload validation, batch caps.
//	normalize.go            Route templating, privacy redaction, closed label sets.
//	metrics.go              SI histograms, dimension counters, release gauges, caps.
//	routetemplates_gen.go   Generated canonical SPA route table (DO NOT EDIT).
//
// `NormalizeRoute` is shared verbatim with internal/api/weberrors so both
// public ingest surfaces produce identical route labels.
//
// Contract, cardinality budget and alert response are documented in
// docs/runbooks/frontend-rum-slos.md. The SLOs built on these metrics live in
// slo/catalog.yaml under the `frontend` tag.
//
// Layer: handler
package webvitals

//go:generate go run github.com/ev-dev-labs/teslasync/cmd/routetemplategen
