// Package vehicle hosts the core /api/v1/vehicles handlers; sibling vehicle
// resources remain in parent packages until their own R2c micro-carves.
//
// # Layer
//
// Layer: handler
//
// Carved from internal/api in Phase R2c. Telemetry access is narrowed to the
// TelemetrySource interface so this package can use live signals without
// importing its parent and closing a cycle.
package vehicle
