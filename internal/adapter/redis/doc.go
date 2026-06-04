// Package rediscache implements the Redis-backed cache adapter.
//
// Layer: adapter
// Layering: implements cache interfaces; must NOT import internal/api, internal/handler/*, or internal/app/*. arch_test (TestAdapterPurity) enforces.
package rediscache
