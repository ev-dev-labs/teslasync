// Package signal contains repositories for Tesla telemetry signal storage:
// the signal_log table (Postgres hypertable + Mongo backup), the signals
// catalog (signal -> column mapping registry), and the bulk write path.
//
// Layer: adapter
//
// Files moved into this bounded context:
//   - reader.go, reader_aggregations.go, reader_query.go (Postgres reads)
//   - log_repo.go (Mongo signal_log backend)
//   - history_writer.go (Postgres signal_log writer)
//   - catalog_repo.go, catalog_repo_test.go (signals_catalog table)
//   - catalog.go (Tesla signal -> column registry)
//
// Callsites alias this package as `signaldb` per ADR-011 to disambiguate
// from the runtime package `internal/signal` and from `internal/signal/store`.
//
// The PositionRepo (positions table; also written from telemetry signals)
// lives in sibling subpackage `internal/database/position` because its
// aggregate root is a geo-coordinate snapshot, not a signal observation.
package signal
