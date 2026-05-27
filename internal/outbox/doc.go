// Package outbox implements the transactional outbox pattern for
// TeslaSync domain events.
//
// Layer: platform
//
// Why this package exists
// ───────────────────────
// The existing events.Bus (internal/events/events.go) publishes
// directly to MQTT and silently drops events when the broker is
// down ("event: MQTT unavailable, event logged only"). That is
// acceptable for the in-process notification worker which subscribes
// from the SAME broker (broker outage means subscriber outage), but
// EXTERNAL integrations (Zapier, n8n, Splunk, Home Assistant via the
// Phase-47 MQTT discovery bridge, bespoke automations) lose every
// event published while the broker is partitioned, restarting, or
// backpressured.
//
// The transactional outbox pattern fixes this: domain writers Append
// inside the SAME database transaction that mutates their domain
// row. A background Dispatcher then claims pending rows, re-publishes
// them via the Bus, and marks them 'published' once the synchronous
// WaitTimeout returns. Failed publishes are retried with exponential
// backoff up to MaxAttempts before being marked 'failed' (operators
// can inspect or replay via /admin/outbox/* in a future slice).
//
// Two-phase delivery contract
// ───────────────────────────
//
//  1. Producer (e.g., drive completion handler) calls
//     Store.Append(tx, Event) INSIDE the same pgx.Tx that updates
//     drives.end_ts. Commit semantics: if the domain write rolls
//     back, the outbox row rolls back too — atomicity preserved.
//
//  2. Dispatcher runs in a background goroutine in any process that
//     embeds it (today: api binary; tomorrow: dedicated worker).
//     Each tick:
//     a. claim() takes ≤BatchSize rows whose next_attempt_at is
//     due, UPDATEs status='in_flight' with a lease_until far
//     enough out to cover the publish round-trip,
//     b. publishes each row via the injected Publisher,
//     c. marks success → 'published'+published_at, or failure →
//     'pending' with attempts+1 and exponentially-backed-off
//     next_attempt_at; rows that exhaust MaxAttempts move to
//     'failed' and stop retrying.
//
// Idempotency
// ───────────
// The outbox guarantees AT-LEAST-ONCE delivery: a dispatcher crash
// after the broker accepted the publish but before the row was
// marked 'published' will republish on the next tick. Consumers MUST
// be idempotent or deduplicate on the (event_type, vehicle_id, ts)
// triple carried in the payload.
//
// Stale lease recovery
// ────────────────────
// If a dispatcher crashes mid-publish, the row stays 'in_flight'
// with lease_until in the past. Any dispatcher (including the same
// one after restart) will reap such rows back to 'pending' via
// reapStaleLeases() so they are eligible for re-publish.
package outbox
