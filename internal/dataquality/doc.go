// Package dataquality computes per-signal freshness, gap, and
// duplicate scores from signal_log + telemetry counters.
//
// Layer: platform
//
// Surfaced via /admin/observability/data-quality so operators can spot a degraded
// signal field BEFORE downstream consumers (charts, FSM, alerts)
// notice it.
//
// Two primitives:
//
//   - Scorer queries signal_log via a narrow Querier interface and
//     produces a per-field FieldScore (freshness/gap/duplicate plus a
//     composite 0..100 quality score).
//   - LineageGraph reads routing.yaml at boot and exposes the static
//     pipeline graph (source field → router → writer → table) so the
//     SPA can render a Sankey/DAG that shows which tables a slow
//     field would impact.
//
// The package is read-only and side-effect free. Scorer queries are
// bounded by context timeout so a slow Postgres doesn't stall the
// admin dashboard.
package dataquality
