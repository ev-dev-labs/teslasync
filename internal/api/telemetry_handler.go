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
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/geocoding"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/signal"
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
	mqttClient     *mqtt.Client
	logRepo        *database.APICallLogRepo
	eventHub       *EventHub
	sessionTracker *TelemetrySessionTracker
	alertEvaluator *TelemetryAlertEvaluator
	staleTimeout   time.Duration
	signalStore    *signal.Store

	// Cancellable context for background goroutines — cancelled on Shutdown()
	bgCtx    context.Context
	bgCancel context.CancelFunc

	// Per-vehicle streaming health tracking
	mu             sync.RWMutex
	streamingState map[string]*VehicleStreamState // keyed by VIN

	// Per-vehicle write throttling to prevent DB overload
	lastWriteMu sync.Mutex
	lastWriteAt map[string]time.Time // keyed by VIN

	// Per-vehicle signal accumulator — merges signals across batches within throttle window
	accumulatedSignalsMu sync.Mutex
	accumulatedSignals   map[string]map[string]interface{} // keyed by VIN

	// Per-vehicle state machine — debounced vehicle state detection
	vehicleStateMu sync.Mutex
	vehicleStates  map[int64]*vehicleStateMachine // keyed by vehicleID

	// Raw telemetry capture (optional, backed by MongoDB)
	rawTelemetryRepo *database.RawTelemetryRepo
	captureEnabled   atomic.Bool
}

// vehicleStateMachine implements debounced state detection to prevent flapping.
// A state change must be confirmed for `confirmDuration` before being committed.
type vehicleStateMachine struct {
	currentState   string    // committed state in DB
	pendingState   string    // candidate state (not yet confirmed)
	pendingSince   time.Time // when the candidate was first seen
	lastDriveSpeed float64   // last non-zero speed (for hysteresis)
	lastSpeedTime  time.Time // when last non-zero speed was seen
}

const (
	// States must be observed for this duration before transition is committed.
	stateConfirmDuration = 30 * time.Second
	// After driving, stay in "driving" for this long even if speed=0 (e.g. at a red light).
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
		mqttClient:     mc,
		logRepo:        database.NewAPICallLogRepo(db),
		eventHub:       hub,
		sessionTracker: NewTelemetrySessionTracker(db, eventBus, geocoder),
		alertEvaluator: NewTelemetryAlertEvaluator(db, eventBus),
		staleTimeout:   staleTimeout,
		bgCtx:          bgCtx,
		bgCancel:       bgCancel,
		streamingState:     make(map[string]*VehicleStreamState),
		lastWriteAt:        make(map[string]time.Time),
		accumulatedSignals: make(map[string]map[string]interface{}),
		vehicleStates:      make(map[int64]*vehicleStateMachine),
	}
}

// SetRawTelemetryRepo enables raw telemetry signal capture to MongoDB.
func (h *TelemetryHandler) SetRawTelemetryRepo(repo *database.RawTelemetryRepo) {
	h.rawTelemetryRepo = repo
}

// SetSignalStore sets the in-memory signal store for real-time state tracking.
func (h *TelemetryHandler) SetSignalStore(store *signal.Store) {
	h.signalStore = store
}

