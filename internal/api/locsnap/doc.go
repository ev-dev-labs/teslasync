// Package locsnap hosts the HTTP handlers for the /api/v1/location-snapshots
// resource: location history (List) plus most-recent location state (Latest),
// both backed by the signal-log change feed and layered live-state reader.
//
// # Layer
//
// Layer: handler
//
// # Why a subpackage
//
// Carved in Phase R2d.75 as part of the internal/api handler decomposition.
// The package depends only on shared API infrastructure (apiparams, httpx) and
// external core packages (internal/signal). It MUST NOT import its parent
// internal/api package.
//
// # Scope
//
// In-scope (lives here):
//   - LocationSnapshotHandler — List + Latest method receivers.
//   - locationMappings ([]signal.FieldMapping projection).
//   - timelineRowsToFlat — small pure helper duplicated locally from
//     internal/api/drive_handler_detail.go until that handler is carved.
//   - Local test fakes duplicated to avoid depending on parent-package tests.
package locsnap
