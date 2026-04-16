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

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/signal"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
)

// TelemetryHandler receives and processes Tesla Fleet Telemetry data.
type TelemetryHandler struct {
	db             *database.DB
	posRepo        *database.PositionRepo
	vehicleRepo    *database.VehicleRepo
	stateRepo      *database.VehicleStateRepo
	mileageRepo    *database.MileageRepo
	tireRepo       *database.TirePressureRepo
	motorRepo      *database.MotorRepo
	climateRepo    *database.ClimateRepo
	securityRepo   *database.SecurityRepo
	chargingTelemetryRepo *database.ChargingTelemetryRepo
	mediaRepo      *database.MediaRepo
	vehicleConfigRepo *database.VehicleConfigRepo
	locationRepo   *database.LocationSnapshotRepo
	safetyRepo     *database.SafetyRepo
	userPrefRepo   *database.UserPreferenceRepo
	swUpdateRepo   *database.SoftwareUpdateRepo
	mqttClient     *mqtt.Client
	logRepo        *database.APICallLogRepo
	eventHub       *EventHub
	sessionTracker *TelemetrySessionTracker
	alertEvaluator *TelemetryAlertEvaluator
	staleTimeout          time.Duration
	snapshotWriteInterval time.Duration
	cleanupInterval       time.Duration
	staleSessionTimeout   time.Duration
	signalStore           *signal.Store

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

	// Per-vehicle state machine — debounced vehicle state detection
	vehicleStateMu sync.Mutex
	vehicleStates  map[int64]*vehicleStateMachine // keyed by vehicleID
}

// vehicleStateMachine tracks vehicle state transitions.
// When Gear signals are available (Fleet Telemetry), transitions are immediate
// since Gear is authoritative from the car's MCU.
// For the legacy polling path (no Gear), debounced speed/charge heuristics are used.
type vehicleStateMachine struct {
	currentState       string    // committed state in DB
	lastGear           string    // last known gear (D/R/P/N) — empty if never received
	pendingState       string    // candidate state (only for speed-based fallback)
	pendingSince       time.Time // when the candidate was first seen (speed-based only)
	lastDriveSpeed     float64   // last non-zero speed (for speed-based hysteresis)
	lastSpeedTime      time.Time // when last non-zero speed was seen
	lastDriveSignalTime time.Time // when last Gear=D/R or speed>0 was seen (for gear-based hold)
	isGearCapable      bool      // true once ANY Gear signal has been received (persisted in DB)
}

const (
	// States must be observed for this duration before transition is committed.
	// Only applies to the speed-based fallback path (no Gear signal).
	stateConfirmDuration = 30 * time.Second
	// After driving (speed-based only), stay in "driving" for this long even if speed=0.
	driveHoldDuration = 2 * time.Minute
)

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
	LatencyMs        int64                  `json:"latency_ms"`        // age of data in milliseconds
	UptimeSeconds    float64                `json:"uptime_seconds"`    // how long vehicle has been streaming
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
		db:             db,
		posRepo:        database.NewPositionRepo(db),
		vehicleRepo:    database.NewVehicleRepo(db),
		stateRepo:      database.NewVehicleStateRepo(db),
		mileageRepo:    database.NewMileageRepo(db),
		tireRepo:       database.NewTirePressureRepo(db),
		motorRepo:      database.NewMotorRepo(db),
		climateRepo:    database.NewClimateRepo(db),
		securityRepo:   database.NewSecurityRepo(db),
		chargingTelemetryRepo: database.NewChargingTelemetryRepo(db),
		mediaRepo:      database.NewMediaRepo(db),
		vehicleConfigRepo: database.NewVehicleConfigRepo(db),
		locationRepo:   database.NewLocationSnapshotRepo(db),
		safetyRepo:     database.NewSafetyRepo(db),
		userPrefRepo:   database.NewUserPreferenceRepo(db),
		swUpdateRepo:   database.NewSoftwareUpdateRepo(db),
		mqttClient:     mc,
		logRepo:        database.NewAPICallLogRepo(db),
		eventHub:       hub,
		sessionTracker: NewTelemetrySessionTracker(db, eventBus, geocoder, nil),
		alertEvaluator: NewTelemetryAlertEvaluator(db, eventBus, hub, func() pahomqtt.Client { if mc != nil { return mc.Underlying() }; return nil }()),
		staleTimeout:          staleTimeout,
		snapshotWriteInterval: 10 * time.Second,
		cleanupInterval:       2 * time.Minute,
		staleSessionTimeout:   5 * time.Minute,
		bgCtx:          bgCtx,
		bgCancel:       bgCancel,
		streamingState:     make(map[string]*VehicleStreamState),
		lastWriteAt:        make(map[string]time.Time),
		accumulatedSignals: make(map[string]map[string]interface{}),
		vehicleStates:      make(map[int64]*vehicleStateMachine),
		fsmHandler:         NewFSMHandler(database.NewVehicleStateRepo(db), database.NewVehicleRepo(db), database.NewFSMTransitionRepo(db)),
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
		rawCopy := make(map[string]interface{}, len(signals))
		for k, v := range signals {
			rawCopy[k] = v
		}
		rec := &models.RawTelemetrySignal{
			VIN:         vin,
			Source:      source,
			Signals:     rawCopy,
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

	// Find vehicle by VIN (needed for SignalStore keying and all downstream)
	var vehicleID int64
	err := h.db.Pool.QueryRow(ctx, "SELECT id FROM vehicles WHERE vin = $1", vin).Scan(&vehicleID)
	if err != nil {
		log.Warn().Err(err).Str("vin", vin).Msg("telemetry: vehicle not found or DB error")
	}

	// Update in-memory SignalStore ╬ô├ç├╢ always complete, never has null fields.
	// This is the primary source of truth for dashboard, state machine, and sessions.
	if vehicleID > 0 && h.signalStore != nil {
		h.signalStore.Update(vehicleID, signals)
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

	// Broadcast to SSE clients for real-time frontend updates.
	// Send the complete SignalStore state (not just the partial batch) so the
	// frontend always has a full picture without polling.
	if h.eventHub != nil {
		sseData := map[string]interface{}{
			"vin":        vin,
			"vehicle_id": vehicleID,
			"source":     "fleet_telemetry",
			"signals":    signals,
			"timestamp":  time.Now().UTC(),
		}
		// Include complete state from SignalStore if available
		if vehicleID > 0 && h.signalStore != nil {
			sseData["state"] = h.signalStore.GetRawMap(vehicleID)
		}
		h.eventHub.Broadcast("vehicle_update", sseData)
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
			bgCtx, cancel := context.WithTimeout(h.bgCtx, 5*time.Second)
			defer cancel()
			h.fsmHandler.ProcessSignals(bgCtx, vehicleID, signalsCopy)
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

			// Drain accumulated signals for this write cycle
			var writeSignals map[string]interface{}
			if shouldWrite {
				h.accumulatedSignalsMu.Lock()
				writeSignals = h.accumulatedSignals[vin]
				h.accumulatedSignals[vin] = make(map[string]interface{})
				h.accumulatedSignalsMu.Unlock()
			}

			// Throttled snapshot writes ╬ô├ç├╢ only run every 10s per vehicle
			if !shouldWrite || writeSignals == nil {
				return
			}

			// Update daily mileage from odometer readings
			h.trackMileage(bgCtx, vehicleID, writeSignals)

			// Store tire pressure snapshots
			h.trackTirePressure(bgCtx, vehicleID, writeSignals)

			// Store motor/powertrain snapshots
			h.trackMotor(bgCtx, vehicleID, writeSignals)

			// Store climate/HVAC snapshots
			h.trackClimate(bgCtx, vehicleID, writeSignals)

			// Store security events
			h.trackSecurity(bgCtx, vehicleID, writeSignals)

			// Store charging telemetry
			h.trackCharging(bgCtx, vehicleID, writeSignals)

			// Store media snapshots
			h.trackMedia(bgCtx, vehicleID, writeSignals)

			// Store vehicle config snapshots
			h.trackVehicleConfig(bgCtx, vehicleID, writeSignals)

			// Store location/navigation snapshots
			h.trackLocation(bgCtx, vehicleID, writeSignals)

			// Store safety settings snapshots
			h.trackSafety(bgCtx, vehicleID, writeSignals)

			// Store user preference snapshots
			h.trackUserPreferences(bgCtx, vehicleID, writeSignals)

			// Store accumulated position ╬ô├ç├╢ uses merged signals so fields like
			// odometer, battery, location, speed are all populated from different
			// MQTT batches within the 10s accumulation window.
			if pos := h.extractPosition(writeSignals); pos != nil {
				pos.VehicleID = vehicleID
				if err := h.posRepo.Insert(bgCtx, pos); err != nil {
					log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store accumulated position")
				}
			}
		})
	}
}

