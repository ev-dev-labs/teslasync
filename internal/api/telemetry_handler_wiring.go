package api

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	telemetryfsm "github.com/ev-dev-labs/teslasync/internal/fsm/telemetry"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/signal"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
)

// NewTelemetryHandler creates a handler for fleet telemetry ingestion.
func NewTelemetryHandler(db *database.DB, mc *mqtt.Client, hub *EventHub, staleTimeout time.Duration, geocoder geocoding.Geocoder) *TelemetryHandler {
	var eventBus *events.Bus
	if mc != nil {
		eventBus = events.NewBus(mc.Underlying())
	} else {
		eventBus = events.NewBus(nil)
	}
	if staleTimeout <= 0 {
		staleTimeout = 5 * time.Minute
	}
	bgCtx, bgCancel := context.WithCancel(context.Background())
	return &TelemetryHandler{
		db:             db,
		posRepo:        database.NewPositionRepo(db),
		vehicleRepo:    database.NewVehicleRepo(db),
		swUpdateRepo:   database.NewSoftwareUpdateRepo(db),
		mqttClient:     mc,
		logRepo:        database.NewAPICallLogRepo(db),
		eventHub:       hub,
		sessionTracker: NewTelemetrySessionTracker(db, eventBus, geocoder, nil),
		alertEvaluator: NewTelemetryAlertEvaluator(db, eventBus, hub, func() pahomqtt.Client {
			if mc != nil {
				return mc.Underlying()
			}
			return nil
		}()),
		staleTimeout:          staleTimeout,
		snapshotWriteInterval: 10 * time.Second,
		cleanupInterval:       2 * time.Minute,
		staleSessionTimeout:   5 * time.Minute,
		startTime:             time.Now().UTC(),
		bgCtx:                 bgCtx,
		bgCancel:              bgCancel,
		streamingState:        make(map[string]*VehicleStreamState),
		lastWriteAt:           make(map[string]time.Time),
		accumulatedSignals:    make(map[string]map[string]interface{}),
		connFSMs:              make(map[int64]*telemetryfsm.ConnectionFSM),
		fsmHandler:            NewFSMHandler(database.NewVehicleRepo(db), database.NewFSMTransitionRepo(db)),
	}
}

// SetRawTelemetryRepo enables raw telemetry signal capture to MongoDB.
func (h *TelemetryHandler) SetRawTelemetryRepo(repo *database.RawTelemetryRepo) {
	h.rawTelemetryRepo = repo
}

// SetTimings overrides default telemetry processing intervals.
// Zero values are ignored (defaults are kept).
func (h *TelemetryHandler) SetTimings(snapshotWrite, cleanup, staleSession time.Duration) {
	if snapshotWrite > 0 {
		h.snapshotWriteInterval = snapshotWrite
	}
	if cleanup > 0 {
		h.cleanupInterval = cleanup
	}
	if staleSession > 0 {
		h.staleSessionTimeout = staleSession
	}
}

// SetSignalStore sets the in-memory signal store for real-time state tracking.
func (h *TelemetryHandler) SetSignalStore(store *signal.Store) {
	h.signalStore = store
	if h.sessionTracker != nil {
		h.sessionTracker.localSignals = store
	}
	if store != nil && h.redisCache != nil {
		store.SetRedisCache(h.redisCache)
	}
}

// SetLiveSignalStore sets the live signal boundary used by telemetry ingestion.
func (h *TelemetryHandler) SetLiveSignalStore(store signal.LiveSignalStore) {
	h.liveSignalStore = store
}

// SetRedisCache sets the Redis cache used by SSE Pub/Sub and startup recovery.
// Live-state writes are routed through LiveSignalStore to avoid duplicate HSETs.
func (h *TelemetryHandler) SetRedisCache(cache *signal.RedisSignalCache) {
	h.redisCache = cache
	if h.signalStore != nil {
		h.signalStore.SetRedisCache(cache)
	}
}

// SetEventHub sets the SSE event hub for real-time browser updates.
func (h *TelemetryHandler) SetEventHub(hub *EventHub) {
	h.eventHub = hub
}

// GetSignalStore returns the signal store (for use by other handlers).
func (h *TelemetryHandler) GetSignalStore() *signal.Store {
	return h.signalStore
}

// GetLiveSignalStore returns the live-signal boundary for cross-pod API reads.
func (h *TelemetryHandler) GetLiveSignalStore() signal.LiveSignalStore {
	return h.liveSignalStore
}

// SessionTracker returns the underlying session tracker for backfill tasks.
func (h *TelemetryHandler) SessionTracker() *TelemetrySessionTracker {
	return h.sessionTracker
}

// AlertEvaluator returns the underlying alert evaluator for state recovery.
func (h *TelemetryHandler) AlertEvaluator() *TelemetryAlertEvaluator {
	return h.alertEvaluator
}

