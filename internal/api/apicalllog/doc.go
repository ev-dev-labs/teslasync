// Package apicalllog serves the read endpoints over the api_call_log
// hypertable — the durable trail of every inbound /api/v1 request and
// every outbound Tesla Fleet API call. Writes happen via the
// APICallLogMiddleware (still in the parent internal/api package, which
// owns the chi middleware chain).
//
// Endpoints:
//
//	GET /api/v1/api-logs          — List with method/status/endpoint/
//	                                service/start/end filters and standard
//	                                limit+offset pagination.
//	GET /api/v1/api-logs/stats    — Aggregate counts (per-method, per-
//	                                status, per-service) for the
//	                                observability board.
//
// Layer: handler
package apicalllog
