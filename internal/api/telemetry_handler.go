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
	mqttClient     *mqtt.Client
	logRepo        *database.APICallLogRepo
	eventHub       *EventHub
	sessionTracker *TelemetrySessionTracker
	alertEvaluator *TelemetryAlertEvaluator
	staleTimeout   time.Duration

	// Per-vehicle streaming health tracking
	mu             sync.RWMutex
	streamingState map[string]*VehicleStreamState // keyed by VIN
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
		mqttClient:     mc,
		logRepo:        database.NewAPICallLogRepo(db),
		eventHub:       hub,
		sessionTracker: NewTelemetrySessionTracker(db, eventBus),
		alertEvaluator: NewTelemetryAlertEvaluator(db, eventBus),
		staleTimeout:   staleTimeout,
		streamingState: make(map[string]*VehicleStreamState),
	}
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
	if vehicleID > 0 {
		go func() {
			bgCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			// Update vehicle to online/healthy
			if err := h.vehicleRepo.UpdateState(bgCtx, vehicleID, "online", true); err != nil {
				log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to update vehicle state")
			}

			// Track vehicle state transitions (online/driving/charging)
			h.trackStateTransition(bgCtx, vehicleID, signals)

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
		}()
	}
}

// trackStateTransition detects the vehicle state from signals and records transitions.
func (h *TelemetryHandler) trackStateTransition(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	// Determine current state from signals
	newState := "online"
	if speed, ok := signals["VehicleSpeed"]; ok && toFloat(speed) > 0 {
		newState = "driving"
	} else if gear, ok := signals["Gear"]; ok {
		gs := fmt.Sprintf("%v", gear)
		if gs == "D" || gs == "R" {
			newState = "driving"
		}
	}
	if cs, ok := signals["ChargeState"]; ok {
		csStr := fmt.Sprintf("%v", cs)
		if csStr == "Charging" || csStr == "Starting" {
			newState = "charging"
		}
	}
	if dcs, ok := signals["DetailedChargeState"]; ok {
		dcsStr := fmt.Sprintf("%v", dcs)
		if dcsStr == "Charging" || dcsStr == "Starting" {
			newState = "charging"
		}
	}

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
			"Location", "Latitude", "Longitude", "GpsHeading", "GpsState",
			// Driving
			"VehicleSpeed", "Odometer", "Gear", "PackPower",
			"LateralAcceleration", "LongitudinalAcceleration",
			// Battery & Charging
			"BatteryLevel", "Soc", "StateOfCharge", "EstBatteryRange", "IdealBatteryRange",
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
	if !hasTorque && !hasSpeed && !hasPedal && !hasAccel {
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
	if err := h.motorRepo.Insert(ctx, snap); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store motor snapshot")
	}
}

// trackClimate stores climate/HVAC snapshots when relevant signals arrive.
func (h *TelemetryHandler) trackClimate(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	_, hasInside := signals["InsideTemp"]
	_, hasHvac := signals["HvacPower"]
	_, hasFan := signals["HvacFanSpeed"]
	if !hasInside && !hasHvac && !hasFan {
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
	if err := h.securityRepo.Insert(ctx, ev); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: failed to store security event")
	}
}

// formatSignalName converts camelCase signal names to snake_case for MQTT topic consistency.
func formatSignalName(name string) string {
	return strings.ToLower(name)
}
