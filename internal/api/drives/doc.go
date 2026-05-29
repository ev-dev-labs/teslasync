// Package drives serves the drive HTTP endpoints under /api/v1/drives,
// including listing, aggregate statistics, drive detail telemetry,
// positions, and bulk deletion.
//
// Drive detail projections preserve the legacy wire contract while reading
// Phase-42 SI-canonical drive rows and signal_log timelines through the
// StateReader / LiveStateReader boundaries documented in ADR-002 and ADR-007.
//
// Layer: handler
package drives
