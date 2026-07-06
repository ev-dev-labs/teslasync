package cache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/platform/config"
)

// Client wraps a Redis client with generic cache helpers.
type Client struct {
	rdb    *redis.Client
	prefix string
}

// MustConnect creates a new Redis client and verifies connectivity.
// It fatally exits if the connection cannot be established.
func MustConnect(cfg config.RedisConfig) *Client {
	c, err := Connect(cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to Redis")
	}
	return c
}

// Connect creates a new Redis client and verifies connectivity.
func Connect(cfg config.RedisConfig) (*Client, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Addr(),
		Password: cfg.Password,
		DB:       cfg.DB,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("pinging Redis at %s: %w", cfg.Addr(), err)
	}

	log.Info().Str("addr", cfg.Addr()).Msg("Redis connected")
	return &Client{rdb: rdb, prefix: "teslasync:"}, nil
}

// Get retrieves a cached value and unmarshals it into the type parameter.
// Returns the value and true if found, or zero value and false if not.
func Get[T any](ctx context.Context, c *Client, key string) (T, bool) {
	var zero T
	val, err := c.rdb.Get(ctx, c.prefix+key).Bytes()
	if err != nil {
		// redis.Nil is an ordinary cache miss; anything else (connection
		// failure, timeout) is a degraded read worth surfacing for diagnostics.
		// Either way the cache-aside contract returns (zero, false) so callers
		// fall through to the source of truth.
		if !errors.Is(err, redis.Nil) {
			log.Debug().Err(err).Str("key", key).Msg("cache get failed")
		}
		return zero, false
	}
	var result T
	if err := json.Unmarshal(val, &result); err != nil {
		log.Debug().Err(err).Str("key", key).Msg("cache value unmarshal failed")
		return zero, false
	}
	return result, true
}

// Set stores a value with the given TTL. TTL must be > 0.
func Set[T any](ctx context.Context, c *Client, key string, val T, ttl time.Duration) error {
	if ttl <= 0 {
		return fmt.Errorf("cache TTL must be positive, got %v", ttl)
	}
	data, err := json.Marshal(val)
	if err != nil {
		return fmt.Errorf("marshaling cache value for key %s: %w", key, err)
	}
	if err := c.rdb.Set(ctx, c.prefix+key, data, ttl).Err(); err != nil {
		return fmt.Errorf("setting cache key %s: %w", key, err)
	}
	return nil
}

// Delete removes a key from the cache.
func Delete(ctx context.Context, c *Client, key string) error {
	if err := c.rdb.Del(ctx, c.prefix+key).Err(); err != nil {
		return fmt.Errorf("deleting cache key %s: %w", key, err)
	}
	return nil
}

// Invalidate removes all keys matching a prefix pattern.
func (c *Client) Invalidate(ctx context.Context, pattern string) error {
	iter := c.rdb.Scan(ctx, 0, c.prefix+pattern+"*", 100).Iterator()
	for iter.Next(ctx) {
		if err := c.rdb.Del(ctx, iter.Val()).Err(); err != nil {
			return fmt.Errorf("deleting key %s: %w", iter.Val(), err)
		}
	}
	if err := iter.Err(); err != nil {
		return fmt.Errorf("scanning cache keys for pattern %s: %w", pattern, err)
	}
	return nil
}

// Health checks Redis connectivity.
func (c *Client) Health(ctx context.Context) error {
	checkCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := c.rdb.Ping(checkCtx).Err(); err != nil {
		return fmt.Errorf("redis health check: %w", err)
	}
	return nil
}

// Close shuts down the Redis client.
func (c *Client) Close() error {
	return c.rdb.Close()
}

// Underlying returns the raw Redis client for advanced operations.
func (c *Client) Underlying() *redis.Client {
	return c.rdb
}
