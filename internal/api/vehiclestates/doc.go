// Package vehiclestates serves FSM-transition-backed
// /api/v1/vehicle-states/timeline and /api/v1/vehicle-states/summary endpoints.
//
// Layer: handler
//
// Carved in Phase R2c.4, it depends only on shared HTTP helpers and
// internal/database/vehicle; it must not import its parent package.
package vehiclestates
