// Package fsm provides a generic, type-safe finite state machine engine
// with declarative transition tables, guards, hooks, and SubFSM support.
//
// This package has zero external dependencies — it is pure domain logic.
// OpenTelemetry tracing is optional and injected via the TracerProvider option.
// Layer: domain
//
package fsm
