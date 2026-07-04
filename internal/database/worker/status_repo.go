// Package worker stores worker heartbeat snapshots.
//
// Worker heartbeat store. Surfaces "is the notification / export /
// automation worker actually running?" to the operator-facing
// /system/queues panel.
//
// Why Redis (and not a Postgres table):
//
//   - Heartbeats are write-heavy and short-lived signal data. We
//     don't need durability across migrations; a process restart
//     legitimately produces a "no heartbeat" reading and that's
//     exactly what the staleness ladder is designed to surface.
//   - The shared Redis client is already required by every API server
//     deployment (signal cache, SSE pubsub, sudo follow-up). Adding a
//     small key-per-worker doesn't grow the dependency surface.
//   - Avoiding schema changes keeps heartbeat surfacing independent of
//     Postgres migration review.
//
// The store is intentionally tiny and behind an interface so that:
//
//   - Tests can swap a fake implementation without standing up Redis.
//   - A future Postgres-backed implementation can drop in if the
//     operator wants heartbeat history beyond "current snapshot".
//
// Wire-up: every worker process creates a [worker.Heartbeater] in its
// main() and calls Start(ctx) once. The heartbeater periodically
// invokes [WorkerStatusStore.RecordHeartbeat]. The /system/queues
// handler reads via [WorkerStatusStore.GetMany] for all known
// workers in a single MGET round-trip.
//
// Backwards-compatible "no key" semantics: when a worker has never
// written a heartbeat (e.g. the install was upgraded but the worker
// process hasn't picked up the new heartbeat code yet), GetMany
// returns a nil entry for that worker — the handler maps that to a
// "down" severity with a "no_heartbeat" detail string so operators
// see a clear "haven't received any heartbeat" UI rather than a
// fake "ok" reading.

package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// workerStatusKeyPrefix is prepended to every worker name to derive
// the Redis key. The "teslasync:" namespace already prefixes most
// other keys (see internal/platform/cache); we mirror it here so a
// single FLUSHDB nuke on the operator side wipes both signal cache
// and heartbeat snapshots.
const workerStatusKeyPrefix = "teslasync:worker_status:"

// WorkerName values that the panel knows how to render. Adding a new
// worker means appending here and shipping the matching i18n key on
// the SPA — the handler does not require backend code changes per
// worker because [WorkerStatusStore.GetMany] takes a free-form list.
const (
	WorkerNameNotification = "notification"
	WorkerNameExport       = "export"
	WorkerNameAutomation   = "automation"
)

// KnownWorkerNames is the canonical ordering rendered by the panel.
// Exported so the API handler and tests share one source of truth.
var KnownWorkerNames = []string{
	WorkerNameNotification,
	WorkerNameExport,
	WorkerNameAutomation,
}

// WorkerHeartbeat is the per-worker JSON document persisted to Redis.
// The shape is intentionally small — the operator UI only needs
// "when did we last hear from you" plus enough provenance to debug
// the heartbeat itself. Counters / queue depth come from the
// Postgres aggregator [WorkerQueueRepo].
type WorkerHeartbeat struct {
	Worker          string    `json:"worker"`
	Host            string    `json:"host,omitempty"`
	PID             int       `json:"pid,omitempty"`
	Version         string    `json:"version,omitempty"`
	StartedAt       time.Time `json:"started_at"`
	LastHeartbeatAt time.Time `json:"last_heartbeat_at"`
}

// ErrWorkerNameRequired is returned when callers pass an empty string
// for the worker name. We surface this loudly because a bug here
// would silently overwrite the global "" key.
var ErrWorkerNameRequired = errors.New("worker name required")

// WorkerStatusStore is the narrow interface the handler and the
// heartbeat library depend on. Keeping the surface this small means
// alternative backings (Postgres, in-memory for tests) drop in
// without touching production wire-up.
type WorkerStatusStore interface {
	// RecordHeartbeat persists hb. The store overwrites any prior
	// document for the same worker name. Implementations MUST be
	// safe to call concurrently from multiple goroutines.
	RecordHeartbeat(ctx context.Context, hb WorkerHeartbeat) error

	// GetMany returns the latest heartbeat for each worker name.
	// The returned map only contains entries for workers that have
	// at least one persisted heartbeat — missing entries are the
	// caller's signal that the worker has never reported in.
	GetMany(ctx context.Context, workers []string) (map[string]*WorkerHeartbeat, error)
}

// RedisWorkerStatusStore implements WorkerStatusStore against the
// shared Redis instance. Construction takes a non-nil *redis.Client;
// the API server's router constructs one and the workers re-use the
// same connection helper from internal/platform/cache.
type RedisWorkerStatusStore struct {
	rdb *redis.Client
}

