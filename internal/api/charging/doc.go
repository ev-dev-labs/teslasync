// Package charging serves /api/v1/charging session listing, detail,
// telemetry, and bulk-delete endpoints consumed by the SPA charging views.
//
// It keeps ChargingHandler exported while moving the charging resource
// handlers out of the root internal/api package during the Phase R2 carve.
//
// Layer: handler
package charging
