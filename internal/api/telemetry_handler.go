package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/events"
	telemetryfsm "github.com/ev-dev-labs/teslasync/internal/fsm/telemetry"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/telemetry"
	"github.com/rs/zerolog/log"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
)

// TelemetryHandler receives and processes Tesla Fleet Telemetry data.
type TelemetryHandler struct {
	db                    *database.DB
	posRepo               *database.PositionRepo
	vehicleRepo           *database.VehicleRepo
	stateRepo             *database.VehicleStateRepo
	mileageRepo           *database.MileageRepo
	securityRepo          *database.SecurityRepo
	swUpdateRepo          *database.SoftwareUpdateRepo
	signalCatalogRepo     *database.SignalCatalogRepo
	signalObsRepo         *database.SignalObservationRepo
	mqttClient            *mqtt.Client
	logRepo               *database.APICallLogRepo
	eventHub              *EventHub
	sessionTracker        *TelemetrySessionTracker
	alertEvaluator        *TelemetryAlertEvaluator
	staleTimeout          time.Duration
	snapshotWriteInterval time.Duration
	cleanupInterval       time.Duration
	staleSessionTimeout   time.Duration
	signalStore           *signal.Store
	startTime             time.Time

	// Cancellable context for background goroutines ╬ô├ç├╢ cancelled on Shutdown()
	bgCtx    context.Context
	bgCancel context.CancelFunc

	// Per-vehicle streaming health tracking
	mu             sync.RWMutex
	streamingState map[string]*VehicleStreamState // keyed by VIN

	// Per-vehicle write throttling to prevent DB overload
	lastWriteMu sync.Mutex
	lastWriteAt map[string]time.Time // keyed by VIN

	// Per-vehicle signal accumulator ╬ô├ç├╢ merges signals across batches within throttle window
	accumulatedSignalsMu sync.Mutex
	accumulatedSignals   map[string]map[string]interface{} // keyed by VIN

	// FSM-based vehicle state tracking
	fsmHandler *FSMHandler

	// Raw telemetry capture (optional, backed by MongoDB)
	rawTelemetryRepo *database.RawTelemetryRepo
	captureEnabled   atomic.Bool

	// Per-signal logging to MongoDB (optional)
	signalLogRepo *database.SignalLogRepo

	// Per-signal history to Postgres (signal_history table)
	signalHistoryWriter *database.SignalHistoryWriter

	// Per-vehicle Fleet Telemetry connection FSM
	connFSMMu sync.Mutex
	connFSMs  map[int64]*telemetryfsm.ConnectionFSM // keyed by vehicleID

	// Domain event bus for publishing state change events
	eventBus *events.Bus

	// Redis write-through cache for signal values (fire-and-forget)
	redisCache *signal.RedisSignalCache
}

// VehicleStreamState tracks streaming health per vehicle.
type VehicleStreamState struct {
	VIN              string                 `json:"vin"`
	LastReceived     time.Time              `json:"last_received"`
	FirstReceived    time.Time              `json:"first_received"`
	SignalCount      int64                  `json:"signal_count"`
	BatchCount       int64                  `json:"batch_count"`
	IsStreaming      bool                   `json:"is_streaming"`
	DataSource       string                 `json:"data_source"`        // "fleet_telemetry" or "fleet_api"
	SignalsPerSecond float64                `json:"signals_per_second"` // rolling throughput
	LatencyMs        int64                  `json:"latency_ms"`         // age of data in milliseconds
	UptimeSeconds    float64                `json:"uptime_seconds"`     // how long vehicle has been streaming
	LastSignals      map[string]interface{} `json:"last_signals,omitempty"`
}

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
		db:                    db,
		posRepo:               database.NewPositionRepo(db),
		vehicleRepo:           database.NewVehicleRepo(db),
		stateRepo:             database.NewVehicleStateRepo(db),
		mileageRepo:           database.NewMileageRepo(db),
		securityRepo:          database.NewSecurityRepo(db),
		swUpdateRepo:          database.NewSoftwareUpdateRepo(db),
		signalCatalogRepo:     database.NewSignalCatalogRepo(db),
		signalObsRepo:         database.NewSignalObservationRepo(db),
		mqttClient:            mc,
		logRepo:               database.NewAPICallLogRepo(db),
		eventHub:              hub,
		sessionTracker:        NewTelemetrySessionTracker(db, eventBus, geocoder, nil),
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
		fsmHandler:            NewFSMHandler(database.NewVehicleStateRepo(db), database.NewVehicleRepo(db), database.NewFSMTransitionRepo(db)),
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
		h.sessionTracker.signalStore = store
	}
	if h.redisCache != nil {
		store.SetRedisCache(h.redisCache)
	}
}

// SetRedisCache sets the Redis write-through cache for signal values.
// When set, signal updates are mirrored to Redis HSET in a fire-and-forget goroutine.
// Also forwards the cache to the signal store for Redis-first startup recovery.
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

type telemetrySignal struct {
	Name      string      `json:"name"`
	Value     interface{} `json:"value"`
	Timestamp string      `json:"timestamp"`
}

type telemetryPayload struct {
	VIN       string                 `json:"vin"`
	CreatedAt string                 `json:"created_at"`
	Data      map[string]interface{} `json:"data"`
	Signals   []telemetrySignal      `json:"signals"`
}

// GetStreamingState returns streaming health for all vehicles with computed metrics.
func (h *TelemetryHandler) GetStreamingState() map[string]*VehicleStreamState {
	h.mu.RLock()
	defer h.mu.RUnlock()
	now := time.Now().UTC()
	result := make(map[string]*VehicleStreamState, len(h.streamingState))
	for k, v := range h.streamingState {
		cp := *v
		cp.IsStreaming = now.Sub(v.LastReceived) < h.staleTimeout
		cp.LatencyMs = now.Sub(v.LastReceived).Milliseconds()
		if !v.FirstReceived.IsZero() {
			cp.UptimeSeconds = now.Sub(v.FirstReceived).Seconds()
			elapsed := now.Sub(v.FirstReceived).Seconds()
			if elapsed > 0 {
				cp.SignalsPerSecond = float64(v.SignalCount) / elapsed
			}
		}
		if cp.IsStreaming {
			cp.DataSource = "fleet_telemetry"
		} else {
			cp.DataSource = "fleet_api"
		}
		result[k] = &cp
	}
	return result
}

// IsVehicleStreaming returns true if a vehicle has received telemetry within the stale timeout.
func (h *TelemetryHandler) IsVehicleStreaming(vin string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	state, ok := h.streamingState[vin]
	if !ok {
		return false
	}
	return time.Since(state.LastReceived) < h.staleTimeout
}