// detectVehicleState determines the vehicle state from telemetry signals.
// Uses signal priority: driving > charging > online.
func (h *TelemetryHandler) detectVehicleState(vehicleID int64, signals map[string]interface{}) string {
	// Priority 1: Gear signal ╬ô├ç├╢ authoritative from car MCU
	gear := ""
	if g, ok := signals["Gear"]; ok {
		gear = toString(g)
	}

	// If no Gear in current batch, check SignalStore for this specific vehicle (not any vehicle)
	if gear == "" && h.signalStore != nil {
		if gv := h.signalStore.Get(vehicleID, "Gear"); gv != nil {
			if time.Since(gv.Timestamp) < 10*time.Minute {
				gear = toString(gv.Raw)
			}
		}
	}

	if gear != "" {
		switch gear {
		case "D", "R":
			return "driving"
		case "P":
			// Check for active charging ╬ô├ç├╢ Gear=P + charging = "charging"
			if dcs, ok := signals["DetailedChargeState"]; ok {
				dcsStr := toString(dcs)
				if strings.Contains(dcsStr, "Charging") || strings.Contains(dcsStr, "Starting") {
					return "charging"
				}
			}
			if cs, ok := signals["ChargeState"]; ok {
				csStr := toString(cs)
				if csStr == "Enable" || strings.Contains(csStr, "Charging") || strings.Contains(csStr, "Starting") {
					return "charging"
				}
			}
			if amps, ok := toFloatOk(signals["ChargeAmps"]); ok && amps > 1.0 {
				return "charging"
			}
			if rate, ok := toFloatOk(signals["ChargeRateMilePerHour"]); ok && rate > 0 {
				return "charging"
			}
			if power, ok := toFloatOk(signals["ACChargingPower"]); ok && power > 0.1 {
				return "charging"
			}
			if voltage, ok := toFloatOk(signals["ChargerVoltage"]); ok && voltage > 10 {
				return "charging"
			}
			return "parked"
		case "N":
			return "online"
		}
	}

	// Fallback: speed-based detection (REST API polling path, no Gear available)
	if speed, ok := toFloatOk(signals["VehicleSpeed"]); ok && speed > 1.0 {
		return "driving"
	}

	// Fallback: charging signals ╬ô├ç├╢ check rare authoritative signals first,
	// then common high-frequency indicators for consistent detection
	if dcs, ok := signals["DetailedChargeState"]; ok {
		dcsStr := toString(dcs)
		if strings.Contains(dcsStr, "Charging") || strings.Contains(dcsStr, "Starting") {
			return "charging"
		}
	}
	if cs, ok := signals["ChargeState"]; ok {
		csStr := toString(cs)
		if csStr == "Enable" || strings.Contains(csStr, "Charging") || strings.Contains(csStr, "Starting") {
			return "charging"
		}
	}
	if amps, ok := toFloatOk(signals["ChargeAmps"]); ok && amps > 1.0 {
		return "charging"
	}
	// High-frequency charging indicators (sent every few seconds during active charge)
	if rate, ok := toFloatOk(signals["ChargeRateMilePerHour"]); ok && rate > 0 {
		return "charging"
	}
	if power, ok := toFloatOk(signals["ACChargingPower"]); ok && power > 0.1 {
		return "charging"
	}
	if voltage, ok := toFloatOk(signals["ChargerVoltage"]); ok && voltage > 10 {
		return "charging"
	}

	return "online"
}

// trackStateTransition determines vehicle state from signals and commits transitions.
//
// Design principles:
//   - Gear signal = immediate commit (authoritative from car MCU, no debounce)
//   - Speed-based fallback (no Gear) = debounced transitions (legacy path)
//   - "offline" is set externally by MarkVehicleOffline when telemetry stops arriving
func (h *TelemetryHandler) trackStateTransition(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	candidateState := h.detectVehicleState(vehicleID, signals)
	now := time.Now().UTC()

	// Check if this batch has a Gear signal ╬ô├ç├╢ determines instant vs debounced path
	_, hasGear := signals["Gear"]

	h.vehicleStateMu.Lock()
	sm, exists := h.vehicleStates[vehicleID]
	if !exists {
		currentDB, _ := h.stateRepo.GetCurrentState(ctx, vehicleID)
		if currentDB == "" {
			currentDB = "online"
		}
		sm = &vehicleStateMachine{currentState: currentDB}
		h.vehicleStates[vehicleID] = sm
		// Restore persisted state machine fields from SignalStore (loaded from DB on startup)
		if h.signalStore != nil {
			if lg, ok := h.signalStore.GetString(vehicleID, "_LastGear"); ok && lg != "" {
				sm.lastGear = lg
			}
			if lst := h.signalStore.Get(vehicleID, "_LastSpeedTime"); lst != nil {
				if t, ok := lst.Raw.(time.Time); ok {
					sm.lastSpeedTime = t
					sm.lastDriveSignalTime = t
				}
			}
		}
		// Load persisted gear capability from DB
		if vehicle, err := h.vehicleRepo.GetByID(ctx, vehicleID); err == nil && vehicle != nil {
			sm.isGearCapable = vehicle.IsGearCapable
		}
	}

	// Persist gear capability on first Gear signal received
	if hasGear && !sm.isGearCapable {
		sm.isGearCapable = true
		go func() {
			persistCtx, cancel := context.WithTimeout(h.bgCtx, 5*time.Second)
			defer cancel()
			if err := h.vehicleRepo.SetGearCapable(persistCtx, vehicleID, true); err != nil {
				log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to persist gear capability")
			}
		}()
	}

	// Update last known gear
	if hasGear {
		sm.lastGear = toString(signals["Gear"])
		// Update drive signal timestamp on Gear=D/R (even without speed in this batch)
		if sm.lastGear == "D" || sm.lastGear == "R" {
			sm.lastDriveSignalTime = now
		}
	}

	// Track last speed for drive hold hysteresis (both gear and speed paths)
	if speed, ok := toFloatOk(signals["VehicleSpeed"]); ok && speed > 0 {
		sm.lastDriveSpeed = speed
		sm.lastSpeedTime = now
		sm.lastDriveSignalTime = now
	}

	// If candidate matches current, reset pending ╬ô├ç├╢ no transition needed
	if candidateState == sm.currentState {
		sm.pendingState = ""
		sm.pendingSince = time.Time{}
		h.vehicleStateMu.Unlock()
		return
	}

	// === GEAR-BASED PATH: Immediate transitions (no debounce) ===
	// Only use gear path if we have a fresh Gear signal (current batch or recently received)
	gearFresh := hasGear
	if !gearFresh && sm.lastGear != "" && h.signalStore != nil {
		if gv := h.signalStore.Get(vehicleID, "Gear"); gv != nil {
			gearFresh = time.Since(gv.Timestamp) < 10*time.Minute
		}
	}
	if gearFresh {
		// Gear-based drive hold: suppress Driving╬ô├Ñ├åParked/Online if vehicle was
		// recently in motion (Gear=D/R or speed>0). Prevents red-light flapping.
		if sm.currentState == "driving" && candidateState != "driving" && candidateState != "charging" {
			if !sm.lastDriveSignalTime.IsZero() && now.Sub(sm.lastDriveSignalTime) < driveHoldDuration {
				sm.pendingState = ""
				sm.pendingSince = time.Time{}
				h.vehicleStateMu.Unlock()
				return
			}
		}

		fromState := sm.currentState
		sm.currentState = candidateState
		sm.pendingState = ""
		sm.pendingSince = time.Time{}
		if candidateState == "driving" {
			sm.lastSpeedTime = now
			sm.lastDriveSignalTime = now
		}
		h.vehicleStateMu.Unlock()
		h.commitStateTransition(ctx, vehicleID, fromState, candidateState)
		// Persist state machine fields to SignalStore for DB flush recovery
		if h.signalStore != nil {
			h.signalStore.Update(vehicleID, map[string]interface{}{
				"_LastGear":      sm.lastGear,
				"_LastSpeedTime": sm.lastSpeedTime,
			})
		}
		log.Info().Int64("vehicle_id", vehicleID).Str("gear", sm.lastGear).Str("from", fromState).Str("to", candidateState).Msg("telemetry: gear-based state transition")
		return
	}

	// === SPEED-BASED FALLBACK: Debounced transitions (no Gear available) ===

	// Gear-capable vehicles: suppress speed-based Driving╬ô├Ñ├åOnline/Parked fallback.
	// Wait for authoritative Gear=P signal instead, unless stopped for 5+ minutes.
	if sm.isGearCapable && sm.currentState == "driving" && (candidateState == "online" || candidateState == "parked") {
		if !sm.lastDriveSignalTime.IsZero() && now.Sub(sm.lastDriveSignalTime) < 5*time.Minute {
			h.vehicleStateMu.Unlock()
			return
		}
	}

	// Drive hold: if currently driving and speed was seen within driveHoldDuration,
	// suppress transitions to online/parked (handles red lights, brief stops)
	if sm.currentState == "driving" && (candidateState == "online" || candidateState == "parked") {
		if !sm.lastSpeedTime.IsZero() && now.Sub(sm.lastSpeedTime) < driveHoldDuration {
			candidateState = "driving"
		}
	}

	if candidateState == sm.currentState {
		sm.pendingState = ""
		sm.pendingSince = time.Time{}
		h.vehicleStateMu.Unlock()
		return
	}

	// Fast path: entering "driving" is immediate even for speed-based
	if candidateState == "driving" && sm.currentState != "driving" {
		fromState := sm.currentState
		sm.currentState = candidateState
		sm.pendingState = ""
		sm.pendingSince = time.Time{}
		sm.lastSpeedTime = now
		sm.lastDriveSignalTime = now
		h.vehicleStateMu.Unlock()
		h.commitStateTransition(ctx, vehicleID, fromState, candidateState)
		return
	}

	// All other speed-based transitions require confirmation period
	if candidateState != sm.pendingState {
		sm.pendingState = candidateState
		sm.pendingSince = now
		h.vehicleStateMu.Unlock()
		return
	}
	if now.Sub(sm.pendingSince) < stateConfirmDuration {
		h.vehicleStateMu.Unlock()
		return
	}

	// Confirmed ╬ô├ç├╢ commit
	fromState := sm.currentState
	sm.currentState = candidateState
	sm.pendingState = ""
	sm.pendingSince = time.Time{}
	h.vehicleStateMu.Unlock()
	h.commitStateTransition(ctx, vehicleID, fromState, candidateState)
}

