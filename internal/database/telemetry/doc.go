// Package telemetry holds the raw-telemetry capture + Fleet Telemetry
// error-state repositories.
//
// Layer: adapter
//
// Carved files (Phase R4.18 — bounded-context restructure per ADR-011):
//
//   - raw_repo.go         (was internal/database/raw_telemetry_repo.go)
//     MongoDB-backed RawTelemetryRepo for high-volume signal capture
//     (debug/diagnostic dump of every inbound MQTT message, TTL-bound).
//     Imports parent for database.MongoClient (sole Mongo binding in
//     the repo; deliberately kept in the parent helpers per ADR-006).
//   - fleet_error_repo.go (was internal/database/tesla_fleet_telemetry_error_repo.go)
//     TeslaFleetTelemetryErrorRepo: Fleet Telemetry error-state mirror
//     keyed by VIN. Powers /api/v1/admin/fleet-telemetry/errors.
//
// Cross-package wiring: callers import this subpkg as `telemetrydb`
// per the ADR-011 alias convention.
//
//	import (
//	    telemetrydb "github.com/ev-dev-labs/teslasync/internal/database/telemetry"
//	)
package telemetry
