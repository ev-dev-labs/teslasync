// Package messaging declares hexagonal ports for asynchronous message buses (MQTT, SSE).
//
// Layer: port
// Layering: imports stdlib + internal/domain/* + sibling internal/port/* only. arch_test (TestPortPurity) enforces.
package messaging
