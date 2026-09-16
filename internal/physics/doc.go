// Package physics is the VIN-scoped energy/force solver. It reconstructs
// where energy and force went from Fleet Telemetry signal_log rows (SI on
// disk) and produces an auditable ledger: predicted vs measured, with an
// unexplained residual and explicit unknown terms.
//
// The package is vendor-agnostic math: callers map Tesla signals to Sample
// and Params, then call Solve. It never invents telemetry. Missing inputs
// make their term unknown (nil), never zero. Residual is first-class and
// may be negative (over-predicted).
//
// Conventions (pinned by solver_test.go):
//
//   - PowerW is discharge-positive: positive means the pack delivers
//     energy (driving), negative means the pack absorbs energy (regen or
//     charging). Tesla's PackCurrent is charge-positive, so the Tesla
//     mapping negates PackVoltage*PackCurrent.
//   - Integration is trapezoid over sample intervals; dt<=0 is skipped;
//     a gap longer than Params.UnknownGapS breaks the segment and the gap
//     interval is recorded as unknown (never zero-filled).
//   - Mass unknown: force, grade, and rolling terms stay unknown unless a
//     default mass is explicitly configured; a default is labelled on the
//     payload via MassSource.
//
// Layer: domain
package physics
