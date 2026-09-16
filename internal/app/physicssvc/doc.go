// Package physicssvc assembles VIN-scoped historical energy/force ledgers.
// It maps Tesla Fleet Telemetry signal_log rows (SI on disk) to the
// vendor-agnostic internal/physics solver and returns one auditable ledger
// per window: predicted vs measured, unexplained residual, and explicit
// unknown terms.
//
// Endpoints (all under /api/v1/physics):
//
//   - GET /ledger?vehicle_id&start&end — arbitrary window + chapter markers
//   - GET /drives/{driveID}/ledger — drive window with session reconcile
//   - GET /charging/{sessionID}/ledger — charge window with session reconcile
//   - GET /park/ledger?vehicle_id&start&end — parked-drain window
//
// Ledger is historical from signal_log. Live cockpit keeps reading
// signal.Store; this package never touches it.
//
// Layer: app
package physicssvc
