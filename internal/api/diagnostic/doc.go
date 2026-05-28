// Package diagnostic serves POST /api/v1/system/diagnostic, the aggregated
// read-only operator self-test endpoint for database, Tesla API, MQTT, Redis,
// health-monitor, and runtime checks.
//
// This is the general diagnostic surface; drive-end diagnostics live in
// internal/api/drivediagnostic.
//
// Layer: handler
package diagnostic
