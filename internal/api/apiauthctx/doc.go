// Package apiauthctx carries API-key authorization state (the permission
// scope granted to the presented X-API-Key) across the request-context
// boundary between the parent api middleware that authenticates the key and
// the sub-package handlers that authorize individual operations.
//
// Context values are keyed by their dynamic type, so a handler in package
// `watch` that defines its own `type permKey struct{}` can never read a value
// stored by the middleware's `permKey` in package `api` — the two types are
// distinct even though they are structurally identical. Both sides MUST use the
// helpers here (which share one unexported key type) instead of redefining a
// key locally. A duplicate local key silently fails the lookup and, in the
// watch command path, made every command return 403.
//
// Layer: handler
package apiauthctx
