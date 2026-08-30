// Package main is the cmd/smoke-gate entrypoint.
//
// Layer: cmd-internal
//
// OPS-01 — the authenticated post-deploy smoke gate. Executes
// ops/smoke/checks.yaml against a deployed environment and exits
// non-zero when any critical check fails.
//
// Credentials are never read from the repository: the manifest names the
// environment VARIABLES that carry them. If a required credential is
// absent the gate fails rather than downgrading to an unauthenticated
// run, because a green unauthenticated smoke proves nothing.
//
// See package internal/ops (smoke.go, smokerun.go) for the manifest
// schema and the runner.
package main
