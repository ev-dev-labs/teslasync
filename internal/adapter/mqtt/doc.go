// Package mqtt implements the MQTT publisher/subscriber adapters. implements outbound adapters for the declared ports.
//
// Layer: adapter
// Layering: implements interfaces from internal/port/messaging; must NOT import internal/api, internal/handler/*, or internal/app/*. arch_test (TestAdapterPurity) enforces.
package mqtt
