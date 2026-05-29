// Package vehiclesettings serves per-vehicle settings endpoints.
//
// This independent VehicleHandler sibling depends only on shared HTTP helpers
// plus settings and vehicle repos. Constructor seams keep production wiring and
// tests decoupled.
//
// Layer: handler
package vehiclesettings
