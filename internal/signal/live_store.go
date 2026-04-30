package signal

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

var (
	ErrInvalidLiveSignalStoreMode = errors.New("live signal store mode must be hybrid or local")
	ErrInvalidLiveSignalVehicleID = errors.New("live signal store vehicle_id must be positive")
	ErrNilLiveSignalBatch         = errors.New("live signal store signal batch must not be nil")
	ErrEmptyLiveSignalName        = errors.New("live signal store signal name must not be empty")
	ErrNilLiveSignalContext       = errors.New("live signal store context must not be nil")
	ErrNilLocalSignalStore        = errors.New("live signal store local Store must not be nil")
)

// LiveSignalStoreMode selects whether distributed Redis-backed reads are active.
type LiveSignalStoreMode string

const (
	LiveSignalStoreModeHybrid LiveSignalStoreMode = "hybrid"
	LiveSignalStoreModeLocal  LiveSignalStoreMode = "local"
)

const liveSignalRedisMirrorTimeout = 5 * time.Second

// LiveSignalReadPreference tells the boundary which layer a caller is allowed to use.
type LiveSignalReadPreference int

const (
	// LiveSignalReadLocal is for telemetry/FSM/session hot paths and always reads L1.
	LiveSignalReadLocal LiveSignalReadPreference = iota
	// LiveSignalReadDistributed is for cross-pod consumers and may read L2 in hybrid mode.
	LiveSignalReadDistributed
)

// LiveSignalStore is the package boundary for current live vehicle signals.
type LiveSignalStore interface {
	Update(ctx context.Context, vehicleID int64, signals map[string]interface{}) error
	UpdateNonBlocking(ctx context.Context, vehicleID int64, signals map[string]interface{}) error
	GetSignal(ctx context.Context, vehicleID int64, name string, preference LiveSignalReadPreference) (*Value, error)
	GetAll(ctx context.Context, vehicleID int64, preference LiveSignalReadPreference) (map[string]*Value, error)
	Warm(ctx context.Context, vehicleID int64) error
	LocalVehicleIDs() []int64
}

// HybridLiveSignalStore keeps Store as L1 and optionally mirrors through RedisSignalCache as L2.
type HybridLiveSignalStore struct {
	mu   sync.RWMutex
	l1   *Store
	l2   *RedisSignalCache
	mode LiveSignalStoreMode
	now  func() time.Time
}

// NewLiveSignalStore creates the default live-signal boundary from a runtime mode string.
func NewLiveSignalStore(l1 *Store, l2 *RedisSignalCache, mode string) (LiveSignalStore, error) {
	parsedMode, err := ParseLiveSignalStoreMode(mode)
	if err != nil {
		return nil, err
	}
	return NewHybridLiveSignalStore(l1, l2, parsedMode)
}

// NewHybridLiveSignalStore creates a live-signal boundary over the existing L1 and optional L2.
func NewHybridLiveSignalStore(l1 *Store, l2 *RedisSignalCache, mode LiveSignalStoreMode) (*HybridLiveSignalStore, error) {
	if l1 == nil {
		return nil, ErrNilLocalSignalStore
	}
	if err := validateLiveSignalStoreMode(mode); err != nil {
		return nil, err
	}
	return &HybridLiveSignalStore{
		l1:   l1,
		l2:   l2,
		mode: mode,
		now:  func() time.Time { return time.Now().UTC() },
	}, nil
}

// ParseLiveSignalStoreMode normalizes LIVE_SIGNAL_STORE_MODE values.
func ParseLiveSignalStoreMode(mode string) (LiveSignalStoreMode, error) {
	switch normalized := strings.ToLower(strings.TrimSpace(mode)); normalized {
	case "", string(LiveSignalStoreModeHybrid):
		return LiveSignalStoreModeHybrid, nil
	case string(LiveSignalStoreModeLocal):
		return LiveSignalStoreModeLocal, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrInvalidLiveSignalStoreMode, mode)
	}
}

// Mode returns the active live-signal runtime mode.
func (s *HybridLiveSignalStore) Mode() LiveSignalStoreMode {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.mode
}

// SetMode changes the runtime mode without replacing the L1 Store.
func (s *HybridLiveSignalStore) SetMode(mode LiveSignalStoreMode) error {
	if err := validateLiveSignalStoreMode(mode); err != nil {
		return err
	}
	s.mu.Lock()
	s.mode = mode
	s.mu.Unlock()
	return nil
}

// Update writes to L1 first. In hybrid mode, it then mirrors to L2 when available.
func (s *HybridLiveSignalStore) Update(ctx context.Context, vehicleID int64, signals map[string]interface{}) error {
	if err := validateLiveSignalContext(ctx); err != nil {
		return err
	}
	if err := validateLiveSignalVehicleID(vehicleID); err != nil {
		return err
	}
	if signals == nil {
		return ErrNilLiveSignalBatch
	}

	s.l1.Update(vehicleID, signals)
	l2 := s.redisCache()
	if len(signals) == 0 || l2 == nil {
		return nil
	}
	if err := l2.Update(ctx, vehicleID, signals); err != nil {
		return fmt.Errorf("mirror live signals to Redis for vehicle %d: %w", vehicleID, err)
	}
	return nil
}

// UpdateNonBlocking writes L1 synchronously, then mirrors to L2 in a bounded goroutine.
func (s *HybridLiveSignalStore) UpdateNonBlocking(ctx context.Context, vehicleID int64, signals map[string]interface{}) error {
	if err := validateLiveSignalContext(ctx); err != nil {
		return err
	}
	if err := validateLiveSignalVehicleID(vehicleID); err != nil {
		return err
	}
	if signals == nil {
		return ErrNilLiveSignalBatch
	}

	s.l1.Update(vehicleID, signals)
	l2 := s.redisCache()
	if len(signals) == 0 || l2 == nil {
		return nil
	}

	signalsCopy := copyLiveSignalBatch(signals)
	go func() {
		redisCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), liveSignalRedisMirrorTimeout)
		defer cancel()
		if err := l2.Update(redisCtx, vehicleID, signalsCopy); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("live signal store: Redis mirror failed")
		}
	}()
	return nil
}