// ProcessSignals is the core telemetry processing pipeline. It stores position
// data in PostgreSQL, broadcasts to SSE clients, detects drive/charge sessions,
// tracks vehicle state transitions, updates daily mileage, stores tire pressure,
// and evaluates alert rules. When publishToMQTT is true, signals are also
// published to MQTT topics (used by the HTTP endpoint). When called from the
// MQTT subscriber, publishToMQTT should be false to avoid a publish loop.
func (h *TelemetryHandler) ProcessSignals(ctx context.Context, vin string, signals map[string]interface{}, publishToMQTT bool) {
	metrics.TelemetryMessagesReceived.Inc()

	// Raw telemetry capture ╬ô├ç├╢ async insert to MongoDB when enabled (before normalization)
	if h.captureEnabled.Load() && h.rawTelemetryRepo != nil {
		source := "mqtt_subscriber"
		if publishToMQTT {
			source = "http_ingest"
		}
		// Copy the signals map to avoid concurrent read/write with normalizeFleetUnits
		rec := &models.RawTelemetrySignal{
			VIN:         vin,
			Source:      source,
			SignalCount: len(signals),
		}
		safeGo("raw-telemetry-insert", func() {
			captureCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := h.rawTelemetryRepo.Insert(captureCtx, rec); err != nil {
				log.Warn().Err(err).Str("vin", vin).Msg("telemetry: failed to capture raw signals")
			}
		})
	}

	// Normalize fleet telemetry units to metric. Tesla Fleet Telemetry sends
	// speed in mph, distances/ranges in miles, but the system stores in km/kmΓö¼Γòûh
	// so the frontend conversion layer works consistently.
	normalizeFleetUnits(signals)

	// Canonicalize signal names — handle Tesla renames via alias registry.
	// Must run before any consumer (SignalStore, Redis, history writer, FSM)
	// so all downstream code sees canonical names only.
	telemetry.CanonicalizeMap(signals)

	// Find vehicle by VIN (needed for SignalStore keying and all downstream)
	var vehicleID int64
	err := h.db.Pool.QueryRow(ctx, "SELECT id FROM vehicles WHERE vin = $1", vin).Scan(&vehicleID)
	if err != nil {
		log.Warn().Err(err).Str("vin", vin).Msg("telemetry: vehicle not found or DB error")
	}

	// Update in-memory SignalStore — always complete, never has null fields.
	// This is the primary source of truth for dashboard, state machine, and sessions.
	if vehicleID > 0 && h.signalStore != nil {
		h.signalStore.Update(vehicleID, signals)
	}

	// Mirror to Redis HSET (fire-and-forget, non-blocking)
	if vehicleID > 0 && h.redisCache != nil {
		redisCopy := make(map[string]interface{}, len(signals))
		for k, v := range signals {
			redisCopy[k] = v
		}
		safeGo("redis-signal-cache", func() {
			redisCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			h.redisCache.Update(redisCtx, vehicleID, redisCopy)
		})
	}

	// Log every signal to MongoDB for full history (async, non-blocking)
	if vehicleID > 0 && h.signalLogRepo != nil {
		// Copy map to avoid concurrent map read/write with the goroutine
		signalsCopy := make(map[string]interface{}, len(signals))
		for k, v := range signals {
			signalsCopy[k] = v
		}
		safeGo("signal-log-mongodb", func() {
			logCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := h.signalLogRepo.WriteBatch(logCtx, vehicleID, signalsCopy); err != nil {
				log.Warn().Err(err).Str("vin", vin).Msg("telemetry: failed to log signals to MongoDB")
			}
		})
	}

	// Log every signal to Postgres signal_history (buffered, non-blocking)
	if vehicleID > 0 && h.signalHistoryWriter != nil {
		h.signalHistoryWriter.Append(vehicleID, signals)
	}

	// Position writing is deferred to the accumulated/throttled write path below
	// so that per-vehicle signal batches are merged before storing. This prevents
	// thousands of sparse positions (93% with odometer=0, battery=0) when Tesla
	// Fleet Telemetry sends each signal as a separate MQTT message.

	// Publish signals to MQTT only when called from the HTTP endpoint.
	// When called from the MQTT subscriber, fleet-telemetry already published.
	if publishToMQTT && h.mqttClient != nil {
		for name, val := range signals {
			switch v := val.(type) {
			case float64:
				h.mqttClient.Publish(vin+"/"+name, formatFloat(v))
			case string:
				h.mqttClient.Publish(vin+"/"+name, v)
			case bool:
				if v {
					h.mqttClient.Publish(vin+"/"+name, "true")
				} else {
					h.mqttClient.Publish(vin+"/"+name, "false")
				}
			case map[string]interface{}:
				if lat, ok := v["latitude"]; ok {
					h.mqttClient.Publish(vin+"/"+name+"_latitude", formatFloat(toFloat(lat)))
				}
				if lng, ok := v["longitude"]; ok {
					h.mqttClient.Publish(vin+"/"+name+"_longitude", formatFloat(toFloat(lng)))
				}
			}
		}
	}

	// Broadcast to SSE clients for real-time frontend updates using the typed
	// per-table wire format. We re-run the legacy map batch through the same
	// flatten/bucket/hot-row pipeline ProcessBatch uses, so both write-paths
	// publish an identical shape: {vehicle_id, ts, tables:{<table>:{<col>:<val>}},
	// cold:[{name,value}]}. No raw map / legacy jsonb fields are emitted.
	if h.eventHub != nil && vehicleID > 0 {
		named := make([]telemetry.NamedValue, 0, len(signals))
		for k, v := range signals {
			named = append(named, telemetry.NamedValue{Name: k, Value: v})
		}
		atomics := make([]telemetry.Atomic, 0, len(named)*2)
		for _, nv := range named {
			flat, ferr := telemetry.Flatten(nv.Name, nv.Value)
			if ferr != nil {
				continue
			}
			atomics = append(atomics, flat...)
		}
		bk := bucketAtomics(atomics)
		ts := time.Now().UTC()
		hotRows := map[string]map[string]any{}
		for table, items := range bk.HotByTable {
			row := h.buildHotRow(table, items, &bk.Cold)
			if len(row) > 0 {
				hotRows[table] = row
			}
		}
		coldObs := h.buildColdObservations(vehicleID, ts, bk.Cold)
		h.broadcastSSE(buildSSEPayload(vehicleID, ts, hotRows, coldObs))
	}

	// Update streaming health state
	h.mu.Lock()
	state, ok := h.streamingState[vin]
	if !ok {
		state = &VehicleStreamState{VIN: vin, FirstReceived: time.Now().UTC()}
		h.streamingState[vin] = state
	}
	state.LastReceived = time.Now().UTC()
	state.SignalCount += int64(len(signals))
	state.BatchCount++
	state.IsStreaming = true
	state.DataSource = "fleet_telemetry"
	last := make(map[string]interface{}, len(signals))
	for k, v := range signals {
		last[k] = v
	}
	state.LastSignals = last
	h.mu.Unlock()

	// Update Fleet Telemetry connection FSM
	if vehicleID > 0 {
		h.connFSMMu.Lock()
		cfsm, ok := h.connFSMs[vehicleID]
		if !ok {
			cfsm = telemetryfsm.New(vehicleID, vin,
				telemetryfsm.WithTransitionRepo(database.NewFSMTransitionRepo(h.db)),
				telemetryfsm.WithMQTTClient(h.mqttClient),
				telemetryfsm.WithEventBus(h.eventBus),
			)
			h.connFSMs[vehicleID] = cfsm
		}
		h.connFSMMu.Unlock()
		cfsm.RecordBatch(len(signals), "fleet_telemetry")
	}

	// Drive/charge session detection from streaming signals.
	// Pass the handler's accumulated signals so the session tracker can use
	// last-known values (battery, odometer, location) when starting new sessions ╬ô├ç├╢
	// the current batch may only contain VehicleSpeed.
	if vehicleID > 0 {
		h.accumulatedSignalsMu.Lock()
		accum := make(map[string]interface{})
		for k, v := range h.accumulatedSignals[vin] {
			accum[k] = v
		}
		h.accumulatedSignalsMu.Unlock()

		h.sessionTracker.ProcessSignals(ctx, vehicleID, vin, signals, accum)
		h.alertEvaluator.Evaluate(ctx, vehicleID, vin, signals, accum)
	}

	// --- FSM-based vehicle state tracking ---
	// The FSM processes every signal batch. Gear signals cause immediate transitions;
	// speed-based fallback uses debounce internally. All transitions write to DB.
	if vehicleID > 0 && h.fsmHandler != nil {
		signalsCopy := make(map[string]interface{}, len(signals))
		for k, v := range signals {
			signalsCopy[k] = v
		}
		safeGo("fsm-state-transition", func() {
			bgCtx, cancel := context.WithTimeout(h.bgCtx, 15*time.Second)
			defer cancel()

			h.fsmHandler.ProcessSignals(bgCtx, vehicleID, signalsCopy)
			metrics.FSMDispatchTotal.WithLabelValues("ok").Inc()
		})
	}

	// --- Async writes: state tracking, mileage, tire pressure, vehicle health ---
	// Throttle snapshot writes to once every 10 seconds per vehicle to prevent
	// DB connection pool exhaustion from high-frequency telemetry batches.
	// Signals are accumulated across batches within the throttle window so that
	// individual MQTT messages don't cause data loss.
	if vehicleID > 0 {
		snapshotWriteInterval := h.snapshotWriteInterval

		// Accumulate signals from this batch
		h.accumulatedSignalsMu.Lock()
		if h.accumulatedSignals[vin] == nil {
			h.accumulatedSignals[vin] = make(map[string]interface{})
		}
		for k, v := range signals {
			h.accumulatedSignals[vin][k] = v
		}
		h.accumulatedSignalsMu.Unlock()

		h.lastWriteMu.Lock()
		lastWrite := h.lastWriteAt[vin]
		isFirstSignal := lastWrite.IsZero()
		shouldWrite := !isFirstSignal && time.Since(lastWrite) >= snapshotWriteInterval
		if isFirstSignal {
			// First signal for this vehicle ╬ô├ç├╢ start the throttle timer but don't write yet.
			// Let the accumulator collect signals for the full interval first.
			h.lastWriteAt[vin] = time.Now().UTC()
		} else if shouldWrite {
			h.lastWriteAt[vin] = time.Now().UTC()
		}
		h.lastWriteMu.Unlock()

		safeGo("snapshot-writes", func() {
			bgCtx, cancel := context.WithTimeout(h.bgCtx, 30*time.Second)
			defer cancel()

			// Drain accumulated signals for this write cycle, merging with
			// SignalStore context so change-only signals (Gear, Locked, etc.)
			// are carried forward between drain cycles.
			var writeSignals map[string]interface{}
			if shouldWrite {
				h.accumulatedSignalsMu.Lock()
				batchSignals := h.accumulatedSignals[vin]
				h.accumulatedSignals[vin] = make(map[string]interface{})
				h.accumulatedSignalsMu.Unlock()

				// Start with full SignalStore context (last-known-good for ALL signals),
				// then overlay the fresh batch on top (fresh values win).
				if h.signalStore != nil && vehicleID > 0 {
					base := h.signalStore.GetRawMap(vehicleID)
					if base != nil {
						for k, v := range batchSignals {
							base[k] = v
						}
						writeSignals = base
					} else {
						writeSignals = batchSignals
					}
				} else {
					writeSignals = batchSignals
				}
			}

			// Throttled snapshot writes ╬ô├ç├╢ only run every 10s per vehicle
			if !shouldWrite || writeSignals == nil {
				return
			}

			// Update daily mileage from odometer readings
			h.trackMileage(bgCtx, vehicleID, writeSignals)

			// Store security events
			h.trackSecurity(bgCtx, vehicleID, writeSignals)

			// Store vehicle config snapshots
			h.trackVehicleConfig(bgCtx, vehicleID, writeSignals)

			// Update vehicle_units with car display preferences
			h.trackUserPreferences(bgCtx, vehicleID, writeSignals)

			// Store accumulated position ╬ô├ç├╢ uses merged signals so fields like
			// odometer, battery, location, speed are all populated from different
			// MQTT batches within the 10s accumulation window.
			if pos := h.extractPosition(writeSignals); pos != nil {
				pos.VehicleID = vehicleID
				pos.Ts = time.Now().UTC()
				pos.Source = "fleet_telemetry"
				if err := h.posRepo.BulkInsert(bgCtx, []models.Position{*pos}); err != nil {
					log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store accumulated position")
				}
			}
		})
	}
}
func (h *TelemetryHandler) trackMileage(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	odomVal, ok := signals["Odometer"]
	if !ok {
		return
	}
	odometer, odOk := toFloatOk(odomVal)
	if !odOk || odometer <= 0 {
		return
	}
	if err := h.mileageRepo.UpsertDaily(ctx, vehicleID, odometer); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to upsert daily mileage")
	}
}

