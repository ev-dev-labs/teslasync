// Package apilog provides the asynchronous API-call logging engine that
// persists every recorded HTTP request (inbound or outbound) to the
// api_call_logs hypertable via pgx.CopyFrom.
//
// The package contains ONLY the engine — Logger interface, async writer,
// SinkAdapter for outbound clients, and the dropped-entry Prometheus
// counter. The HTTP middleware that records inbound requests stays in
// internal/api/api_call_log_middleware.go because it depends on chi and
// in-process redaction helpers; it now constructs its async writer via
// apilog.NewAsync rather than the (deprecated) api.NewAsyncAPICallLogger.
//
// This package was extracted in phase-47/05 to break the layering
// inversion where workers (cmd/notification-worker, cmd/automation-worker)
// imported internal/api just to construct the same async logger.
//
// Layer: platform
package apilog
