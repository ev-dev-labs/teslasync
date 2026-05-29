// Package signal provides read-only point-in-time snapshots.
//
// asof.go provides the parsing and read helpers that back the global
// `?as_of=` query parameter recognised by SignalStore-backed read paths.
// The parameter is read-only by contract: handlers may use it to
// reconstruct historical state from signal_log, but it MUST NEVER influence
// any write path. The read-only architecture guard enforces this by
// failing if `as_of` appears on any line that also mentions
// POST/PUT/DELETE/Insert/Update in the api package.
//
// Parameter format: RFC 3339 (e.g. `2024-11-12T14:30:00Z`). Empty or
// absent means "use live state" — handlers fall back to their existing
// SignalStore / Redis / Tesla read path.
//
// Bounds: t MUST be <= now and >= now - MaxAsOfLookback. Future
// timestamps and timestamps older than the lookback window are rejected
// at the handler boundary so a misconfigured caller cannot accidentally
// scan signal_log unbounded or fabricate "data from tomorrow".
//
// See ADR-002 for state-read semantics over signal_log; this file's
// contract is identical to LogStateReader.State() with the additional
// constraint that t comes from untrusted client input and therefore
// requires range validation before reaching the SQL layer.
package signal

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"
)

// AsOfQueryParam is the canonical query string key for the time-machine
// timestamp. A constant so both the parser and any future writer share one
// source of truth.
const AsOfQueryParam = "as_of"

// MaxAsOfLookback caps how far back the `?as_of=` query parameter is
// allowed to reach. Older signal_log history exists but is generally
// pruned/aggregated after this window and a wider point-in-time scan
// risks a slow query on the hypertable. 90 days mirrors the chart
// horizons the SPA already exposes (analytics windows, battery health
// trend) and keeps the time-machine view in the same observability tier.
//
// Surfaced as a package-level var (not a const) so future configuration
// wiring (cmd/teslasync/main.go) can override it if operators need a
// deeper window for post-incident reconstruction. Tests read it directly
// to compute expected lower bounds.
var MaxAsOfLookback = 90 * 24 * time.Hour

// Sentinel errors returned by ParseAsOf. Handlers map these to 400
// Bad Request envelopes; production code should use errors.Is to
// distinguish them from transport / SQL failures.
var (
	// ErrAsOfMalformed is returned when the supplied value is not a
	// valid RFC 3339 timestamp.
	ErrAsOfMalformed = errors.New("as_of: must be RFC 3339 timestamp")
	// ErrAsOfFuture is returned when the supplied timestamp lies in
	// the future relative to the now-anchor passed to ParseAsOf.
	ErrAsOfFuture = errors.New("as_of: must not be in the future")
	// ErrAsOfTooOld is returned when the supplied timestamp lies more
	// than MaxAsOfLookback before the now-anchor.
	ErrAsOfTooOld = errors.New("as_of: exceeds the supported lookback window")
)

// ParseAsOf extracts and validates the as_of query parameter from the
// supplied url.Values. If absent or empty it returns (zero, false, nil)
// — the caller continues to read live state through its existing path.
// When present it is parsed as RFC 3339, normalized to UTC, then
// bounds-checked against now and the lookback window.
//
// The now anchor is passed in (rather than read from time.Now() inside)
// so handler tests can pin the comparison without monkey-patching the
// clock. Production callers pass time.Now(); test callers can pass any
// fixed anchor.
//
// Validation order (caller observes the FIRST failure only):
//  1. raw absent → (zero, false, nil)   — fall back to live state
//  2. raw not RFC 3339 → ErrAsOfMalformed
//  3. parsed > now → ErrAsOfFuture
//  4. parsed < now - MaxAsOfLookback → ErrAsOfTooOld
//  5. otherwise → (parsed.UTC(), true, nil)
func ParseAsOf(values url.Values, now time.Time) (time.Time, bool, error) {
	raw := values.Get(AsOfQueryParam)
	if raw == "" {
		return time.Time{}, false, nil
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}, false, fmt.Errorf("%w: %v", ErrAsOfMalformed, err)
	}
	t = t.UTC()
	if t.After(now) {
		return time.Time{}, false, ErrAsOfFuture
	}
	if t.Before(now.Add(-MaxAsOfLookback)) {
		return time.Time{}, false, ErrAsOfTooOld
	}
	return t, true, nil
}

// SnapshotAt is the read-only point-in-time signal_log lookup that backs
// the `?as_of=` time-machine query parameter. It returns the most recent
// value of every signal emitted at-or-before t for vehicleID by
// delegating to a StateReader (typically LogStateReader). Falls back
// implicitly to a missing-map-entry when a signal had no value at that
// timestamp — callers are responsible for translating absence into
// whatever zero-fallback their JSON envelope expects.
//
// Implemented as a free function (rather than a method on *Store) so the
// L1 in-memory cache stays free of DB-aware code per ADR-007. Hot-path
// callers MUST NOT use this function — it is cold-path only and intended
// for HTTP handlers building time-machine responses.
//
// Edge guards:
//   - reader nil → error (programmer mistake; live path missed wiring).
//   - t zero → error (zero would silently match no rows; almost
//     always a forgotten ParseAsOf branch at the call site).
//
// Returns the same error shape as the underlying reader.State so callers
// can wrap it with the usual handler envelope. Successful empty results
// (no signals ever emitted before t) return (empty State, nil) NOT nil
// so callers can range over the result without an explicit nil-check.
func SnapshotAt(ctx context.Context, reader StateReader, vehicleID int64, t time.Time) (State, error) {
	if reader == nil {
		return nil, fmt.Errorf("snapshot_at: reader is nil")
	}
	if t.IsZero() {
		return nil, fmt.Errorf("snapshot_at: t must be non-zero (use ParseAsOf)")
	}
	state, err := reader.State(ctx, vehicleID, t)
	if err != nil {
		return nil, fmt.Errorf("snapshot_at vehicle %d at %s: %w", vehicleID, t.Format(time.RFC3339), err)
	}
	if state == nil {
		state = State{}
	}
	return state, nil
}
