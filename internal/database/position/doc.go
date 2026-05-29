// Package position contains the PositionRepo for the SI-canonical
// positions hypertable (lat/lng/altitude_m/speed_mps/heading_deg/
// odometer_m/est_range_m/rated_range_m/ideal_range_m).
//
// Layer: adapter
//
// Files:
//   - repo.go         (PositionRepo, BulkInsert, ListByVehicle, ...)
//   - from_map.go     (InsertFromMap + parent-private insertRowFromMap helper)
//
// Callsites alias this package as `positiondb` per ADR-011. Position is a
// separate aggregate from signal observations (signal_log) — it is the
// geo-coordinate snapshot row, written from the telemetry pipeline but
// queried independently by drive/route/map handlers.
package position
