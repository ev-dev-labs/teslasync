// Package queries houses SQL query bindings for the postgres adapter.
//
// Layer: adapter
// Layering: implements interfaces from internal/port/repository; must NOT import internal/api, internal/handler/*, or internal/app/*. arch_test (TestAdapterPurity) enforces.
package queries