// NewRedisWorkerStatusStore returns a Redis-backed store. Pass the
// raw client; we deliberately do NOT wrap it in a higher-level cache
// helper because RecordHeartbeat must control TTL semantics directly
// and the cache helper enforces a positive TTL.
func NewRedisWorkerStatusStore(rdb *redis.Client) *RedisWorkerStatusStore {
	return &RedisWorkerStatusStore{rdb: rdb}
}

// RecordHeartbeat marshals hb to JSON and SETs the worker key with
// no TTL. We let documents persist across worker restarts so a
// freshly-deployed worker that hasn't ticked yet still reports its
// previous LastHeartbeatAt — which the staleness ladder will
// classify as "warn" or "critical" depending on how long ago.
func (s *RedisWorkerStatusStore) RecordHeartbeat(ctx context.Context, hb WorkerHeartbeat) error {
	if hb.Worker == "" {
		return ErrWorkerNameRequired
	}
	if hb.LastHeartbeatAt.IsZero() {
		hb.LastHeartbeatAt = time.Now().UTC()
	}
	payload, err := json.Marshal(hb)
	if err != nil {
		return fmt.Errorf("worker_status: marshal heartbeat: %w", err)
	}
	if err := s.rdb.Set(ctx, workerStatusKeyPrefix+hb.Worker, payload, 0).Err(); err != nil {
		return fmt.Errorf("worker_status: set heartbeat for %s: %w", hb.Worker, err)
	}
	return nil
}

// GetMany fans out to MGET and returns parsed heartbeats. Missing
// keys become missing map entries (not zero-value documents) so the
// caller can tell "never reported" from "reported zero-time".
func (s *RedisWorkerStatusStore) GetMany(ctx context.Context, workers []string) (map[string]*WorkerHeartbeat, error) {
	out := make(map[string]*WorkerHeartbeat, len(workers))
	if len(workers) == 0 {
		return out, nil
	}
	keys := make([]string, len(workers))
	for i, name := range workers {
		keys[i] = workerStatusKeyPrefix + name
	}
	res, err := s.rdb.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, fmt.Errorf("worker_status: mget heartbeats: %w", err)
	}
	for i, raw := range res {
		if raw == nil {
			continue
		}
		str, ok := raw.(string)
		if !ok || str == "" {
			continue
		}
		var hb WorkerHeartbeat
		if err := json.Unmarshal([]byte(str), &hb); err != nil {
			// A poisoned key shouldn't take down the whole
			// panel; log-and-skip semantics live at the
			// caller (handler) which surfaces "down" with a
			// detail string.
			continue
		}
		out[workers[i]] = &hb
	}
	return out, nil
}

// MemoryWorkerStatusStore is a tiny in-memory store used by tests
// and as a graceful fallback when Redis is unavailable at API-server
// startup. Concurrency-safe; behaves identically to the Redis
// implementation for the operations the handler exercises.
type MemoryWorkerStatusStore struct {
	mu   sync.Mutex
	data map[string]WorkerHeartbeat
}

// NewMemoryWorkerStatusStore returns an empty store. Useful both as
// a test seam and as a no-op backing for environments where Redis
// is intentionally disabled — the handler will then report every
// known worker as "down (no heartbeat)" which matches reality.
func NewMemoryWorkerStatusStore() *MemoryWorkerStatusStore {
	return &MemoryWorkerStatusStore{data: make(map[string]WorkerHeartbeat)}
}

// RecordHeartbeat overwrites any previous document for hb.Worker.
func (s *MemoryWorkerStatusStore) RecordHeartbeat(_ context.Context, hb WorkerHeartbeat) error {
	if hb.Worker == "" {
		return ErrWorkerNameRequired
	}
	if hb.LastHeartbeatAt.IsZero() {
		hb.LastHeartbeatAt = time.Now().UTC()
	}
	s.mu.Lock()
	s.data[hb.Worker] = hb
	s.mu.Unlock()
	return nil
}

// GetMany is the in-memory equivalent of MGET. Returns a fresh map
// every call to avoid sharing internal state with callers.
func (s *MemoryWorkerStatusStore) GetMany(_ context.Context, workers []string) (map[string]*WorkerHeartbeat, error) {
	out := make(map[string]*WorkerHeartbeat, len(workers))
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, name := range workers {
		hb, ok := s.data[name]
		if !ok {
			continue
		}
		copyHB := hb
		out[name] = &copyHB
	}
	return out, nil
}
