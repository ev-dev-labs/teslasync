package rag

import (
	"time"
)

// neverExpiresFrom is the synthetic time we hand to pgx for sources
// that should never expire. Postgres has a native 'infinity' literal
// for timestamptz, but pgx round-trips it as the maximum representable
// time which is what we want callers to compare against.
//
// We use the year 9999 instead of an actual pg 'infinity' modifier
// because:
//  1. Comparing `time.Now().Before(neverExpiresFrom)` always returns
//     true (we will never reach the year 9999), so retrieval and
//     TTL queries behave correctly without special-casing.
//  2. pgx serialises this as a normal TIMESTAMPTZ string — no
//     pgtype.Timestamptz{InfinityModifier} dance, no risk of the
//     postgres parser rejecting the literal in a future driver
//     upgrade.
var neverExpiresFrom = time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC)

// TTLPolicy maps source_type to the per-row TTL. After this many
// hours the row is eligible for deletion by the embeddings_ttl cron
// (internal/jobs). A zero duration means "never expire" — the row's
// expires_at is set to [neverExpiresFrom] and the cron's
// `WHERE expires_at < now()` clause leaves it untouched.
//
// The map is exported so consuming slices can introspect the policy
// (e.g. the AI usage card might surface "your drive_summary
// embeddings expire in 90 days"). It is read-only at runtime —
// adding a new source_type means editing this file AND adding a test
// case to ttl_test.go.
//
// Values mirror the prompt's table verbatim, plus a deliberate
// safety net: any source_type missing from the map is treated as if
// it had a 30-day TTL ([defaultTTL] below). Callers should not rely
// on the default — every new source_type SHOULD register an explicit
// policy so the lifetime decision is visible in this file.
var TTLPolicy = map[string]time.Duration{
	SourceDriveSummary:  90 * 24 * time.Hour,  // 90d
	SourceChargeSession: 90 * 24 * time.Hour,  // 90d
	SourceAlertHistory:  30 * 24 * time.Hour,  // 30d
	SourceAutomationRun: 30 * 24 * time.Hour,  // 30d
	SourceDocs:          0,                    // never (pinned to release)
	SourceUserNote:      365 * 24 * time.Hour, // 1y
}

// defaultTTL applies to any source_type not registered in [TTLPolicy].
// 30 days is a conservative middle ground — long enough to cover any
// reasonable analytics window, short enough that a forgotten source
// does not balloon the table indefinitely.
const defaultTTL = 30 * 24 * time.Hour

// ExpiresAt returns the absolute expiration time for a row written
// at `now` with the given source_type. A zero TTL in [TTLPolicy]
// resolves to [neverExpiresFrom] so the timestamp is comparable in
// SQL without special-case branches.
//
// Pure function: same inputs always produce the same output. The
// `now` parameter is taken explicitly (rather than reading
// time.Now() inside) so tests can be deterministic.
func ExpiresAt(sourceType string, now time.Time) time.Time {
	ttl, ok := TTLPolicy[sourceType]
	if !ok {
		ttl = defaultTTL
	}
	if ttl == 0 {
		return neverExpiresFrom
	}
	return now.Add(ttl)
}

// IsNeverExpires reports whether t is the sentinel returned by
// [ExpiresAt] for "never expire" sources. Useful for ops queries
// like "how many rows in the corpus are immortal vs expiring soon".
func IsNeverExpires(t time.Time) bool {
	return t.Equal(neverExpiresFrom)
}
