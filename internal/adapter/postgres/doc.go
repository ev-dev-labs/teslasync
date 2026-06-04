// Package postgres implements postgres-backed repository adapters.
//
// Layer: adapter
// Layering: implements interfaces from internal/port/repository; must NOT import internal/api, internal/handler/*, or internal/app/*. arch_test (TestAdapterPurity) enforces.
package postgres
