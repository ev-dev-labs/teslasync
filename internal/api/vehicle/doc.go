// Package vehicle hosts the HTTP handlers for the core /api/v1/vehicles
// resource — List, Get, Delete, Positions, CurrentState, Wake,
// SyncFromTesla. Sibling resources (settings, photo, info, access,
// config, states) live in their own future subpackages but are NOT in
// scope for this carve (R2c).
//
// # Layer
//
// Layer: handler
//
// # Why a subpackage
//
// Carved out of the flat parent internal/api/ in Phase R2c. Follows the
// pattern set by R2a (backup) and R2b (geofence): one resource per
// subpackage; the subpackage depends only on shared infrastructure
// subpackages (R2.0d apperror, R2.0e apiparams, R2.0f apibulk, R2.0c
// apitest if reused, R2.0a httpx) and external core packages
// (internal/signal, internal/service, internal/tesla, internal/tracing).
// It must NOT import its parent — that would close the cycle.
//
// # Telemetry interface decoupling
//
// The legacy parent VehicleHandler held a *TelemetryHandler pointer
// directly. Moving the handler into a subpackage would close a cycle
// (vehicle → api → vehicle), so we declare a narrow interface
// (TelemetrySource) that captures only what the handler needs:
//
//	GetLiveSignalStore() signal.LiveSignalStore
//
// The parent *api.TelemetryHandler satisfies this interface via
// duck-typing; the SetTelemetrySource(ts TelemetrySource) method is
// called from the router wire-up. Tests can supply any value that
// implements the interface, including nil for the "no telemetry wired"
// fallback path that CurrentState already handles.
//
// # Scope
//
// In-scope (lives here):
//   - Handler (CurrentState, Get, Delete, List, Positions, SyncFromTesla, Wake).
//   - vehiclePositionMappings (signal.FieldMapping projection for /positions).
//   - liveSignalValuesToRaw (small pure helper duplicated from parent
//     signal_handler.go; the parent copy stays in place until R2e).
//   - TelemetrySource interface + SetTelemetrySource.
//
// Out-of-scope (still in parent until later R2c.* micro-carves):
//   - VehicleAccessHandler (drivers + invitations).
//   - VehicleConfigHandler (config history).
//   - VehicleInfoHandler (mobile-enabled, options, specs, subscriptions,
//     upgrades, warranty).
//   - VehiclePhotoHandler.
//   - VehicleSettingsHandler.
//   - VehicleStatesHandler.
//
// Each of those siblings has its own constructor and an independent
// route mount block, so they can be carved one at a time without
// touching this subpackage.
package vehicle
