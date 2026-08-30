// Package signal — see package doc in store.go for the layered live-state
// contract. This file holds the L2 (Redis HSET) cache.
//
// # Typed Redis envelope
//
// Each HSET field value is a JSON envelope of the form:
//
//	{"kind": <int>, "v": <typed value>, "ts": <unix nanos>, ...}
//
// where `kind` is a protomodel.ValueKind discriminator so the reader can
// switch on it and unmarshal `v` into the right concrete Go type without
// reflection or string-parsing fallbacks. Legacy envelope fields
// (`encoding`, `value`, `timestamp`, `source`, `legacy_value`)
// are still populated by the writer so binaries running the old reader
// mid-rollout can keep decoding without flushing production Redis. New
// readers prefer the typed `kind`+`v`+`ts` triplet and ignore the
// legacy fields. Legacy envelopes ({"encoding","value",
// "timestamp",...}) and legacy scalar fields ("72.5", "true",
// "asleep") remain decodable forever for the same reason.
//
// # Stale-cache contract (Fresh-only API)
//
// The cache exposes a freshness-aware family of read methods (suffix
// "Fresh") that enforces the cross-pod live-state staleness window. When
// a stored value is older than the cache's staleAfter window — or has
// unknown freshness because it predates the timestamped envelope — the
// Fresh method returns (advisoryValue, ErrStale) and increments
// tesla_signal_cache_stale_total{vehicle_id, field}. Callers MUST treat
// the advisory value as a hint and re-resolve authoritative state via
// the local L1 signal.Store or the durable signal_log history before
// acting on it; the Fresh API contract is "the cache must NOT silently
// return stale data".
//
// ErrStale is a sentinel error: callers MUST switch on errors.Is(err,
// ErrStale), they MUST NOT wrap it in another error or compare with
// strings, so the contract stays cheap to test for in hot read paths.
//
// The pre-existing GetSignalValue / GetAllValues / GetSignal / GetAll
// methods remain pass-through reads: they return the value with whatever
// freshness it has and never surface ErrStale. This is intentional so
// the merged-map preservation contract enforced by HybridLiveSignalStore
// (newer Timestamp wins; legacy/stale L2 values are still returned for
// the freshness oracle to inspect) keeps working unchanged.
package signal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

// redisCacheTracerName is the OpenTelemetry tracer name for Redis L2
// cache spans. The trace-coverage audit greps for this exact constant.
const redisCacheTracerName = "signal"

// redisAsyncCtxKey is the unexported key the L2 mirror goroutine in
// HybridLiveSignalStore.UpdateNonBlocking uses to mark its detached
// Redis write as async=true. The L1 hot path (Update) leaves the value
// unset so the span's async attr defaults to false.
type redisAsyncCtxKey struct{}

// contextWithRedisAsync marks ctx as carrying an async Redis L2 write.
// Used by HybridLiveSignalStore.UpdateNonBlocking before spawning the
// detached goroutine. The receiver reads via redisAsyncFromContext.
func contextWithRedisAsync(ctx context.Context) context.Context {
	return context.WithValue(ctx, redisAsyncCtxKey{}, true)
}

// redisAsyncFromContext returns whether the caller propagated an async
// marker. Used by RedisSignalCache.Update to stamp the async=true
// attribute on its span.
func redisAsyncFromContext(ctx context.Context) bool {
	v, _ := ctx.Value(redisAsyncCtxKey{}).(bool)
	return v
}

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

// ErrStale is returned by the *Fresh family of read methods when a cached
// entry is older than the cache's staleAfter window, or has unknown
// freshness (legacy scalar / pre-timestamped envelope). The accompanying
// Value is advisory: callers MUST treat it as a hint and re-resolve
// authoritative state via the local L1 signal.Store or the durable
// signal_log history before acting on it.
//
// ErrStale is a sentinel: callers MUST switch on errors.Is(err, ErrStale)
// and MUST NOT wrap it in another error so the contract stays cheap to
// test for in hot read paths.
var ErrStale = errors.New("redis signal cache: stale entry")

