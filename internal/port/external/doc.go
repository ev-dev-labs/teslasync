// Package external declares hexagonal ports for outbound integrations such as Tesla, geocoding, and gas prices.
//
// Layer: port
// Layering: imports stdlib + internal/domain/* + sibling internal/port/* only. arch_test (TestPortPurity) enforces.
package external
