package signal

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
)

const signalKeyTTL = 7 * 24 * time.Hour // auto-expire stale vehicles after 7 days

// LiveSignalFreshnessThreshold is the cross-pod live-state freshness window.
const LiveSignalFreshnessThreshold = 2 * time.Minute

// vehicleSignalsChannel is the Redis Pub/Sub channel used to broadcast
// signal updates across all pods so every SSE handler sees every update.
const vehicleSignalsChannel = "vehicle_signals"

const (
	redisSignalValueEncoding = "teslasync.signal.v1"
	redisSignalValueSource   = "redis_signal_cache"
)

type redisSignalClient interface {
	HSet(ctx context.Context, key string, values ...interface{}) *redis.IntCmd
	Expire(ctx context.Context, key string, expiration time.Duration) *redis.BoolCmd
	HGetAll(ctx context.Context, key string) *redis.MapStringStringCmd
	HGet(ctx context.Context, key string, field string) *redis.StringCmd
	Publish(ctx context.Context, channel string, message interface{}) *redis.IntCmd
	Subscribe(ctx context.Context, channels ...string) *redis.PubSub
}

type redisSignalValueEnvelope struct {
	Encoding    string          `json:"encoding"`
	Value       json.RawMessage `json:"value"`
	LegacyValue *string         `json:"legacy_value,omitempty"`
	Timestamp   time.Time       `json:"timestamp"`
	Source      string          `json:"source"`
}