// staleTotal counts stale entries returned by the freshness-aware
// *Fresh APIs. Cardinality is bounded by vehicle_id (small fleet
// per deployment) × field (~250 from protomodel.Signals); precedent
// for vehicle_id-labelled metrics is metrics.VehicleLastSeen.
//
// The metric is intentionally NOT incremented by the legacy
// pass-through reads (GetSignalValue / GetAllValues) — only the Fresh
// API can produce a stale return that is observable to the caller.
var staleTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "tesla",
	Subsystem: "signal_cache",
	Name:      "stale_total",
	Help: "Number of stale entries returned by the freshness-aware Redis " +
		"signal cache reads (the *Fresh API). Labelled by vehicle_id and " +
		"field. A non-zero rate indicates that cross-pod live-state " +
		"consumers are seeing data older than the staleAfter window and " +
		"must re-resolve via signal.Store or signal_log.",
}, []string{"vehicle_id", "field"})

type redisSignalClient interface {
	HSet(ctx context.Context, key string, values ...interface{}) *redis.IntCmd
	Eval(ctx context.Context, script string, keys []string, args ...interface{}) *redis.Cmd
	Expire(ctx context.Context, key string, expiration time.Duration) *redis.BoolCmd
	HGetAll(ctx context.Context, key string) *redis.MapStringStringCmd
	HGet(ctx context.Context, key string, field string) *redis.StringCmd
	HLen(ctx context.Context, key string) *redis.IntCmd
	Del(ctx context.Context, keys ...string) *redis.IntCmd
	Scan(ctx context.Context, cursor uint64, match string, count int64) *redis.ScanCmd
	Publish(ctx context.Context, channel string, message interface{}) *redis.IntCmd
	Subscribe(ctx context.Context, channels ...string) *redis.PubSub
}

const updateTimestampedSignalsScript = `
local written = 0
for i = 2, #ARGV, 3 do
  local field = ARGV[i]
  local incoming_ts = tonumber(ARGV[i + 1])
  local encoded = ARGV[i + 2]
  local current = redis.call("HGET", KEYS[1], field)
  local current_ts = nil
  if current then
    local ok, envelope = pcall(cjson.decode, current)
    if ok and envelope then
      current_ts = tonumber(envelope["ts"])
    end
  end
  if not current_ts or current_ts <= incoming_ts then
    redis.call("HSET", KEYS[1], field, encoded)
    written = written + 1
  end
end
if written > 0 then
  redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
end
return written
`

// redisSignalValueEnvelope is the wire format for a single HSET field
// value. Writers populate BOTH the typed envelope fields (Kind, V, TS)
// and the legacy envelope fields (Encoding, Value, LegacyValue, Timestamp,
// Source) so old readers keep decoding during rolling deploys. New readers
// prefer the typed Kind+V+TS triplet and ignore the legacy fields. Existing
// production Redis entries remain decodable via the legacy fields alone.
type redisSignalValueEnvelope struct {
	// Typed envelope (canonical going forward).
	Kind     protomodel.ValueKind `json:"kind,omitempty"`
	V        json.RawMessage      `json:"v,omitempty"`
	TS       int64                `json:"ts,omitempty"`
	Observed *bool                `json:"observed,omitempty"`

	// Legacy envelope (dual-written for old-binary read compatibility).
	Encoding    string          `json:"encoding,omitempty"`
	Value       json.RawMessage `json:"value,omitempty"`
	LegacyValue *string         `json:"legacy_value,omitempty"`
	Timestamp   time.Time       `json:"timestamp,omitempty"`
	Source      string          `json:"source,omitempty"`
}

// RedisSignalCache writes signal values to Redis HSET as a write-through
// cache alongside the in-memory Store. Key: "vehicle:{vehicleID}:signals",
// field: signal name, value: typed JSON envelope. Legacy scalar values
// and legacy envelopes are still decoded indefinitely for
// backwards compatibility.
type RedisSignalCache struct {
	rdb        redisSignalClient
	staleAfter time.Duration
	// batch is the optional bulk (pipelined) read seam used by
	// GetAllValuesBulk. Installed by NewRedisSignalCache from the concrete
	// client; see redis_cache_bulk.go.
	batch redisHashBatchReader
}

// RedisSignalCacheOption configures a RedisSignalCache at construction.
type RedisSignalCacheOption func(*RedisSignalCache)