// GetSignalStore returns the signal store (for use by other handlers).
func (h *TelemetryHandler) GetSignalStore() *signal.Store {
	return h.signalStore
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
		h.sessionTracker.CleanupStaleSessions(ctx, 30*time.Minute)
	}

	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.cleanupStaleEntries()
				// Also clean up stale drive/charge sessions
				if h.sessionTracker != nil {
					h.sessionTracker.CleanupStaleSessions(ctx, 30*time.Minute)
				}
			}
		}
	}()
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
				h.MarkVehicleOffline(ctx, vehicleID)
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
	// Raw telemetry capture — async insert to MongoDB when enabled (before normalization)
	if h.captureEnabled.Load() && h.rawTelemetryRepo != nil {
		source := "mqtt_subscriber"
		if publishToMQTT {
			source = "http_ingest"
		}
		rec := &models.RawTelemetrySignal{
			VIN:         vin,
			Source:      source,
			Signals:     signals,
			SignalCount: len(signals),
		}
		go func() {
			captureCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := h.rawTelemetryRepo.Insert(captureCtx, rec); err != nil {
				log.Warn().Err(err).Str("vin", vin).Msg("telemetry: failed to capture raw signals")
			}
		}()
	}

	// Normalize fleet telemetry units to metric. Tesla Fleet Telemetry sends
	// speed in mph, distances/ranges in miles, but the system stores in km/km·h
	// so the frontend conversion layer works consistently.
	normalizeFleetUnits(signals)

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

	// Extract position data from all supported signals
	pos := h.extractPosition(signals)

	// Store position
	if err == nil && pos != nil {
		pos.VehicleID = vehicleID
		if err := h.posRepo.Insert(ctx, pos); err != nil {
			log.Warn().Err(err).Str("vin", vin).Msg("telemetry: failed to store position")
		}
	}

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

	// Broadcast to SSE clients for real-time frontend updates
	if h.eventHub != nil {
		h.eventHub.Broadcast("vehicle_update", map[string]interface{}{
			"vin":        vin,
			"vehicle_id": vehicleID,
			"source":     "fleet_telemetry",
			"signals":    signals,
			"timestamp":  time.Now().UTC(),
		})
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
	// last-known values (battery, odometer, location) when starting new sessions —
	// the current batch may only contain VehicleSpeed.
	if vehicleID > 0 {
		h.accumulatedSignalsMu.Lock()
		accum := make(map[string]interface{})
		for k, v := range h.accumulatedSignals[vin] {
			accum[k] = v
		}
		h.accumulatedSignalsMu.Unlock()

		h.sessionTracker.ProcessSignals(ctx, vehicleID, vin, signals, accum)
		h.alertEvaluator.Evaluate(ctx, vehicleID, vin, signals)
	}

	// --- Async writes: state tracking, mileage, tire pressure, vehicle health ---
	// Throttle snapshot writes to once every 10 seconds per vehicle to prevent
	// DB connection pool exhaustion from high-frequency telemetry batches.
	// Signals are accumulated across batches within the throttle window so that
	// individual MQTT messages don't cause data loss.
	if vehicleID > 0 {
		const snapshotWriteInterval = 10 * time.Second

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
			// First signal for this vehicle — start the throttle timer but don't write yet.
			// Let the accumulator collect signals for the full interval first.
			h.lastWriteAt[vin] = time.Now().UTC()
		} else if shouldWrite {
			h.lastWriteAt[vin] = time.Now().UTC()
		}
		h.lastWriteMu.Unlock()

		go func() {
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

			// State machine handles state transitions with debouncing
			if shouldWrite && writeSignals != nil {
				h.trackStateTransition(bgCtx, vehicleID, writeSignals)
			}

			// Throttled snapshot writes — only run every 10s per vehicle
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
		}()
	}
}

// detectVehicleState determines the vehicle state from telemetry signals.
// Uses signal priority: driving > charging > online.
func (h *TelemetryHandler) detectVehicleState(signals map[string]interface{}) string {
	// Priority 1: Driving — speed > 1 km/h or Gear in D/R (ShiftStateDrive/ShiftStateReverse)
	if speed, ok := toFloatOk(signals["VehicleSpeed"]); ok && speed > 1.0 {
		return "driving"
	}
	if gear, ok := signals["Gear"]; ok {
		gs := toString(gear)
		if strings.Contains(gs, "Drive") || strings.Contains(gs, "Reverse") || gs == "D" || gs == "R" {
			return "driving"
		}
	}

	// Priority 2: Charging — explicit charge state or active charge current (> 1A)
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

	// Priority 3: Parked — Gear in P (ShiftStatePark)
	if gear, ok := signals["Gear"]; ok {
		gs := toString(gear)
		if strings.Contains(gs, "Park") || gs == "P" {
			return "parked"
		}
	}

	return "online"
}

// trackStateTransition uses a debounced state machine to prevent state flapping.
//
// Design principles:
//   - Driving entry is IMMEDIATE (no delay) — we never want to miss a drive start
//   - Driving exit requires 2 min of no speed (driveHoldDuration) — red lights, brief stops
//   - All other transitions require 30s of consistent observation (stateConfirmDuration)
//   - "offline" is set externally by MarkVehicleOffline when telemetry stops arriving
func (h *TelemetryHandler) trackStateTransition(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	candidateState := h.detectVehicleState(signals)
	now := time.Now().UTC()

	h.vehicleStateMu.Lock()
	sm, exists := h.vehicleStates[vehicleID]
	if !exists {
		currentDB, _ := h.stateRepo.GetCurrentState(ctx, vehicleID)
		if currentDB == "" {
			currentDB = "online"
		}
		sm = &vehicleStateMachine{currentState: currentDB}
		h.vehicleStates[vehicleID] = sm
	}

	// Track last speed for drive hold hysteresis
	if candidateState == "driving" {
		if speed, ok := toFloatOk(signals["VehicleSpeed"]); ok && speed > 0 {
			sm.lastDriveSpeed = speed
			sm.lastSpeedTime = now
		}
	}

	// Drive hold: if currently driving and speed was seen within driveHoldDuration,
	// suppress transitions to online/parked (handles red lights, brief stops)
	if sm.currentState == "driving" && (candidateState == "online" || candidateState == "parked") {
		if !sm.lastSpeedTime.IsZero() && now.Sub(sm.lastSpeedTime) < driveHoldDuration {
			candidateState = "driving"
		}
	}

	// If candidate matches current, reset pending — no transition needed
	if candidateState == sm.currentState {
		sm.pendingState = ""
		sm.pendingSince = time.Time{}
		h.vehicleStateMu.Unlock()
		return
	}

	// Fast path: entering "driving" is immediate (no confirmation delay)
	if candidateState == "driving" && sm.currentState != "driving" {
		sm.currentState = candidateState
		sm.pendingState = ""
		sm.pendingSince = time.Time{}
		sm.lastSpeedTime = now
		h.vehicleStateMu.Unlock()
		h.commitStateTransition(ctx, vehicleID, candidateState)
		return
	}

	// All other transitions require confirmation period
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

	// Confirmed — commit
	sm.currentState = candidateState
	sm.pendingState = ""
	sm.pendingSince = time.Time{}
	h.vehicleStateMu.Unlock()
	h.commitStateTransition(ctx, vehicleID, candidateState)
}