// trackTirePressure stores tire pressure snapshots when TPMS signals arrive.

// StreamingVINs returns the set of VINs currently receiving live telemetry data.
func (h *TelemetryHandler) StreamingVINs() map[string]bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	result := make(map[string]bool, len(h.streamingState))
	for vin, state := range h.streamingState {
		if time.Since(state.LastReceived) < h.staleTimeout {
			result[vin] = true
		}
	}
	return result
}

// GetStaleVINs returns VINs that were previously streaming but have not received
// any telemetry signals within the stale timeout. These vehicles should be polled
// via the Tesla Fleet API as a fallback.
func (h *TelemetryHandler) GetStaleVINs() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	var stale []string
	for vin, state := range h.streamingState {
		if time.Since(state.LastReceived) >= h.staleTimeout {
			stale = append(stale, vin)
		}
	}
	return stale
}

// TelemetryIngest receives Fleet Telemetry data via HTTP POST.
// This endpoint is used when fleet-telemetry dispatches via the HTTP dispatcher.
// It delegates to ProcessSignals with publishToMQTT=true.
func (h *TelemetryHandler) TelemetryIngest(w http.ResponseWriter, r *http.Request) {
	start := time.Now().UTC()
	var payload telemetryPayload

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid telemetry payload")
		return
	}

	log.Debug().
		Str("vin", payload.VIN).
		Int("signals", len(payload.Signals)).
		Msg("telemetry data received via HTTP")

	// Build the signal map for downstream consumers. We first walk
	// payload.Signals in Tesla emission order, normalize that ordered
	// batch via telemetry.NormalizeFleetUnits, then merge into a map
	// for the legacy map-based ProcessSignals pipeline. ProcessSignals
	// will run normalization again as a safety net for the MQTT path,
	// which is idempotent for these per-signal transforms.
	ordered := make([]telemetry.NamedValue, 0, len(payload.Signals))
	for _, sig := range payload.Signals {
		ordered = append(ordered, telemetry.NamedValue{Name: sig.Name, Value: sig.Value})
	}
	ordered = telemetry.NormalizeFleetUnits(ordered)

	signals := make(map[string]interface{}, len(ordered)+len(payload.Data))
	for _, nv := range ordered {
		signals[nv.Name] = nv.Value
	}

	// Also merge payload.Data (Fleet Telemetry server may use either format)
	for k, v := range payload.Data {
		if _, exists := signals[k]; !exists {
			signals[k] = v
		}
	}

	// Process with MQTT publishing enabled (HTTP dispatcher path)
	h.ProcessSignals(r.Context(), payload.VIN, signals, true)

	// Log the ingest (sampled ╬ô├ç├╢ only log every 100th to avoid flooding)
	h.mu.RLock()
	state := h.streamingState[payload.VIN]
	h.mu.RUnlock()
	if state != nil && state.SignalCount%100 == 0 {
		durationMs := int(time.Since(start).Milliseconds())
		statusCode := http.StatusOK
		logEntry := &models.APICallLog{
			HTTPMethod: "POST",
			Endpoint:   fmt.Sprintf("/api/v1/telemetry (VIN: %s)", payload.VIN),
			StatusCode: int16(statusCode),
			DurationMs: int32(durationMs),
			Service:    "fleet_telemetry",
		}
		_ = h.logRepo.Create(r.Context(), logEntry)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "accepted",
		"signals": len(signals),
		"vin":     payload.VIN,
	})
}