// WithStaleAfter overrides the cache's freshness window. Values stored
// in Redis whose Timestamp is older than this when read through the
// freshness-aware *Fresh API return ErrStale plus the advisory value.
// Pass 0 to disable freshness checks (the *Fresh API becomes equivalent
// to the legacy pass-through reads).
func WithStaleAfter(d time.Duration) RedisSignalCacheOption {
	return func(c *RedisSignalCache) { c.staleAfter = d }
}

// NewRedisSignalCache creates a RedisSignalCache backed by the given
// client. The default staleAfter window is LiveSignalFreshnessThreshold
// (2 minutes) per the layered live-state contract; override with
// WithStaleAfter when needed (e.g. tests).
func NewRedisSignalCache(rdb *redis.Client, opts ...RedisSignalCacheOption) *RedisSignalCache {
	c := &RedisSignalCache{
		rdb:        rdb,
		staleAfter: LiveSignalFreshnessThreshold,
	}
	if rdb != nil {
		// Bulk reads (GetAllValuesBulk) pipeline N HGETALLs into one round
		// trip. Wiring the seam here — rather than type-asserting the
		// interface field — keeps the batching available to production
		// without widening the redisSignalClient contract every fake
		// implements.
		c.batch = pipelinedHashBatchReader{rdb: rdb}
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// Update writes all non-nil signals to the vehicle's HSET using a single
// HSET call (variadic) for one round-trip per batch. Also refreshes the
// key TTL to auto-expire stale vehicles.
//
// If Redis is unreachable, the error is logged as a warning and swallowed -
// the in-memory store remains the primary source of truth.
func (c *RedisSignalCache) Update(ctx context.Context, vehicleID int64, signals map[string]interface{}) (err error) {
	if len(signals) == 0 {
		return nil
	}

	ctx, span := otel.Tracer(redisCacheTracerName).Start(
		ctx,
		"signal.redis_cache.update",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.Int64("vehicle_id", vehicleID),
			attribute.Int("signal_count", len(signals)),
			attribute.Bool("async", redisAsyncFromContext(ctx)),
		),
	)
	defer func() {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "redis_cache.update")
		}
		span.End()
	}()

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
		encoded, encErr := encodeTimestampedSignalValueForField(name, val, now)
		if encErr != nil {
			err = fmt.Errorf("encode redis signal %s: %w", name, encErr)
			return err
		}
		fields = append(fields, name, encoded)
	}

	span.SetAttributes(attribute.Int("written_count", len(fields)/2))
	if len(fields) == 0 {
		return nil
	}

	if hsetErr := c.rdb.HSet(ctx, key, fields...).Err(); hsetErr != nil {
		log.Warn().Err(hsetErr).Int64("vehicle_id", vehicleID).Msg("redis signal cache: HSET failed")
		err = hsetErr
		return err
	}

	// Refresh TTL so actively-streaming vehicles never expire
	if expErr := c.rdb.Expire(ctx, key, signalKeyTTL).Err(); expErr != nil {
		log.Warn().Err(expErr).Int64("vehicle_id", vehicleID).Msg("redis signal cache: EXPIRE failed")
	}

	return nil
}

