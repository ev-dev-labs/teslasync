// Package signal provides an in-memory signal store for real-time vehicle
// telemetry. It maintains a last-known-good value for every signal per vehicle,
// updated on every MQTT batch (nanosecond operation). The dashboard and state
// machine read from here instead of partial DB rows.
//
// Pod restart recovery uses Redis HSET → signal_log fallback chain.
package signal

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

// Value holds a signal's current value and when it was last updated.
//
// Raw is `any` so the store can hold the typed primitive that the Tesla
// pipeline emits at the codec boundary (string, bool, int32, int64,
// float32, float64, time.Time, or a typed ftproto enum). Callers that
// need a concrete Go scalar should use the typed convenience getters
// (GetFloat, GetBool, GetString, GetTime) which verify the stored value
// against the field's declared protomodel.ValueKind.
type Value struct {
	Raw                interface{} `json:"value"`
	Timestamp          time.Time   `json:"timestamp"`
	TimestampSynthetic bool        `json:"-"`
}

// Store is a concurrent-safe, in-memory store of the latest signal values
// per vehicle. Updated on every MQTT batch; never loses known values.
type Store struct {
	mu       sync.RWMutex
	vehicles map[int64]map[string]*Value

	redisCache *RedisSignalCache
}

// New creates a new SignalStore. Pod restart recovery uses Redis → signal_log.
func New() *Store {
	return &Store{
		vehicles: make(map[int64]map[string]*Value),
	}
}

// SetRedisCache sets the Redis signal cache for startup recovery.
// When set, LoadFromDB tries Redis HSET before signal_log hydration.
func (s *Store) SetRedisCache(cache *RedisSignalCache) {
	s.redisCache = cache
}

// Update merges incoming signals into the vehicle's state. Only non-nil,
// non-empty values are stored — existing values are never overwritten with nil.
// This is called on every MQTT batch and must be as fast as possible.
func (s *Store) Update(vehicleID int64, signals map[string]interface{}) {
	now := time.Now().UTC()
	values := make(map[string]*Value, len(signals))
	for field, raw := range signals {
		values[field] = &Value{Raw: raw, Timestamp: now}
	}
	s.UpdateValues(vehicleID, values)
}

// UpdateValues merges timestamped signals while preserving the newest
// observation for each field. Older replayed values never overwrite newer
// live state; equal timestamps remain idempotently replaceable.
func (s *Store) UpdateValues(vehicleID int64, values map[string]*Value) {
	s.mu.Lock()
	m, ok := s.vehicles[vehicleID]
	if !ok {
		m = make(map[string]*Value, len(values))
		s.vehicles[vehicleID] = m
	}
	for field, value := range values {
		if value == nil || value.Raw == nil {
			continue
		}
		// Skip {invalid: true} markers from Tesla
		if im, isMap := value.Raw.(map[string]interface{}); isMap {
			if inv, has := im["invalid"]; has {
				if b, isBool := inv.(bool); isBool && b {
					continue
				}
			}
		}
		if current := m[field]; current != nil && !shouldReplaceSignalValue(current, value) {
			continue
		}
		m[field] = cloneSignalValue(value)
	}
	s.mu.Unlock()

	// Update freshness metric
	metrics.VehicleLastSeen.WithLabelValues(strconv.FormatInt(vehicleID, 10)).Set(0)
}

// GetAll returns a snapshot of all latest signal values for a vehicle.
func (s *Store) GetAll(vehicleID int64) map[string]*Value {
	s.mu.RLock()
	defer s.mu.RUnlock()

	m, ok := s.vehicles[vehicleID]
	if !ok {
		return nil
	}
	result := make(map[string]*Value, len(m))
	for k, v := range m {
		result[k] = v
	}
	return result
}

// Get returns a single signal's latest value, or nil if not known.
func (s *Store) Get(vehicleID int64, name string) *Value {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if m, ok := s.vehicles[vehicleID]; ok {
		return m[name]
	}
	return nil
}

// Set updates or inserts a single signal value for a vehicle. It is the
// per-field counterpart of Update used by the new Tesla normalize
// pipeline, which emits typed primitives one Atomic at a time.
//
// nil values and {invalid: true} markers are dropped to preserve the
// last-known-good contract — an invalid sample must NOT overwrite a
// previously known good value.
//
// The caller-supplied ts becomes the Value.Timestamp so producers that
// have a precise emit time (e.g. codec.Atomic.EmittedAt sourced from the
// Payload's CreatedAt) preserve it instead of being restamped to
// time.Now() at the boundary. Callers that have no precise timestamp
// SHOULD pass time.Now().UTC() explicitly.
func (s *Store) Set(vehicleID int64, field string, value any, ts time.Time) {
	s.UpdateValues(vehicleID, map[string]*Value{
		field: {Raw: value, Timestamp: ts},
	})
}

