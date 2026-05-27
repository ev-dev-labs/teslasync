// Package main is the cmd/fleet-config-validator entrypoint.
//
// Layer: cmd-internal
//
// A one-shot CLI gate that catches the most common pre-deployment
// foot-guns in TeslaSync's Tesla Fleet-Telemetry plumbing BEFORE
// `docker compose up` or a Helm upgrade rolls out a broken
// configuration. Validates fleet-telemetry-config.json structure,
// MQTT broker URL form, TLS material existence (with --check-paths),
// and records.V coverage.
//
// Designed to be run from CI and pre-commit; exits non-zero on any
// fatal validation error.
package main