// UpdateValues writes timestamped values without allowing an older replay to
// replace a newer value. The compare-and-set runs atomically in Redis so
// concurrent async mirrors and multiple API pods preserve per-field ordering.
func (c *RedisSignalCache) UpdateValues(ctx context.Context, vehicleID int64, values map[string]*Value) (err error) {
	if len(values) == 0 {
		return nil
	}

	ctx, span := otel.Tracer(redisCacheTracerName).Start(
		ctx,
		"signal.redis_cache.update_values",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.Int64("vehicle_id", vehicleID),
			attribute.Int("signal_count", len(values)),
			attribute.Bool("async", redisAsyncFromContext(ctx)),
		),
	)
	defer func() {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "redis_cache.update_values")
		}
		span.End()
	}()

	args := make([]interface{}, 0, 1+len(values)*3)
	args = append(args, int64(signalKeyTTL/time.Second))
	for name, value := range values {
		if value == nil || value.Raw == nil {
			continue
		}
		if im, isMap := value.Raw.(map[string]interface{}); isMap {
			if invalid, ok := im["invalid"].(bool); ok && invalid {
				continue
			}
		}
		encoded, encErr := encodeTimestampedSignalValueForFieldWithMetadata(
			name,
			value.Raw,
			value.Timestamp,
			value.TimestampSynthetic,
		)
		if encErr != nil {
			return fmt.Errorf("encode timestamped Redis signal %s: %w", name, encErr)
		}
		args = append(args, name, value.Timestamp.UTC().UnixNano(), encoded)
	}

	candidateCount := (len(args) - 1) / 3
	span.SetAttributes(attribute.Int("candidate_count", candidateCount))
	if candidateCount == 0 {
		return nil
	}
	key := fmt.Sprintf("vehicle:%d:signals", vehicleID)
	if evalErr := c.rdb.Eval(ctx, updateTimestampedSignalsScript, []string{key}, args...).Err(); evalErr != nil {
		log.Warn().Err(evalErr).Int64("vehicle_id", vehicleID).Msg("redis signal cache: timestamped update failed")
		return fmt.Errorf("conditionally update Redis live signals for vehicle %d: %w", vehicleID, evalErr)
	}
	return nil
}

// RestampLegacy rewrites legacy scalar HSET fields under
// vehicle:{vehicleID}:signals as full timestamp-aware envelopes using
// time.Now() as the synthetic restamp timestamp. It returns the count of
// fields that were restamped.
//
// Legacy entries are identified by attempting envelope parsing: any field
// that does NOT decode as a valid {encoding,value,timestamp,source}
// envelope is treated as a legacy scalar and re-encoded via
// decodeLegacySignalValue → encodeTimestampedSignalValue. Valid envelopes
// are skipped so their original timestamps are preserved bit-for-bit.
//
// All restamped fields are written in a single HSET round-trip and the
// key TTL is refreshed via the same Expire path that Update uses.
// {invalid: true} marker values are skipped to match Update's contract.
//
// On HSET failure the function returns the wrapped error WITHOUT having
// issued any HDEL or DEL — the caller can safely retry on the next Warm.
func (c *RedisSignalCache) RestampLegacy(ctx context.Context, vehicleID int64) (int, error) {
	key := fmt.Sprintf("vehicle:%d:signals", vehicleID)

	vals, err := c.rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return 0, fmt.Errorf("redis HGETALL %s: %w", key, err)
	}
	if len(vals) == 0 {
		return 0, nil
	}

	now := time.Now().UTC()
	fields := make([]interface{}, 0, len(vals)*2)

	for field, raw := range vals {
		// Skip valid envelopes — their original Timestamp must be preserved
		// bit-for-bit so freshness windows are not falsely refreshed.
		if _, ok, parseErr := parseRedisSignalValueEnvelope(raw, false); ok && parseErr == nil {
			continue
		}

		decoded := decodeLegacySignalValue(raw)
		if decoded == nil {
			continue
		}
		// Skip {invalid: true} markers from Tesla, matching Update's contract.
		if im, isMap := decoded.(map[string]interface{}); isMap {
			if inv, has := im["invalid"]; has {
				if b, isBool := inv.(bool); isBool && b {
					continue
				}
			}
		}

		encoded, encErr := encodeTimestampedSignalValueForFieldWithMetadata(field, decoded, now, true)
		if encErr != nil {
			return 0, fmt.Errorf("encode restamped redis signal %s: %w", field, encErr)
		}
		fields = append(fields, field, encoded)
	}

	if len(fields) == 0 {
		return 0, nil
	}

	if err := c.rdb.HSet(ctx, key, fields...).Err(); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("redis signal cache: restamp HSET failed")
		return 0, fmt.Errorf("redis HSET restamp %s: %w", key, err)
	}

	// Refresh TTL via the same Expire call Update uses so actively-warmed
	// vehicles keep the canonical 7-day TTL.
	if err := c.rdb.Expire(ctx, key, signalKeyTTL).Err(); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("redis signal cache: restamp EXPIRE failed")
	}

	return len(fields) / 2, nil
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

