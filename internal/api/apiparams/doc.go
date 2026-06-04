// Package apiparams provides shared request-decoding helpers used
// across the internal/api package and its R2a-R2e wave subpackages.
//
// Layer: handler
//
// # Why this subpackage exists
//
// These helpers once lived as unexported lowercase functions in
// internal/api/helpers.go (pagination / urlParamInt64 / parseDateRange /
// nullableTime). With many caller sites and handler subpackages parsing
// the same query params, URL params, and date ranges, we promoted them
// to a shared subpackage with exported names BEFORE
// the waves begin. Each wave subpkg imports
//
//	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
//
// and calls apiparams.Pagination(r), apiparams.URLParamInt64(r,"id"),
// apiparams.ParseDateRange(r), apiparams.NullableTime(use, t).
//
// # Wrapper transition
//
// The parent internal/api retains lowercase 1-line wrappers
// (pagination / urlParamInt64 / parseDateRange / nullableTime) that
// delegate to apiparams.* so the existing 156 call sites keep
// compiling. Wrappers are drained naturally as handlers migrate into
// subpackages — the migrated handler code
// calls apiparams.* directly. After Phase D when internal/api is
// drained, the wrappers become dead code and are deleted in one
// sweep.
//
// # Contract pinning
//
// Pagination caps `limit` at 1000 with default 50; rejects negative
// offsets. This contract is documented in many handler docstrings —
// changing the cap or default requires updating every handler that
// references it (search regex: `limit.{0,40}max.{0,40}1000`).
//
// ParseDateRange has two parsing paths in priority order:
//  1. RFC 3339 instants (preferred — used by React useRangeState)
//  2. YYYY-MM-DD legacy (backward-compat for audit endpoints)
//
// The RFC 3339 end path subtracts one microsecond so `[start, exclusiveEnd)`
// semantics work with handlers using `ts BETWEEN $2 AND $3`. See the
// detailed docstring on ParseDateRange for the timezone bug-fix rationale.
//
// URLParamInt64 uses chi.URLParam — only call from handlers mounted
// behind a chi router with the corresponding {id} URL param. Tests
// must use chi.NewRouteContext + req.WithContext to inject the param.
//
// NullableTime is a tiny SQL helper: pgx.Query parameter that is
// either the time value or interface-typed nil. Pair with a SQL guard
// like `($N::timestamptz IS NULL OR ts >= $N)` to express "filter when
// supplied; full-history when not".
//
// # Stability
//
// Exported surface area is intentionally tiny (4 functions). New
// request-parsing helpers should land here too rather than re-living
// at the parent.
package apiparams

// Layer: handler