// extractPosition builds a Position from available telemetry signals.
func (h *TelemetryHandler) extractPosition(signals map[string]interface{}) *models.Position {
	pos := &models.Position{}
	hasLocation := false

	// Location ╬ô├ç├╢ may come as Location object or separate Latitude/Longitude
	if loc, ok := signals["Location"].(map[string]interface{}); ok {
		if lat, lok := toFloatOk(loc["latitude"]); lok {
			pos.Latitude = lat
			hasLocation = true
		}
		if lng, lok := toFloatOk(loc["longitude"]); lok {
			pos.Longitude = lng
			hasLocation = true
		}
	}
	if v, ok := signals["Latitude"]; ok {
		if f, fok := toFloatOk(v); fok {
			pos.Latitude = f
			hasLocation = true
		}
	}
	if v, ok := signals["Longitude"]; ok {
		if f, fok := toFloatOk(v); fok {
			pos.Longitude = f
			hasLocation = true
		}
	}

	if !hasLocation {
		// No GPS — skip position. Battery/temp/speed are already persisted in
		// vehicle_live_state and signal_history; writing 0,0 coordinates here
		// pollutes the positions table and breaks map/route queries.
		return nil
	}

	// Driving signals
	if v, ok := signals["VehicleSpeed"]; ok {
		if f, fok := toFloatOk(v); fok {
			pos.SpeedMph = &f
		}
	}
	if v, ok := signals["GpsHeading"]; ok {
		if f, fok := toFloatOk(v); fok {
			i16 := int16(f)
			pos.Heading = &i16
		}
	} else if v, ok := signals["Heading"]; ok {
		if f, fok := toFloatOk(v); fok {
			i16 := int16(f)
			pos.Heading = &i16
		}
	}

	// Elevation
	if v, ok := signals["Elevation"]; ok {
		if f, fok := toFloatOk(v); fok {
			pos.ElevationM = &f
		}
	}

	return pos
}

// TelemetryStatus returns the telemetry endpoint configuration and streaming health.
func (h *TelemetryHandler) TelemetryStatus(w http.ResponseWriter, r *http.Request) {
	streamingVehicles := h.GetStreamingState()
	connected := h.mqttClient != nil && h.mqttClient.IsConnected()

	// Build vehicles map keyed by VIN (frontend expects Record<string, VehicleStreamState>)
	vehicleMap := make(map[string]interface{}, len(streamingVehicles))
	var totalSignals int64
	var totalBatches int64
	var avgRate float64
	var streamingCount int

	// Index connection FSMs by VIN for enriching the status response
	h.connFSMMu.Lock()
	connFSMByVIN := make(map[string]*telemetryfsm.ConnectionFSM, len(h.connFSMs))
	for _, cfsm := range h.connFSMs {
		connFSMByVIN[cfsm.VIN()] = cfsm
	}
	h.connFSMMu.Unlock()
	for vin, v := range streamingVehicles {
		entry := map[string]interface{}{
			"vin":                v.VIN,
			"last_received":      v.LastReceived,
			"first_received":     v.FirstReceived,
			"signal_count":       v.SignalCount,
			"batch_count":        v.BatchCount,
			"is_streaming":       v.IsStreaming,
			"data_source":        v.DataSource,
			"signals_per_second": v.SignalsPerSecond,
			"latency_ms":         v.LatencyMs,
			"uptime_seconds":     v.UptimeSeconds,
		}
		if cfsm, ok := connFSMByVIN[vin]; ok {
			entry["connection_fsm_state"] = string(cfsm.State())
			entry["state_since"] = cfsm.StateEnteredAt()
			entry["state_duration"] = time.Since(cfsm.StateEnteredAt()).String()
		}
		vehicleMap[vin] = entry
		totalSignals += v.SignalCount
		totalBatches += v.BatchCount
		avgRate += v.SignalsPerSecond
		if v.IsStreaming {
			streamingCount++
		}
	}

	// Broker URL and topic patterns from MQTT client
	var broker string
	var topics []string
	if h.mqttClient != nil {
		broker = h.mqttClient.BrokerURL()
		prefix := h.mqttClient.Prefix()
		if prefix != "" {
			topics = []string{prefix + "/+/v/#"}
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"enabled":            true,
		"connected":          connected,
		"broker":             broker,
		"uptime_seconds":     time.Since(h.startTime).Seconds(),
		"topics":             topics,
		"mode":               "fleet_telemetry",
		"endpoint":           "/api/v1/telemetry",
		"protocol":           "MQTT + HTTP",
		"mqtt_publishing":    connected,
		"vehicles":           vehicleMap,
		"streaming_vehicles": vehicleMap,
		"aggregate_stats": map[string]interface{}{
			"streaming_vehicles":      streamingCount,
			"total_vehicles_seen":     len(streamingVehicles),
			"total_signals_received":  totalSignals,
			"total_batches_processed": totalBatches,
			"avg_signals_per_second":  fmt.Sprintf("%.2f", avgRate),
			"stale_timeout":           h.staleTimeout.String(),
		},
	})
}

