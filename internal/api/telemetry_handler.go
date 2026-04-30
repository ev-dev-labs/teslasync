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
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/rs/zerolog/log"
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
	liveSignalStore       signal.LiveSignalStore
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

	// Redis cache used for SSE Pub/Sub and as L2 when attached to LiveSignalStore.
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
