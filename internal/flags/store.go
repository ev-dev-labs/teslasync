// Package flags — dynamic, Redis-backed feature flag store.
//
// Phase-44 / observability-batch / Prompt F8.
//
// Solves the "I need to toggle a behavior without redeploying" problem
// for TeslaSync operators. The store is a thin layer over a single
// Redis HASH (key `teslasync:flags`) with these properties:
//
//   - **Hot-path reads** are served from a per-process local cache
//     with a configurable TTL (default 5s). This keeps GetString /
//     GetBool / GetFloat / GetInt latency under 1µs without touching
//     Redis, which is important for code paths that read flags from
//     inside the telemetry pipeline (~1k msg/s × N flags = too many
//     Redis round-trips).
//
//   - **Writes invalidate immediately** by publishing on a Redis
//     Pub/Sub channel (`teslasync:flags:invalidate`) so cross-process
//     consistency happens within the SUBSCRIBE round-trip time (~10ms
//     typical) rather than 5s.
//
//   - **All values are stored as strings.** Typed getters parse the
//     string at the call site so the producer doesn't need to know
//     the consumer's type. A default is REQUIRED at every read so a
//     missing or malformed value never returns the Go zero value
//     unintentionally — the rubber-duck critique (F8.R4) called this
//     out as the largest production-bug class for flag stores.
//
//   - **Audit is the handler's responsibility,** not the store's.
//     Set/Delete return the previous value so the handler can write
//     a feature_flag_changes row before AND after the change.
//
// What this store does NOT do:
//
//   - It does NOT do percentage rollouts, A/B variants, or targeting
//     rules. It's a key/value store. Those features need a separate
//     ADR + schema and are out of scope.
//   - It does NOT persist to PostgreSQL. Flags are configuration, not
//     data — a redis-down environment falls back to in-memory cache
//     + defaults, which is the right behavior for a sidecar concern.
//   - It does NOT validate flag keys against a schema. Operators can
//     create keys ad-hoc; the convention is `area.subsystem.behavior`
//     (e.g. `ingest.si_canonical_cutover`).

package flags

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// DefaultLocalCacheTTL bounds how long a process can serve stale values
// after another process / operator changes a flag. The Pub/Sub
// invalidate channel makes the cross-process latency much shorter in
// practice (~10ms); the TTL is the worst case if the Pub/Sub message
// is lost.
const DefaultLocalCacheTTL = 5 * time.Second

// RedisHashKey is the single Redis HASH that holds all flags. Hash
// (rather than per-flag keys) so a list operation is O(N flags),
// HGETALL is one round-trip, and operators can SCAN-free inspect via
// `HKEYS teslasync:flags`.
const RedisHashKey = "teslasync:flags"

// RedisInvalidateChannel is the Pub/Sub channel writes publish to so
// other processes invalidate their local caches.
const RedisInvalidateChannel = "teslasync:flags:invalidate"

// ErrNotFound is returned by Get when the key is not present. Typed
// getters (GetString / GetBool / ...) DO NOT return this — they return
// the supplied default silently.
var ErrNotFound = errors.New("flags: not found")

// Store provides thread-safe reads + writes against the Redis hash with
// local caching + Pub/Sub invalidation.
type Store struct {
	rdb            *redis.Client
	localCacheTTL  time.Duration
	logger         logger
	hashKey        string
	invalidateChan string

	mu    sync.RWMutex
	cache map[string]cacheEntry

	psCancel context.CancelFunc
	psDone   chan struct{}

	hits   atomic.Uint64
	misses atomic.Uint64
}

type cacheEntry struct {
	value   string
	present bool      // false → known absent (negative caching)
	expiry  time.Time // when this entry is stale
}

// logger is the minimal interface the store needs.
type logger interface {
	Warn(msg string, args ...any)
}

type nopLogger struct{}

func (nopLogger) Warn(string, ...any) {}

// Option customises a new store.
type Option func(*Store)

// WithLocalCacheTTL overrides the default 5s local-cache TTL.
func WithLocalCacheTTL(d time.Duration) Option {
	return func(s *Store) {
		if d > 0 {
			s.localCacheTTL = d
		}
	}
}

// WithLogger sets the warning logger.
func WithLogger(l logger) Option {
	return func(s *Store) {
		if l != nil {
			s.logger = l
		}
	}
}

