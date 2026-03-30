package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
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

	// Per-vehicle streaming health tracking
	mu             sync.RWMutex
	streamingState map[string]*VehicleStreamState // keyed by VIN

	// Per-vehicle write throttling to prevent DB overload
	lastWriteMu sync.Mutex
	lastWriteAt map[string]time.Time // keyed by VIN
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
	LatencyMs        int64                  `json:"latency_ms"`        // age of data in milliseconds
	UptimeSeconds    float64                `json:"uptime_seconds"`    // how long vehicle has been streaming
	LastSignals      map[string]interface{} `json:"last_signals,omitempty"`
}

// NewTelemetryHandler creates a handler for fleet telemetry ingestion.
func NewTelemetryHandler(db *database.DB, mc *mqtt.Client, hub *EventHub, staleTimeout time.Duration) *TelemetryHandler {
	var eventBus *events.Bus
	if mc != nil {
		eventBus = events.NewBus(mc.Underlying())
	} else {
		eventBus = events.NewBus(nil)
	}
	if staleTimeout <= 0 {
		staleTimeout = 5 * time.Minute
	}
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
		sessionTracker: NewTelemetrySessionTracker(db, eventBus),
		alertEvaluator: NewTelemetryAlertEvaluator(db, eventBus),
		staleTimeout:   staleTimeout,
		streamingState: make(map[string]*VehicleStreamState),
		lastWriteAt:    make(map[string]time.Time),
	}
}

// StartCleanup runs periodic cleanup of stale streaming state entries.
// Call this once at startup; it stops when ctx is cancelled.
func (h *TelemetryHandler) StartCleanup(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.cleanupStaleEntries()
			}
		}
	}()
}

func (h *TelemetryHandler) cleanupStaleEntries() {
	now := time.Now()
	cutoff := 3 * h.staleTimeout // remove entries 3x past stale timeout

	h.mu.Lock()
	for vin, state := range h.streamingState {
		if now.Sub(state.LastReceived) > cutoff {
			delete(h.streamingState, vin)
		}
	}
	h.mu.Unlock()

	h.lastWriteMu.Lock()
	for vin, lastWrite := range h.lastWriteAt {
		if now.Sub(lastWrite) > cutoff {
			delete(h.lastWriteAt, vin)
		}
	}
	h.lastWriteMu.Unlock()
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
	now := time.Now()
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
	// Extract position data from all supported signals
	pos := h.extractPosition(signals)

	// Find vehicle by VIN and store position
	var vehicleID int64
	err := h.db.Pool.QueryRow(ctx, "SELECT id FROM vehicles WHERE vin = $1", vin).Scan(&vehicleID)
	if err != nil {
		log.Warn().Err(err).Str("vin", vin).Msg("telemetry: vehicle not found or DB error")
	}
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
		state = &VehicleStreamState{VIN: vin, FirstReceived: time.Now()}
		h.streamingState[vin] = state
	}
	state.LastReceived = time.Now()
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

	// Drive/charge session detection from streaming signals
	if vehicleID > 0 {
		h.sessionTracker.ProcessSignals(ctx, vehicleID, vin, signals)
		h.alertEvaluator.Evaluate(ctx, vehicleID, vin, signals)
	}

	// --- Async writes: state tracking, mileage, tire pressure, vehicle health ---
	// Throttle snapshot writes to once every 10 seconds per vehicle to prevent
	// DB connection pool exhaustion from high-frequency telemetry batches.
	if vehicleID > 0 {
		const snapshotWriteInterval = 10 * time.Second
		h.lastWriteMu.Lock()
		lastWrite := h.lastWriteAt[vin]
		shouldWrite := time.Since(lastWrite) >= snapshotWriteInterval
		if shouldWrite {
			h.lastWriteAt[vin] = time.Now()
		}
		h.lastWriteMu.Unlock()

		go func() {
			bgCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			// Always update vehicle state (lightweight, single UPDATE)
			if shouldWrite {
				detectedState := h.detectVehicleState(signals)
				if err := h.vehicleRepo.UpdateState(bgCtx, vehicleID, detectedState, true); err != nil {
					log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to update vehicle state")
				}
				h.trackStateTransition(bgCtx, vehicleID, signals)
			}

			// Throttled snapshot writes — only run every 10s per vehicle
			if !shouldWrite {
				return
			}

			// Update daily mileage from odometer readings
			h.trackMileage(bgCtx, vehicleID, signals)

			// Store tire pressure snapshots
			h.trackTirePressure(bgCtx, vehicleID, signals)

			// Store motor/powertrain snapshots
			h.trackMotor(bgCtx, vehicleID, signals)

			// Store climate/HVAC snapshots
			h.trackClimate(bgCtx, vehicleID, signals)

			// Store security events
			h.trackSecurity(bgCtx, vehicleID, signals)

			// Store charging telemetry
			h.trackCharging(bgCtx, vehicleID, signals)

			// Store media snapshots
			h.trackMedia(bgCtx, vehicleID, signals)

			// Store vehicle config snapshots
			h.trackVehicleConfig(bgCtx, vehicleID, signals)

			// Store location/navigation snapshots
			h.trackLocation(bgCtx, vehicleID, signals)

			// Store safety settings snapshots
			h.trackSafety(bgCtx, vehicleID, signals)

			// Store user preference snapshots
			h.trackUserPreferences(bgCtx, vehicleID, signals)
		}()
	}
}

