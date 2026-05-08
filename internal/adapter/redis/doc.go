// Package rediscache implements the redis-backed cache adapter. implements outbound adapters for the declared ports.
//
// Layer: adapter
// Layering: implements cache interfaces; must NOT import internal/api, internal/handler/*, or internal/app/*. arch_test (TestAdapterPurity) enforces.
package rediscache
