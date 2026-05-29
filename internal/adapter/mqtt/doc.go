// Package mqtt implements MQTT publisher/subscriber adapters.
//
// Layer: adapter
// Layering: implements interfaces from internal/port/messaging; must NOT import internal/api, internal/handler/*, or internal/app/*. arch_test (TestAdapterPurity) enforces.
package mqtt