// detectVehicleState determines the vehicle state from telemetry signals.
func (h *TelemetryHandler) detectVehicleState(signals map[string]interface{}) string {
	// Check for driving state
	if speed, ok := signals["VehicleSpeed"]; ok && toFloat(speed) > 0 {
		return "driving"
	}
	if gear, ok := signals["Gear"]; ok {
		gs := fmt.Sprintf("%v", gear)
		if gs == "D" || gs == "R" {
			return "driving"
		}
	}

	// Check for charging state
	if cs, ok := signals["ChargeState"]; ok {
		csStr := fmt.Sprintf("%v", cs)
		if csStr == "Charging" || csStr == "Starting" {
			return "charging"
		}
	}
	if dcs, ok := signals["DetailedChargeState"]; ok {
		dcsStr := fmt.Sprintf("%v", dcs)
		if dcsStr == "Charging" || dcsStr == "Starting" {
			return "charging"
		}
	}
	// Infer charging from rate/amps when ChargeState isn't sent
	if rate, ok := signals["ChargeRateMilePerHour"]; ok && toFloat(rate) > 0 {
		return "charging"
	}
	if amps, ok := signals["ChargeAmps"]; ok && toFloat(amps) > 0 {
		return "charging"
	}

	return "online"
}

// trackStateTransition detects the vehicle state from signals and records transitions.
func (h *TelemetryHandler) trackStateTransition(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	newState := h.detectVehicleState(signals)

	currentState, _ := h.stateRepo.GetCurrentState(ctx, vehicleID)
	if currentState == newState {
		return // no transition
	}

	// Close previous state and open new one
	if currentState != "" {
		if err := h.stateRepo.EndCurrent(ctx, vehicleID); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to end current state")
		}
	}
	if _, err := h.stateRepo.Insert(ctx, vehicleID, newState); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Str("state", newState).Msg("telemetry: failed to insert state")
	}
}

// trackMileage updates daily mileage when odometer readings are present.
func (h *TelemetryHandler) trackMileage(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	odomVal, ok := signals["Odometer"]
	if !ok {
		return
	}
	odometer := toFloat(odomVal)
	if odometer <= 0 {
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
		return // no tire pressure in this batch
	}

	snap := &models.TirePressureSnapshot{VehicleID: vehicleID}
	if flOk {
		v := toFloat(fl)
		snap.FrontLeft = &v
	}
	if frOk {
		v := toFloat(fr)
		snap.FrontRight = &v
	}
	if rlOk {
		v := toFloat(rl)
		snap.RearLeft = &v
	}
	if rrOk {
		v := toFloat(rr)
		snap.RearRight = &v
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
	start := time.Now()
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
		pos.Latitude = toFloat(loc["latitude"])
		pos.Longitude = toFloat(loc["longitude"])
		hasLocation = pos.Latitude != 0 || pos.Longitude != 0
	}
	if v, ok := signals["Latitude"]; ok {
		pos.Latitude = toFloat(v)
		hasLocation = true
	}
	if v, ok := signals["Longitude"]; ok {
		pos.Longitude = toFloat(v)
		hasLocation = true
	}

	if !hasLocation {
		return nil
	}

	// Driving signals
	if v, ok := signals["VehicleSpeed"]; ok {
		f := toFloat(v)
		pos.Speed = &f
	}
	if v, ok := signals["PackPower"]; ok {
		f := toFloat(v)
		pos.Power = &f
	}
	if v, ok := signals["GpsHeading"]; ok {
		i := int(toFloat(v))
		pos.Heading = &i
	} else if v, ok := signals["Heading"]; ok {
		i := int(toFloat(v))
		pos.Heading = &i
	}

	// Battery & range
	if v, ok := signals["BatteryLevel"]; ok {
		pos.BatteryLvl = int(toFloat(v))
	} else if v, ok := signals["Soc"]; ok {
		pos.BatteryLvl = int(toFloat(v))
	} else if v, ok := signals["StateOfCharge"]; ok {
		pos.BatteryLvl = int(toFloat(v))
	}
	if v, ok := signals["IdealBatteryRange"]; ok {
		f := toFloat(v)
		pos.IdealRange = &f
	}
	if v, ok := signals["EstBatteryRange"]; ok {
		f := toFloat(v)
		pos.RatedRange = &f
	}

	// Climate
	if v, ok := signals["InsideTemp"]; ok {
		f := toFloat(v)
		pos.InsideTemp = &f
	}
	if v, ok := signals["OutsideTemp"]; ok {
		f := toFloat(v)
		pos.OutsideTemp = &f
	}

	// Odometer
	if v, ok := signals["Odometer"]; ok {
		pos.Odometer = toFloat(v)
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
		"supported_signals": []string{
			// Location
			"Location", "GpsHeading", "GpsState",
			// Driving
			"VehicleSpeed", "Odometer", "Gear",
			"LateralAcceleration", "LongitudinalAcceleration",
			// Battery & Charging
			"BatteryLevel", "Soc", "EstBatteryRange", "IdealBatteryRange",
			"EnergyRemaining", "ChargeState", "DetailedChargeState",
			"ChargeAmps", "ChargerVoltage", "ChargerPhases", "ChargeLimitSoc",
			"ChargeCurrentRequest", "ChargeRateMilePerHour", "DCChargingPower", "ACChargingPower",
			"FastChargerPresent", "FastChargerType", "ChargingCableType",
			// Climate
			"InsideTemp", "OutsideTemp", "HvacPower", "HvacFanSpeed",
			"HvacLeftTemperatureRequest", "HvacRightTemperatureRequest",
			"CabinOverheatProtectionMode", "DefrostMode",
			// Vehicle State
			"Locked", "DoorState", "FdWindow", "FpWindow",
			"SentryMode", "HomelinkNearby", "GuestModeEnabled",
			// TPMS
			"TpmsPressureFl", "TpmsPressureFr", "TpmsPressureRl", "TpmsPressureRr",
		},
		"mqtt_publishing":    h.mqttClient != nil,
		"streaming_vehicles": streamingVehicles,
	})
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

