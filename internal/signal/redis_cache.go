package signal

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

const signalKeyTTL = 7 * 24 * time.Hour // auto-expire stale vehicles after 7 days

// RedisSignalCache writes signal values to Redis HSET as a write-through
// cache alongside the in-memory Store. Key: "vehicle:{vehicleID}:signals",
// field: signal name, value: string-encoded typed value.
type RedisSignalCache struct {
	rdb *redis.Client
}

// NewRedisSignalCache creates a RedisSignalCache backed by the given client.
func NewRedisSignalCache(rdb *redis.Client) *RedisSignalCache {
	return &RedisSignalCache{rdb: rdb}
}

// Update writes all non-nil signals to the vehicle's HSET using a single
// HSET call (variadic) for one round-trip per batch. Also refreshes the
// key TTL to auto-expire stale vehicles.
//
// If Redis is unreachable, the error is logged as a warning and swallowed -
// the in-memory store remains the primary source of truth.
func (c *RedisSignalCache) Update(ctx context.Context, vehicleID int64, signals map[string]interface{}) error {
	if len(signals) == 0 {
		return nil
	}

	key := fmt.Sprintf("vehicle:%d:signals", vehicleID)

	// Build flat field-value pairs for variadic HSET.
	fields := make([]interface{}, 0, len(signals)*2)
	for name, val := range signals {
		if val == nil {
			continue
		}
		// Skip {invalid: true} markers from Tesla
		if im, isMap := val.(map[string]interface{}); isMap {
			if inv, has := im["invalid"]; has {
				if b, isBool := inv.(bool); isBool && b {
					continue
				}
			}
		}
		fields = append(fields, name, encodeSignalValue(val))
	}

	if len(fields) == 0 {
		return nil
	}

	if err := c.rdb.HSet(ctx, key, fields...).Err(); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("redis signal cache: HSET failed")
		return err
	}

	// Refresh TTL so actively-streaming vehicles never expire
	if err := c.rdb.Expire(ctx, key, signalKeyTTL).Err(); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("redis signal cache: EXPIRE failed")
	}

	return nil
}

// GetAll returns all signals for a vehicle from Redis HSET.
// Returns map[string]interface{} matching the signal store format.
// Values are decoded: numbers → float64, "true"/"false" → bool, otherwise string.
func (c *RedisSignalCache) GetAll(ctx context.Context, vehicleID int64) (map[string]interface{}, error) {
	key := fmt.Sprintf("vehicle:%d:signals", vehicleID)

	vals, err := c.rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("redis HGETALL %s: %w", key, err)
	}
	if len(vals) == 0 {
		return nil, nil
	}

	result := make(map[string]interface{}, len(vals))
	for field, raw := range vals {
		result[field] = decodeSignalValue(raw)
	}
	return result, nil
}

// GetSignal returns a single signal value from Redis HSET.
// Returns the decoded value or an error if Redis is unreachable.
// Returns (nil, nil) if the signal does not exist.
func (c *RedisSignalCache) GetSignal(ctx context.Context, vehicleID int64, signal string) (interface{}, error) {
	key := fmt.Sprintf("vehicle:%d:signals", vehicleID)

	raw, err := c.rdb.HGet(ctx, key, signal).Result()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, fmt.Errorf("redis HGET %s %s: %w", key, signal, err)
	}
	return decodeSignalValue(raw), nil
}

// decodeSignalValue reverses encodeSignalValue: tries float64 first, then
// bool ("true"/"false"), then returns the raw string.
func decodeSignalValue(s string) interface{} {
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return f
	}
	if s == "true" {
		return true
	}
	if s == "false" {
		return false
	}
	return s
}

// encodeSignalValue converts a signal value to its string representation.
// Numbers -> decimal string, bools -> "true"/"false", strings -> as-is.
func encodeSignalValue(v interface{}) string {
	switch val := v.(type) {
	case string:
		return val
	case bool:
		if val {
			return "true"
		}
		return "false"
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(val), 'f', -1, 32)
	case int:
		return strconv.Itoa(val)
	case int64:
		return strconv.FormatInt(val, 10)
	case int32:
		return strconv.FormatInt(int64(val), 10)
	case uint64:
		return strconv.FormatUint(val, 10)
	default:
		return fmt.Sprintf("%v", val)
	}
}
