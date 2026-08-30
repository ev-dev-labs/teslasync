package cache

import (
	"context"
	"encoding/json"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// Store provides a unified caching interface backed by Redis when available,
// with an in-memory fallback for development or when Redis is disabled.
type Store struct {
	rdb    *redis.Client
	mem    *memStore
	prefix string
}

// New creates a cache store. When Redis is enabled, its client is retained
// even if the startup probe fails so go-redis can reconnect after dependencies
// recover. Individual operations continue to fall back to the in-memory store.
func New(cfg config.RedisConfig) *Store {
	s := &Store{
		mem:    newMemStore(),
		prefix: "teslasync:",
	}

	if !cfg.Enabled {
		log.Info().Msg("cache: using in-memory store (Redis disabled)")
		return s
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Addr(),
		Password: cfg.Password,
		DB:       cfg.DB,
	})
	s.rdb = rdb

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Warn().Err(err).Msg("cache: Redis unreachable; using in-memory fallback until Redis reconnects")
		return s
	}

	log.Info().Str("addr", cfg.Addr()).Msg("cache: connected to Redis")
	return s
}

// Get retrieves a cached value and unmarshals it into dest.
func (s *Store) Get(ctx context.Context, key string, dest interface{}) bool {
	if s.rdb != nil {
		val, err := s.rdb.Get(ctx, s.prefix+key).Bytes()
		if err == nil {
			return json.Unmarshal(val, dest) == nil
		}
	}
	return s.mem.Get(key, dest)
}

// Set stores a value with the given TTL.
func (s *Store) Set(ctx context.Context, key string, val interface{}, ttl time.Duration) {
	data, err := json.Marshal(val)
	if err != nil {
		return
	}
	if s.rdb != nil {
		s.rdb.Set(ctx, s.prefix+key, data, ttl)
	}
	s.mem.Set(key, data, ttl)
}

// Delete removes a key from the cache.
func (s *Store) Delete(ctx context.Context, key string) {
	if s.rdb != nil {
		s.rdb.Del(ctx, s.prefix+key)
	}
	s.mem.Delete(key)
}

// Invalidate removes all keys matching a prefix pattern.
func (s *Store) Invalidate(ctx context.Context, pattern string) {
	if s.rdb != nil {
		iter := s.rdb.Scan(ctx, 0, s.prefix+pattern+"*", 100).Iterator()
		for iter.Next(ctx) {
			s.rdb.Del(ctx, iter.Val())
		}
	}
	s.mem.Invalidate(pattern)
}

// Close shuts down the cache store.
func (s *Store) Close() {
	if s.rdb != nil {
		s.rdb.Close()
	}
	s.mem.Close()
}

// IsRedis returns true when Redis is configured. Reachability is checked by
// health probes and may change while the retained client reconnects.
func (s *Store) IsRedis() bool {
	return s.rdb != nil
}

// Underlying returns the configured raw *redis.Client, or nil when Redis is
// disabled. The client reconnects automatically after transient outages.
func (s *Store) Underlying() *redis.Client {
	return s.rdb
}
