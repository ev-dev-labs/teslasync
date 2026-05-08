// Package fsm provides a generic, type-safe finite state machine engine
// with declarative transition tables, guards, hooks, and SubFSM support.
//
// This package has zero external dependencies — it is pure domain logic.
// OpenTelemetry tracing is optional and injected via the TracerProvider option.
// Layer: domain
//
// Per ADR-006: this package contains business entities and invariants.
// May import only stdlib + other internal/domain/* subpackages.
// Persistence and HTTP imports are forbidden (arch_test enforces).
// Conversion to/from persistence DTOs (internal/models) happens in
// internal/app/<name>svc.
package fsm
