// Package repository declares ports for persistent repositories implemented under internal/adapter/postgres. declares the application's hexagonal-architecture ports.
//
// Layer: port
// Layering: imports stdlib + internal/domain/* + sibling internal/port/* only. arch_test (TestPortPurity) enforces.
package repository
