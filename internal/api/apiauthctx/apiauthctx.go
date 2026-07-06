// Package apiauthctx: see doc.go for the package overview and layer.
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
