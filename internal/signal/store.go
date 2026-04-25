// Package signal provides an in-memory signal store for real-time vehicle
// telemetry. It maintains a last-known-good value for every signal per vehicle,
// updated on every MQTT batch (nanosecond operation). The dashboard and state
// machine read from here instead of partial DB rows.
//
// Pod restart recovery uses Redis HSET → signal_log fallback chain.
package signal

import (
	"context"
	"strconv"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
)

// Value holds a signal's current value and when it was last updated.
type Value struct {
	Raw       interface{} `json:"value"`
	Timestamp time.Time   `json:"timestamp"`
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
// When set, LoadFromDB tries Redis HSET first (all 230+ signals) before
// falling back to the Postgres vehicle_live_state table (~30 columns).
func (s *Store) SetRedisCache(cache *RedisSignalCache) {
	s.redisCache = cache
}

// Update merges incoming signals into the vehicle's state. Only non-nil,
// non-empty values are stored — existing values are never overwritten with nil.
// This is called on every MQTT batch and must be as fast as possible.
func (s *Store) Update(vehicleID int64, signals map[string]interface{}) {
	now := time.Now().UTC()

	s.mu.Lock()
	m, ok := s.vehicles[vehicleID]
	if !ok {
		m = make(map[string]*Value, len(signals))
		s.vehicles[vehicleID] = m
	}
	for k, v := range signals {
		if v == nil {
			continue
		}
		// Skip {invalid: true} markers from Tesla
		if im, isMap := v.(map[string]interface{}); isMap {
			if inv, has := im["invalid"]; has {
				if b, isBool := inv.(bool); isBool && b {
					continue
				}
			}
		}
		m[k] = &Value{Raw: v, Timestamp: now}
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

// GetFloat returns a numeric signal value. Returns (0, false) if not found.
func (s *Store) GetFloat(vehicleID int64, name string) (float64, bool) {
	v := s.Get(vehicleID, name)
	if v == nil {
		return 0, false
	}
	switch val := v.Raw.(type) {
	case float64:
		return val, true
	case int:
		return float64(val), true
	case int64:
		return float64(val), true
	}
	return 0, false
}

// GetInt returns an integer signal value. Returns (0, false) if not found.
func (s *Store) GetInt(vehicleID int64, name string) (int, bool) {
	f, ok := s.GetFloat(vehicleID, name)
	if !ok {
		return 0, false
	}
	return int(f), true
}

// GetString returns a string signal value. Returns ("", false) if not found.
func (s *Store) GetString(vehicleID int64, name string) (string, bool) {
	v := s.Get(vehicleID, name)
	if v == nil {
		return "", false
	}
	if str, ok := v.Raw.(string); ok {
		return str, true
	}
	return "", false
}

// GetBool returns a boolean signal value. Returns (false, false) if not found.
func (s *Store) GetBool(vehicleID int64, name string) (bool, bool) {
	v := s.Get(vehicleID, name)
	if v == nil {
		return false, false
	}
	if b, ok := v.Raw.(bool); ok {
		return b, true
	}
	return false, false
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
//   Tier 1: Redis HSET (has ALL 230+ signals, survives pod restart)
//   Tier 2: signal_log (query latest value per signal — prompt 06)
func (s *Store) LoadFromDB(ctx context.Context, vehicleID int64) {
	// Tier 1: Redis HSET (has ALL 230+ signals, survives pod restart)
	if s.redisCache != nil {
		signals, err := s.redisCache.GetAll(ctx, vehicleID)
		if err == nil && len(signals) > 0 {
			s.Hydrate(vehicleID, signals)
			log.Info().Int64("vehicle_id", vehicleID).Int("signals", len(signals)).Msg("signal store: loaded from Redis")
			return
		}
		if err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("signal store: Redis read failed")
		}
	}

	// Tier 2: signal_log (implemented in prompt 06 — hydrated separately via SignalHistoryWriter)
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
		m[k] = &Value{Raw: v, Timestamp: now}
		added++
	}
	s.mu.Unlock()
	log.Debug().Int64("vehicle_id", vehicleID).Int("hydrated", added).Int("skipped", len(signals)-added).Msg("signal store: hydrated from signal_history")
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
