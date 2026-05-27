// Package ocpp implements the OCPP-J 1.6 protocol for non-Tesla EV
// chargers (Wallbox, OpenEVSE, EVlink, etc.).
//
// Layer: adapter
//
// Phase-50 / p50-ocpp. TeslaSync's primary ingest is Tesla Fleet
// Telemetry (vendor-locked, mTLS + protobuf). OCPP is a parallel,
// industry-standard adapter that lets operators with mixed fleets
// surface charging sessions from any J1.6 charger through the same
// internal signal / charging-session pipeline.
//
// Layered as `adapter` because everything here is protocol-specific:
// JSON-RPC framing, BootNotification / StatusNotification / MeterValues
// / StartTransaction / StopTransaction message handling. The domain
// concept (a charging session with a kWh delivered) is canonical and
// lives in the Tesla side of the pipeline; this package translates
// OCPP into that shape.
//
// The protocol primitives in messages.go and protocol.go are pure;
// the dispatcher (dispatcher.go) and the WebSocket server (server.go)
// hold the side effects. SessionStore is a port that allows the
// default in-memory store to be swapped for a Postgres-backed one in
// cmd/ocpp-server without changing the protocol layer.
package ocpp
