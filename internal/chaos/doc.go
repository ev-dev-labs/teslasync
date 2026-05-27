// Package chaos implements TeslaSync's scripted fault-injection suite.
//
// Layer: tool
//
// Phase-49 / p49-chaos. The scenario library encodes the recovery
// expectations TeslaSync makes of its dependencies (MQTT, Redis,
// Postgres, Tesla API) and exercises each via Toxiproxy so we can
// validate them in CI / local dev without a real chaos-engineering
// platform.
//
// Layered as a `tool` rather than `platform` because it has no
// runtime caller from the API server; the only consumer is the
// cmd/chaos-runner binary and an optional `make chaos` target.
//
// Design property: scenarios are sequential, not parallel. Running
// two scenarios at once makes attribution of recovery failures
// ambiguous — and the harness is a diagnostic tool, not a load test.
package chaos
