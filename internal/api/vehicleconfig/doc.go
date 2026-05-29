// Package vehicleconfig hosts the HTTP handlers for the
// /api/v1/vehicle-config resource — vehicle configuration history
// (List) + most-recent flattened configuration (Latest), both backed by
// the ADR-002 signal-log change feed.
//
// # Layer
//
// Layer: handler
//
// # Why a subpackage
//
// This resource cluster lives in its own subpackage and follows the same
// resource-per-package precedent as its siblings. It depends only on shared
// infrastructure (apperror, httpx, apiparams) and external
// core packages (internal/signal). MUST NOT import its parent.
//
// # Scope
//
// In-scope (lives here):
//   - Handler — List + Latest method receivers.
//   - vehicleConfigMappings ([]signal.FieldMapping projection).
//   - timelineRowsToFlat — small pure helper duplicated locally from
//     internal/api/drive_handler_detail.go. The parent copy stays
//     until that handler is also carved.
//   - Local test fakes (fakeStateReader, fakeLiveStateReader,
//     newTestLiveStateReader) duplicated for the same cycle-avoidance
//     reason as the vehicle subpkg.
//
// # Independence
//
// The constructor takes only (signal.StateReader, signal.LiveStateReader)
// — both external. Zero shared state/types/helpers with sibling
// vehicle.* clusters. Clean carve: single router.go constructor swap.
package vehicleconfig