// NewStore constructs a flag store. rdb may be nil — in that case the
// store operates in fallback mode: reads return the default; writes
// return an error; Start is a no-op. This matches the "Redis-down
// degrades gracefully" contract of TeslaSync's other Redis consumers.
func NewStore(rdb *redis.Client, opts ...Option) *Store {
	s := &Store{
		rdb:            rdb,
		localCacheTTL:  DefaultLocalCacheTTL,
		logger:         nopLogger{},
		hashKey:        RedisHashKey,
		invalidateChan: RedisInvalidateChannel,
		cache:          make(map[string]cacheEntry),
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

// Start begins the Pub/Sub goroutine that listens for cross-process
// invalidations. Safe to call once; calling on a nil-redis store is
// a no-op. The returned shutdown function must be called during
// process shutdown to close the subscription cleanly.
func (s *Store) Start(_ context.Context) func() {
	if s == nil || s.rdb == nil {
		return func() {}
	}
	subCtx, cancel := context.WithCancel(context.Background())
	s.psCancel = cancel
	s.psDone = make(chan struct{})
	go s.runInvalidateSubscriber(subCtx)
	return s.shutdown
}

// shutdown stops the Pub/Sub goroutine. Bounded by a 1s timeout so a
// stuck Pub/Sub doesn't block process exit.
func (s *Store) shutdown() {
	if s == nil || s.psCancel == nil {
		return
	}
	s.psCancel()
	select {
	case <-s.psDone:
	case <-time.After(time.Second):
		// best-effort: leave the goroutine; process is exiting anyway
	}
}

// runInvalidateSubscriber listens on the Pub/Sub channel. Every
// received message is a key (or "*" for everything) that we evict
// from the local cache so the next read goes to Redis. Reconnects
// after brief sleep on disconnect.
func (s *Store) runInvalidateSubscriber(ctx context.Context) {
	defer close(s.psDone)
	for {
		if ctx.Err() != nil {
			return
		}
		sub := s.rdb.Subscribe(ctx, s.invalidateChan)
		ch := sub.Channel()
		disconnected := false
		for !disconnected {
			select {
			case <-ctx.Done():
				_ = sub.Close()
				return
			case msg, ok := <-ch:
				if !ok {
					disconnected = true
					break
				}
				s.evictLocal(msg.Payload)
			}
		}
		_ = sub.Close()
		select {
		case <-ctx.Done():
			return
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func (s *Store) evictLocal(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if key == "*" || key == "" {
		s.cache = make(map[string]cacheEntry)
		return
	}
	delete(s.cache, key)
}

// Get returns the raw string value for key. Returns ErrNotFound when
// the key is absent. Reads from local cache first; on miss, reads
// from Redis and populates the cache (positive or negative).
func (s *Store) Get(ctx context.Context, key string) (string, error) {
	if s == nil {
		return "", ErrNotFound
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return "", errors.New("flags: Get: empty key")
	}

	s.mu.RLock()
	if e, ok := s.cache[key]; ok && time.Now().Before(e.expiry) {
		s.mu.RUnlock()
		s.hits.Add(1)
		if !e.present {
			return "", ErrNotFound
		}
		return e.value, nil
	}
	s.mu.RUnlock()
	s.misses.Add(1)

	if s.rdb == nil {
		return "", ErrNotFound
	}

	val, err := s.rdb.HGet(ctx, s.hashKey, key).Result()
	switch {
	case errors.Is(err, redis.Nil):
		s.putCache(key, "", false)
		return "", ErrNotFound
	case err != nil:
		// Don't populate the cache on transport errors — next call
		// gets a fresh attempt.
		return "", fmt.Errorf("flags: HGET %s.%s: %w", s.hashKey, key, err)
	}
	s.putCache(key, val, true)
	return val, nil
}

// GetString returns the string value or def when absent.
func (s *Store) GetString(ctx context.Context, key, def string) string {
	v, err := s.Get(ctx, key)
	if err != nil {
		return def
	}
	return v
}

// GetBool parses the value as a bool (any case of "true"/"false"/
// "1"/"0"/"yes"/"no"/"on"/"off"). Returns def on absent OR malformed.
func (s *Store) GetBool(ctx context.Context, key string, def bool) bool {
	v, err := s.Get(ctx, key)
	if err != nil {
		return def
	}
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "true", "1", "yes", "on":
		return true
	case "false", "0", "no", "off":
		return false
	}
	return def
}

// GetFloat parses the value as a float64 via strconv. Returns def on
// absent OR malformed.
func (s *Store) GetFloat(ctx context.Context, key string, def float64) float64 {
	v, err := s.Get(ctx, key)
	if err != nil {
		return def
	}
	f, perr := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if perr != nil {
		return def
	}
	return f
}

// GetInt parses the value as an int64 via strconv. Returns def on
// absent OR malformed.
func (s *Store) GetInt(ctx context.Context, key string, def int64) int64 {
	v, err := s.Get(ctx, key)
	if err != nil {
		return def
	}
	i, perr := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
	if perr != nil {
		return def
	}
	return i
}

// Set writes the value to Redis and publishes an invalidation. Returns
// the previous value (and whether it existed) so the caller can write
// a meaningful audit row capturing the diff.
func (s *Store) Set(ctx context.Context, key, value string) (prev string, hadPrev bool, err error) {
	if s == nil || s.rdb == nil {
		return "", false, errors.New("flags: Set: redis unavailable")
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return "", false, errors.New("flags: Set: empty key")
	}

	prevStr, getErr := s.rdb.HGet(ctx, s.hashKey, key).Result()
	switch {
	case errors.Is(getErr, redis.Nil):
		hadPrev = false
	case getErr != nil:
		return "", false, fmt.Errorf("flags: Set: HGET pre: %w", getErr)
	default:
		hadPrev = true
		prev = prevStr
	}

	if _, err := s.rdb.HSet(ctx, s.hashKey, key, value).Result(); err != nil {
		return "", false, fmt.Errorf("flags: Set: HSET: %w", err)
	}

	s.putCache(key, value, true)
	if _, err := s.rdb.Publish(ctx, s.invalidateChan, key).Result(); err != nil {
		s.logger.Warn("flags: Set: PUBLISH invalidate failed", "key", key, "err", err)
	}
	return prev, hadPrev, nil
}

// Delete removes the key from Redis and publishes invalidation. Returns
// the previous value (and whether it existed) for audit.
func (s *Store) Delete(ctx context.Context, key string) (prev string, hadPrev bool, err error) {
	if s == nil || s.rdb == nil {
		return "", false, errors.New("flags: Delete: redis unavailable")
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return "", false, errors.New("flags: Delete: empty key")
	}

	prevStr, getErr := s.rdb.HGet(ctx, s.hashKey, key).Result()
	switch {
	case errors.Is(getErr, redis.Nil):
		hadPrev = false
	case getErr != nil:
		return "", false, fmt.Errorf("flags: Delete: HGET pre: %w", getErr)
	default:
		hadPrev = true
		prev = prevStr
	}

	if _, err := s.rdb.HDel(ctx, s.hashKey, key).Result(); err != nil {
		return "", false, fmt.Errorf("flags: Delete: HDEL: %w", err)
	}

	s.putCache(key, "", false)
	if _, err := s.rdb.Publish(ctx, s.invalidateChan, key).Result(); err != nil {
		s.logger.Warn("flags: Delete: PUBLISH invalidate failed", "key", key, "err", err)
	}
	return prev, hadPrev, nil
}

// All returns every flag's current value. Used by the admin UI.
// Returns an empty map when Redis is unavailable rather than nil so
// callers can iterate safely.
func (s *Store) All(ctx context.Context) (map[string]string, error) {
	if s == nil {
		return map[string]string{}, nil
	}
	if s.rdb == nil {
		return map[string]string{}, nil
	}
	out, err := s.rdb.HGetAll(ctx, s.hashKey).Result()
	if err != nil {
		return nil, fmt.Errorf("flags: All: HGETALL: %w", err)
	}
	if out == nil {
		out = map[string]string{}
	}
	return out, nil
}

// Stats returns the local cache hit/miss counters. Useful for the
// /system/flags/stats endpoint.
func (s *Store) Stats() (hits, misses uint64) {
	if s == nil {
		return 0, 0
	}
	return s.hits.Load(), s.misses.Load()
}

func (s *Store) putCache(key, value string, present bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cache[key] = cacheEntry{
		value:   value,
		present: present,
		expiry:  time.Now().Add(s.localCacheTTL),
	}
}
