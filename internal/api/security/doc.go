// Package security serves vehicle security and access signal endpoints.
//
// # Layer
//
// Layer: handler
//
// # Why a subpackage
//
// Carved in Phase R2d.82 to isolate the security handler from the parent
// internal/api package while keeping the existing exported constructor and
// handler type names for router wiring.
//
// # Scope
//
// In-scope (lives here):
//   - SecurityHandler — List + Latest method receivers.
//   - securityMappings ([]signal.FieldMapping projection).
//   - timelineRowsToFlat — small pure helper duplicated locally until the
//     parent signal timeline helpers are shared outside internal/api.
//   - Local test fakes for signal.StateReader and signal.LiveStateReader.
package security