func (h *TelemetryHandler) commitStateTransition(ctx context.Context, vehicleID int64, newState string) {
	if err := h.stateRepo.EndCurrent(ctx, vehicleID); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to end current state")
	}
	if _, err := h.stateRepo.Insert(ctx, vehicleID, newState); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Str("state", newState).Msg("telemetry: failed to insert state")
	}
	if err := h.vehicleRepo.UpdateState(ctx, vehicleID, newState, true); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to update vehicle state")
	}
	log.Info().Int64("vehicle_id", vehicleID).Str("state", newState).Msg("telemetry: state transition confirmed")
}

// MarkVehicleOffline transitions a vehicle to "offline" when telemetry stops arriving.
func (h *TelemetryHandler) MarkVehicleOffline(ctx context.Context, vehicleID int64) {
	h.vehicleStateMu.Lock()
	sm, exists := h.vehicleStates[vehicleID]
	if exists && sm.currentState == "offline" {
		h.vehicleStateMu.Unlock()
		return
	}
	if exists {
		sm.currentState = "offline"
		sm.pendingState = ""
	}
	h.vehicleStateMu.Unlock()
	h.commitStateTransition(ctx, vehicleID, "offline")
}

// trackMileage updates daily mileage when odometer readings are present.
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

	// Log the ingest (sampled — only log every 100th to avoid flooding)
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

	// Location — may come as Location object or separate Latitude/Longitude
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
		// No GPS location — still create position if we have battery/temp/speed data
		hasBattery := false
		if _, ok := signals["BatteryLevel"]; ok {
			hasBattery = true
		} else if _, ok := signals["Soc"]; ok {
			hasBattery = true
		}
		_, hasTemp := signals["InsideTemp"]
		_, hasOutTemp := signals["OutsideTemp"]
		_, hasSpeed := signals["VehicleSpeed"]
		_, hasOdometer := signals["Odometer"]
		if !hasBattery && !hasTemp && !hasOutTemp && !hasSpeed && !hasOdometer {
			return nil
		}
	}

	// Driving signals
	if v, ok := signals["VehicleSpeed"]; ok {
		if f, fok := toFloatOk(v); fok {
			pos.Speed = &f
		}
	}
	// Power — Tesla Fleet Telemetry has no "PackPower" signal; compute from
	// PackVoltage (V) × PackCurrent (A) → kW.  Fall back to PackPower for
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

	// Battery & range — use toFloatOk to distinguish 0% from missing signal
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

	// Odometer — use toFloatOk to avoid storing 0 for missing signal
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

	// Compute aggregate metrics
	totalSignals := int64(0)
	totalBatches := int64(0)
	streamingCount := 0
	avgSignalsPerSec := 0.0
	for _, v := range streamingVehicles {
		totalSignals += v.SignalCount
		totalBatches += v.BatchCount
		if v.IsStreaming {
			streamingCount++
			avgSignalsPerSec += v.SignalsPerSecond
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"enabled":  true,
		"mode":     "primary",
		"endpoint": "/api/v1/telemetry",
		"protocol": "HTTP POST (JSON) + MQTT",
		"speed_comparison": map[string]interface{}{
			"fleet_telemetry_latency": "<100ms (real-time via MQTT)",
			"fleet_api_polling":       "15,000ms (15s intervals)",
			"speedup":                 "~150x faster with Fleet Telemetry",
		},
		"aggregate_stats": map[string]interface{}{
			"streaming_vehicles":       streamingCount,
			"total_vehicles_seen":      len(streamingVehicles),
			"total_signals_received":   totalSignals,
			"total_batches_processed":  totalBatches,
			"avg_signals_per_second":   fmt.Sprintf("%.1f", avgSignalsPerSec),
			"stale_timeout":            h.staleTimeout.String(),
		},
		"supported_signals": SubscribedSignals,
		"mqtt_publishing":    h.mqttClient != nil,
		"streaming_vehicles": streamingVehicles,
	})
}