// ProcessBatch is the new slice-oriented write-path entrypoint that will
// eventually replace the map-based ProcessSignals pipeline. It accepts an
// ordered batch of telemetry.NamedValue (decoded in Tesla emission order)
// and walks it through normalize -> flatten -> bucket -> persist stages.
//
// This method is being assembled incrementally across the db-refactor
// prompts. Today it covers stages 1-2 (normalize + flatten); subsequent
// prompts add hot-route bucketing and per-table writers.
func (h *TelemetryHandler) ProcessBatch(ctx context.Context, vin string, decoded []telemetry.NamedValue) error {
	startedAt := time.Now()
	// Resolve vehicle by VIN up-front so downstream stages (FSM hooks, hot/cold
	// writers) all share the same identity columns. A missing vehicle is fatal
	// for this batch — without an FK we cannot persist anything.
	veh, err := h.vehicleRepo.GetByVIN(ctx, vin)
	if err != nil || veh == nil {
		log.Warn().Err(err).Str("vin", vin).Msg("ProcessBatch: vehicle not found; dropping batch")
		return nil
	}
	vehicleID := veh.ID
	ts := time.Now().UTC()

	normalized := telemetry.NormalizeFleetUnits(decoded)

	atomics := make([]telemetry.Atomic, 0, len(normalized)*2)
	var flattenErrs int
	for _, nv := range normalized {
		flat, err := telemetry.Flatten(nv.Name, nv.Value)
		if err != nil {
			flattenErrs++
			log.Warn().
				Err(err).
				Str("signal", nv.Name).
				Msg("flatten failed; skipping signal")
			continue
		}
		atomics = append(atomics, flat...)
	}
	log.Debug().
		Int("normalized", len(normalized)).
		Int("atomics", len(atomics)).
		Int("flatten_errors", flattenErrs).
		Msg("flatten step complete")

	buckets := bucketAtomics(atomics)
	log.Debug().
		Int("hot_tables", len(buckets.HotByTable)).
		Int("cold_atomics", len(buckets.Cold)).
		Msg("bucket step complete")

	// Catalog upsert: dedupe AllNames in-place (stable order) and register
	// every observed signal name in signal_catalog before any cold inserts
	// so the signal_observations FK resolves. Single round-trip per batch.
	seen := make(map[string]struct{}, len(buckets.AllNames))
	unique := buckets.AllNames[:0]
	for _, n := range buckets.AllNames {
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		unique = append(unique, n)
	}
	newCount, err := h.signalCatalogRepo.BulkUpsertObserved(ctx, unique)
	if err != nil {
		log.Error().Err(fmt.Errorf("catalog upsert: %w", err)).
			Str("vin", vin).
			Int("unique_names", len(unique)).
			Msg("catalog upsert failed; aborting batch")
		return fmt.Errorf("catalog upsert: %w", err)
	}
	log.Debug().
		Int("unique_names", len(unique)).
		Int("new_names", newCount).
		Msg("catalog upsert complete")

	hotRows := map[string]map[string]any{}
	for table, items := range buckets.HotByTable {
		hotRows[table] = h.buildHotRow(table, items, &buckets.Cold)
	}
	log.Debug().
		Int("hot_rows", len(hotRows)).
		Int("cold_atomics_after_transform", len(buckets.Cold)).
		Msg("hot row build step complete")

	coldObs := h.buildColdObservations(vehicleID, ts, buckets.Cold)
	log.Debug().
		Int("cold_observations", len(coldObs)).
		Msg("cold observation build step complete")

	// FSM hooks — fire AFTER the bucket/transform step but BEFORE write fan-out
	// so connection-state, drive, charge, and automation rule FSMs see every
	// batch in arrival order. Order with writes matters (prompt 27): if writes
	// were to fail, the FSM has already observed the transition and follow-up
	// batches will keep its state coherent.
	//
	// 1. Connection FSM: per-vehicle health/staleness tracker. Lookup is guarded
	//    by connFSMMu; the map is initialized in NewTelemetryHandler (e516fef
	//    nil-map regression guard).
	if vehicleID > 0 {
		h.connFSMMu.Lock()
		cfsm, ok := h.connFSMs[vehicleID]
		if !ok {
			cfsm = telemetryfsm.New(vehicleID, vin,
				telemetryfsm.WithTransitionRepo(database.NewFSMTransitionRepo(h.db)),
				telemetryfsm.WithMQTTClient(h.mqttClient),
				telemetryfsm.WithEventBus(h.eventBus),
			)
			h.connFSMs[vehicleID] = cfsm
		}
		h.connFSMMu.Unlock()
		cfsm.RecordBatch(len(atomics), "fleet_telemetry")
	}

	// 2. Vehicle/drive/charge FSM: feed it the same atomic stream the buckets
	//    were built from, adapted to the legacy map shape its trackStateTransition
	//    / commitStateTransition logic still expects. FSM internals are unchanged.
	if vehicleID > 0 && h.fsmHandler != nil {
		fsmSignals := make(map[string]interface{}, len(atomics))
		for _, a := range atomics {
			fsmSignals[a.Name] = a.Value
		}
		h.fsmHandler.ProcessSignals(ctx, vehicleID, fsmSignals)
	}

	// Fan-out: dispatch each populated hot row to its per-table repo, then the
	// cold residue to signal_observations. Errors are aggregated (not returned)
	// so a slow/failing table does not lose writes destined for sibling tables;
	// terminal handling of writeErrs is layered in the next prompt (28).
	type writeErr struct {
		table string
		err   error
	}
	var writeErrs []writeErr
	dispatch := func(table string, fn func() error) {
		if err := fn(); err != nil {
			writeErrs = append(writeErrs, writeErr{table, err})
		}
	}
	for table, row := range hotRows {
		if len(row) == 0 {
			continue
		}
		switch table {
		case "positions":
			dispatch(table, func() error {
				return h.posRepo.InsertFromMap(ctx, vehicleID, ts, row)
			})
		case "security_events":
			dispatch(table, func() error {
				return h.securityRepo.InsertFromMap(ctx, vehicleID, ts, row)
			})
		default:
			// Tables whose repos were removed (vehicle_live_state, charging_telemetry,
			// climate_snapshots, motor_snapshots, vehicle_meta_snapshots) are silently
			// skipped — their signals already land in signal_log via signalHistoryWriter.
		}
	}
	if len(coldObs) > 0 {
		dispatch("signal_observations", func() error {
			return h.signalObsRepo.BulkInsert(ctx, coldObs)
		})
	}

	// Typed-tables SSE broadcast (Phase 6 wire format). Frontend SSE consumer
	// rewrite to read `tables.<name>.<column>` is Phase 7's responsibility.
	// Uses Redis Pub/Sub when available for multi-pod delivery.
	h.broadcastSSE(buildSSEPayload(vehicleID, ts, hotRows, coldObs))

	total := len(hotRows) + boolToInt(len(coldObs) > 0)
	failed := len(writeErrs)

	for _, we := range writeErrs {
		log.Error().
			Err(we.err).
			Str("table", we.table).
			Msg("telemetry write failed")
	}

	log.Info().
		Str("vin", vin).
		Int64("vehicle_id", vehicleID).
		Int("normalized", len(normalized)).
		Int("atomics", len(atomics)).
		Int("hot_writes", len(hotRows)).
		Int("cold_writes", len(coldObs)).
		Int("write_failures", failed).
		Dur("duration", time.Since(startedAt)).
		Msg("telemetry batch processed")

	if total > 0 && failed == total {
		return fmt.Errorf("all %d write targets failed (systemic)", total)
	}
	return nil
}