func formatFloat(v float64) string {
	if v == float64(int64(v)) {
		return fmt.Sprintf("%d", int64(v))
	}
	return fmt.Sprintf("%.6f", v)
}

func toString(v interface{}) string {
	switch val := v.(type) {
	case string:
		return val
	case float64:
		return fmt.Sprintf("%v", val)
	case bool:
		if val {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprintf("%v", val)
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
		f := toFloat(v)
		snap.HvacPower = &f
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
		b := toBool(v)
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
	if v, ok := signals["CabinOverheatProtectionTempLimit"]; ok {
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

	ev := &models.SecurityEvent{VehicleID: vehicleID}
	if v, ok := signals["Locked"]; ok {
		b := toBool(v)
		ev.Locked = &b
	}
	if v, ok := signals["SentryMode"]; ok {
		b := toBool(v)
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
	}
}

// trackCharging stores charging telemetry when relevant signals arrive.
func (h *TelemetryHandler) trackCharging(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	_, hasChargeState := signals["ChargeState"]
	_, hasDetailedCharge := signals["DetailedChargeState"]
	_, hasDCPower := signals["DCChargingPower"]
	_, hasACPower := signals["ACChargingPower"]
	_, hasBatteryLevel := signals["BatteryLevel"]
	_, hasSoc := signals["Soc"]
	_, hasChargeRate := signals["ChargeRateMilePerHour"]
	_, hasChargeAmps := signals["ChargeAmps"]
	if !hasChargeState && !hasDetailedCharge && !hasDCPower && !hasACPower && !hasBatteryLevel && !hasSoc && !hasChargeRate && !hasChargeAmps {
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
	if v, ok := signals["BmsState"]; ok {
		s := toString(v)
		snap.BmsState = &s
	}
	if v, ok := signals["BmsFullchargecomplete"]; ok {
		b := toBool(v)
		snap.BmsFullchargeComplete = &b
	}
	if v, ok := signals["DcdcEnable"]; ok {
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
	if v, ok := signals["PowersharePowerKw"]; ok {
		f := toFloat(v)
		snap.PowersharePowerKw = &f
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
	if v, ok := signals["SoftwareUpdateInstallPercentComplete"]; ok {
		i := int(toFloat(v))
		snap.SoftwareUpdateInstallPct = &i
	}
	if v, ok := signals["SoftwareUpdateExpectedDurationMinutes"]; ok {
		i := int(toFloat(v))
		snap.SoftwareUpdateExpectedDuration = &i
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
	if !hasDest && !hasMiles && !hasRoute {
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
func formatSignalName(name string) string {
	return strings.ToLower(name)
}