// RawFieldCount returns the size of the HSET BEFORE decoding. Used by
// diagnostic surfaces that need to distinguish "no fields stored" from
// "fields stored but undecodable". Returns 0 with no error when the key
// does not exist (HLEN returns 0 for missing keys per Redis semantics).
func (c *RedisSignalCache) RawFieldCount(ctx context.Context, vehicleID int64) (int, error) {
	key := fmt.Sprintf("vehicle:%d:signals", vehicleID)
	n, err := c.rdb.HLen(ctx, key).Result()
	if err != nil {
		return 0, fmt.Errorf("redis HLEN %s: %w", key, err)
	}
	return int(n), nil
}

// Purge deletes the entire HSET for a single vehicle. Returns true when
// the key existed and was removed, false when there was nothing to
// delete (DEL on a missing key returns 0 — not an error).
//
// This is the destructive cousin of Update / GetAll: callers (currently
// the /dev-tools/redis-signals diagnostic page) use it to reset the L2
// cache when a vehicle's stored values are stale, malformed, or
// otherwise need to be re-warmed from incoming telemetry. The L1
// in-process Store is intentionally NOT touched here — it lives in each
// pod's memory, would require pub/sub fan-out to clear cluster-wide,
// and naturally drifts back into sync as new fleet telemetry arrives.
func (c *RedisSignalCache) Purge(ctx context.Context, vehicleID int64) (bool, error) {
	key := fmt.Sprintf("vehicle:%d:signals", vehicleID)
	n, err := c.rdb.Del(ctx, key).Result()
	if err != nil {
		return false, fmt.Errorf("redis DEL %s: %w", key, err)
	}
	return n > 0, nil
}

// PurgeAll deletes every vehicle:*:signals HSET reachable via SCAN.
// Returns (purged, scanned, err) where purged is the DEL return value
// (the number of keys actually removed) and scanned is the number of
// keys SCAN found in this batch.
//
// SCAN is bounded by `limit` (clamped 1..1000 per ScanVehicleKeys) so
// extremely large clusters need to call PurgeAll in a loop until both
// returned counts are zero — the bound exists to keep the dev-tools
// endpoint's worst-case Redis load deterministic. When scanned == limit
// there are likely more keys outside this batch and the caller should
// loop. DEL is variadic, so the discovered keys are removed in a single
// round-trip.
//
// The L1 in-process Store is NOT touched: each pod's L1 drifts back
// into sync as new fleet telemetry arrives.
func (c *RedisSignalCache) PurgeAll(ctx context.Context, limit int) (purged int, scanned int, err error) {
	ids, err := c.ScanVehicleKeys(ctx, limit)
	if err != nil {
		return 0, 0, err
	}
	if len(ids) == 0 {
		return 0, 0, nil
	}
	keys := make([]string, len(ids))
	for i, id := range ids {
		keys[i] = fmt.Sprintf("vehicle:%d:signals", id)
	}
	n, err := c.rdb.Del(ctx, keys...).Result()
	if err != nil {
		return 0, len(ids), fmt.Errorf("redis DEL (bulk %d): %w", len(keys), err)
	}
	return int(n), len(ids), nil
}

// ScanVehicleKeys uses cursor-based SCAN to enumerate vehicle:*:signals
// keys. Bounded by limit; returns the slice of int64 vehicleIDs parsed
// from key names. Skips keys that don't match the vehicle:{int64}:signals
// shape. This is intentionally NOT KEYS, which would block the server.
func (c *RedisSignalCache) ScanVehicleKeys(ctx context.Context, limit int) ([]int64, error) {
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	const pattern = "vehicle:*:signals"
	var (
		cursor uint64
		seen   = make(map[int64]struct{}, 16)
		out    = make([]int64, 0, 16)
	)
	for {
		batch, next, err := c.rdb.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return nil, fmt.Errorf("redis SCAN %s: %w", pattern, err)
		}
		for _, k := range batch {
			id, ok := parseVehicleSignalsKey(k)
			if !ok {
				continue
			}
			if _, dup := seen[id]; dup {
				continue
			}
			seen[id] = struct{}{}
			out = append(out, id)
			if len(out) >= limit {
				return out, nil
			}
		}
		if next == 0 {
			break
		}
		cursor = next
	}
	return out, nil
}