// boolToInt returns 1 when b is true, else 0. Used to count the cold-write
// target as one of the batch's total write targets without inflating the hot
// row count.
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// pickValue returns the populated value_* field of a SignalObservation, or nil.
// Cold observations have exactly one of ValueNumeric/ValueText/ValueBool set.
func pickValue(o models.SignalObservation) any {
	switch {
	case o.ValueNumeric != nil:
		return *o.ValueNumeric
	case o.ValueText != nil:
		return *o.ValueText
	case o.ValueBool != nil:
		return *o.ValueBool
	default:
		return nil
	}
}

// buildSSEPayload assembles the Phase-6 typed-tables SSE payload from the
// already-built hot rows and cold observations. Wire shape:
//
//	{ vehicle_id, ts, tables: {<table>: {<col>: <val>}}, cold: [{name, value}] }
//
// Empty hot rows are skipped; cold is omitted entirely when there are no
// observations. The frontend (Phase 7) reads tables.<name>.<column> instead of
// the legacy raw_state/signals jsonb shape.
func buildSSEPayload(vehicleID int64, ts time.Time, hotRows map[string]map[string]any, coldObs []models.SignalObservation) map[string]any {
	tables := map[string]map[string]any{}
	for table, row := range hotRows {
		if len(row) == 0 {
			continue
		}
		tables[table] = row
	}
	payload := map[string]any{
		"vehicle_id": vehicleID,
		"ts":         ts,
		"tables":     tables,
	}
	if len(coldObs) > 0 {
		cold := make([]map[string]any, 0, len(coldObs))
		for _, o := range coldObs {
			cold = append(cold, map[string]any{
				"name":  o.SignalName,
				"value": pickValue(o),
			})
		}
		payload["cold"] = cold
	}
	return payload
}

// broadcastSSE sends a vehicle_update SSE event. When Redis Pub/Sub is
// available the payload is published to the vehicle_signals channel so all
// pods receive it (including this one, via SubscribeRedis). When Redis is
// not configured, falls back to direct in-process broadcast (single-pod mode).
func (h *TelemetryHandler) broadcastSSE(payload map[string]any) {
	if h.eventHub == nil {
		return
	}

	if h.redisCache != nil {
		// Format the SSE wire message exactly as Broadcast would, then publish
		// via Redis so every pod's SubscribeRedis goroutine forwards it.
		jsonData, err := json.Marshal(payload)
		if err != nil {
			log.Error().Err(err).Msg("failed to marshal SSE payload for Redis Pub/Sub")
			// Fall through to local broadcast as safety net
			h.eventHub.Broadcast("vehicle_update", payload)
			return
		}
		msg := fmt.Appendf(nil, "event: vehicle_update\ndata: %s\n\n", jsonData)
		safeGo("redis-pubsub-publish", func() {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			if err := h.redisCache.PublishSignals(ctx, msg); err != nil {
				log.Warn().Err(err).Msg("redis pub/sub publish failed, falling back to local broadcast")
				h.eventHub.Broadcast("vehicle_update", payload)
			}
		})
		return
	}

	// No Redis — single-pod fallback
	h.eventHub.Broadcast("vehicle_update", payload)
}

// buildColdObservations converts cold atomics (originally cold + transform-demoted)
// into SignalObservation rows ready for signalObsRepo.BulkInsert. Each atomic's
// Go type selects the correct value_* column; nulls are skipped. Unknown types
// are stringified defensively into value_text with a warn log so no data is lost.
func (h *TelemetryHandler) buildColdObservations(vehicleID int64, ts time.Time, cold []telemetry.Atomic) []models.SignalObservation {
	out := make([]models.SignalObservation, 0, len(cold))
	for _, a := range cold {
		obs := models.SignalObservation{
			VehicleID:  vehicleID,
			Ts:         ts,
			SignalName: a.Name,
			Source:     "fleet_telemetry",
		}
		switch v := a.Value.(type) {
		case nil:
			continue
		case bool:
			b := v
			obs.ValueBool = &b
		case float64:
			f := v
			obs.ValueNumeric = &f
		case float32:
			f := float64(v)
			obs.ValueNumeric = &f
		case int:
			f := float64(v)
			obs.ValueNumeric = &f
		case int32:
			f := float64(v)
			obs.ValueNumeric = &f
		case int64:
			f := float64(v)
			obs.ValueNumeric = &f
		case string:
			s := v
			obs.ValueText = &s
		default:
			s := fmt.Sprintf("%v", v)
			obs.ValueText = &s
			log.Warn().
				Str("signal", a.Name).
				Str("type", fmt.Sprintf("%T", v)).
				Msg("cold signal had unexpected type; stringified")
		}
		out = append(out, obs)
	}
	return out
}

// buildHotRow folds a slice of atomics that all target the same table into one
// column->value map, applying each route's Transformer where present. A
// transform error does NOT abort the row — the offending atomic is appended to
// demoteCold so the data still lands losslessly in signal_observations.
func (h *TelemetryHandler) buildHotRow(table string, atomics []telemetry.Atomic, demoteCold *[]telemetry.Atomic) map[string]any {
	row := map[string]any{}
	for _, a := range atomics {
		hot := telemetry.LookupHot(a.Name)
		if hot == nil || hot.Column == "" {
			*demoteCold = append(*demoteCold, a)
			continue
		}
		v := a.Value
		if hot.Transformer != nil {
			tv, err := hot.Transformer(v)
			if err != nil {
				log.Warn().
					Err(err).
					Str("signal", a.Name).
					Str("table", table).
					Msg("transform failed; demoting to cold")
				*demoteCold = append(*demoteCold, a)
				continue
			}
			v = tv
		}
		row[hot.Column] = v
	}
	return row
}

// bucketResult partitions a flattened atomic stream into per-hot-table queues
// and a cold residue (atomics with no HotCatalog mapping). AllNames preserves
// every atomic name in arrival order for the catalog upsert step.
type bucketResult struct {
	HotByTable map[string][]telemetry.Atomic
	Cold       []telemetry.Atomic
	AllNames   []string
}

