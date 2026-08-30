// Package main is the cmd/readiness-scorecard entrypoint.
//
// Layer: cmd-internal
//
// OPS-13 — generates docs/operations/production-readiness-scorecard.md
// from ops/scorecard/dimensions.yaml plus the live state of the
// repository.
//
// Every status in the output is DERIVED. A criterion is `met` only when
// all of its evidence paths resolve and its static gate passes; it is
// `gap` otherwise; and it is `unverifiable` — excluded from the score
// and listed separately — when it needs a deployed environment or real
// credentials that CI does not have.
//
// See package internal/ops (scorecard.go) for the derivation rules.
package main