// parseVehicleSignalsKey extracts the int64 vehicleID from a
// "vehicle:{id}:signals" key. Returns (0, false) for malformed keys.
func parseVehicleSignalsKey(key string) (int64, bool) {
	const prefix = "vehicle:"
	const suffix = ":signals"
	if !strings.HasPrefix(key, prefix) || !strings.HasSuffix(key, suffix) {
		return 0, false
	}
	mid := strings.TrimSuffix(strings.TrimPrefix(key, prefix), suffix)
	if mid == "" {
		return 0, false
	}
	id, err := strconv.ParseInt(mid, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// decodeSignalValue is the untyped, error-suppressing decoder. It tries
// the typed envelope first, then the legacy envelope, then a legacy
// scalar fallback so it never fails on existing Redis data.
func decodeSignalValue(s string) interface{} {
	if envelope, ok, err := parseRedisSignalValueEnvelope(s, false); ok && err == nil {
		if value, ok := decodeEnvelopeValue(envelope); ok {
			return value
		}
	}
	return decodeLegacySignalValue(s)
}

// decodeSignalValueWithTimestamp returns the signal value plus its
// freshness timestamp. Typed and legacy envelopes both carry an authoritative
// timestamp; legacy scalar
// fields decode with a zero Timestamp to indicate unknown freshness.
func decodeSignalValueWithTimestamp(s string) (*Value, error) {
	envelope, ok, err := parseRedisSignalValueEnvelope(s, true)
	if err != nil {
		return nil, err
	}
	if ok {
		value, decoded := decodeEnvelopeValue(envelope)
		if !decoded {
			return nil, fmt.Errorf("decode envelope value: missing typed v / legacy value field")
		}
		return &Value{
			Raw:       value,
			Timestamp: envelopeTimestamp(envelope),
			// Envelopes written before provenance was explicit are
			// conservative unknowns. They may be genuine cache writes or a
			// legacy scalar that an older binary restamped with time.Now().
			TimestampSynthetic: envelope.Observed == nil || !*envelope.Observed,
		}, nil
	}
	return &Value{Raw: decodeLegacySignalValue(s), Timestamp: time.Time{}}, nil
}

// decodeEnvelopeValue extracts the typed Go value from an envelope.
// Typed envelopes (Kind+V) take precedence; legacy envelopes fall back to
// LegacyValue or untyped Value.
func decodeEnvelopeValue(envelope redisSignalValueEnvelope) (interface{}, bool) {
	if len(envelope.V) > 0 {
		value, err := decodeTypedValue(envelope.Kind, envelope.V)
		if err == nil {
			return value, true
		}
		// Fall through to legacy fields if typed decode fails. This is
		// defensive only — a Kind/V mismatch is a producer bug.
	}
	if envelope.LegacyValue != nil {
		return decodeLegacySignalValue(*envelope.LegacyValue), true
	}
	if len(envelope.Value) > 0 {
		var raw interface{}
		if err := json.Unmarshal(envelope.Value, &raw); err == nil {
			return raw, true
		}
	}
	return nil, false
}

// envelopeTimestamp returns the freshness timestamp from an envelope,
// preferring the unix-nanos field when present and falling
// back to the legacy time.Time field otherwise.
func envelopeTimestamp(envelope redisSignalValueEnvelope) time.Time {
	if envelope.TS != 0 {
		return time.Unix(0, envelope.TS).UTC()
	}
	return envelope.Timestamp.UTC()
}

// decodeTypedValue switches on the envelope's Kind to unmarshal V into
// the right concrete Go type without reflection. Unknown / zero kinds
// fall through to a generic untyped decode so a missing classifier
// never silently drops a value.
func decodeTypedValue(kind protomodel.ValueKind, raw json.RawMessage) (interface{}, error) {
	switch kind {
	case protomodel.ValueKindBool:
		var b bool
		if err := json.Unmarshal(raw, &b); err != nil {
			return nil, fmt.Errorf("decode bool: %w", err)
		}
		return b, nil
	case protomodel.ValueKindInt32:
		var n int32
		if err := json.Unmarshal(raw, &n); err != nil {
			return nil, fmt.Errorf("decode int32: %w", err)
		}
		return n, nil
	case protomodel.ValueKindInt64:
		var n int64
		if err := json.Unmarshal(raw, &n); err != nil {
			return nil, fmt.Errorf("decode int64: %w", err)
		}
		return n, nil
	case protomodel.ValueKindFloat:
		var f float32
		if err := json.Unmarshal(raw, &f); err != nil {
			return nil, fmt.Errorf("decode float32: %w", err)
		}
		return f, nil
	case protomodel.ValueKindDouble:
		var f float64
		if err := json.Unmarshal(raw, &f); err != nil {
			return nil, fmt.Errorf("decode float64: %w", err)
		}
		return f, nil
	case protomodel.ValueKindString, protomodel.ValueKindEnum:
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return nil, fmt.Errorf("decode string: %w", err)
		}
		return s, nil
	case protomodel.ValueKindTime:
		var t time.Time
		if err := json.Unmarshal(raw, &t); err != nil {
			return nil, fmt.Errorf("decode time: %w", err)
		}
		return t, nil
	case protomodel.ValueKindCompound, protomodel.ValueKindUnknown, protomodel.ValueKindInvalid:
		fallthrough
	default:
		var any interface{}
		if err := json.Unmarshal(raw, &any); err != nil {
			return nil, fmt.Errorf("decode untyped: %w", err)
		}
		return any, nil
	}
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

// parseRedisSignalValueEnvelope tries to decode s as either the typed
// envelope ({"kind","v","ts"}) or the legacy envelope
// ({"encoding","value","timestamp"}). Returns (envelope, true, nil) for
// either canonical shape. Returns (zero, false, nil) for legacy scalar
// fields so the caller falls through to decodeLegacySignalValue. In
// strict mode any malformed JSON object / array surfaces as an error so
// the caller can distinguish "no envelope" from "broken envelope".
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

	_, hasKind := probe["kind"]
	_, hasV := probe["v"]
	_, hasTS := probe["ts"]
	hasTypedEnvelope := hasKind && hasV && hasTS

	encodingRaw, hasEncoding := probe["encoding"]
	hasLegacyEnvelope := false
	if hasEncoding {
		var encoding string
		if err := json.Unmarshal(encodingRaw, &encoding); err == nil && encoding == redisSignalValueEncoding {
			hasLegacyEnvelope = true
		}
	}

	if !hasTypedEnvelope && !hasLegacyEnvelope {
		return empty, false, nil
	}

	var envelope redisSignalValueEnvelope
	if err := json.Unmarshal([]byte(trimmed), &envelope); err != nil {
		return empty, true, fmt.Errorf("decode redis signal envelope: %w", err)
	}

	if hasTypedEnvelope {
		if len(envelope.V) == 0 {
			return empty, true, fmt.Errorf("typed redis signal envelope missing v")
		}
		if envelope.TS == 0 {
			return empty, true, fmt.Errorf("typed redis signal envelope missing ts")
		}
		return envelope, true, nil
	}

	// Legacy envelope path.
	if len(envelope.Value) == 0 {
		return empty, true, fmt.Errorf("legacy redis signal envelope missing value")
	}
	if envelope.Timestamp.IsZero() {
		return empty, true, fmt.Errorf("legacy redis signal envelope missing timestamp")
	}
	return envelope, true, nil
}

// encodeTimestampedSignalValueForField is the canonical Redis envelope encoder.
// It infers the protomodel.ValueKind for `name` (runtime-type-first;
// metadata fallback for enum disambiguation and unknown types) and
// writes the typed envelope {"kind","v","ts"}. Legacy envelope
// fields (encoding/value/timestamp/source/legacy_value) are
// also populated so older binaries mid-rollout — and the immutable
// wire-format assertions in live_store_test.go — keep working. New
// readers pick up `kind`+`v`+`ts`; old readers ignore them and fall
// through to `value`/`timestamp` exactly as before.
func encodeTimestampedSignalValueForField(name string, v interface{}, timestamp time.Time) (string, error) {
	return encodeTimestampedSignalValueForFieldWithMetadata(name, v, timestamp, false)
}

func encodeTimestampedSignalValueForFieldWithMetadata(
	name string,
	v interface{},
	timestamp time.Time,
	synthetic bool,
) (string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return "", fmt.Errorf("marshal value: %w", err)
	}
	legacyValue := encodeSignalValue(v)
	observed := !synthetic
	envelope := redisSignalValueEnvelope{
		Kind:     inferValueKind(name, v),
		V:        raw,
		TS:       timestamp.UTC().UnixNano(),
		Observed: &observed,

		Encoding:    redisSignalValueEncoding,
		Value:       raw,
		LegacyValue: &legacyValue,
		Timestamp:   timestamp.UTC(),
		Source:      redisSignalValueSource,
	}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return "", fmt.Errorf("marshal typed envelope: %w", err)
	}
	return string(encoded), nil
}

