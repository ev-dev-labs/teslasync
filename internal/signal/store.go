// Package signal provides an in-memory signal store for real-time vehicle
// telemetry. It maintains a last-known-good value for every signal per vehicle,
// updated on every MQTT batch (nanosecond operation). The dashboard and state
// machine read from here instead of partial DB rows.
//
// Periodically flushed to the vehicle_live_state Postgres table as a checkpoint
// for pod restart recovery.
package signal

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/sony/gobreaker"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
)

// Value holds a signal's current value and when it was last updated.
type Value struct {
	Raw       interface{} `json:"value"`
	Timestamp time.Time   `json:"timestamp"`
}

// Store is a concurrent-safe, in-memory store of the latest signal values
// per vehicle. Updated on every MQTT batch; never loses known values.
// Debounced write-through: updates mark vehicles dirty, a periodic FlushLoop
// coalesces and flushes to Postgres (1s normal, 5s when circuit breaker open).
type Store struct {
	mu       sync.RWMutex
	vehicles map[int64]map[string]*Value

	flusher      Flusher
	redisCache   *RedisSignalCache
	writeBreaker *database.DBCircuitBreaker

	// Debounced flush: dirty vehicles are flushed on a timer, not per-batch.
	dirtyMu sync.Mutex
	dirty   map[int64]bool
	flushWg sync.WaitGroup // tracks FlushLoop goroutine for shutdown coordination
}

// Flusher persists the in-memory state to a durable store (e.g. Postgres).
type Flusher interface {
	FlushLiveState(ctx context.Context, vehicleID int64, signals map[string]interface{}) error
	LoadLiveState(ctx context.Context, vehicleID int64) (map[string]interface{}, error)
}

// New creates a new SignalStore with debounced write-through persistence.
// If flusher is nil, no DB persistence occurs and FlushLoop is a no-op.
// If writeBreaker is non-nil, flushes are guarded by the circuit breaker
// and the flush interval adapts (1s normal → 5s when breaker is open).
func New(flusher Flusher, flushInterval time.Duration, writeBreaker *database.DBCircuitBreaker) *Store {
	return &Store{
		vehicles:     make(map[int64]map[string]*Value),
		flusher:      flusher,
		writeBreaker: writeBreaker,
		dirty:        make(map[int64]bool),
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
// Marks the vehicle dirty for the next FlushLoop tick (debounced write-through).
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

	// Debounced write-through: mark dirty for next FlushLoop tick.
	// Coalesces multiple MQTT batches into a single DB write per vehicle per tick.
	s.markDirty(vehicleID)
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
// Three-tier fallback chain:
//   Tier 1: Redis HSET (has ALL 230+ signals, survives pod restart)
//   Tier 2: signal_log (query latest value per signal — prompt 06)
//   Tier 3: Legacy vehicle_live_state (~30 columns — removed in prompt 13)
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
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("signal store: Redis read failed, falling back to DB")
		}
	}

	// Tier 2: signal_log (query latest value per signal)
	// SELECT DISTINCT ON (signal) signal, value_num, value_str, value_bool
	// FROM signal_log WHERE vehicle_id = $1 ORDER BY signal, created_at DESC
	// (implemented in prompt 06 — for now fall through to legacy)

	// Tier 3: Legacy vehicle_live_state (will be removed in prompt 13)
	if s.flusher == nil {
		return
	}
	signals, err := s.flusher.LoadLiveState(ctx, vehicleID)
	if err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("signal store: failed to load from DB")
		return
	}
	if len(signals) == 0 {
		return
	}

	now := time.Now().UTC()
	s.mu.Lock()
	m := make(map[string]*Value, len(signals))
	for k, v := range signals {
		if v != nil {
			m[k] = &Value{Raw: v, Timestamp: now}
		}
	}
	s.vehicles[vehicleID] = m
	s.mu.Unlock()

	log.Info().Int64("vehicle_id", vehicleID).Int("signals", len(m)).Msg("signal store: loaded from DB")
}

// Hydrate merges signals into the store WITHOUT triggering a write-through flush.
// Used on startup to warm the store from Postgres signal_history.
// Does NOT overwrite values already loaded from vehicle_live_state (LoadFromDB).
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
		// Don't overwrite values already loaded from vehicle_live_state
		if _, exists := m[k]; exists {
			continue
		}
		m[k] = &Value{Raw: v, Timestamp: now}
		added++
	}
	s.mu.Unlock()
	log.Debug().Int64("vehicle_id", vehicleID).Int("hydrated", added).Int("skipped", len(signals)-added).Msg("signal store: hydrated from signal_history")
}

