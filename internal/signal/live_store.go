package signal

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/metrics"
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
	UpdateValuesNonBlocking(ctx context.Context, vehicleID int64, values map[string]*Value) error
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
	// Stamp the per-vehicle "last seen" timestamp so the telemetry-lag
	// refresher can compute now - lastSeen.
	metrics.RecordSignalReceived(strconv.FormatInt(vehicleID, 10), time.Now())
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
	// Keep telemetry-lag metrics consistent with the blocking update path.
	metrics.RecordSignalReceived(strconv.FormatInt(vehicleID, 10), time.Now())
	l2 := s.redisCache()
	if len(signals) == 0 || l2 == nil {
		return nil
	}

	signalsCopy := copyLiveSignalBatch(signals)
	go func() {
		redisCtx, cancel := context.WithTimeout(contextWithRedisAsync(context.WithoutCancel(ctx)), liveSignalRedisMirrorTimeout)
		defer cancel()
		if err := l2.Update(redisCtx, vehicleID, signalsCopy); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("live signal store: Redis mirror failed")
		}
	}()
	return nil
}

// UpdateValuesNonBlocking preserves each signal's event time in L1 and L2.
// Redis mirroring remains bounded and asynchronous so telemetry ingestion does
// not depend on Redis availability.
func (s *HybridLiveSignalStore) UpdateValuesNonBlocking(ctx context.Context, vehicleID int64, values map[string]*Value) error {
	if err := validateLiveSignalContext(ctx); err != nil {
		return err
	}
	if err := validateLiveSignalVehicleID(vehicleID); err != nil {
		return err
	}
	if values == nil {
		return ErrNilLiveSignalBatch
	}

	s.l1.UpdateValues(vehicleID, values)
	metrics.RecordSignalReceived(strconv.FormatInt(vehicleID, 10), time.Now())
	l2 := s.redisCache()
	if len(values) == 0 || l2 == nil {
		return nil
	}

	valuesCopy := cloneSignalValues(values)
	go func() {
		redisCtx, cancel := context.WithTimeout(contextWithRedisAsync(context.WithoutCancel(ctx)), liveSignalRedisMirrorTimeout)
		defer cancel()
		if err := l2.UpdateValues(redisCtx, vehicleID, valuesCopy); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("live signal store: timestamped Redis mirror failed")
		}
	}()
	return nil
}

// GetSignal reads one live signal from L1 and L2 and returns the merged value
// per the per-signal merge rule (newer non-zero Timestamp wins; legacy
// zero-Timestamp values lose to any non-zero Timestamp; ties prefer L2).
// LiveSignalReadLocal preference and LiveSignalStoreModeLocal mode short-circuit
// to L1 only and never call into Redis. Redis errors in distributed mode are
// surfaced wrapped; an empty L2 result falls back to L1 only.
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

	l1Value := s.l1.Get(vehicleID, name)
	l2Value, err := l2.GetSignalValue(ctx, vehicleID, name)
	if err != nil {
		return nil, fmt.Errorf("read Redis live signal %d/%s: %w", vehicleID, name, err)
	}
	return cloneSignalValue(mergeSignalValues(l1Value, l2Value)), nil
}

// GetAll reads a vehicle's live signals from L1 and L2 and returns the merged
// per-signal map per the per-signal merge rule. L1-only and L2-only signals
// are both retained. Stale and legacy zero-Timestamp L2 values are retained
// (callers use IsLiveSignalFresh to inspect freshness; the read path does not
// drop them). LiveSignalReadLocal preference and LiveSignalStoreModeLocal mode
// short-circuit to L1 only and never call into Redis. Redis errors in
// distributed mode are surfaced wrapped; an empty L2 result falls back to L1.
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

	l2Values, err := l2.GetAllValues(ctx, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("read Redis live signals for vehicle %d: %w", vehicleID, err)
	}
	l1Values := s.l1.GetAll(vehicleID)
	if len(l1Values) == 0 && len(l2Values) == 0 {
		return cloneSignalValues(l1Values), nil
	}
	return mergeSignalMaps(l1Values, l2Values), nil
}

// Warm hydrates missing L1 values from Redis when L2 is enabled and available.
// Before hydration, Warm restamps any legacy scalar Redis entries as full
// envelope values so previously-skipped zero-Timestamp entries can flow into
// L1. If the restamp HSet fails, Warm surfaces the error WITHOUT mutating L1.
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

	if _, err := l2.RestampLegacy(ctx, vehicleID); err != nil {
		return fmt.Errorf("warm live signals from Redis for vehicle %d: %w", vehicleID, err)
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
	s.l1.HydrateValues(vehicleID, values)
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

// mergeSignalValues returns the L1/L2 value that wins per the live-signal
// merge rule:
//   - nil-safe: if either side is nil, the other side wins.
//   - both have non-zero Timestamp: the strictly newer one wins; ties on
//     identical non-zero Timestamps prefer L2 (cross-pod authoritative).
//   - exactly one side has zero Timestamp (legacy unknown freshness): the
//     non-zero side wins regardless of which layer it came from.
//   - both have zero Timestamp: L1 wins (local hot-path observation).
//
// The returned pointer is the chosen layer's value (not cloned); callers that
// expose it across the boundary must clone before mutating.
func mergeSignalValues(l1, l2 *Value) *Value {
	if l1 == nil {
		return l2
	}
	if l2 == nil {
		return l1
	}
	l1Zero := l1.Timestamp.IsZero()
	l2Zero := l2.Timestamp.IsZero()
	switch {
	case l1Zero && l2Zero:
		return l1
	case l1Zero:
		return l2
	case l2Zero:
		return l1
	}
	if l1.Timestamp.After(l2.Timestamp) {
		return l1
	}
	return l2
}

// mergeSignalMaps returns the union of L1 and L2 keys with mergeSignalValues
// applied per signal. Values in the result are clones so the caller cannot
// mutate either layer's storage. Returns nil when both inputs are empty so the
// nil-map contract for unknown vehicles is preserved.
func mergeSignalMaps(l1, l2 map[string]*Value) map[string]*Value {
	if len(l1) == 0 && len(l2) == 0 {
		return nil
	}
	merged := make(map[string]*Value, len(l1)+len(l2))
	for name, v := range l1 {
		merged[name] = cloneSignalValue(v)
	}
	for name, v := range l2 {
		existing, ok := merged[name]
		if !ok {
			merged[name] = cloneSignalValue(v)
			continue
		}
		if mergeSignalValues(existing, v) == v {
			merged[name] = cloneSignalValue(v)
		}
	}
	return merged
}
