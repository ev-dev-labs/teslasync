// Package writers contains production router.Writer implementations for
// every non-drop destination declared in routing.yaml. Each destination
// has its own file. Snapshot writers (climate, motor, tire_pressure,
// media, safety, location, security_event) compose the unexported
// snapshotWriter helper in snapshot_base.go.
//
// Per ADR-004 #8 writers are best-effort, idempotent on (vehicle_id, ts,
// field), and MUST NOT retry internally.
// Layer: platform
//
package writers