// encodeTimestampedSignalValue is a field-name-less convenience wrapper
// retained so non-allowed-files callers (live_store_test.go) keep
// compiling. It uses runtime type inference because the signal name is
// not available.
func encodeTimestampedSignalValue(v interface{}, timestamp time.Time) (string, error) {
	return encodeTimestampedSignalValueForField("", v, timestamp)
}

// inferValueKind returns the protomodel.ValueKind for a signal value.
// Runtime-type-first: the producer (codec) emits typed primitives so
// preserving the runtime type round-trips losslessly (float32 stays
// float32; int32 stays int32). Metadata is consulted only to
// disambiguate string-shaped values that the proto declares as
// ValueKindEnum, and as a last resort for unknown runtime types.
func inferValueKind(name string, v interface{}) protomodel.ValueKind {
	switch v.(type) {
	case bool:
		return protomodel.ValueKindBool
	case int32:
		return protomodel.ValueKindInt32
	case int, int64:
		return protomodel.ValueKindInt64
	case float32:
		return protomodel.ValueKindFloat
	case float64:
		return protomodel.ValueKindDouble
	case string:
		// Disambiguate string vs enum via metadata when available.
		if name != "" {
			if meta, ok := protomodel.SignalsByName[name]; ok && meta != nil && meta.ValueKind == protomodel.ValueKindEnum {
				return protomodel.ValueKindEnum
			}
		}
		return protomodel.ValueKindString
	case time.Time:
		return protomodel.ValueKindTime
	case map[string]interface{}, []interface{}:
		return protomodel.ValueKindCompound
	}
	// Fall through to metadata for unknown / unmappable runtime types.
	if name != "" {
		if meta, ok := protomodel.SignalsByName[name]; ok && meta != nil && meta.ValueKind != protomodel.ValueKindUnknown {
			return meta.ValueKind
		}
	}
	return protomodel.ValueKindUnknown
}

