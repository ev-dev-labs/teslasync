// Package geocoding implements provider-agnostic outbound adapters for geocoding ports.
//
// Layer: adapter
// Layering: implements interfaces from internal/port/external; must NOT import internal/api, internal/handler/*, or internal/app/*. arch_test (TestAdapterPurity) enforces.
package geocoding
