// Package flags is the dynamic feature-flag store backing the
// /api/v1/system/flags admin endpoints (Phase-44 / observability-
// batch / Prompt F8).
//
// Layer: platform
//
// The store is a thin write-through layer over Redis HSET
// `teslasync:flags`, with a Redis Pub/Sub channel
// `teslasync:flags:changes` that other processes can subscribe to in
// order to invalidate their local caches. Every Set / Delete returns
// the previous value so the FlagsHandler can record a precise
// before/after audit row in the feature_flag_changes table.
//
// Why a dedicated package (vs internal/cache or internal/config):
//
//   - internal/config is build-time / env-var loaded; flags MUST be
//     runtime-mutable so an operator can flip a behaviour without a
//     redeploy.
//   - internal/cache is a generic key/value layer with TTLs; flags
//     are write-rare-read-often without TTL semantics and need
//     change-notification.
//
// Errors:
//
//   - ErrNotFound is returned by Get when the key is unknown so the
//     handler can map it to 404 distinct from "value is empty string".
//
// Concurrency:
//
//	The package is safe for concurrent use. All mutation goes through
//	atomic Redis HSET / HDEL; the Pub/Sub broadcast is best-effort
//	and never blocks the write path.
package flags