// bucketAtomics walks atomics and routes each one via telemetry.LookupHot.
// Compound parents (HotRoute with empty Column) should never reach here —
// Flatten expands them into atomics first. If one slips through, treat it as
// unmapped and route to cold so we don't lose the data.
func bucketAtomics(atomics []telemetry.Atomic) bucketResult {
	res := bucketResult{
		HotByTable: map[string][]telemetry.Atomic{},
		Cold:       make([]telemetry.Atomic, 0),
		AllNames:   make([]string, 0, len(atomics)),
	}
	for _, a := range atomics {
		res.AllNames = append(res.AllNames, a.Name)
		hot := telemetry.LookupHot(a.Name)
		if hot == nil || hot.Column == "" {
			res.Cold = append(res.Cold, a)
			continue
		}
		res.HotByTable[hot.Table] = append(res.HotByTable[hot.Table], a)
	}
	return res
}

// normalizeFleetSignals adapts the slice-based telemetry.NormalizeFleetUnits
// helper to the legacy map-based ProcessSignals path.
//
// ProcessSignals (and the FSM/SignalStore consumers downstream) still use
// map[string]interface{}, so we round-trip through the ordered slice API
// for the duration of the normalization step. New code paths should call
// telemetry.NormalizeFleetUnits directly with an ordered batch decoded
// from Tesla emission order.
func normalizeFleetUnits(signals map[string]interface{}) {
	nvs := telemetry.FromMap(signals)
	nvs = telemetry.NormalizeFleetUnits(nvs)
	telemetry.WriteIntoMap(nvs, signals)
}

func toFloat(v interface{}) float64 {
	// Unwrap {"value": X, ...} envelopes from wrapped telemetry payloads
	if m, ok := v.(map[string]interface{}); ok {
		if inner, has := m["value"]; has {
			v = inner
		} else {
			return 0
		}
	}
	switch val := v.(type) {
	case float64:
		return val
	case int:
		return float64(val)
	case int64:
		return float64(val)
	case json.Number:
		f, _ := val.Float64()
		return f
	case string:
		// Some signals come as string numbers
		var f float64
		fmt.Sscanf(val, "%f", &f)
		return f
	}
	return 0
}

func toBool(v interface{}) bool {
	// Unwrap {"value": X, ...} envelopes from wrapped telemetry payloads
	if m, ok := v.(map[string]interface{}); ok {
		if inner, has := m["value"]; has {
			v = inner
		} else {
			// Check if this is a tire-location compound map: any true value → true
			for _, val := range m {
				if b, ok := val.(bool); ok && b {
					return true
				}
			}
			return false
		}
	}
	switch val := v.(type) {
	case bool:
		return val
	case float64:
		return val != 0
	case string:
		if val == "true" || val == "1" {
			return true
		}
		// Handle tire-location JSON strings: {"FrontLeft":true,...} → true if any value is true
		if len(val) > 2 && val[0] == '{' {
			var m map[string]interface{}
			if json.Unmarshal([]byte(val), &m) == nil {
				for _, v := range m {
					if b, ok := v.(bool); ok && b {
						return true
					}
				}
			}
			return false
		}
		return false
	default:
		return false
	}
}

// parseBuckleStatus converts Tesla's BuckleStatus enum to a boolean.
// Tesla sends seatbelt signals as enum strings: "BuckleStatusLatched" (buckled)
// or "BuckleStatusUnlatched" (unbuckled), but may also send booleans.
func parseBuckleStatus(v interface{}) bool {
	// Unwrap {"value": X, ...} envelopes
	if m, ok := v.(map[string]interface{}); ok {
		if inner, has := m["value"]; has {
			v = inner
		} else {
			return false
		}
	}
	switch val := v.(type) {
	case bool:
		return val
	case string:
		return val == "BuckleStatusLatched"
	case float64:
		return val != 0
	default:
		return false
	}
}

func toTimestamp(v interface{}) *time.Time {
	switch val := v.(type) {
	case string:
		if t, err := time.Parse(time.RFC3339, val); err == nil {
			return &t
		}
		if t, err := time.Parse(time.RFC3339Nano, val); err == nil {
			return &t
		}
		// Try unix timestamp as string
		if f, err := strconv.ParseFloat(val, 64); err == nil {
			sec := int64(f)
			nsec := int64((f - float64(sec)) * 1e9)
			t := time.Unix(sec, nsec)
			return &t
		}
	case float64:
		sec := int64(val)
		nsec := int64((val - float64(sec)) * 1e9)
		t := time.Unix(sec, nsec)
		return &t
	case int64:
		t := time.Unix(val, 0)
		return &t
	}
	return nil
}

// trackSecurity stores security/access events when relevant signals arrive.
func (h *TelemetryHandler) trackSecurity(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	_, hasLocked := signals["Locked"]
	_, hasSentry := signals["SentryMode"]
	_, hasDoor := signals["DoorState"]
	_, hasWindow := signals["FdWindow"]
	if !hasLocked && !hasSentry && !hasDoor && !hasWindow {
		return
	}

	log.Debug().Int64("vehicle_id", vehicleID).Bool("locked", hasLocked).Bool("sentry", hasSentry).Bool("door", hasDoor).Bool("window", hasWindow).Msg("telemetry: trackSecurity gate passed")

	now := time.Now().UTC()

	// Collect snapshot-level state from all signals in this batch.
	var locked *bool
	if v, ok := signals["Locked"]; ok {
		b := toBool(v)
		locked = &b
	}
	var sentryMode *bool
	if v, ok := signals["SentryMode"]; ok {
		b := enums.ParseEnumBool(toString(v))
		sentryMode = &b
	}
	var doorsOpen *string
	if v, ok := signals["DoorState"]; ok {
		s := toString(v)
		doorsOpen = &s
	}
	// Aggregate window states into a single WindowsOpen summary.
	var windowParts []string
	for _, wp := range []struct{ sig, label string }{
		{"FdWindow", "FD"}, {"FpWindow", "FP"},
		{"RdWindow", "RD"}, {"RpWindow", "RP"},
	} {
		if v, ok := signals[wp.sig]; ok {
			s := toString(v)
			if s != "" && s != "Closed" {
				windowParts = append(windowParts, wp.label+":"+s)
			}
		}
	}
	var windowsOpen *string
	if len(windowParts) > 0 {
		s := strings.Join(windowParts, ",")
		windowsOpen = &s
	}
	var userPresent *bool
	if v, ok := signals["DriverSeatOccupied"]; ok {
		b := toBool(v)
		userPresent = &b
	}

	// Base event carries the full snapshot state; each derived event
	// gets a distinct event_type matching the DB CHECK constraint.
	base := models.SecurityEvent{
		VehicleID:   vehicleID,
		Ts:          now,
		Locked:      locked,
		SentryMode:  sentryMode,
		DoorsOpen:   doorsOpen,
		WindowsOpen: windowsOpen,
		UserPresent: userPresent,
		Source:      "fleet_telemetry",
	}

	var events []models.SecurityEvent

	if locked != nil {
		ev := base
		if *locked {
			ev.EventType = "lock"
		} else {
			ev.EventType = "unlock"
		}
		events = append(events, ev)
	}
	if sentryMode != nil {
		ev := base
		if *sentryMode {
			ev.EventType = "sentry_on"
		} else {
			ev.EventType = "sentry_off"
		}
		events = append(events, ev)
	}
	if doorsOpen != nil {
		ev := base
		if *doorsOpen != "" && *doorsOpen != "Closed" {
			ev.EventType = "door_open"
		} else {
			ev.EventType = "door_closed"
		}
		events = append(events, ev)
	}
	if hasWindow {
		ev := base
		if len(windowParts) > 0 {
			ev.EventType = "window_open"
		} else {
			ev.EventType = "window_closed"
		}
		events = append(events, ev)
	}
	if userPresent != nil {
		ev := base
		if *userPresent {
			ev.EventType = "user_present"
		} else {
			ev.EventType = "user_absent"
		}
		events = append(events, ev)
	}

	if len(events) == 0 {
		return
	}
	if err := h.securityRepo.BulkInsert(ctx, events); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store security events")
	} else {
		log.Debug().Int64("vehicle_id", vehicleID).Int("count", len(events)).Msg("telemetry: security events stored")
	}
}


