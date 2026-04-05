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
	"sync"
	"time"

	"github.com/rs/zerolog/log"
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

	flusher Flusher

	flushMu    sync.Mutex
	lastFlush  map[int64]time.Time
	flushEvery time.Duration
}

// Flusher persists the in-memory state to a durable store (e.g. Postgres).
type Flusher interface {
	FlushLiveState(ctx context.Context, vehicleID int64, signals map[string]interface{}) error
	LoadLiveState(ctx context.Context, vehicleID int64) (map[string]interface{}, error)
}

// New creates a new SignalStore. If flusher is nil, no DB persistence occurs.
func New(flusher Flusher, flushInterval time.Duration) *Store {
	if flushInterval <= 0 {
		flushInterval = 5 * time.Second
	}
	return &Store{
		vehicles:   make(map[int64]map[string]*Value),
		flusher:    flusher,
		lastFlush:  make(map[int64]time.Time),
		flushEvery: flushInterval,
	}
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

	// Periodic flush to DB (non-blocking check)
	s.maybeFlush(vehicleID)
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

// LoadFromDB loads the vehicle_live_state from the flusher (Postgres) into memory.
// Called on startup to recover state after a pod restart.
func (s *Store) LoadFromDB(ctx context.Context, vehicleID int64) {
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

// maybeFlush flushes to DB if the flush interval has elapsed for this vehicle.
func (s *Store) maybeFlush(vehicleID int64) {
	if s.flusher == nil {
		return
	}

	s.flushMu.Lock()
	last := s.lastFlush[vehicleID]
	if time.Since(last) < s.flushEvery {
		s.flushMu.Unlock()
		return
	}
	s.lastFlush[vehicleID] = time.Now().UTC()
	s.flushMu.Unlock()

	// Flush asynchronously to avoid blocking the MQTT handler
	raw := s.GetRawMap(vehicleID)
	if raw == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.flusher.FlushLiveState(ctx, vehicleID, raw); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("signal store: flush to DB failed")
		}
	}()
}

// VehicleIDs returns all vehicle IDs that have signal data.
func (s *Store) VehicleIDs() []int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ids := make([]int64, 0, len(s.vehicles))
	for id := range s.vehicles {
		ids = append(ids, id)
	}
	return ids
}
