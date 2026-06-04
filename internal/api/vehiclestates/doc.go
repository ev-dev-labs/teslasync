// Package vehiclestates serves FSM-transition-backed
// /api/v1/vehicle-states/timeline and /api/v1/vehicle-states/summary endpoints.
//
// Layer: handler
//
// Depends only on shared HTTP helpers and internal/database/vehicle;
// it must not import its parent package.
package vehiclestates