func shouldReplaceSignalValue(current, incoming *Value) bool {
	if current == nil {
		return true
	}
	if incoming.Timestamp.IsZero() {
		return current.Timestamp.IsZero()
	}
	if current.Timestamp.IsZero() {
		return true
	}
	return !incoming.Timestamp.Before(current.Timestamp)
}

// GetFloat returns a numeric signal value as float64. When the field is
// declared in protomodel.SignalsByName, the declared ValueKind must be
// numeric (Float/Double/Int32/Int64); a mismatch returns (0, false) and
// logs a warn. Unannotated fields (e.g. ad-hoc test names) fall back to
// best-effort numeric coercion so callers that do not own a SignalMeta
// entry are not punished for the missing annotation.
func (s *Store) GetFloat(vehicleID int64, field string) (float64, bool) {
	v := s.Get(vehicleID, field)
	if v == nil {
		return 0, false
	}
	if meta, ok := protomodel.SignalsByName[field]; ok {
		switch meta.ValueKind {
		case protomodel.ValueKindFloat,
			protomodel.ValueKindDouble,
			protomodel.ValueKindInt32,
			protomodel.ValueKindInt64:
			// declared numeric — fall through to type switch
		default:
			log.Warn().
				Int64("vehicle_id", vehicleID).
				Str("field", field).
				Stringer("value_kind", meta.ValueKind).
				Msg("signal store: GetFloat called on non-numeric ValueKind")
			return 0, false
		}
	}
	f, ok := Float64(v.Raw)
	if !ok {
		log.Warn().
			Int64("vehicle_id", vehicleID).
			Str("field", field).
			Str("got_type", fmt.Sprintf("%T", v.Raw)).
			Msg("signal store: GetFloat type mismatch on stored value")
		return 0, false
	}
	return f, true
}

// GetInt returns an integer signal value. Returns (0, false) if not found.
func (s *Store) GetInt(vehicleID int64, field string) (int, bool) {
	f, ok := s.GetFloat(vehicleID, field)
	if !ok {
		return 0, false
	}
	return int(f), true
}

// GetString returns the field's value as a string. After the codec change
// that canonicalizes proto-enum variants to short strings (see
// protomodel.DecodeValue), both ValueKindString AND ValueKindEnum fields
// hold native Go strings in the store, so a single accessor serves both.
//
// Returns ("", false) when the field is missing OR the stored value is
// not a string (a producer bug — the codec contract guarantees string
// for both kinds; a non-string here means an upstream layer wrote a
// typed value directly without going through the codec).
func (s *Store) GetString(vehicleID int64, field string) (string, bool) {
	v := s.Get(vehicleID, field)
	if v == nil {
		return "", false
	}
	if str, ok := v.Raw.(string); ok {
		return str, true
	}
	log.Warn().
		Int64("vehicle_id", vehicleID).
		Str("field", field).
		Str("got_type", fmt.Sprintf("%T", v.Raw)).
		Msg("signal store: GetString type mismatch on stored value")
	return "", false
}

// GetBool returns a boolean signal value. When the field is declared in
// protomodel.SignalsByName, the declared ValueKind must be Bool; a
// mismatch returns (false, false) and logs a warn. Unannotated fields
// fall back to best-effort bool assertion.
func (s *Store) GetBool(vehicleID int64, field string) (bool, bool) {
	v := s.Get(vehicleID, field)
	if v == nil {
		return false, false
	}
	if meta, ok := protomodel.SignalsByName[field]; ok {
		if meta.ValueKind != protomodel.ValueKindBool {
			log.Warn().
				Int64("vehicle_id", vehicleID).
				Str("field", field).
				Stringer("value_kind", meta.ValueKind).
				Msg("signal store: GetBool called on non-bool ValueKind")
			return false, false
		}
	}
	if b, ok := v.Raw.(bool); ok {
		return b, true
	}
	log.Warn().
		Int64("vehicle_id", vehicleID).
		Str("field", field).
		Str("got_type", fmt.Sprintf("%T", v.Raw)).
		Msg("signal store: GetBool type mismatch on stored value")
	return false, false
}

