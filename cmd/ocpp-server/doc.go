// Package main is the cmd/ocpp-server entrypoint.
//
// Layer: cmd-internal
//
// OCPP-J 1.6 CSMS (Charging Station Management System) entrypoint.
// Accepts WebSocket connections from non-Tesla chargers (Wallbox,
// OpenEVSE, EVlink, etc.) on the `ocpp1.6` subprotocol and routes
// protocol messages through the internal/ocpp dispatcher into the
// shared signal/charging-session pipeline.
//
// See package internal/ocpp for the protocol + dispatcher primitives.
package main
