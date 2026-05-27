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
// This binary intentionally has no CI gate; exit code is always 0.
// Output is a tabular report grouped by mismatch class, used during
// signal-catalog reviews and Phase-42/43 telemetry pipeline audits.
//
// Moved here from `tmp/audit_signal_types/` in the
// chore/repo-reorganization branch (Phase A1) to satisfy ADR-007 and
// the `internal/arch.TestEveryInternalPackageHasDocGoWithLayer` rule.
package main