// GetTime returns a time.Time signal value. When the field is declared
// in protomodel.SignalsByName, the declared ValueKind must be Time; a
// mismatch returns (zero-time, false) and logs a warn. Unannotated
// fields fall back to best-effort time.Time assertion.
func (s *Store) GetTime(vehicleID int64, field string) (time.Time, bool) {
	v := s.Get(vehicleID, field)
	if v == nil {
		return time.Time{}, false
	}
	if meta, ok := protomodel.SignalsByName[field]; ok {
		if meta.ValueKind != protomodel.ValueKindTime {
			log.Warn().
				Int64("vehicle_id", vehicleID).
				Str("field", field).
				Stringer("value_kind", meta.ValueKind).
				Msg("signal store: GetTime called on non-time ValueKind")
			return time.Time{}, false
		}
	}
	if t, ok := v.Raw.(time.Time); ok {
		return t, true
	}
	log.Warn().
		Int64("vehicle_id", vehicleID).
		Str("field", field).
		Str("got_type", fmt.Sprintf("%T", v.Raw)).
		Msg("signal store: GetTime type mismatch on stored value")
	return time.Time{}, false
}

// GetRawMap returns the raw signal values as a simple map (for API responses).
func (s *Store) GetRawMap(vehicleID int64) map[string]interface{} {
	all := s.GetAll(vehicleID)
	if all == nil {
		return nil
	}
	result := make(map[string]interface{}, len(all))
	for k, v := range all {
		result[k] = v.Raw
	}
	return result
}

// LoadFromDB loads vehicle state into memory for pod restart recovery.
// Two-tier fallback chain:
//
//	Tier 1: Redis HSET (has ALL 230+ signals, survives pod restart)
//	Tier 2: signal_log (query latest value per signal)
func (s *Store) LoadFromDB(ctx context.Context, vehicleID int64) {
	// Tier 1: Redis HSET (has ALL 230+ signals, survives pod restart)
	if s.redisCache != nil {
		values, err := s.redisCache.GetAllValues(ctx, vehicleID)
		if err == nil && len(values) > 0 {
			s.HydrateValues(vehicleID, values)
			log.Info().Int64("vehicle_id", vehicleID).Int("signals", len(values)).Msg("signal store: loaded from Redis")
			return
		}
		if err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("signal store: Redis read failed")
		}
	}

	// Tier 2: signal_log hydration is handled separately via SignalHistoryWriter.
}

// Hydrate merges signals into the store without flushing.
// Used on startup to warm the store from signal_history.
// Does NOT overwrite values already loaded from Redis (LoadFromDB).
func (s *Store) Hydrate(vehicleID int64, signals map[string]interface{}) {
	if len(signals) == 0 {
		return
	}
	now := time.Now().UTC()
	s.mu.Lock()
	m, ok := s.vehicles[vehicleID]
	if !ok {
		m = make(map[string]*Value, len(signals))
		s.vehicles[vehicleID] = m
	}
	added := 0
	for k, v := range signals {
		if v == nil {
			continue
		}
		if _, exists := m[k]; exists {
			continue
		}
		m[k] = &Value{Raw: v, Timestamp: now, TimestampSynthetic: true}
		added++
	}
	s.mu.Unlock()
	log.Debug().Int64("vehicle_id", vehicleID).Int("hydrated", added).Int("skipped", len(signals)-added).Msg("signal store: hydrated from signal_history")
}

// HydrateValues merges timestamped values without overwriting existing L1
// entries. Unlike Hydrate, it preserves each value's observation provenance.
func (s *Store) HydrateValues(vehicleID int64, values map[string]*Value) {
	if len(values) == 0 {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	signals, ok := s.vehicles[vehicleID]
	if !ok {
		signals = make(map[string]*Value, len(values))
		s.vehicles[vehicleID] = signals
	}
	for name, value := range values {
		if value == nil || value.Raw == nil {
			continue
		}
		if _, exists := signals[name]; exists {
			continue
		}
		signals[name] = cloneSignalValue(value)
	}
}

// VehicleIDs returns all vehicle IDs that have signal data.
func (s *Store) VehicleIDs() []int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ids := make([]int64, 0, len(s.vehicles))
	total := 0
	for id, sigs := range s.vehicles {
		ids = append(ids, id)
		total += len(sigs)
	}
	metrics.SignalStoreEntries.Set(float64(total))
	return ids
}

// LastSeenAt returns the newest Timestamp across all signals for a
// vehicle, or the zero time when the vehicle has no L1 entries. This is
// the L1-side complement of computing max(value.Timestamp) over a Redis
// HGETALL — useful for diagnostic surfaces that distinguish "L1 has
// fresh data" from "L1 has stale-or-empty data".
func (s *Store) LastSeenAt(vehicleID int64) time.Time {
	s.mu.RLock()
	defer s.mu.RUnlock()
	signals, ok := s.vehicles[vehicleID]
	if !ok {
		return time.Time{}
	}
	var newest time.Time
	for _, v := range signals {
		if v == nil {
			continue
		}
		if v.Timestamp.After(newest) {
			newest = v.Timestamp
		}
	}
	return newest
}
