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
	mqttClient     *mqtt.Client
	logRepo        *database.APICallLogRepo
	eventHub       *EventHub
	sessionTracker *TelemetrySessionTracker
	alertEvaluator *TelemetryAlertEvaluator

	// Per-vehicle streaming health tracking
	mu             sync.RWMutex
	streamingState map[string]*VehicleStreamState // keyed by VIN
}

// VehicleStreamState tracks streaming health per vehicle.
type VehicleStreamState struct {
	VIN          string                 `json:"vin"`
	LastReceived time.Time              `json:"last_received"`
	SignalCount  int64                  `json:"signal_count"`
	IsStreaming  bool                   `json:"is_streaming"`
	LastSignals  map[string]interface{} `json:"last_signals,omitempty"`
}

// NewTelemetryHandler creates a handler for fleet telemetry ingestion.
func NewTelemetryHandler(db *database.DB, mc *mqtt.Client, hub *EventHub) *TelemetryHandler {
	var eventBus *events.Bus
	if mc != nil {
		eventBus = events.NewBus(mc.Underlying())
	} else {
		eventBus = events.NewBus(nil)
	}
	return &TelemetryHandler{
		db:             db,
		posRepo:        database.NewPositionRepo(db),
		mqttClient:     mc,
		logRepo:        database.NewAPICallLogRepo(db),
		eventHub:       hub,
		sessionTracker: NewTelemetrySessionTracker(db, eventBus),
		alertEvaluator: NewTelemetryAlertEvaluator(db, eventBus),
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

// GetStreamingState returns streaming health for all vehicles.
func (h *TelemetryHandler) GetStreamingState() map[string]*VehicleStreamState {
	h.mu.RLock()
	defer h.mu.RUnlock()
	result := make(map[string]*VehicleStreamState, len(h.streamingState))
	for k, v := range h.streamingState {
		cp := *v
		cp.IsStreaming = time.Since(v.LastReceived) < 5*time.Minute
		result[k] = &cp
	}
	return result
}

// IsVehicleStreaming returns true if a vehicle has received telemetry within 5 minutes.
func (h *TelemetryHandler) IsVehicleStreaming(vin string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	state, ok := h.streamingState[vin]
	if !ok {
		return false
	}
	return time.Since(state.LastReceived) < 5*time.Minute
}

// ProcessSignals is the core telemetry processing pipeline. It stores position
// data in PostgreSQL, broadcasts to SSE clients, detects drive/charge sessions,
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
				// Location type: {latitude: ..., longitude: ...}
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
		state = &VehicleStreamState{VIN: vin}
		h.streamingState[vin] = state
	}
	state.LastReceived = time.Now()
	state.SignalCount += int64(len(signals))
	state.IsStreaming = true
	// Store a shallow copy of the latest signal batch for the status endpoint
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

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"enabled":  true,
		"endpoint": "/api/v1/telemetry",
		"protocol": "HTTP POST (JSON)",
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

// formatSignalName converts camelCase signal names to snake_case for MQTT topic consistency.
func formatSignalName(name string) string {
	return strings.ToLower(name)
}
