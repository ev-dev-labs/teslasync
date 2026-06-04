// Package energyflow serves GET /api/v1/vehicles/{vehicleID}/energy/flow,
// the current per-vehicle energy-flow snapshot consumed by the SPA.
//
// The handler reads through signal.LiveStateReader so the endpoint observes
// the layered live-state contract while preserving the historical JSON wire
// shape for the Energy Flow panel.
//
// Layer: handler
package energyflow
