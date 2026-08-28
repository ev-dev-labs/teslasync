package signal

// L2 BULK read path.
//
// The fleet batch current-state read (GET /api/v1/vehicles/states) needs the
// live signals of EVERY vehicle in one page. Issuing one HGETALL per vehicle
// costs one network round trip per car: a 100-vehicle fleet paid 100
// sequential RTTs inside a single HTTP request, which is the dominant term in
// that endpoint's latency long before Redis itself is the bottleneck.
//
// GetAllValuesBulk collapses that into ONE pipelined round trip. It does NOT
// change the stored representation, the key layout, the envelope format or the
// freshness semantics — it is purely a transport-level batching of the same
// HGETALLs, so ADR-007's layering (L1 signal.Store, L2 Redis HSET, L3
// signal_log) is untouched and no snapshot/mirror table is introduced.

import (
	"context"
	"errors"
	"fmt"

	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// LiveSignalRead is ONE vehicle's slot in a bulk live-signal read.
//
// Err is per-vehicle on purpose: a bulk read that partially fails must report
// exactly which vehicles could not be read instead of failing the whole fleet.
// A non-nil Err means "we do not know this vehicle's live signals", which is
// NOT the same fact as "this vehicle has no live signals" (Values empty,
// Err nil) — collapsing the two is how a Redis blip previously rendered as a
// fleet of offline cars.
type LiveSignalRead struct {
	// Values is the merged per-signal map, nil/empty when the vehicle has no
	// live signals or when Err is set.
	Values map[string]*Value
	// Err records why this vehicle's live read failed. Callers degrade to the
	// durable signal_log fallback for exactly these vehicles.
	Err error
}

// RedisHashBatchReply is one key's result inside a bulk hash read.
type RedisHashBatchReply struct {
	// Fields is the raw HGETALL result, nil when Err is set or the key is
	// absent (Redis returns an empty hash for a missing key, never an error).
	Fields map[string]string
	// Err is this key's own command error, independent of its siblings.
	Err error
}

// redisHashBatchReader issues N HGETALLs in ONE round trip.
//
// It is a narrow seam (single method, no go-redis types in the signature
// beyond the reply struct) precisely so tests can substitute an in-memory
// implementation and ASSERT the round-trip count. Production installs
// pipelinedHashBatchReader over the live *redis.Client.
type redisHashBatchReader interface {
	HGetAllBatch(ctx context.Context, keys []string) ([]RedisHashBatchReply, error)
}

// redisPipelinedRunner is the go-redis pipelining entry point. *redis.Client
// satisfies it directly.
type redisPipelinedRunner interface {
	Pipelined(ctx context.Context, fn func(redis.Pipeliner) error) ([]redis.Cmder, error)
}

// pipelinedHashBatchReader is the production redisHashBatchReader: it queues
// every HGETALL into one pipeline so the whole batch costs a single round
// trip, then reads each command's INDIVIDUAL result so one failing key cannot
// erase its siblings' answers.
type pipelinedHashBatchReader struct {
	rdb redisPipelinedRunner
}

// HGetAllBatch runs len(keys) HGETALLs in one pipelined round trip.
//
// go-redis's Pipelined returns the FIRST command error as its aggregate
// error and still stamps every command with its own error, so the aggregate
// is deliberately not returned: it would turn a single bad key into a total
// failure. The aggregate is only used as the fallback error for a command
// that somehow carries none.
func (p pipelinedHashBatchReader) HGetAllBatch(ctx context.Context, keys []string) ([]RedisHashBatchReply, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	cmds := make([]*redis.MapStringStringCmd, len(keys))
	_, execErr := p.rdb.Pipelined(ctx, func(pipe redis.Pipeliner) error {
		for i, key := range keys {
			cmds[i] = pipe.HGetAll(ctx, key)
		}
		return nil
	})
	if execErr != nil && errors.Is(execErr, redis.Nil) {
		// redis.Nil is "no such key" for some commands; HGETALL never
		// produces it, but the aggregate can surface a sibling's Nil.
		execErr = nil
	}

	replies := make([]RedisHashBatchReply, len(keys))
	for i, cmd := range cmds {
		if cmd == nil {
			// The pipeline never queued this command (queue callback
			// aborted); report the aggregate rather than a silent empty hash.
			replies[i] = RedisHashBatchReply{Err: execErr}
			continue
		}
		fields, err := cmd.Result()
		switch {
		case errors.Is(err, redis.Nil):
			// Missing key: an empty hash, not a failure.
			replies[i] = RedisHashBatchReply{}
		case err != nil:
			replies[i] = RedisHashBatchReply{Err: err}
		default:
			replies[i] = RedisHashBatchReply{Fields: fields}
		}
	}
	return replies, nil
}

// hashBatchReader returns the active bulk seam.
//
// Production caches are constructed by NewRedisSignalCache, which installs the
// pipelined reader. Hand-constructed caches (tests) may inject a client that
// implements the seam itself; when neither is available GetAllValuesBulk falls
// back to the per-vehicle HGETALL loop, which is CORRECT but not batched.
func (c *RedisSignalCache) hashBatchReader() redisHashBatchReader {
	if c.batch != nil {
		return c.batch
	}
	if reader, ok := c.rdb.(redisHashBatchReader); ok {
		return reader
	}
	return nil
}

// GetAllValuesBulk returns timestamp-aware signals for MANY vehicles using one
// pipelined round trip.
//
// Semantics are identical to calling GetAllValues once per vehicle:
//   - a vehicle with no Redis key yields an entry with nil Values and nil Err;
//   - legacy scalar values keep their zero Timestamp (unknown freshness);
//   - stale envelopes are returned unchanged — freshness stays informational,
//     never a filter (ADR-007).
//
// The returned map has one entry per REQUESTED vehicle id. The outer error is
// reserved for whole-call failures (nil context); every transport or decode
// failure is attributed to the vehicle it belongs to via LiveSignalRead.Err.
func (c *RedisSignalCache) GetAllValuesBulk(ctx context.Context, vehicleIDs []int64) (map[int64]LiveSignalRead, error) {
	if err := validateLiveSignalContext(ctx); err != nil {
		return nil, err
	}
	ids := dedupeVehicleIDs(vehicleIDs)
	if len(ids) == 0 {
		return map[int64]LiveSignalRead{}, nil
	}

	ctx, span := otel.Tracer(redisCacheTracerName).Start(
		ctx,
		"signal.redis_cache.get_all_values_bulk",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(attribute.Int("vehicle_count", len(ids))),
	)
	defer span.End()

	out := make(map[int64]LiveSignalRead, len(ids))
	reader := c.hashBatchReader()
	if reader == nil {
		// No pipelining seam available (hand-constructed cache). Correctness
		// first: answer from the same per-vehicle reads, one key at a time.
		span.SetAttributes(attribute.Bool("pipelined", false))
		for _, id := range ids {
			values, err := c.GetAllValues(ctx, id)
			out[id] = LiveSignalRead{Values: values, Err: err}
		}
		return out, nil
	}
	span.SetAttributes(attribute.Bool("pipelined", true))

	keys := make([]string, len(ids))
	for i, id := range ids {
		keys[i] = fmt.Sprintf("vehicle:%d:signals", id)
	}
	replies, err := reader.HGetAllBatch(ctx, keys)
	if err != nil {
		// A failure to even issue the pipeline is a fact about every
		// requested vehicle, recorded per vehicle so each one degrades to its
		// durable fallback exactly as a single-vehicle read would.
		span.RecordError(err)
		span.SetStatus(codes.Error, "redis_cache.get_all_values_bulk")
		for i, id := range ids {
			out[id] = LiveSignalRead{Err: fmt.Errorf("redis pipelined HGETALL %s: %w", keys[i], err)}
		}
		return out, nil
	}
	if len(replies) != len(ids) {
		return nil, fmt.Errorf("redis pipelined HGETALL returned %d replies for %d keys", len(replies), len(ids))
	}

	failed := 0
	for i, id := range ids {
		reply := replies[i]
		if reply.Err != nil {
			failed++
			out[id] = LiveSignalRead{Err: fmt.Errorf("redis HGETALL %s: %w", keys[i], reply.Err)}
			continue
		}
		if len(reply.Fields) == 0 {
			out[id] = LiveSignalRead{}
			continue
		}
		values := make(map[string]*Value, len(reply.Fields))
		var decodeErr error
		for field, raw := range reply.Fields {
			value, err := decodeSignalValueWithTimestamp(raw)
			if err != nil {
				decodeErr = fmt.Errorf("decode redis signal %s %s: %w", keys[i], field, err)
				break
			}
			values[field] = value
		}
		if decodeErr != nil {
			failed++
			out[id] = LiveSignalRead{Err: decodeErr}
			continue
		}
		out[id] = LiveSignalRead{Values: values}
	}
	span.SetAttributes(attribute.Int("failed_count", failed))
	return out, nil
}

// dedupeVehicleIDs preserves first-seen order and drops non-positive ids.
// Bulk reads are keyed by vehicle id, so a duplicate would issue a redundant
// round trip and a non-positive id has no Redis key at all.
func dedupeVehicleIDs(vehicleIDs []int64) []int64 {
	if len(vehicleIDs) == 0 {
		return nil
	}
	seen := make(map[int64]struct{}, len(vehicleIDs))
	out := make([]int64, 0, len(vehicleIDs))
	for _, id := range vehicleIDs {
		if id <= 0 {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}
