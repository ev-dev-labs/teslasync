// Package geocoding implements the geocoding adapter (provider-agnostic). implements outbound adapters for the declared ports.
//
// Layer: adapter
// Layering: implements interfaces from internal/port/external; must NOT import internal/api, internal/handler/*, or internal/app/*. arch_test (TestAdapterPurity) enforces.
package geocoding
