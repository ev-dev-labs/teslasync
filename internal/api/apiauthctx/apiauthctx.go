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
package apiauthctx

import "context"

// permCtxKey is the unexported context key under which the API-key permission
// scope is stored. Unexported so only these helpers can read or write it.
type permCtxKey struct{}

// WithPermissions returns a child context carrying the API-key permission scope
// ("read", "read-write", or "admin"). Called by the API-key auth middleware
// after a key is validated.
func WithPermissions(ctx context.Context, perms string) context.Context {
	return context.WithValue(ctx, permCtxKey{}, perms)
}

// PermissionsFromContext returns the API-key permission scope stored by
// WithPermissions and whether it was present. The value is absent (ok=false)
// for requests that did not pass through the API-key auth middleware.
func PermissionsFromContext(ctx context.Context) (string, bool) {
	perms, ok := ctx.Value(permCtxKey{}).(string)
	return perms, ok
}
