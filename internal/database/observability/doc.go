// Package observability holds persistence for operational diagnostics:
// slow-query introspection (pg_stat_statements), status incident manifests,
// TimescaleDB hypertable metrics + capacity forecast, FSM transition
// history audit trail, and per-vehicle ingest X-Ray (signal sample counts,
// field stats, cost report).
//
// Layer: adapter (database) — per Clean Architecture (ADR-009).
//
// Carved from the parent `internal/database` package as part of Phase R4
// (bounded-context restructure per ADR-011 §3 + ADR-015-amend).
//
// Aggregates:
//   - [SlowQueriesRepo]         — Phase-44 pg_stat_statements wrapper
//   - [IncidentRepo]            — Phase-45 status_incidents table CRUD
//   - [HypertableMetricsRepo]   — Phase-44 TimescaleDB size + forecast
//   - [FSMTransitionRepo]       — generic FSM audit log
//   - [IngestXRayRepo]          — Phase-44 + Phase-45 ingest diagnostics
//     (also hosts VehicleCostReport methods — shares the signal_log access path)
//
// Cross-aggregate cohesion: vehicle_cost_repo.go defines methods ON
// IngestXRayRepo (VehicleCostReport reuses the ingest pool); kept together
// because the methods share the receiver type.
package observability
