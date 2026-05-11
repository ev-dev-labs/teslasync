// Package tesla implements the Tesla Fleet API adapter. implements outbound adapters for the declared ports.
//
// Layer: adapter
// Layering: implements Tesla-fleet interfaces from internal/port/external; must NOT import internal/api, internal/handler/*, or internal/app/*. arch_test (TestAdapterPurity) enforces.
package tesla