// trackVehicleConfig tracks firmware version changes via swUpdateRepo.
func (h *TelemetryHandler) trackVehicleConfig(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	v, ok := signals["Version"]
	if !ok {
		return
	}
	version := toString(v)
	if version == "" {
		return
	}
	go func(vid int64, ver string) {
		fwCtx, cancel := context.WithTimeout(h.bgCtx, 5*time.Second)
		defer cancel()
		inserted, err := h.swUpdateRepo.InsertIfChanged(fwCtx, vid, ver, "installed")
		if err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vid).Str("version", ver).Msg("telemetry: failed to track firmware version")
		} else if inserted {
			log.Info().Int64("vehicle_id", vid).Str("version", ver).Msg("telemetry: new firmware version detected")
		}
	}(vehicleID, version)
}

// trackUserPreferences updates vehicle_units with car display preferences.
// (Snapshot write to user_preference_snapshots removed — signals land in signal_log.)
func (h *TelemetryHandler) trackUserPreferences(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	hasDist := signals["SettingDistanceUnit"] != nil
	hasTemp := signals["SettingTemperatureUnit"] != nil
	hasCharge := signals["SettingChargeUnit"] != nil
	hasPressure := signals["SettingTirePressureUnit"] != nil
	if !hasDist && !hasTemp && !hasPressure && !hasCharge {
		return
	}

	distPref := toString(signals["SettingDistanceUnit"])
	tempPref := toString(signals["SettingTemperatureUnit"])
	pressurePref := toString(signals["SettingTirePressureUnit"])
	chargePref := toString(signals["SettingChargeUnit"])
	_, _ = h.db.Pool.Exec(ctx,
		`INSERT INTO vehicle_units (vehicle_id, car_distance_pref, car_temp_pref, car_pressure_pref, car_charge_pref, updated_at)
		 VALUES ($1, NULLIF($2,''), NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), NOW())
		 ON CONFLICT (vehicle_id) DO UPDATE SET
		   car_distance_pref = COALESCE(NULLIF($2,''), vehicle_units.car_distance_pref),
		   car_temp_pref = COALESCE(NULLIF($3,''), vehicle_units.car_temp_pref),
		   car_pressure_pref = COALESCE(NULLIF($4,''), vehicle_units.car_pressure_pref),
		   car_charge_pref = COALESCE(NULLIF($5,''), vehicle_units.car_charge_pref),
		   updated_at = NOW()`,
		vehicleID, distPref, tempPref, pressurePref, chargePref)
}

// formatSignalName converts camelCase signal names to snake_case for MQTT topic consistency.
var _ = formatSignalName // kept for potential future use
func formatSignalName(name string) string {
	return strings.ToLower(name)
}

// ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç Raw Telemetry Capture API ╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç╬ô├╢├ç

// CaptureList returns captured raw telemetry signals, paginated.
// Query params: ?vin=, ?limit=, ?offset=
func (h *TelemetryHandler) CaptureList(w http.ResponseWriter, r *http.Request) {
	if h.rawTelemetryRepo == nil {
		writeError(w, http.StatusServiceUnavailable, "MongoDB not configured ╬ô├ç├╢ telemetry capture unavailable")
		return
	}

	vin := r.URL.Query().Get("vin")
	limit := int64(50)
	offset := int64(0)
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n >= 0 {
			offset = n
		}
	}

	var (
		results []*models.RawTelemetrySignal
		err     error
	)
	if vin != "" {
		results, err = h.rawTelemetryRepo.GetByVIN(r.Context(), vin, limit, offset)
	} else {
		results, err = h.rawTelemetryRepo.GetAll(r.Context(), limit, offset)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to query captured signals")
		return
	}
	writeJSON(w, http.StatusOK, results)
}

// CaptureStats returns aggregate statistics about captured signals.
func (h *TelemetryHandler) CaptureStats(w http.ResponseWriter, r *http.Request) {
	if h.rawTelemetryRepo == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"mongodb_enabled": false,
			"capture_enabled": h.captureEnabled.Load(),
			"total_documents": 0,
			"distinct_vins":   []string{},
		})
		return
	}

	stats, err := h.rawTelemetryRepo.Stats(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get capture stats")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"mongodb_enabled": true,
		"capture_enabled": h.captureEnabled.Load(),
		"total_documents": stats.TotalDocuments,
		"distinct_vins":   stats.DistinctVINs,
	})
}

// CaptureDrop deletes all captured telemetry data.
func (h *TelemetryHandler) CaptureDrop(w http.ResponseWriter, r *http.Request) {
	if h.rawTelemetryRepo == nil {
		writeError(w, http.StatusServiceUnavailable, "MongoDB not configured ╬ô├ç├╢ telemetry capture unavailable")
		return
	}

	if err := h.rawTelemetryRepo.Drop(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to drop captured signals")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "dropped"})
}

// CaptureExport streams all captured signals as a JSONL download.
func (h *TelemetryHandler) CaptureExport(w http.ResponseWriter, r *http.Request) {
	if h.rawTelemetryRepo == nil {
		writeError(w, http.StatusServiceUnavailable, "MongoDB not configured ╬ô├ç├╢ telemetry capture unavailable")
		return
	}

	cursor, err := h.rawTelemetryRepo.StreamAll(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to export captured signals")
		return
	}
	defer cursor.Close(r.Context())

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Content-Disposition", "attachment; filename=telemetry-capture.jsonl")

	enc := json.NewEncoder(w)
	for cursor.Next(r.Context()) {
		var doc models.RawTelemetrySignal
		if err := cursor.Decode(&doc); err != nil {
			continue
		}
		enc.Encode(doc)
	}
}
