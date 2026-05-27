// Package main is the cmd/chaos-runner entrypoint.
//
// Layer: cmd-internal
//
// Operator-facing entrypoint for TeslaSync's scripted fault-injection
// suite. Runs the default scenario library (see internal/chaos) against
// a running Toxiproxy instance, optionally probing API health endpoints
// after each scenario, and exits non-zero if any scenario fails or any
// recovery probe times out.
//
// See package internal/chaos for the scenario primitives.
package main
