// Package queuestatus serves read-only worker queue status endpoints.
//
// Response envelopes preserve the Phase-46 / Prompt 41 JSON contract for queue
// counters, heartbeat staleness, and recent job drawer rows.
//
// Layer: handler
package queuestatus