// GetSignalValueFresh returns the value of a single signal from Redis
// HSET and enforces the cache's stale-after contract. When the stored
// value is older than staleAfter — or has unknown freshness because it
// is a legacy zero-Timestamp scalar — the function returns
// (advisoryValue, ErrStale) and increments
// tesla_signal_cache_stale_total{vehicle_id, field}. The advisory value
// is NEVER nil when ErrStale is returned, so callers can compare it
// against an authoritative L1/log re-resolution.
//
// Returns (nil, nil) when the key is missing. Returns (nil, err) on
// transport or decode errors. Returns (value, nil) for fresh entries.
//
// When staleAfter is 0 (e.g. tests using direct struct construction),
// freshness checks are disabled and the call is equivalent to
// GetSignalValue with the legacy timestamp/zero behaviour.
func (c *RedisSignalCache) GetSignalValueFresh(ctx context.Context, vehicleID int64, name string) (*Value, error) {
	value, err := c.GetSignalValue(ctx, vehicleID, name)
	if err != nil {
		return nil, err
	}
	if value == nil {
		return nil, nil
	}
	if c.staleAfter <= 0 {
		return value, nil
	}
	if value.Timestamp.IsZero() {
		// Legacy scalar with unknown freshness — must be re-resolved.
		staleTotal.WithLabelValues(strconv.FormatInt(vehicleID, 10), name).Inc()
		return value, ErrStale
	}
	if time.Since(value.Timestamp) > c.staleAfter {
		staleTotal.WithLabelValues(strconv.FormatInt(vehicleID, 10), name).Inc()
		return value, ErrStale
	}
	return value, nil
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
