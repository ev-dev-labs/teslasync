// Package dlq owns the dead-letter queue inspector HTTP endpoints for
// listing DLQ ring entries, fetching payload details, replaying messages,
// and reading replay audit rows under /api/v1/system/dlq.
//
// Replay remains protected by router-level sudo-token gating plus the
// DLQ_REPLAY_ENABLED feature flag, while read endpoints rely on global
// forward-auth and per-route rate limits.
//
// Layer: handler
package dlq
