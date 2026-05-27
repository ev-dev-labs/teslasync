package router

import "context"

// writeRole annotates whether a writer.Write call is the primary
// destination (the one routing.yaml's `dest:` field selects) or the
// secondary dual-write to signal_log that the Router performs after
// every non-signal_log / non-unit_history primary write completes.
//
// Phase-10 propagates the role through context so each writer's
// tesla.writer.<dest> span can carry the write.role attribute
// without the writer needing to know which call-site invoked it. The
// writers package reads the value via WriteRoleFromContext; the key
// type is unexported to prevent cross-package collisions, so callers
// outside the writers package cannot set this value — only the Router
// does.
type writeRoleCtxKey struct{}

// writeRole values are strings rather than an enum because the writers
// package consumes them only to stamp an OTel attribute, which is also
// a string. The enum-vs-string trade-off has no upside here.
const (
	writeRolePrimary = "primary"
	writeRoleDual    = "dual"
)

// contextWithWriteRole attaches the role marker the writer reads. The
// key is unexported so callers outside this package cannot fabricate
// a value — the Router is the single source of truth.
func contextWithWriteRole(ctx context.Context, role string) context.Context {
	return context.WithValue(ctx, writeRoleCtxKey{}, role)
}

// WriteRoleFromContext returns the write role marker the Router stamped
// on the context, or the empty string when the context did not pass
// through Router.Route (e.g. tests that invoke a writer directly). The
// writers package uses this to stamp the write.role span attribute on
// its tesla.writer.<dest> spans; an empty return is a normal "no
// router parent" condition and the writers omit the attribute entirely
// rather than emitting an "unknown" value that would pollute Tempo
// dashboards.
func WriteRoleFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(writeRoleCtxKey{}).(string); ok {
		return v
	}
	return ""
}
