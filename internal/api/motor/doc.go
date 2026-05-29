// Package motor hosts the HTTP handlers for the /api/v1/motor resource —
// motor, drive-inverter, and powertrain history plus latest live-state
// projections backed by signal.StateReader / signal.LiveStateReader.
//
// # Layer
//
// Layer: handler
//
// # Why a subpackage
//
// Carved in Phase R2d.77 as part of the internal/api resource-package
// reorganization. The package depends only on shared API infrastructure
// (apiparams, httpx) and core signal interfaces; it must not import its
// parent package.
//
// # Scope
//
// In-scope (lives here):
//   - MotorHandler — List + Latest method receivers.
//   - motorMappings ([]signal.FieldMapping projection).
//   - Derived motor power helpers for power_kw / regen_kw.
//   - timelineRowsToFlat — small pure helper duplicated locally from
//     internal/api/drive_handler_detail.go until that handler is carved.
//   - Local test fakes duplicated because subpackage tests cannot import
//     parent package test fixtures without creating coupling.
package motor