// GetSignal reads one live signal from L1 or L2 according to caller preference and runtime mode.
func (s *HybridLiveSignalStore) GetSignal(ctx context.Context, vehicleID int64, name string, preference LiveSignalReadPreference) (*Value, error) {
	if err := validateLiveSignalContext(ctx); err != nil {
		return nil, err
	}
	if err := validateLiveSignalVehicleID(vehicleID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(name) == "" {
		return nil, ErrEmptyLiveSignalName
	}
	l2 := s.redisCache()
	if preference != LiveSignalReadDistributed || l2 == nil {
		return cloneSignalValue(s.l1.Get(vehicleID, name)), nil
	}

	value, err := l2.GetSignalValue(ctx, vehicleID, name)
	if err != nil {
		return nil, fmt.Errorf("read Redis live signal %d/%s: %w", vehicleID, name, err)
	}
	if IsLiveSignalFresh(value, s.now()) {
		return cloneSignalValue(value), nil
	}
	if value != nil {
		return nil, nil
	}
	return cloneSignalValue(s.l1.Get(vehicleID, name)), nil
}

// GetAll reads a vehicle's live signals from L1 or L2 according to caller preference and runtime mode.
func (s *HybridLiveSignalStore) GetAll(ctx context.Context, vehicleID int64, preference LiveSignalReadPreference) (map[string]*Value, error) {
	if err := validateLiveSignalContext(ctx); err != nil {
		return nil, err
	}
	if err := validateLiveSignalVehicleID(vehicleID); err != nil {
		return nil, err
	}
	l2 := s.redisCache()
	if preference != LiveSignalReadDistributed || l2 == nil {
		return cloneSignalValues(s.l1.GetAll(vehicleID)), nil
	}

	values, err := l2.GetAllValues(ctx, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("read Redis live signals for vehicle %d: %w", vehicleID, err)
	}
	if len(values) == 0 {
		return cloneSignalValues(s.l1.GetAll(vehicleID)), nil
	}
	return freshSignalValues(values, s.now()), nil
}

// Warm hydrates missing L1 values from Redis when L2 is enabled and available.
func (s *HybridLiveSignalStore) Warm(ctx context.Context, vehicleID int64) error {
	if err := validateLiveSignalContext(ctx); err != nil {
		return err
	}
	if err := validateLiveSignalVehicleID(vehicleID); err != nil {
		return err
	}
	l2 := s.redisCache()
	if l2 == nil {
		return nil
	}

	values, err := l2.GetAllValues(ctx, vehicleID)
	if err != nil {
		return fmt.Errorf("warm live signals from Redis for vehicle %d: %w", vehicleID, err)
	}
	s.hydrateMissingValues(vehicleID, values)
	return nil
}

// LocalVehicleIDs lists vehicle IDs known to the local L1 Store.
func (s *HybridLiveSignalStore) LocalVehicleIDs() []int64 {
	return s.l1.VehicleIDs()
}

func (s *HybridLiveSignalStore) redisCache() *RedisSignalCache {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.mode != LiveSignalStoreModeHybrid {
		return nil
	}
	return s.l2
}

func (s *HybridLiveSignalStore) hydrateMissingValues(vehicleID int64, values map[string]*Value) {
	if len(values) == 0 {
		return
	}
	s.l1.mu.Lock()
	defer s.l1.mu.Unlock()

	signals, ok := s.l1.vehicles[vehicleID]
	if !ok {
		signals = make(map[string]*Value, len(values))
		s.l1.vehicles[vehicleID] = signals
	}
	for name, value := range values {
		if value == nil || value.Raw == nil {
			continue
		}
		// Legacy Redis scalars have unknown freshness; let signal_log hydration fill them.
		if value.Timestamp.IsZero() {
			continue
		}
		if _, exists := signals[name]; exists {
			continue
		}
		signals[name] = cloneSignalValue(value)
	}
}

func validateLiveSignalStoreMode(mode LiveSignalStoreMode) error {
	switch mode {
	case LiveSignalStoreModeHybrid, LiveSignalStoreModeLocal:
		return nil
	default:
		return fmt.Errorf("%w: %q", ErrInvalidLiveSignalStoreMode, mode)
	}
}

func validateLiveSignalContext(ctx context.Context) error {
	if ctx == nil {
		return ErrNilLiveSignalContext
	}
	return nil
}

func validateLiveSignalVehicleID(vehicleID int64) error {
	if vehicleID <= 0 {
		return ErrInvalidLiveSignalVehicleID
	}
	return nil
}

func copyLiveSignalBatch(signals map[string]interface{}) map[string]interface{} {
	copied := make(map[string]interface{}, len(signals))
	for name, value := range signals {
		copied[name] = value
	}
	return copied
}

func cloneSignalValues(values map[string]*Value) map[string]*Value {
	if values == nil {
		return nil
	}
	cloned := make(map[string]*Value, len(values))
	for name, value := range values {
		cloned[name] = cloneSignalValue(value)
	}
	return cloned
}

func cloneSignalValue(value *Value) *Value {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func freshSignalValues(values map[string]*Value, now time.Time) map[string]*Value {
	if len(values) == 0 {
		return nil
	}
	fresh := make(map[string]*Value, len(values))
	for name, value := range values {
		if IsLiveSignalFresh(value, now) {
			fresh[name] = cloneSignalValue(value)
		}
	}
	return fresh
}
