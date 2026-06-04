// Package tesla implements outbound adapters for Tesla Fleet API ports.
//
// Layer: adapter
// Layering: implements Tesla-fleet interfaces from internal/port/external; must NOT import internal/api, internal/handler/*, or internal/app/*. arch_test (TestAdapterPurity) enforces.
package tesla
