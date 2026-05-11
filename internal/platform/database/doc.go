// Package database wires the database connection pool and observability hooks.
//
// Layer: platform
//
// DEPRECATED per ADR-007: new code belongs in internal/database (the
// canonical home, 123 .go files) for higher-level repo wrappers, or
// internal/adapter/postgres for generic SQL helpers. Existing symbols
// here remain functional; consolidation tracked in phase-48 (see
// docs/architecture/platform-consolidation-todo.md).
package database
