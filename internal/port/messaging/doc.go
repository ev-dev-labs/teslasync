// Package messaging declares ports for asynchronous message buses (MQTT, SSE). declares the application's hexagonal-architecture ports.
//
// Layer: port
// Layering: imports stdlib + internal/domain/* + sibling internal/port/* only. arch_test (TestPortPurity) enforces.
package messaging
