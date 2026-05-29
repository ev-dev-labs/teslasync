// Package system hosts the system/diagnostics HTTP handlers (version,
// update-check, migration status, config validation, worker + health
// reporting, map config) and the process-wide outbound api_call_logs sink
// registry consumed by package-api outbound HTTP clients.
//
// Layer: handler
package system
