// Package queries houses generated SQL query bindings for the postgres adapter. implements the postgres-backed adapters for the repository ports. implements outbound adapters for the declared ports.
//
// Layer: adapter
// Layering: implements interfaces from internal/port/repository; must NOT import internal/api, internal/handler/*, or internal/app/*. arch_test (TestAdapterPurity) enforces.
package queries
