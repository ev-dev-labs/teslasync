// Package main is the cmd/ops-gate entrypoint.
//
// Layer: cmd-internal
//
// Runs the static release/operations gates that back epics OPS-01
// through OPS-13. Every check is deterministic and offline: it reads the
// machine-readable manifests under ops/ and compares them against the
// actual state of the repository. No database, no cluster, no
// credentials, no network.
//
// See package internal/ops for the check implementations.
package main
