package telemetry

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
)

// ConnectionFSM tracks the Fleet Telemetry connection lifecycle for a single vehicle.
// Thread-safe — all methods acquire the internal mutex.
type ConnectionFSM struct {
	mu               sync.Mutex
	state            State
	vehicleID        int64
	vin              string
	lastBatchAt      time.Time
	firstBatchAt     time.Time
	batchCount       int64
	signalCount      int64
	dataSource       string // "fleet_telemetry" or "fleet_api"
	stateEnteredAt   time.Time
	staleThreshold   time.Duration
	offlineThreshold time.Duration

	transRepo  *database.FSMTransitionRepo
	mqttClient *mqtt.Client
	eventBus   *events.Bus
	logger     zerolog.Logger
}

// Option configures a ConnectionFSM.
type Option func(*ConnectionFSM)

// WithStaleThreshold sets the duration after which a streaming connection is considered stale.
func WithStaleThreshold(d time.Duration) Option {
	return func(f *ConnectionFSM) { f.staleThreshold = d }
}

// WithOfflineThreshold sets the duration after which a stale connection is considered disconnected.
func WithOfflineThreshold(d time.Duration) Option {
	return func(f *ConnectionFSM) { f.offlineThreshold = d }
}

// WithTransitionRepo enables logging transitions to the fsm_transitions table.
func WithTransitionRepo(repo *database.FSMTransitionRepo) Option {
	return func(f *ConnectionFSM) { f.transRepo = repo }
}

// WithMQTTClient enables publishing connection state changes to MQTT.
func WithMQTTClient(mc *mqtt.Client) Option {
	return func(f *ConnectionFSM) { f.mqttClient = mc }
}

// WithEventBus enables publishing domain events on stale/disconnected transitions.
func WithEventBus(bus *events.Bus) Option {
	return func(f *ConnectionFSM) { f.eventBus = bus }
}

// WithLogger sets a custom logger for this FSM instance.
func WithLogger(l zerolog.Logger) Option {
	return func(f *ConnectionFSM) { f.logger = l }
}

// New creates a ConnectionFSM for the given vehicle.
func New(vehicleID int64, vin string, opts ...Option) *ConnectionFSM {
	f := &ConnectionFSM{
		state:            Unknown,
		vehicleID:        vehicleID,
		vin:              vin,
		stateEnteredAt:   time.Now().UTC(),
		staleThreshold:   60 * time.Second,
		offlineThreshold: 5 * time.Minute,
		logger:           log.With().Str("component", "telemetry_conn_fsm").Str("vin", vin).Logger(),
	}
	for _, opt := range opts {
		opt(f)
	}
	return f
}

// State returns the current connection state (thread-safe).
func (f *ConnectionFSM) State() State {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.state
}

// VIN returns the vehicle VIN.
func (f *ConnectionFSM) VIN() string {
	return f.vin
}

// StateEnteredAt returns when the FSM entered its current state (thread-safe).
func (f *ConnectionFSM) StateEnteredAt() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.stateEnteredAt
}

// RecordBatch is called on every telemetry signal batch. It updates metrics
// and fires the appropriate state transition based on current state and data source.
func (f *ConnectionFSM) RecordBatch(signalCount int, dataSource string) {
	f.mu.Lock()
	defer f.mu.Unlock()

	now := time.Now().UTC()
	f.lastBatchAt = now
	f.batchCount++
	f.signalCount += int64(signalCount)
	f.dataSource = dataSource

	switch f.state {
	case Unknown:
		f.firstBatchAt = now
		if dataSource == "fleet_api" {
			f.transition(TriggerPollingDetected)
		} else {
			f.transition(TriggerFirstBatch)
		}

	case Connecting:
		f.transition(TriggerBatchReceived)

	case Streaming:
		// Already streaming — just update metrics, no transition needed.

	case Stale, Disconnected:
		f.transition(TriggerReconnected)

	case PollingOnly:
		if dataSource == "fleet_telemetry" {
			f.transition(TriggerStreamingResumed)
		}
	}
}

