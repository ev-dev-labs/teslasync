// Package queuestatus serves the read-only job queue status endpoints consumed
// by the admin status panel: GET /api/v1/system/queues and
// GET /api/v1/system/queues/{worker}/jobs.
//
// The status endpoint returns one QueueStat row per known worker
// (notification, export, automation) with queue counters and the latest
// heartbeat. The jobs endpoint returns up to N recent jobs for the worker drawer;
// limit defaults to 20 and is clamped at 200.
//
// Wire-shape stability: the exported response envelopes and row types preserve
// the Phase-46 / Prompt 41 JSON contract for queue counters, worker heartbeat
// staleness, and recent job drawer rows.
//
// Layer: handler
package queuestatus