// RedisSignalCache writes signal values to Redis HSET as a write-through
// cache alongside the in-memory Store. Key: "vehicle:{vehicleID}:signals",
// field: signal name, value: timestamped JSON envelope. Legacy scalar values
// are still decoded indefinitely for backwards compatibility.
type RedisSignalCache struct {
	rdb redisSignalClient
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
	now := time.Now().UTC()

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
		encoded, err := encodeTimestampedSignalValue(val, now)
		if err != nil {
			return fmt.Errorf("encode redis signal %s: %w", name, err)
		}
		fields = append(fields, name, encoded)
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

// IsLiveSignalFresh reports whether a timestamp-aware signal value is fresh
// enough for cross-pod live-state reads. Zero timestamps have unknown freshness.
func IsLiveSignalFresh(value *Value, now time.Time) bool {
	if value == nil || value.Timestamp.IsZero() {
		return false
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	age := now.UTC().Sub(value.Timestamp.UTC())
	return age <= LiveSignalFreshnessThreshold
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

// GetAllValues returns timestamp-aware signals for a vehicle from Redis HSET.
// Legacy scalar values are returned with a zero timestamp to indicate unknown
// freshness.
func (c *RedisSignalCache) GetAllValues(ctx context.Context, vehicleID int64) (map[string]*Value, error) {
	key := fmt.Sprintf("vehicle:%d:signals", vehicleID)

	vals, err := c.rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("redis HGETALL %s: %w", key, err)
	}
	if len(vals) == 0 {
		return nil, nil
	}

	result := make(map[string]*Value, len(vals))
	for field, raw := range vals {
		value, err := decodeSignalValueWithTimestamp(raw)
		if err != nil {
			return nil, fmt.Errorf("decode redis signal %s %s: %w", key, field, err)
		}
		result[field] = value
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

// GetSignalValue returns one timestamp-aware signal value from Redis HSET.
// Legacy scalar values are returned with a zero timestamp to indicate unknown
// freshness. Returns (nil, nil) if the signal does not exist.
func (c *RedisSignalCache) GetSignalValue(ctx context.Context, vehicleID int64, name string) (*Value, error) {
	key := fmt.Sprintf("vehicle:%d:signals", vehicleID)

	raw, err := c.rdb.HGet(ctx, key, name).Result()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, fmt.Errorf("redis HGET %s %s: %w", key, name, err)
	}
	value, err := decodeSignalValueWithTimestamp(raw)
	if err != nil {
		return nil, fmt.Errorf("decode redis signal %s %s: %w", key, name, err)
	}
	return value, nil
}

// decodeSignalValue reverses encodeSignalValue: tries float64 first, then
// bool ("true"/"false"), then JSON objects/arrays, then returns the raw string.
func decodeSignalValue(s string) interface{} {
	if envelope, ok, err := parseRedisSignalValueEnvelope(s, false); ok && err == nil {
		if envelope.LegacyValue != nil {
			return decodeLegacySignalValue(*envelope.LegacyValue)
		}
		if value, err := decodeJSONRawValue(envelope.Value); err == nil {
			return value
		}
	}
	return decodeLegacySignalValue(s)
}

func decodeSignalValueWithTimestamp(s string) (*Value, error) {
	envelope, ok, err := parseRedisSignalValueEnvelope(s, true)
	if err != nil {
		return nil, err
	}
	if ok {
		value, err := decodeJSONRawValue(envelope.Value)
		if err != nil {
			return nil, fmt.Errorf("decode timestamped raw value: %w", err)
		}
		return &Value{Raw: value, Timestamp: envelope.Timestamp.UTC()}, nil
	}
	return &Value{Raw: decodeLegacySignalValue(s), Timestamp: time.Time{}}, nil
}

func decodeLegacySignalValue(s string) interface{} {
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return f
	}
	if s == "true" {
		return true
	}
	if s == "false" {
		return false
	}
	// JSON objects or arrays (e.g. Tesla composite signal values)
	if len(s) > 0 && (s[0] == '{' || s[0] == '[') {
		var parsed interface{}
		if err := json.Unmarshal([]byte(s), &parsed); err == nil {
			return parsed
		}
	}
	return s
}

func parseRedisSignalValueEnvelope(s string, strict bool) (redisSignalValueEnvelope, bool, error) {
	trimmed := strings.TrimSpace(s)
	var empty redisSignalValueEnvelope
	if len(trimmed) == 0 {
		return empty, false, nil
	}
	if trimmed[0] != '{' {
		if strict && trimmed[0] == '[' {
			var parsed interface{}
			if err := json.Unmarshal([]byte(trimmed), &parsed); err != nil {
				return empty, false, fmt.Errorf("malformed redis signal JSON: %w", err)
			}
		}
		return empty, false, nil
	}

	var probe map[string]json.RawMessage
	if err := json.Unmarshal([]byte(trimmed), &probe); err != nil {
		if strict {
			return empty, false, fmt.Errorf("malformed redis signal JSON: %w", err)
		}
		return empty, false, nil
	}

	encodingRaw, hasEncoding := probe["encoding"]
	if !hasEncoding {
		return empty, false, nil
	}
	var encoding string
	if err := json.Unmarshal(encodingRaw, &encoding); err != nil || encoding != redisSignalValueEncoding {
		return empty, false, nil
	}

	var envelope redisSignalValueEnvelope
	if err := json.Unmarshal([]byte(trimmed), &envelope); err != nil {
		return empty, true, fmt.Errorf("decode timestamped redis signal value: %w", err)
	}
	if len(envelope.Value) == 0 {
		return empty, true, fmt.Errorf("timestamped redis signal value missing value")
	}
	if envelope.Timestamp.IsZero() {
		return empty, true, fmt.Errorf("timestamped redis signal value missing timestamp")
	}
	return envelope, true, nil
}

func decodeJSONRawValue(raw json.RawMessage) (interface{}, error) {
	var value interface{}
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	return value, nil
}

func encodeTimestampedSignalValue(v interface{}, timestamp time.Time) (string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return "", fmt.Errorf("marshal raw value: %w", err)
	}
	legacyValue := encodeSignalValue(v)
	envelope := redisSignalValueEnvelope{
		Encoding:    redisSignalValueEncoding,
		Value:       raw,
		LegacyValue: &legacyValue,
		Timestamp:   timestamp.UTC(),
		Source:      redisSignalValueSource,
	}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return "", fmt.Errorf("marshal timestamped value: %w", err)
	}
	return string(encoded), nil
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

// PublishSignals publishes a vehicle signal update to the Redis Pub/Sub
// channel so all pods' SSE handlers receive the event. The payload is
// pre-serialised JSON (from buildSSEPayload) to avoid double-marshalling.
func (c *RedisSignalCache) PublishSignals(ctx context.Context, payload []byte) error {
	return c.rdb.Publish(ctx, vehicleSignalsChannel, payload).Err()
}

// SubscribeSignals returns a Go channel that yields SSE payloads published
// by any pod via PublishSignals. The subscription is cancelled when ctx is
// done. The caller must drain the returned channel.
func (c *RedisSignalCache) SubscribeSignals(ctx context.Context) <-chan string {
	sub := c.rdb.Subscribe(ctx, vehicleSignalsChannel)
	ch := sub.Channel()
	out := make(chan string, 64)
	go func() {
		defer close(out)
		defer func() {
			if err := sub.Close(); err != nil {
				log.Warn().Err(err).Msg("redis pub/sub: close error")
			}
		}()
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-ch:
				if !ok {
					return
				}
				out <- msg.Payload
			}
		}
	}()
	return out
}