// CheckTimeouts evaluates whether the connection has gone stale or offline.
// Called periodically (every 10s) by the health monitor goroutine.
func (f *ConnectionFSM) CheckTimeouts() {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.lastBatchAt.IsZero() {
		return
	}

	age := time.Since(f.lastBatchAt)

	switch f.state {
	case Streaming, Connecting:
		if age > f.offlineThreshold {
			f.transition(TriggerOfflineTimeout)
		} else if age > f.staleThreshold {
			f.transition(TriggerStaleTimeout)
		}
	case Stale:
		if age > f.offlineThreshold {
			f.transition(TriggerOfflineTimeout)
		}
	}
}

// IsStale returns true if the FSM is in Stale or Disconnected state.
func (f *ConnectionFSM) IsStale() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.state == Stale || f.state == Disconnected
}

// Snapshot returns a context map suitable for logging in fsm_transitions.
func (f *ConnectionFSM) Snapshot() map[string]interface{} {
	return map[string]interface{}{
		"vin":               f.vin,
		"data_source":       f.dataSource,
		"batch_count":       f.batchCount,
		"signal_count":      f.signalCount,
		"last_batch_age_ms": time.Since(f.lastBatchAt).Milliseconds(),
	}
}

// snapshotLocked returns a snapshot while the mutex is already held.
func (f *ConnectionFSM) snapshotLocked() map[string]interface{} {
	var lastBatchAgeMs int64
	if !f.lastBatchAt.IsZero() {
		lastBatchAgeMs = time.Since(f.lastBatchAt).Milliseconds()
	}
	return map[string]interface{}{
		"vin":               f.vin,
		"data_source":       f.dataSource,
		"batch_count":       f.batchCount,
		"signal_count":      f.signalCount,
		"last_batch_age_ms": lastBatchAgeMs,
	}
}

// transition executes a state change. Must be called with f.mu held.
func (f *ConnectionFSM) transition(trigger Trigger) {
	from := f.state
	to := LookupTransition(f.state, trigger)
	if to == "" {
		return // invalid transition — no-op
	}

	durationInState := time.Since(f.stateEnteredAt).Milliseconds()
	snapshot := f.snapshotLocked()

	f.state = to
	f.stateEnteredAt = time.Now().UTC()

	f.logger.Info().
		Str("from", string(from)).
		Str("to", string(to)).
		Str("trigger", string(trigger)).
		Int64("duration_ms", durationInState).
		Msg("telemetry connection state changed")

	// Async side effects — fire-and-forget to avoid blocking signal pipeline.
	// Per-vehicle transitions are serialized by the mutex, so ordering is preserved.
	vehicleID := f.vehicleID
	vin := f.vin

	if f.transRepo != nil {
		repo := f.transRepo
		details := snapshot
		if details == nil {
			details = map[string]interface{}{}
		}
		details["duration_in_state_ms"] = durationInState
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := repo.Insert(ctx, vehicleID, time.Now(), "telemetry_connection",
				string(from), string(to), string(trigger), details); err != nil {
				log.Warn().Err(err).Int64("vehicle_id", vehicleID).
					Msg("telemetry_conn_fsm: failed to log transition")
			}
		}()
	}

	if f.mqttClient != nil {
		mc := f.mqttClient
		go func() {
			mc.Publish(vin+"/telemetry/connection_state", string(to))
			mc.Publish(vin+"/telemetry/data_source", snapshot["data_source"].(string))
		}()
	}

	if f.eventBus != nil && (to == Stale || to == Disconnected) {
		bus := f.eventBus
		go func() {
			bus.Publish(events.Event{
				Type:      "telemetry." + string(to),
				VehicleID: vehicleID,
				VIN:       vin,
				Data: map[string]interface{}{
					"message": fmt.Sprintf("Fleet Telemetry %s for vehicle %s", to, vin),
				},
			})
		}()
	}
}
