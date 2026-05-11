// Package charging models the charging session domain (start/stop, energy added, cost). groups domain entities and value objects shared across bounded contexts.
//
// Layer: domain
//
// Per ADR-006: this package contains business entities and invariants.
// May import only stdlib + other internal/domain/* subpackages.
// Persistence and HTTP imports are forbidden (arch_test enforces).
// Conversion to/from persistence DTOs (internal/models) happens in
// internal/app/<name>svc.
package charging