func (h *TelemetryHandler) commitStateTransition(ctx context.Context, vehicleID int64, fromState, newState string) {
	if err := h.stateRepo.EndCurrent(ctx, vehicleID); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to end current state")
	}
	if _, err := h.stateRepo.Insert(ctx, vehicleID, newState); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Str("state", newState).Msg("telemetry: failed to insert state")
	}
	if err := h.vehicleRepo.UpdateState(ctx, vehicleID, newState, true); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to update vehicle state")
	}
	// Log to fsm_transitions for the FSM debugger (best-effort)
	if fromState != "" && fromState != newState {
		_, err := h.db.Pool.Exec(ctx,
			`INSERT INTO fsm_transitions (vehicle_id, fsm_type, from_state, to_state, trigger, mode)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			vehicleID, "vehicle_state",
			fromState, newState, "signal_change", "immediate",
		)
		if err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to log FSM transition")
		}
	}
	log.Info().Int64("vehicle_id", vehicleID).Str("from", fromState).Str("to", newState).Msg("telemetry: state transition confirmed")
}

// MarkVehicleOffline transitions a vehicle to "offline" or "asleep" when telemetry stops.
// If the last state was "parked", the vehicle is likely asleep (normal behavior).
// If the last state was "driving" or "charging", something unexpected happened ╬ô├Ñ├å "offline".
func (h *TelemetryHandler) MarkVehicleOffline(ctx context.Context, vehicleID int64) {
	h.vehicleStateMu.Lock()
	sm, exists := h.vehicleStates[vehicleID]
	if exists && (sm.currentState == "offline" || sm.currentState == "asleep") {
		h.vehicleStateMu.Unlock()
		return
	}
	// Choose asleep vs offline based on last known state
	fromState := "online"
	if exists {
		fromState = sm.currentState
	}
	newState := "offline"
	if exists && (sm.currentState == "parked" || sm.currentState == "online") {
		newState = "asleep" // parked/online ╬ô├Ñ├å quiet = normal sleep
	}
	if exists {
		sm.currentState = newState
		sm.pendingState = ""
	}
	h.vehicleStateMu.Unlock()
	h.commitStateTransition(ctx, vehicleID, fromState, newState)
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
func (h *TelemetryHandler) trackTirePressure(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	fl, flOk := signals["TirePressureFrontLeft"]
	fr, frOk := signals["TirePressureFrontRight"]
	rl, rlOk := signals["TirePressureRearLeft"]
	rr, rrOk := signals["TirePressureRearRight"]

	if !flOk && !frOk && !rlOk && !rrOk {
		// Also try the alternate signal names from fleet telemetry
		fl, flOk = signals["TPMS_FL"]
		fr, frOk = signals["TPMS_FR"]
		rl, rlOk = signals["TPMS_RL"]
		rr, rrOk = signals["TPMS_RR"]
	}

	if !flOk && !frOk && !rlOk && !rrOk {
		// Try TpmsPressure* naming used by fleet-telemetry proto
		fl, flOk = signals["TpmsPressureFl"]
		fr, frOk = signals["TpmsPressureFr"]
		rl, rlOk = signals["TpmsPressureRl"]
		rr, rrOk = signals["TpmsPressureRr"]
	}

	if !flOk && !frOk && !rlOk && !rrOk {
		// Try short TpmsFl/Fr/Rl/Rr naming from Fleet Telemetry subscriptions
		fl, flOk = signals["TpmsFl"]
		fr, frOk = signals["TpmsFr"]
		rl, rlOk = signals["TpmsRl"]
		rr, rrOk = signals["TpmsRr"]
	}

	_, hasHardWarn := signals["TpmsHardWarnings"]
	_, hasSoftWarn := signals["TpmsSoftWarnings"]
	_, hasLastSeenFL := signals["TpmsLastSeenPressureTimeFl"]
	if !flOk && !frOk && !rlOk && !rrOk && !hasHardWarn && !hasSoftWarn && !hasLastSeenFL {
		return // no tire-pressure-related data in this batch
	}

	snap := &models.TirePressureSnapshot{VehicleID: vehicleID}
	if flOk {
		if v, ok := toFloatOk(fl); ok {
			snap.FrontLeft = &v
		}
	}
	if frOk {
		if v, ok := toFloatOk(fr); ok {
			snap.FrontRight = &v
		}
	}
	if rlOk {
		if v, ok := toFloatOk(rl); ok {
			snap.RearLeft = &v
		}
	}
	if rrOk {
		if v, ok := toFloatOk(rr); ok {
			snap.RearRight = &v
		}
	}
	if v, ok := signals["TpmsHardWarnings"]; ok {
		s := toString(v)
		snap.TpmsHardWarn = &s
	}
	if v, ok := signals["TpmsSoftWarnings"]; ok {
		s := toString(v)
		snap.TpmsSoftWarn = &s
	}
	if v, ok := signals["TpmsLastSeenPressureTimeFl"]; ok {
		if t := toTimestamp(v); t != nil {
			snap.LastSeenTimeFl = t
		}
	}
	if v, ok := signals["TpmsLastSeenPressureTimeFr"]; ok {
		if t := toTimestamp(v); t != nil {
			snap.LastSeenTimeFr = t
		}
	}
	if v, ok := signals["TpmsLastSeenPressureTimeRl"]; ok {
		if t := toTimestamp(v); t != nil {
			snap.LastSeenTimeRl = t
		}
	}
	if v, ok := signals["TpmsLastSeenPressureTimeRr"]; ok {
		if t := toTimestamp(v); t != nil {
			snap.LastSeenTimeRr = t
		}
	}
	if err := h.tireRepo.Insert(ctx, snap); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store tire pressure")
	}
}

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

	// Build a signal map for easy lookup
	signals := make(map[string]interface{}, len(payload.Signals))
	for _, sig := range payload.Signals {
		signals[sig.Name] = sig.Value
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
			Method:     "POST",
			URL:        fmt.Sprintf("/api/v1/telemetry (VIN: %s)", payload.VIN),
			StatusCode: &statusCode,
			DurationMs: durationMs,
			Source:     "fleet_telemetry",
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
			pos.Speed = &f
		}
	}
	// Power ╬ô├ç├╢ Tesla Fleet Telemetry has no "PackPower" signal; compute from
	// PackVoltage (V) Γö£├╣ PackCurrent (A) ╬ô├Ñ├å kW.  Fall back to PackPower for
	// non-fleet-telemetry sources (e.g. REST API polling).
	if v, ok := signals["PackPower"]; ok {
		if f, fok := toFloatOk(v); fok {
			pos.Power = &f
		}
	} else if voltage, vOk := toFloatOk(signals["PackVoltage"]); vOk {
		if current, cOk := toFloatOk(signals["PackCurrent"]); cOk {
			pwr := voltage * current / 1000.0 // kW
			pos.Power = &pwr
		}
	}
	if v, ok := signals["GpsHeading"]; ok {
		if f, fok := toFloatOk(v); fok {
			i := int(f)
			pos.Heading = &i
		}
	} else if v, ok := signals["Heading"]; ok {
		if f, fok := toFloatOk(v); fok {
			i := int(f)
			pos.Heading = &i
		}
	}

	// Battery & range ╬ô├ç├╢ use toFloatOk to distinguish 0% from missing signal
	if v, ok := signals["BatteryLevel"]; ok {
		if f, fok := toFloatOk(v); fok {
			pos.BatteryLvl = int(f)
		}
	} else if v, ok := signals["Soc"]; ok {
		if f, fok := toFloatOk(v); fok {
			pos.BatteryLvl = int(f)
		}
	} else if v, ok := signals["StateOfCharge"]; ok {
		if f, fok := toFloatOk(v); fok {
			pos.BatteryLvl = int(f)
		}
	}
	if v, ok := signals["IdealBatteryRange"]; ok {
		if f, fok := toFloatOk(v); fok {
			pos.IdealRange = &f
		}
	}
	if v, ok := signals["EstBatteryRange"]; ok {
		if f, fok := toFloatOk(v); fok {
			pos.RatedRange = &f
		}
	}

	// Climate
	if v, ok := signals["InsideTemp"]; ok {
		if f, fok := toFloatOk(v); fok {
			pos.InsideTemp = &f
		}
	}
	if v, ok := signals["OutsideTemp"]; ok {
		if f, fok := toFloatOk(v); fok {
			pos.OutsideTemp = &f
		}
	}

	// Odometer ╬ô├ç├╢ use toFloatOk to avoid storing 0 for missing signal
	if v, ok := signals["Odometer"]; ok {
		if f, fok := toFloatOk(v); fok {
			pos.Odometer = f
		}
	}

	return pos
}

// TelemetryStatus returns the telemetry endpoint configuration and streaming health.
func (h *TelemetryHandler) TelemetryStatus(w http.ResponseWriter, r *http.Request) {
	streamingVehicles := h.GetStreamingState()

	// Build vehicle list in the format the frontend expects
	type vehicleTelemetry struct {
		VIN           string  `json:"vin"`
		VehicleID     int64   `json:"vehicle_id,omitempty"`
		State         string  `json:"state,omitempty"`
		SignalCount   int64   `json:"signal_count"`
		BatchCount    int64   `json:"batch_count"`
		SignalsPerSec float64 `json:"signals_per_sec"`
		LastReceived  string  `json:"last_received,omitempty"`
	}

	vehicles := make([]vehicleTelemetry, 0, len(streamingVehicles))
	for _, v := range streamingVehicles {
		vt := vehicleTelemetry{
			VIN:           v.VIN,
			SignalCount:   v.SignalCount,
			BatchCount:    v.BatchCount,
			SignalsPerSec: v.SignalsPerSecond,
		}
		if !v.LastReceived.IsZero() {
			vt.LastReceived = v.LastReceived.Format(time.RFC3339)
		}
		if v.IsStreaming {
			vt.State = "streaming"
		} else {
			vt.State = "stale"
		}
		vehicles = append(vehicles, vt)
	}

	connected := h.mqttClient != nil && h.mqttClient.IsConnected()

	// Build streaming_vehicles map keyed by VIN (frontend expects this shape)
	streamingMap := make(map[string]interface{}, len(vehicles))
	var totalSignals int64
	var avgRate float64
	for _, v := range vehicles {
		streamingMap[v.VIN] = v
		totalSignals += v.SignalCount
		avgRate += v.SignalsPerSec
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"enabled":              true,
		"connected":            connected,
		"mode":                 "fleet_telemetry",
		"endpoint":             "/api/v1/telemetry",
		"protocol":             "MQTT + HTTP",
		"mqtt_publishing":      connected,
		"streaming_vehicles":   streamingMap,
		"vehicles":             vehicles,
		"total_signals":        totalSignals,
		"avg_signals_per_sec":  avgRate,
	})
}

// normalizeFleetSignals normalizes Tesla Fleet Telemetry signal formats.
// Raw values are stored AS-IS (no unit conversion) ╬ô├ç├╢ conversion happens at display time.
// Only format normalization is done here (e.g., Gear enum ╬ô├Ñ├å single letter).
func normalizeFleetUnits(signals map[string]interface{}) {
	// Gear: normalize Tesla enum to single-letter D/R/P/N
	if g, ok := signals["Gear"]; ok {
		if parsed := enums.ParseGear(toString(g)); parsed != "" {
			signals["Gear"] = parsed
		}
	}
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

// toFloatOk parses a value to float64 and returns whether the signal was present.
// This distinguishes missing signals (ok=false) from actual zero values (ok=true, val=0).
func toFloatOk(v interface{}) (float64, bool) {
	if v == nil {
		return 0, false
	}
	// Handle map values: {"invalid": true} ╬ô├Ñ├å skip, {"value": X} ╬ô├Ñ├å unwrap
	if m, ok := v.(map[string]interface{}); ok {
		if inv, ok := m["invalid"]; ok {
			if b, ok := inv.(bool); ok && b {
				return 0, false
			}
		}
		if inner, ok := m["value"]; ok {
			v = inner
		} else {
			return 0, false
		}
	}
	switch val := v.(type) {
	case float64:
		return val, true
	case int:
		return float64(val), true
	case int64:
		return float64(val), true
	case json.Number:
		f, err := val.Float64()
		return f, err == nil
	case string:
		if val == "" || val == "<nil>" || val == "nil" || val == "null" {
			return 0, false
		}
		var f float64
		n, _ := fmt.Sscanf(val, "%f", &f)
		return f, n > 0
	case bool:
		if val {
			return 1, true
		}
		return 0, true
	}
	return 0, false
}

func formatFloat(v float64) string {
	if v == float64(int64(v)) {
		return fmt.Sprintf("%d", int64(v))
	}
	return fmt.Sprintf("%.6f", v)
}

func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	// Unwrap {"value": X, ...} envelopes from wrapped telemetry payloads
	if m, ok := v.(map[string]interface{}); ok {
		if inner, has := m["value"]; has {
			v = inner
		} else {
			return ""
		}
	}
	switch val := v.(type) {
	case string:
		if val == "<nil>" || val == "nil" || val == "null" {
			return ""
		}
		return val
	case float64:
		return fmt.Sprintf("%v", val)
	case bool:
		if val {
			return "true"
		}
		return "false"
	default:
		s := fmt.Sprintf("%v", val)
		if s == "<nil>" || s == "nil" || s == "null" {
			return ""
		}
		return s
	}
}

func toBool(v interface{}) bool {
	// Unwrap {"value": X, ...} envelopes from wrapped telemetry payloads
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
	case float64:
		return val != 0
	case string:
		return val == "true" || val == "1"
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

// trackMotor stores motor/powertrain snapshots when relevant signals arrive.
func (h *TelemetryHandler) trackMotor(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	_, hasTorque := signals["DiTorquemotor"]
	_, hasSpeed := signals["VehicleSpeed"]
	_, hasPedal := signals["PedalPosition"]
	_, hasAccel := signals["LateralAcceleration"]
	_, hasGear := signals["Gear"]
	_, hasOdometer := signals["Odometer"]
	if !hasTorque && !hasSpeed && !hasPedal && !hasAccel && !hasGear && !hasOdometer {
		return
	}

	snap := &models.MotorSnapshot{VehicleID: vehicleID}
	if v, ok := signals["DiStateR"]; ok {
		s := toString(v)
		snap.DiState = &s
	}
	if v, ok := signals["DiTorquemotor"]; ok {
		f := toFloat(v)
		snap.DiTorque = &f
	}
	if v, ok := signals["DiAxleSpeedR"]; ok {
		f := toFloat(v)
		snap.DiAxleSpeed = &f
	}
	if v, ok := signals["DiStatorTempR"]; ok {
		f := toFloat(v)
		snap.DiStatorTemp = &f
	}
	if v, ok := signals["PedalPosition"]; ok {
		f := toFloat(v)
		snap.PedalPosition = &f
	}
	if v, ok := signals["BrakePedal"]; ok {
		b := toBool(v)
		snap.BrakePedal = &b
	}
	if v, ok := signals["LateralAcceleration"]; ok {
		f := toFloat(v)
		snap.LateralAccel = &f
	}
	if v, ok := signals["LongitudinalAcceleration"]; ok {
		f := toFloat(v)
		snap.LongitudinalAccel = &f
	}
	if v, ok := signals["VehicleSpeed"]; ok {
		f := toFloat(v)
		snap.VehicleSpeed = &f
	}
	if v, ok := signals["Gear"]; ok {
		s := toString(v)
		snap.Gear = &s
	}
	if v, ok := signals["DiTorqueActualF"]; ok {
		f := toFloat(v)
		snap.DiTorqueActualF = &f
	}
	if v, ok := signals["DiTorqueActualR"]; ok {
		f := toFloat(v)
		snap.DiTorqueActualR = &f
	}
	if v, ok := signals["DiTorqueActualREL"]; ok {
		f := toFloat(v)
		snap.DiTorqueActualREL = &f
	}
	if v, ok := signals["DiTorqueActualRER"]; ok {
		f := toFloat(v)
		snap.DiTorqueActualRER = &f
	}
	if v, ok := signals["DiAxleSpeedF"]; ok {
		f := toFloat(v)
		snap.DiAxleSpeedF = &f
	}
	if v, ok := signals["DiAxleSpeedREL"]; ok {
		f := toFloat(v)
		snap.DiAxleSpeedREL = &f
	}
	if v, ok := signals["DiAxleSpeedRER"]; ok {
		f := toFloat(v)
		snap.DiAxleSpeedRER = &f
	}
	if v, ok := signals["DiStateF"]; ok {
		s := toString(v)
		snap.DiStateF = &s
	}
	if v, ok := signals["DiStateREL"]; ok {
		s := toString(v)
		snap.DiStateREL = &s
	}
	if v, ok := signals["DiStateRER"]; ok {
		s := toString(v)
		snap.DiStateRER = &s
	}
	if v, ok := signals["DiStatorTempF"]; ok {
		f := toFloat(v)
		snap.DiStatorTempF = &f
	}
	if v, ok := signals["DiStatorTempREL"]; ok {
		f := toFloat(v)
		snap.DiStatorTempREL = &f
	}
	if v, ok := signals["DiStatorTempRER"]; ok {
		f := toFloat(v)
		snap.DiStatorTempRER = &f
	}
	if v, ok := signals["DiHeatsinkTF"]; ok {
		f := toFloat(v)
		snap.DiHeatsinkTF = &f
	}
	if v, ok := signals["DiHeatsinkTR"]; ok {
		f := toFloat(v)
		snap.DiHeatsinkTR = &f
	}
	if v, ok := signals["DiHeatsinkTREL"]; ok {
		f := toFloat(v)
		snap.DiHeatsinkTREL = &f
	}
	if v, ok := signals["DiHeatsinkTRER"]; ok {
		f := toFloat(v)
		snap.DiHeatsinkTRER = &f
	}
	if v, ok := signals["DiInverterTF"]; ok {
		f := toFloat(v)
		snap.DiInverterTF = &f
	}
	if v, ok := signals["DiInverterTR"]; ok {
		f := toFloat(v)
		snap.DiInverterTR = &f
	}
	if v, ok := signals["DiInverterTREL"]; ok {
		f := toFloat(v)
		snap.DiInverterTREL = &f
	}
	if v, ok := signals["DiInverterTRER"]; ok {
		f := toFloat(v)
		snap.DiInverterTRER = &f
	}
	if v, ok := signals["DiMotorCurrentF"]; ok {
		f := toFloat(v)
		snap.DiMotorCurrentF = &f
	}
	if v, ok := signals["DiMotorCurrentR"]; ok {
		f := toFloat(v)
		snap.DiMotorCurrentR = &f
	}
	if v, ok := signals["DiMotorCurrentREL"]; ok {
		f := toFloat(v)
		snap.DiMotorCurrentREL = &f
	}
	if v, ok := signals["DiMotorCurrentRER"]; ok {
		f := toFloat(v)
		snap.DiMotorCurrentRER = &f
	}
	if v, ok := signals["DiVBatF"]; ok {
		f := toFloat(v)
		snap.DiVBatF = &f
	}
	if v, ok := signals["DiVBatR"]; ok {
		f := toFloat(v)
		snap.DiVBatR = &f
	}
	if v, ok := signals["DiVBatREL"]; ok {
		f := toFloat(v)
		snap.DiVBatREL = &f
	}
	if v, ok := signals["DiVBatRER"]; ok {
		f := toFloat(v)
		snap.DiVBatRER = &f
	}
	if v, ok := signals["DiSlaveTorqueCmd"]; ok {
		f := toFloat(v)
		snap.DiSlaveTorqueCmd = &f
	}
	if v, ok := signals["Hvil"]; ok {
		s := toString(v)
		snap.Hvil = &s
	}
	if v, ok := signals["BrakePedalPos"]; ok {
		f := toFloat(v)
		snap.BrakePedalPos = &f
	}
	if v, ok := signals["CruiseSetSpeed"]; ok {
		f := toFloat(v)
		snap.CruiseSetSpeed = &f
	}
	if v, ok := signals["DriveRail"]; ok {
		b := toBool(v)
		snap.DriveRail = &b
	}
	if v, ok := signals["LifetimeEnergyGainedRegen"]; ok {
		f := toFloat(v)
		snap.LifetimeEnergyGainedRegen = &f
	}
	if v, ok := signals["LifetimeEnergyUsedDrive"]; ok {
		f := toFloat(v)
		snap.LifetimeEnergyUsedDrive = &f
	}
	if err := h.motorRepo.Insert(ctx, snap); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store motor snapshot")
	}
}

// trackClimate stores climate/HVAC snapshots when relevant signals arrive.
func (h *TelemetryHandler) trackClimate(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	_, hasInside := signals["InsideTemp"]
	_, hasOutside := signals["OutsideTemp"]
	_, hasHvac := signals["HvacPower"]
	_, hasFan := signals["HvacFanSpeed"]
	if !hasInside && !hasOutside && !hasHvac && !hasFan {
		return
	}

	snap := &models.ClimateSnapshot{VehicleID: vehicleID}
	if v, ok := signals["InsideTemp"]; ok {
		f := toFloat(v)
		snap.InsideTemp = &f
	}
	if v, ok := signals["OutsideTemp"]; ok {
		f := toFloat(v)
		snap.OutsideTemp = &f
	}
	if v, ok := signals["HvacPower"]; ok {
		s := toString(v)
		if enums.ParseHvacPower(s) {
			one := 1.0
			snap.HvacPower = &one
		} else {
			zero := 0.0
			snap.HvacPower = &zero
		}
	}
	if v, ok := signals["HvacFanSpeed"]; ok {
		i := int(toFloat(v))
		snap.HvacFanSpeed = &i
	}
	if v, ok := signals["HvacLeftTemperatureRequest"]; ok {
		f := toFloat(v)
		snap.HvacLeftTempRequest = &f
	}
	if v, ok := signals["HvacRightTemperatureRequest"]; ok {
		f := toFloat(v)
		snap.HvacRightTempRequest = &f
	}
	if v, ok := signals["CabinOverheatProtectionMode"]; ok {
		s := toString(v)
		snap.CabinOverheatMode = &s
	}
	if v, ok := signals["DefrostMode"]; ok {
		s := toString(v)
		snap.DefrostMode = &s
	}
	if v, ok := signals["BatteryHeaterOn"]; ok {
		b := toBool(v)
		snap.BatteryHeaterOn = &b
	}
	if v, ok := signals["HvacACEnabled"]; ok {
		b := toBool(v)
		snap.HvacACEnabled = &b
	}
	if v, ok := signals["HvacAutoMode"]; ok {
		s := toString(v)
		snap.HvacAutoMode = &s
	}
	if v, ok := signals["HvacFanStatus"]; ok {
		i := int(toFloat(v))
		snap.HvacFanStatus = &i
	}
	if v, ok := signals["HvacSteeringWheelHeatAuto"]; ok {
		b := toBool(v)
		snap.HvacSteeringWheelHeatAuto = &b
	}
	if v, ok := signals["HvacSteeringWheelHeatLevel"]; ok {
		i := int(toFloat(v))
		snap.HvacSteeringWheelHeatLevel = &i
	}
	if v, ok := signals["ClimateKeeperMode"]; ok {
		s := toString(v)
		snap.ClimateKeeperMode = &s
	}
	if v, ok := signals["CabinOverheatProtectionTemperatureLimit"]; ok {
		s := toString(v)
		snap.CabinOverheatProtectionTempLimit = &s
	} else if v, ok := signals["CabinOverheatProtectionTempLimit"]; ok {
		s := toString(v)
		snap.CabinOverheatProtectionTempLimit = &s
	}
	if v, ok := signals["DefrostForPreconditioning"]; ok {
		b := toBool(v)
		snap.DefrostForPreconditioning = &b
	}
	if v, ok := signals["SeatHeaterLeft"]; ok {
		i := int(toFloat(v))
		snap.SeatHeaterLeft = &i
	}
	if v, ok := signals["SeatHeaterRight"]; ok {
		i := int(toFloat(v))
		snap.SeatHeaterRight = &i
	}
	if v, ok := signals["SeatHeaterRearLeft"]; ok {
		i := int(toFloat(v))
		snap.SeatHeaterRearLeft = &i
	}
	if v, ok := signals["SeatHeaterRearCenter"]; ok {
		i := int(toFloat(v))
		snap.SeatHeaterRearCenter = &i
	}
	if v, ok := signals["SeatHeaterRearRight"]; ok {
		i := int(toFloat(v))
		snap.SeatHeaterRearRight = &i
	}
	if v, ok := signals["SeatVentEnabled"]; ok {
		b := toBool(v)
		snap.SeatVentEnabled = &b
	}
	if v, ok := signals["ClimateSeatCoolingFrontLeft"]; ok {
		i := int(toFloat(v))
		snap.ClimateSeatCoolingFrontLeft = &i
	}
	if v, ok := signals["ClimateSeatCoolingFrontRight"]; ok {
		i := int(toFloat(v))
		snap.ClimateSeatCoolingFrontRight = &i
	}
	if v, ok := signals["AutoSeatClimateLeft"]; ok {
		b := toBool(v)
		snap.AutoSeatClimateLeft = &b
	}
	if v, ok := signals["AutoSeatClimateRight"]; ok {
		b := toBool(v)
		snap.AutoSeatClimateRight = &b
	}
	if v, ok := signals["RearDefrostEnabled"]; ok {
		b := toBool(v)
		snap.RearDefrostEnabled = &b
	}
	if v, ok := signals["RearDisplayHvacEnabled"]; ok {
		b := toBool(v)
		snap.RearDisplayHvacEnabled = &b
	}
	if v, ok := signals["WiperHeatEnabled"]; ok {
		b := toBool(v)
		snap.WiperHeatEnabled = &b
	}
	if err := h.climateRepo.Insert(ctx, snap); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store climate snapshot")
	}
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

	ev := &models.SecurityEvent{VehicleID: vehicleID}
	if v, ok := signals["Locked"]; ok {
		b := toBool(v)
		ev.Locked = &b
	}
	if v, ok := signals["SentryMode"]; ok {
		b := enums.ParseEnumBool(toString(v))
		ev.SentryMode = &b
	}
	if v, ok := signals["DoorState"]; ok {
		s := toString(v)
		ev.DoorState = &s
	}
	if v, ok := signals["FdWindow"]; ok {
		s := toString(v)
		ev.FdWindow = &s
	}
	if v, ok := signals["FpWindow"]; ok {
		s := toString(v)
		ev.FpWindow = &s
	}
	if v, ok := signals["RdWindow"]; ok {
		s := toString(v)
		ev.RdWindow = &s
	}
	if v, ok := signals["RpWindow"]; ok {
		s := toString(v)
		ev.RpWindow = &s
	}
	if v, ok := signals["HomelinkNearby"]; ok {
		b := toBool(v)
		ev.HomelinkNearby = &b
	}
	if v, ok := signals["GuestModeEnabled"]; ok {
		b := toBool(v)
		ev.GuestMode = &b
	}
	if v, ok := signals["HomelinkDeviceCount"]; ok {
		i := int(toFloat(v))
		ev.HomelinkDeviceCount = &i
	}
	if v, ok := signals["GuestModeMobileAccessState"]; ok {
		s := toString(v)
		ev.GuestModeMobileAccessState = &s
	}
	if v, ok := signals["DriverSeatOccupied"]; ok {
		b := toBool(v)
		ev.DriverSeatOccupied = &b
	}
	if v, ok := signals["CenterDisplay"]; ok {
		s := toString(v)
		ev.CenterDisplay = &s
	}
	if v, ok := signals["SpeedLimitMode"]; ok {
		s := toString(v)
		ev.SpeedLimitMode = &s
	}
	if v, ok := signals["ValetModeEnabled"]; ok {
		b := toBool(v)
		ev.ValetModeEnabled = &b
	}
	if v, ok := signals["ServiceMode"]; ok {
		b := toBool(v)
		ev.ServiceMode = &b
	}
	if v, ok := signals["CurrentLimitMph"]; ok {
		f := toFloat(v)
		ev.CurrentLimitMph = &f
	}
	if v, ok := signals["PairedPhoneKeyAndKeyFobQty"]; ok {
		i := int(toFloat(v))
		ev.PairedPhoneKeyCount = &i
	}
	if v, ok := signals["LightsHazardsActive"]; ok {
		b := toBool(v)
		ev.LightsHazardsActive = &b
	}
	if v, ok := signals["LightsHighBeams"]; ok {
		b := toBool(v)
		ev.LightsHighBeams = &b
	}
	if v, ok := signals["LightsTurnSignal"]; ok {
		s := toString(v)
		ev.LightsTurnSignal = &s
	}
	if v, ok := signals["TonneauPosition"]; ok {
		s := toString(v)
		ev.TonneauPosition = &s
	}
	if v, ok := signals["TonneauOpenPercent"]; ok {
		f := toFloat(v)
		ev.TonneauOpenPercent = &f
	}
	if v, ok := signals["TonneauTentMode"]; ok {
		s := toString(v)
		ev.TonneauTentMode = &s
	}
	if v, ok := signals["DriverSeatBelt"]; ok {
		b := toBool(v)
		ev.DriverSeatBelt = &b
	}
	if v, ok := signals["PassengerSeatBelt"]; ok {
		b := toBool(v)
		ev.PassengerSeatBelt = &b
	}
	if err := h.securityRepo.Insert(ctx, ev); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store security event")
	} else {
		log.Debug().Int64("vehicle_id", vehicleID).Int64("id", ev.ID).Msg("telemetry: security event stored")
	}
}

// trackCharging stores charging telemetry when relevant signals arrive.
// Gate: only writes when a charging-specific signal is present (not just
// PackVoltage/PackCurrent which are always sent regardless of charge state).
func (h *TelemetryHandler) trackCharging(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	_, hasChargeState := signals["ChargeState"]
	_, hasDetailedCharge := signals["DetailedChargeState"]
	_, hasDCPower := signals["DCChargingPower"]
	_, hasACPower := signals["ACChargingPower"]
	_, hasBatteryLevel := signals["BatteryLevel"]
	_, hasSoc := signals["Soc"]
	_, hasChargeRate := signals["ChargeRateMilePerHour"]
	_, hasChargeAmps := signals["ChargeAmps"]
	_, hasChargerVoltage := signals["ChargerVoltage"]
	_, hasEstRange := signals["EstBatteryRange"]
	_, hasIdealRange := signals["IdealBatteryRange"]
	_, hasEnergyRemaining := signals["EnergyRemaining"]
	_, hasChargeLimitSoc := signals["ChargeLimitSoc"]
	// Note: PackVoltage/PackCurrent excluded from gate ╬ô├ç├╢ they're always sent
	// (even when not charging) and would create 35K+ mostly-empty rows.
	// They're still stored in the row when other charging signals trigger it.
	if !hasChargeState && !hasDetailedCharge && !hasDCPower && !hasACPower &&
		!hasBatteryLevel && !hasSoc && !hasChargeRate && !hasChargeAmps &&
		!hasChargerVoltage && !hasEstRange && !hasIdealRange && !hasEnergyRemaining &&
		!hasChargeLimitSoc {
		return
	}

	snap := &models.ChargingTelemetry{VehicleID: vehicleID}
	if v, ok := signals["BatteryLevel"]; ok {
		f := toFloat(v)
		snap.BatteryLevel = &f
	}
	if v, ok := signals["Soc"]; ok {
		f := toFloat(v)
		snap.Soc = &f
	}
	if v, ok := signals["ChargeState"]; ok {
		s := toString(v)
		snap.ChargeState = &s
	}
	if v, ok := signals["DetailedChargeState"]; ok {
		s := toString(v)
		snap.DetailedChargeState = &s
	}
	if v, ok := signals["ChargeLimitSoc"]; ok {
		i := int(toFloat(v))
		snap.ChargeLimitSoc = &i
	}
	if v, ok := signals["ChargeAmps"]; ok {
		f := toFloat(v)
		snap.ChargeAmps = &f
	}
	if v, ok := signals["ChargeCurrentRequest"]; ok {
		f := toFloat(v)
		snap.ChargeCurrentRequest = &f
	}
	if v, ok := signals["ChargeCurrentRequestMax"]; ok {
		f := toFloat(v)
		snap.ChargeCurrentRequestMax = &f
	}
	if v, ok := signals["ChargeEnableRequest"]; ok {
		b := toBool(v)
		snap.ChargeEnableRequest = &b
	}
	if v, ok := signals["ChargerVoltage"]; ok {
		f := toFloat(v)
		snap.ChargerVoltage = &f
	}
	if v, ok := signals["ChargerPhases"]; ok {
		i := int(toFloat(v))
		snap.ChargerPhases = &i
	}
	if v, ok := signals["ChargeRateMilePerHour"]; ok {
		f := toFloat(v)
		snap.ChargeRateMph = &f
	}
	if v, ok := signals["DCChargingPower"]; ok {
		f := toFloat(v)
		snap.DCChargingPower = &f
	}
	if v, ok := signals["DCChargingEnergyIn"]; ok {
		f := toFloat(v)
		snap.DCChargingEnergyIn = &f
	}
	if v, ok := signals["ACChargingPower"]; ok {
		f := toFloat(v)
		snap.ACChargingPower = &f
	}
	if v, ok := signals["ACChargingEnergyIn"]; ok {
		f := toFloat(v)
		snap.ACChargingEnergyIn = &f
	}
	if v, ok := signals["EnergyRemaining"]; ok {
		f := toFloat(v)
		snap.EnergyRemaining = &f
	}
	if v, ok := signals["EstBatteryRange"]; ok {
		f := toFloat(v)
		snap.EstBatteryRange = &f
	}
	if v, ok := signals["IdealBatteryRange"]; ok {
		f := toFloat(v)
		snap.IdealBatteryRange = &f
	}
	if v, ok := signals["RatedRange"]; ok {
		f := toFloat(v)
		snap.RatedRange = &f
	}
	if v, ok := signals["PackVoltage"]; ok {
		f := toFloat(v)
		snap.PackVoltage = &f
	}
	if v, ok := signals["PackCurrent"]; ok {
		f := toFloat(v)
		snap.PackCurrent = &f
	}
	if v, ok := signals["ChargePortDoorOpen"]; ok {
		b := toBool(v)
		snap.ChargePortDoorOpen = &b
	}
	if v, ok := signals["ChargePortLatch"]; ok {
		s := toString(v)
		snap.ChargePortLatch = &s
	}
	if v, ok := signals["ChargePortColdWeatherMode"]; ok {
		b := toBool(v)
		snap.ChargePortColdWeatherMode = &b
	}
	if v, ok := signals["ChargingCableType"]; ok {
		s := toString(v)
		snap.ChargingCableType = &s
	}
	if v, ok := signals["FastChargerPresent"]; ok {
		b := toBool(v)
		snap.FastChargerPresent = &b
	}
	if v, ok := signals["FastChargerType"]; ok {
		s := toString(v)
		snap.FastChargerType = &s
	}
	if v, ok := signals["TimeToFullCharge"]; ok {
		f := toFloat(v)
		snap.TimeToFullCharge = &f
	}
	if v, ok := signals["EstimatedHoursToChargeTermination"]; ok {
		f := toFloat(v)
		snap.EstimatedHoursToCharge = &f
	}
	if v, ok := signals["ScheduledChargingMode"]; ok {
		s := toString(v)
		snap.ScheduledChargingMode = &s
	}
	if v, ok := signals["ScheduledChargingPending"]; ok {
		b := toBool(v)
		snap.ScheduledChargingPending = &b
	}
	if v, ok := signals["PreconditioningEnabled"]; ok {
		b := toBool(v)
		snap.PreconditioningEnabled = &b
	}
	if v, ok := signals["BrickVoltageMax"]; ok {
		f := toFloat(v)
		snap.BrickVoltageMax = &f
	}
	if v, ok := signals["BrickVoltageMin"]; ok {
		f := toFloat(v)
		snap.BrickVoltageMin = &f
	}
	if v, ok := signals["NumBrickVoltageMax"]; ok {
		i := int(toFloat(v))
		snap.NumBrickVoltageMax = &i
	}
	if v, ok := signals["NumBrickVoltageMin"]; ok {
		i := int(toFloat(v))
		snap.NumBrickVoltageMin = &i
	}
	if v, ok := signals["ModuleTempMax"]; ok {
		f := toFloat(v)
		snap.ModuleTempMax = &f
	}
	if v, ok := signals["ModuleTempMin"]; ok {
		f := toFloat(v)
		snap.ModuleTempMin = &f
	}
	if v, ok := signals["NumModuleTempMax"]; ok {
		i := int(toFloat(v))
		snap.NumModuleTempMax = &i
	}
	if v, ok := signals["NumModuleTempMin"]; ok {
		i := int(toFloat(v))
		snap.NumModuleTempMin = &i
	}
	if v, ok := signals["BatteryHeaterOn"]; ok {
		b := toBool(v)
		snap.BatteryHeaterOn = &b
	}
	if v, ok := signals["NotEnoughPowerToHeat"]; ok {
		b := toBool(v)
		snap.NotEnoughPowerToHeat = &b
	}
	if v, ok := signals["BMSState"]; ok {
		s := toString(v)
		snap.BmsState = &s
	} else if v, ok := signals["BmsState"]; ok {
		s := toString(v)
		snap.BmsState = &s
	}
	if v, ok := signals["BmsFullchargecomplete"]; ok {
		b := toBool(v)
		snap.BmsFullchargeComplete = &b
	}
	if v, ok := signals["DCDCEnable"]; ok {
		b := toBool(v)
		snap.DcdcEnable = &b
	} else if v, ok := signals["DcdcEnable"]; ok {
		b := toBool(v)
		snap.DcdcEnable = &b
	}
	if v, ok := signals["IsolationResistance"]; ok {
		f := toFloat(v)
		snap.IsolationResistance = &f
	}
	if v, ok := signals["LifetimeEnergyUsed"]; ok {
		f := toFloat(v)
		snap.LifetimeEnergyUsed = &f
	}
	if v, ok := signals["SuperchargerSessionTripPlanner"]; ok {
		b := toBool(v)
		snap.SuperchargerSessionTripPlanner = &b
	}
	if v, ok := signals["PowershareStatus"]; ok {
		s := toString(v)
		snap.PowershareStatus = &s
	}
	if v, ok := signals["PowershareType"]; ok {
		s := toString(v)
		snap.PowershareType = &s
	}
	if v, ok := signals["PowershareStopReason"]; ok {
		s := toString(v)
		snap.PowershareStopReason = &s
	}
	if v, ok := signals["PowershareHoursLeft"]; ok {
		i := int(toFloat(v))
		snap.PowershareHoursLeft = &i
	}
	if v, ok := signals["PowershareInstantaneousPowerKW"]; ok {
		f := toFloat(v)
		snap.PowersharePowerKw = &f
	} else if v, ok := signals["PowersharePowerKw"]; ok {
		f := toFloat(v)
		snap.PowersharePowerKw = &f
	}
	if v, ok := signals["ScheduledChargingStartTime"]; ok {
		s := toString(v)
		snap.ScheduledChargingStartTime = &s
	}
	if v, ok := signals["ScheduledDepartureTime"]; ok {
		s := toString(v)
		snap.ScheduledDepartureTime = &s
	}
	if v, ok := signals["ExpectedEnergyPercentAtTripArrival"]; ok {
		f := toFloat(v)
		snap.ExpectedEnergyPctAtArrival = &f
	}
	if err := h.chargingTelemetryRepo.Insert(ctx, snap); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store charging telemetry")
	}
}

// trackMedia stores media playback snapshots when relevant signals arrive.
func (h *TelemetryHandler) trackMedia(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	_, hasTitle := signals["MediaNowPlayingTitle"]
	_, hasArtist := signals["MediaNowPlayingArtist"]
	if !hasTitle && !hasArtist {
		return
	}

	snap := &models.MediaSnapshot{VehicleID: vehicleID}
	if v, ok := signals["MediaNowPlayingTitle"]; ok {
		s := toString(v)
		snap.NowPlayingTitle = &s
	}
	if v, ok := signals["MediaNowPlayingArtist"]; ok {
		s := toString(v)
		snap.NowPlayingArtist = &s
	}
	if v, ok := signals["MediaNowPlayingAlbum"]; ok {
		s := toString(v)
		snap.NowPlayingAlbum = &s
	}
	if v, ok := signals["MediaNowPlayingStation"]; ok {
		s := toString(v)
		snap.NowPlayingStation = &s
	}
	if v, ok := signals["MediaNowPlayingDuration"]; ok {
		i := int(toFloat(v))
		snap.NowPlayingDuration = &i
	}
	if v, ok := signals["MediaNowPlayingElapsed"]; ok {
		i := int(toFloat(v))
		snap.NowPlayingElapsed = &i
	}
	if v, ok := signals["MediaPlaybackStatus"]; ok {
		s := toString(v)
		snap.PlaybackStatus = &s
	}
	if v, ok := signals["MediaPlaybackSource"]; ok {
		s := toString(v)
		snap.PlaybackSource = &s
	}
	if v, ok := signals["MediaAudioVolume"]; ok {
		f := toFloat(v)
		snap.AudioVolume = &f
	}
	if v, ok := signals["MediaAudioVolumeMax"]; ok {
		f := toFloat(v)
		snap.AudioVolumeMax = &f
	}
	if v, ok := signals["MediaAudioVolumeIncrement"]; ok {
		f := toFloat(v)
		snap.AudioVolumeIncrement = &f
	}

	// Carry forward source/status from signalStore if not in current batch
	if snap.PlaybackSource == nil && h.signalStore != nil {
		if src, ok := h.signalStore.GetString(vehicleID, "MediaPlaybackSource"); ok && src != "" {
			snap.PlaybackSource = &src
		}
	}
	if snap.PlaybackStatus == nil && h.signalStore != nil {
		if status, ok := h.signalStore.GetString(vehicleID, "MediaPlaybackStatus"); ok && status != "" {
			snap.PlaybackStatus = &status
		}
	}

	if err := h.mediaRepo.Insert(ctx, snap); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store media snapshot")
	}
}

// trackVehicleConfig stores vehicle configuration snapshots when relevant signals arrive.
func (h *TelemetryHandler) trackVehicleConfig(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	_, hasVersion := signals["Version"]
	_, hasName := signals["VehicleName"]
	_, hasCarType := signals["CarType"]
	_, hasSWVersion := signals["SoftwareUpdateVersion"]
	_, hasSWDownload := signals["SoftwareUpdateDownloadPercentComplete"]
	_, hasTrim := signals["Trim"]
	_, hasWheel := signals["WheelType"]
	_, hasColor := signals["ExteriorColor"]
	_, hasChargePort := signals["ChargePort"]
	if !hasVersion && !hasName && !hasCarType && !hasSWVersion && !hasSWDownload &&
		!hasTrim && !hasWheel && !hasColor && !hasChargePort {
		return
	}

	snap := &models.VehicleConfigSnapshot{VehicleID: vehicleID}
	if v, ok := signals["CarType"]; ok {
		s := toString(v)
		snap.CarType = &s
	}
	if v, ok := signals["Trim"]; ok {
		s := toString(v)
		snap.Trim = &s
	}
	if v, ok := signals["ExteriorColor"]; ok {
		s := toString(v)
		snap.ExteriorColor = &s
	}
	if v, ok := signals["RoofColor"]; ok {
		s := toString(v)
		snap.RoofColor = &s
	}
	if v, ok := signals["WheelType"]; ok {
		s := toString(v)
		snap.WheelType = &s
	}
	if v, ok := signals["RearSeatHeaters"]; ok {
		s := toString(v)
		snap.RearSeatHeaters = &s
	}
	if v, ok := signals["SunroofInstalled"]; ok {
		s := toString(v)
		snap.SunroofInstalled = &s
	}
	if v, ok := signals["EfficiencyPackage"]; ok {
		s := toString(v)
		snap.EfficiencyPackage = &s
	}
	if v, ok := signals["EuropeVehicle"]; ok {
		b := toBool(v)
		snap.EuropeVehicle = &b
	}
	if v, ok := signals["RightHandDrive"]; ok {
		b := toBool(v)
		snap.RightHandDrive = &b
	}
	if v, ok := signals["RemoteStartEnabled"]; ok {
		b := toBool(v)
		snap.RemoteStartEnabled = &b
	}
	if v, ok := signals["ChargePort"]; ok {
		s := toString(v)
		snap.ChargePort = &s
	}
	if v, ok := signals["OffroadLightbarPresent"]; ok {
		b := toBool(v)
		snap.OffroadLightbarPresent = &b
	}
	if v, ok := signals["Version"]; ok {
		s := toString(v)
		snap.Version = &s
		// Track firmware version changes ╬ô├ç├╢ only insert if different from latest
		if s != "" {
			go func(vid int64, ver string) {
				fwCtx, cancel := context.WithTimeout(h.bgCtx, 5*time.Second)
				defer cancel()
				inserted, err := h.swUpdateRepo.InsertIfChanged(fwCtx, vid, ver, "installed")
				if err != nil {
					log.Warn().Err(err).Int64("vehicle_id", vid).Str("version", ver).Msg("telemetry: failed to track firmware version")
				} else if inserted {
					log.Info().Int64("vehicle_id", vid).Str("version", ver).Msg("telemetry: new firmware version detected")
				}
			}(vehicleID, s)
		}
	}
	if v, ok := signals["VehicleName"]; ok {
		s := toString(v)
		snap.VehicleName = &s
	}
	if v, ok := signals["SoftwareUpdateVersion"]; ok {
		s := toString(v)
		snap.SoftwareUpdateVersion = &s
	}
	if v, ok := signals["SoftwareUpdateDownloadPercentComplete"]; ok {
		i := int(toFloat(v))
		snap.SoftwareUpdateDownloadPct = &i
	}
	if v, ok := signals["SoftwareUpdateInstallationPercentComplete"]; ok {
		i := int(toFloat(v))
		snap.SoftwareUpdateInstallPct = &i
	}
	if v, ok := signals["SoftwareUpdateExpectedDurationMinutes"]; ok {
		i := int(toFloat(v))
		snap.SoftwareUpdateExpectedDuration = &i
	}
	if v, ok := signals["SoftwareUpdateScheduledStartTime"]; ok {
		s := toString(v)
		snap.SoftwareUpdateScheduledStart = &s
	}
	if err := h.vehicleConfigRepo.Insert(ctx, snap); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store vehicle config snapshot")
	}
}

// trackLocation stores navigation/location snapshots when relevant signals arrive.
func (h *TelemetryHandler) trackLocation(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	_, hasDest := signals["DestinationName"]
	_, hasMiles := signals["MilesToArrival"]
	_, hasRoute := signals["RouteLine"]
	_, hasLocation := signals["Location"]
	_, hasRouteUpdated := signals["RouteLastUpdated"]
	_, hasAtHome := signals["LocatedAtHome"]
	_, hasAtWork := signals["LocatedAtWork"]
	_, hasAtFav := signals["LocatedAtFavorite"]
	_, hasGpsState := signals["GpsState"]
	if !hasDest && !hasMiles && !hasRoute && !hasLocation && !hasRouteUpdated &&
		!hasAtHome && !hasAtWork && !hasAtFav && !hasGpsState {
		return
	}

	snap := &models.LocationSnapshot{VehicleID: vehicleID}
	if v, ok := signals["DestinationName"]; ok {
		s := toString(v)
		snap.DestinationName = &s
	}
	if v, ok := signals["DestinationLocation"].(map[string]interface{}); ok {
		if lat, ok2 := v["latitude"]; ok2 {
			f := toFloat(lat)
			snap.DestinationLat = &f
		}
		if lon, ok2 := v["longitude"]; ok2 {
			f := toFloat(lon)
			snap.DestinationLon = &f
		}
	}
	if v, ok := signals["OriginLocation"].(map[string]interface{}); ok {
		if lat, ok2 := v["latitude"]; ok2 {
			f := toFloat(lat)
			snap.OriginLat = &f
		}
		if lon, ok2 := v["longitude"]; ok2 {
			f := toFloat(lon)
			snap.OriginLon = &f
		}
	}
	if v, ok := signals["MilesToArrival"]; ok {
		f := toFloat(v)
		snap.MilesToArrival = &f
	}
	if v, ok := signals["MinutesToArrival"]; ok {
		f := toFloat(v)
		snap.MinutesToArrival = &f
	}
	if v, ok := signals["RouteLine"]; ok {
		s := toString(v)
		snap.RouteLine = &s
	}
	if v, ok := signals["RouteTrafficMinutesDelay"]; ok {
		f := toFloat(v)
		snap.RouteTrafficDelayMin = &f
	}
	if v, ok := signals["LocatedAtHome"]; ok {
		b := toBool(v)
		snap.LocatedAtHome = &b
	}
	if v, ok := signals["LocatedAtWork"]; ok {
		b := toBool(v)
		snap.LocatedAtWork = &b
	}
	if v, ok := signals["LocatedAtFavorite"]; ok {
		b := toBool(v)
		snap.LocatedAtFavorite = &b
	}
	if v, ok := signals["GpsState"]; ok {
		s := toString(v)
		snap.GpsState = &s
	}
	if v, ok := signals["RouteLastUpdated"]; ok {
		if t := toTimestamp(v); t != nil {
			snap.RouteLastUpdated = t
		}
	}
	if v, ok := signals["Location"]; ok {
		if loc, ok2 := v.(map[string]interface{}); ok2 {
			if lat, ok3 := loc["latitude"]; ok3 {
				f := toFloat(lat)
				snap.CurrentLat = &f
			}
			if lon, ok3 := loc["longitude"]; ok3 {
				f := toFloat(lon)
				snap.CurrentLon = &f
			}
		}
	}
	// Backfill current position from SignalStore if Location wasn't in this batch
	if snap.CurrentLat == nil && h.signalStore != nil {
		if locVal := h.signalStore.Get(vehicleID, "Location"); locVal != nil {
			if loc, ok := locVal.Raw.(map[string]interface{}); ok {
				if lat, ok2 := loc["latitude"]; ok2 {
					f := toFloat(lat)
					snap.CurrentLat = &f
				}
				if lon, ok2 := loc["longitude"]; ok2 {
					f := toFloat(lon)
					snap.CurrentLon = &f
				}
			}
		}
	}
	if err := h.locationRepo.Insert(ctx, snap); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store location snapshot")
	}
}

// trackSafety stores safety settings snapshots when relevant signals arrive.
func (h *TelemetryHandler) trackSafety(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	_, hasBelt := signals["DriverSeatBelt"]
	_, hasAEB := signals["AutomaticEmergencyBrakingOff"]
	_, hasFCW := signals["ForwardCollisionWarning"]
	if !hasBelt && !hasAEB && !hasFCW {
		return
	}

	snap := &models.SafetySnapshot{VehicleID: vehicleID}
	if v, ok := signals["AutomaticBlindSpotCamera"]; ok {
		b := toBool(v)
		snap.AutomaticBlindSpotCamera = &b
	}
	if v, ok := signals["AutomaticEmergencyBrakingOff"]; ok {
		b := toBool(v)
		snap.AutomaticEmergencyBrakingOff = &b
	}
	if v, ok := signals["BlindSpotCollisionWarningChime"]; ok {
		s := toString(v)
		snap.BlindSpotCollisionWarning = &s
	}
	if v, ok := signals["CruiseFollowDistance"]; ok {
		s := toString(v)
		snap.CruiseFollowDistance = &s
	}
	if v, ok := signals["EmergencyLaneDepartureAvoidance"]; ok {
		b := toBool(v)
		snap.EmergencyLaneDepartureAvoidance = &b
	}
	if v, ok := signals["ForwardCollisionWarning"]; ok {
		s := toString(v)
		snap.ForwardCollisionWarning = &s
	}
	if v, ok := signals["LaneDepartureAvoidance"]; ok {
		s := toString(v)
		snap.LaneDepartureAvoidance = &s
	}
	if v, ok := signals["SpeedLimitWarning"]; ok {
		s := toString(v)
		snap.SpeedLimitWarning = &s
	}
	if v, ok := signals["PinToDriveEnabled"]; ok {
		b := toBool(v)
		snap.PinToDriveEnabled = &b
	}
	if v, ok := signals["MilesSinceReset"]; ok {
		f := toFloat(v)
		snap.MilesSinceReset = &f
	}
	if v, ok := signals["SelfDrivingMilesSinceReset"]; ok {
		f := toFloat(v)
		snap.SelfDrivingMilesSinceReset = &f
	}
	if err := h.safetyRepo.Insert(ctx, snap); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store safety snapshot")
	}
}

// trackUserPreferences stores user preference snapshots when relevant signals arrive.
func (h *TelemetryHandler) trackUserPreferences(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	_, hasDist := signals["SettingDistanceUnit"]
	_, hasTemp := signals["SettingTemperatureUnit"]
	_, hasCharge := signals["SettingChargeUnit"]
	_, hasPressure := signals["SettingTirePressureUnit"]
	_, has24h := signals["Setting24HourTime"]
	if !hasDist && !hasTemp && !hasCharge && !hasPressure && !has24h {
		return
	}

	snap := &models.UserPreferenceSnapshot{VehicleID: vehicleID}
	if v, ok := signals["Setting24HourTime"]; ok {
		b := toBool(v)
		snap.Setting24hrTime = &b
	}
	if v, ok := signals["SettingChargeUnit"]; ok {
		s := toString(v)
		snap.SettingChargeUnit = &s
	}
	if v, ok := signals["SettingDistanceUnit"]; ok {
		s := toString(v)
		snap.SettingDistanceUnit = &s
	}
	if v, ok := signals["SettingTemperatureUnit"]; ok {
		s := toString(v)
		snap.SettingTemperatureUnit = &s
	}
	if v, ok := signals["SettingTirePressureUnit"]; ok {
		s := toString(v)
		snap.SettingTirePressureUnit = &s
	}
	if err := h.userPrefRepo.Insert(ctx, snap); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store user preference snapshot")
	}

	// Update vehicle_units with car display preferences
	if hasDist || hasTemp || hasPressure || hasCharge {
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
