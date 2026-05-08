// Package app assembles the TeslaSync API server. It owns the
// dependency-injection container ([App]), the bootstrap sequence
// ([New]) and the request-serving lifecycle ([App.Run] / [App.Close]).
//
// Layer: app
//
// The package was extracted from cmd/teslasync/main.go in phase-47/04
// to give the binary a boring outer shell and to make startup
// composable from tests. Use-case services live under
// internal/app/<name>svc subpackages and are wired into the HTTP layer
// through internal/api.NewRouter (see [App.Run]).
//
// Per ADR-005 (phase-47/06, scheduled) package internal/api is FROZEN
// and is referenced from this package via a single alias import in
// run.go so that future migrations off internal/api change one file.
package app