// markDirty flags a vehicle for flush on the next FlushLoop tick.
// Lock-free fast path called from Update() on every MQTT batch.
func (s *Store) markDirty(vehicleID int64) {
	s.dirtyMu.Lock()
	s.dirty[vehicleID] = true
	s.dirtyMu.Unlock()
}

// FlushLoop runs a periodic flush of dirty vehicles to Postgres.
// Normal interval is 1s; increases to 5s when the circuit breaker is open.
// Must be started as a goroutine: go signalStore.FlushLoop(ctx)
// Call WaitForFlushLoop() before FlushAll() during shutdown.
func (s *Store) FlushLoop(ctx context.Context) {
	if s.flusher == nil {
		return
	}

	s.flushWg.Add(1)
	defer s.flushWg.Done()

	const normalInterval = config.LiveStateFlushNormal
	const degradedInterval = config.LiveStateFlushDegraded

	ticker := time.NewTicker(normalInterval)
	defer ticker.Stop()
	currentInterval := normalInterval

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.flushDirty(ctx)

			// Adapt interval based on circuit breaker state
			newInterval := normalInterval
			if s.writeBreaker != nil && s.writeBreaker.State() != gobreaker.StateClosed {
				newInterval = degradedInterval
			}
			if newInterval != currentInterval {
				ticker.Reset(newInterval)
				currentInterval = newInterval
				log.Info().Dur("interval", newInterval).Msg("signal store: flush interval adjusted")
			}
		}
	}
}

// WaitForFlushLoop blocks until FlushLoop exits. Call after cancelling the
// context but before FlushAll() to prevent concurrent flush operations.
func (s *Store) WaitForFlushLoop() {
	s.flushWg.Wait()
}

// flushDirty flushes all dirty vehicles to Postgres and re-marks any that fail.
func (s *Store) flushDirty(ctx context.Context) {
	s.dirtyMu.Lock()
	if len(s.dirty) == 0 {
		s.dirtyMu.Unlock()
		return
	}
	ids := make([]int64, 0, len(s.dirty))
	for id := range s.dirty {
		ids = append(ids, id)
	}
	s.dirty = make(map[int64]bool, len(ids))
	s.dirtyMu.Unlock()

	for _, vid := range ids {
		raw := s.GetRawMap(vid)
		if raw == nil {
			continue
		}

		flushStart := time.Now()
		flushCtx, cancel := context.WithTimeout(ctx, config.SignalFlushTimeout)

		flushFn := func() error {
			return database.RetryOnTransient(flushCtx, "live_state_flush", func(ctx context.Context) error {
				return s.flusher.FlushLiveState(ctx, vid, raw)
			})
		}

		var err error
		if s.writeBreaker != nil {
			err = s.writeBreaker.Execute(flushFn)
		} else {
			err = flushFn()
		}
		cancel()

		if err != nil {
			if errors.Is(err, gobreaker.ErrOpenState) {
				log.Debug().Int64("vehicle_id", vid).Msg("signal store: circuit breaker open, re-marking dirty")
			} else {
				log.Warn().Err(err).Int64("vehicle_id", vid).Msg("signal store: flush failed, re-marking dirty")
			}
			// Re-mark for next cycle
			s.dirtyMu.Lock()
			s.dirty[vid] = true
			s.dirtyMu.Unlock()
		}
		metrics.SignalFlushDuration.Observe(time.Since(flushStart).Seconds())
	}
}

// FlushAll synchronously flushes all vehicles' live state to Postgres.
// Called during graceful shutdown to ensure no data loss.
func (s *Store) FlushAll(ctx context.Context) {
	if s.flusher == nil {
		return
	}
	ids := s.VehicleIDs()
	for _, vid := range ids {
		raw := s.GetRawMap(vid)
		if raw == nil {
			continue
		}
		err := database.RetryOnTransient(ctx, "shutdown_flush", func(ctx context.Context) error {
			return s.flusher.FlushLiveState(ctx, vid, raw)
		})
		if err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vid).Msg("signal store: shutdown flush failed after retries")
		}
	}
	log.Info().Int("vehicles", len(ids)).Msg("signal store: graceful shutdown flush complete")
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
