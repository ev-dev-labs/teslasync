// Package vehiclesettings serves per-vehicle settings endpoints.
//
// Carved in Phase R2c.5 as an independent VehicleHandler sibling; keep it
// dependent only on shared HTTP helpers plus settings and vehicle repos.
// Constructor seams keep production wiring and tests decoupled.
//
// Layer: handler
package vehiclesettings
