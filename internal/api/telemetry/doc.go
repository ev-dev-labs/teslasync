// Package telemetry hosts the Tesla Fleet Telemetry ingestion handler and its
// supporting machinery: the streaming session tracker (drive/charge tracking,
// flush/backfill, recovery), the alert rule engine, and capture/diagnostics
// endpoints. It was carved out of the flat internal/api package as part of the
// Phase R repository reorganization.
//
// Layer: handler
package telemetry