// SetSignalLogRepo enables per-signal logging to MongoDB.
func (h *TelemetryHandler) SetSignalLogRepo(repo *database.SignalLogRepo) {
	h.signalLogRepo = repo
}

// SetSignalHistoryWriter enables per-signal history logging to Postgres.
func (h *TelemetryHandler) SetSignalHistoryWriter(w *database.SignalHistoryWriter) {
	h.signalHistoryWriter = w
	if h.sessionTracker != nil {
		h.sessionTracker.signalHistoryWriter = w
	}
}

// FSMHandler returns the FSM handler for status/stats queries.
func (h *TelemetryHandler) FSMHandler() *FSMHandler {
	return h.fsmHandler
}

// SetCaptureEnabled toggles raw telemetry capture on or off.
func (h *TelemetryHandler) SetCaptureEnabled(enabled bool) {
	h.captureEnabled.Store(enabled)
}

// IsCaptureEnabled returns whether raw telemetry capture is currently active.
func (h *TelemetryHandler) IsCaptureEnabled() bool {
	return h.captureEnabled.Load()
}

// StartCleanup runs periodic cleanup of stale streaming state entries
// and stale drive/charge sessions. Call this once at startup; it stops when ctx is cancelled.
func (h *TelemetryHandler) StartCleanup(ctx context.Context) {
	// Run cleanup immediately on startup to close orphaned DB sessions
	if h.sessionTracker != nil {
		h.sessionTracker.CleanupStaleSessions(ctx, 2*h.staleSessionTimeout)
	}

	safeGo("telemetry-cleanup", func() {
		ticker := time.NewTicker(h.cleanupInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.cleanupStaleEntries()
				// Close drive/charge sessions with no signals for 5+ minutes
				if h.sessionTracker != nil {
					h.sessionTracker.CleanupStaleSessions(ctx, h.staleSessionTimeout)
				}
			}
		}
	})

	// Periodic connection FSM timeout checker (every 10s)
	safeGo("conn-fsm-timeout-checker", func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.checkConnFSMTimeouts()
			}
		}
	})
}

// checkConnFSMTimeouts copies FSM pointers under lock, then checks timeouts unlocked.
func (h *TelemetryHandler) checkConnFSMTimeouts() {
	h.connFSMMu.Lock()
	fsms := make([]*telemetryfsm.ConnectionFSM, 0, len(h.connFSMs))
	for _, cfsm := range h.connFSMs {
		fsms = append(fsms, cfsm)
	}
	h.connFSMMu.Unlock()

	for _, cfsm := range fsms {
		cfsm.CheckTimeouts()
	}
}

func (h *TelemetryHandler) cleanupStaleEntries() {
	now := time.Now().UTC()
	cutoff := 3 * h.staleTimeout // remove entries 3x past stale timeout

	// Find stale VINs and mark their vehicles offline
	h.mu.Lock()
	staleVINs := map[string]bool{}
	for vin, state := range h.streamingState {
		if now.Sub(state.LastReceived) > cutoff {
			staleVINs[vin] = true
			delete(h.streamingState, vin)
		}
	}
	h.mu.Unlock()

	// Mark stale vehicles as offline
	if len(staleVINs) > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		for vin := range staleVINs {
			var vehicleID int64
			if err := h.db.Pool.QueryRow(ctx, "SELECT id FROM vehicles WHERE vin = $1", vin).Scan(&vehicleID); err == nil {
				if h.fsmHandler != nil {
					h.fsmHandler.HandleTimeout(ctx, vehicleID)
				}
			}
		}
	}

	h.lastWriteMu.Lock()
	for vin, lastWrite := range h.lastWriteAt {
		if now.Sub(lastWrite) > cutoff {
			delete(h.lastWriteAt, vin)
		}
	}
	h.lastWriteMu.Unlock()

	h.accumulatedSignalsMu.Lock()
	for vin := range h.accumulatedSignals {
		// Clean up accumulated signals for VINs no longer streaming
		h.mu.RLock()
		_, still := h.streamingState[vin]
		h.mu.RUnlock()
		if !still {
			delete(h.accumulatedSignals, vin)
		}
	}
	h.accumulatedSignalsMu.Unlock()

	// Evict connection FSMs for vehicles that have been cleaned up
	h.connFSMMu.Lock()
	for vid, cfsm := range h.connFSMs {
		if cfsm.IsStale() {
			h.mu.RLock()
			_, stillTracked := h.streamingState[cfsm.VIN()]
			h.mu.RUnlock()
			if !stillTracked {
				delete(h.connFSMs, vid)
			}
		}
	}
	h.connFSMMu.Unlock()
}

// Shutdown cancels all background goroutines spawned by the handler.
func (h *TelemetryHandler) Shutdown() {
	h.bgCancel()
}
