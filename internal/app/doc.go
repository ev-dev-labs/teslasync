// Package app assembles the TeslaSync API server. It owns the
// dependency-injection container ([App]), the bootstrap sequence
// ([New]) and the request-serving lifecycle ([App.Run] / [App.Close]).
//
// Layer: app
//
// The package keeps the binary as a thin outer shell and makes startup
// composable from tests. Use-case services live under
// internal/app/<name>svc subpackages and are wired into the HTTP layer
// through internal/api.NewRouter (see [App.Run]).
//
// ADR-005 keeps package internal/api frozen and referenced from this
// package via a single alias import in
// run.go so that future migrations off internal/api change one file.
package app
