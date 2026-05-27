// Package synthetic runs outside-in canary probes that exercise the
// full ingest pipeline and the read-path endpoints.
//
// Layer: platform
//
// Phase-46 / p46-synthetic. Designed to be embedded inside the
// TeslaSync API process so failures roll into the same alert + metric
// surface, but it can also be invoked from a one-shot binary as a CI
// gate.
//
// Probes are deliberately small + idempotent — they create a single
// synthetic vehicle (`synthetic_canary`), publish a known signal via
// the existing pub-test-signal pathway, and then poll the read side
// (latest signal, live state, signal_log) to assert the value
// propagated within the configured SLO. Failures roll up into a
// SyntheticResult that includes per-stage timing so operators can
// pinpoint where the pipeline regressed.
package synthetic
