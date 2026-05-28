// Package dataquality serves the data-quality scoring and signal-lineage
// read endpoints (ADR-009 exception).
//
// Two endpoints:
//
//	GET /api/v1/admin/observability/data-quality
//	  Per-field freshness / max-gap / duplicate-ratio score from
//	  signal_log over a configurable lookback window (default 60 mins).
//	  Worst scores first so the SPA can lead with the most degraded
//	  fields. Returns 503 SUBSYSTEM_NOT_CONFIGURED when the database
//	  pool was not threaded into the handler.
//
//	GET /api/v1/admin/observability/lineage
//	  Static pipeline DAG: source(field) -> router -> writer -> table.
//	  Same shape across every deployment because routing.yaml is
//	  embedded in the binary. Dual-write edges to signal_log are
//	  rendered when the routing entry has also_signal_log=true.
//
// Layer: handler
package dataquality