const (
	milesToKm = 1.60934
	mphToKmh  = 1.60934
)

// normalizeFleetUnits converts Tesla Fleet Telemetry signals from their native
// units (miles, mph) to the metric units the system stores (km, km/h).
// Temperatures (Celsius) and pressure (bar) are already metric.
func normalizeFleetUnits(signals map[string]interface{}) {
	// Speed: mph → km/h
	if v, ok := toFloatOk(signals["VehicleSpeed"]); ok {
		signals["VehicleSpeed"] = v * mphToKmh
	}
	if v, ok := toFloatOk(signals["CruiseSetSpeed"]); ok {
		signals["CruiseSetSpeed"] = v * mphToKmh
	}
	if v, ok := toFloatOk(signals["CurrentLimitMph"]); ok {
		signals["CurrentLimitMph"] = v * mphToKmh
	}

	// Distance: miles → km
	if v, ok := toFloatOk(signals["Odometer"]); ok {
		signals["Odometer"] = v * milesToKm
	}
	if v, ok := toFloatOk(signals["EstBatteryRange"]); ok {
		signals["EstBatteryRange"] = v * milesToKm
	}
	if v, ok := toFloatOk(signals["IdealBatteryRange"]); ok {
		signals["IdealBatteryRange"] = v * milesToKm
	}
	if v, ok := toFloatOk(signals["RatedRange"]); ok {
		signals["RatedRange"] = v * milesToKm
	}
	if v, ok := toFloatOk(signals["MilesToArrival"]); ok {
		signals["MilesToArrival"] = v * milesToKm
	}

	// Charge rate: mph → km/h
	if v, ok := toFloatOk(signals["ChargeRateMilePerHour"]); ok {
		signals["ChargeRateMilePerHour"] = v * mphToKmh
	}
}

func toFloat(v interface{}) float64 {
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
	// Tesla sends {"invalid": true} for signals that can't be measured
	if m, ok := v.(map[string]interface{}); ok {
		if inv, ok := m["invalid"]; ok {
			if b, ok := inv.(bool); ok && b {
				return 0, false
			}
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
		// HvacPower is an enum (HvacPowerState) — map to float for DB compatibility:
		// "On"/"Precondition" → 1.0, "Off" → 0.0
		s := toString(v)
		if strings.Contains(s, "On") || strings.Contains(s, "Precondition") {
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
		// DefrostMode is an enum (DefrostModeState) — any non-Off state is true
		s := toString(v)
		b := !strings.Contains(s, "Off") && s != "" && s != "0" && s != "false"
		snap.DefrostMode = &b
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
		// SentryMode is an enum (SentryModeState) — any non-Off state is true
		s := toString(v)
		b := !strings.Contains(s, "Off") && s != "" && s != "0" && s != "false"
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
		b := toBool(v)
		ev.SpeedLimitMode = &b
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
	// Note: PackVoltage/PackCurrent excluded from gate — they're always sent
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
	_, hasStatus := signals["MediaPlaybackStatus"]
	if !hasTitle && !hasStatus {
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
	if err := h.mediaRepo.Insert(ctx, snap); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store media snapshot")
	}
}

// trackVehicleConfig stores vehicle configuration snapshots when relevant signals arrive.
func (h *TelemetryHandler) trackVehicleConfig(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	_, hasVersion := signals["Version"]
	_, hasName := signals["VehicleName"]
	_, hasCarType := signals["CarType"]
	if !hasVersion && !hasName && !hasCarType {
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
	if !hasDest && !hasMiles && !hasRoute && !hasLocation && !hasRouteUpdated {
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
		b := toBool(v)
		snap.GpsState = &b
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
		b := toBool(v)
		snap.BlindSpotCollisionWarning = &b
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
	if !hasDist && !hasTemp {
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
}

// formatSignalName converts camelCase signal names to snake_case for MQTT topic consistency.
var _ = formatSignalName // kept for potential future use
func formatSignalName(name string) string {
	return strings.ToLower(name)
}

// ─── Raw Telemetry Capture API ──────────────────────────────────────────────

// CaptureList returns captured raw telemetry signals, paginated.
// Query params: ?vin=, ?limit=, ?offset=
func (h *TelemetryHandler) CaptureList(w http.ResponseWriter, r *http.Request) {
	if h.rawTelemetryRepo == nil {
		writeError(w, http.StatusServiceUnavailable, "MongoDB not configured — telemetry capture unavailable")
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
		writeError(w, http.StatusServiceUnavailable, "MongoDB not configured — telemetry capture unavailable")
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
		writeError(w, http.StatusServiceUnavailable, "MongoDB not configured — telemetry capture unavailable")
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
