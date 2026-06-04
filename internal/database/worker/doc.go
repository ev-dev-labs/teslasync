// Package worker holds the background-worker status + queue
// observability repositories.
//
// Layer: adapter
//
// Bounded-context files per ADR-011:
//
//   - status_repo.go        (was internal/database/worker_status_repo.go)
//     WorkerStatusStore port + Redis + in-memory implementations for
//     heartbeat liveness telemetry across notification, export, and
//     automation workers.
//   - status_queue_repo.go  (was internal/database/worker_status_queue_repo.go)
//     WorkerQueueRepo: per-worker queue counters + recent-job views over
//     notification_log, export_jobs, and automation runs. Backs
//     /api/v1/system/queues + /api/v1/system/queues/{worker}/jobs.
//
// Cross-package wiring: callers import this subpkg as `workerdb` per
// the ADR-011 alias convention (mandatory because internal/worker
// runtime package also imports the database layer).
//
//	import (
//	    workerdb "github.com/ev-dev-labs/teslasync/internal/database/worker"
//	)
package worker
