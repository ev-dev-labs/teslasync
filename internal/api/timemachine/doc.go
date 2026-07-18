// Package timemachine reconstructs the complete signal state of a vehicle
// at an arbitrary past instant from the signal_log cold-path hypertable
// (ADR-004). It powers the Vehicle Time Machine: a DVR-style scrubber over
// the full field state of a car's "mind" at any moment in its history.
//
// The reconstruction is the classic "last row at-or-before an instant"
// query — DISTINCT ON (field) ... WHERE vehicle_id = $1 AND ts <= $2
// ORDER BY field, ts DESC — served by the (vehicle_id, field, ts DESC)
// covering index. Every value returned is SI-canonical (normalize.toSI ran
// before the cold-path writer), so display-unit conversion is a frontend
// render-boundary concern.
//
// Layer: handler
package timemachine
