// Package main implements the audit-signal-types one-off discovery tool.
//
// Layer: cmd-internal
//
// Cross-references the three sources of truth for Tesla signal value
// shapes — `protomodel.SignalsByName` (declared ValueKind),
// `routing.yaml` (hot-column destination), and the live DB column SQL
// type — to find type-shape mismatches (like DriverSeatBelt /
// GpsState / RearSeatHeaters mis-classifications) before they bite in
// production telemetry ingest.
//
// Run from repo root:
//
//	go run ./cmd/audit-signal-types
//
// This binary intentionally has no CI gate: the audit findings never
// change the exit code. The process exits 0 once the audit completes and
// 2 only on a fatal setup error (working directory unavailable,
// unreadable migrations, or malformed routing.yaml).
// Output is a tabular report grouped by mismatch class, used during
// signal-catalog reviews and telemetry pipeline audits.
//
// Kept under cmd/ to satisfy ADR-007 and
// internal/arch.TestEveryInternalPackageHasDocGoWithLayer.
package main
