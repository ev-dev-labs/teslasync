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
	"github.com/ev-dev-labs/teslasync/internal/events"
	telemetryfsm "github.com/ev-dev-labs/teslasync/internal/fsm/telemetry"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/rs/zerolog/log"
)

// TelemetryHandler receives and processes Tesla Fleet Telemetry data.
type TelemetryHandler struct {
	db                    *database.DB
	posRepo               *database.PositionRepo
	vehicleRepo           *database.VehicleRepo
	swUpdateRepo          *database.SoftwareUpdateRepo
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

// Phase-42 (prompt 0077): trackSecurity was deleted with security_repo.go.
// Security signals (Locked, SentryMode, DoorState, FdWindow, etc.) flow
// through the typed signal_log pipeline (000167+); the legacy snapshot
// row writer has no SI replacement.

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

// Phase-42 (prompt 0077): trackUserPreferences was deleted with the
// vehicle_units table. Per-vehicle unit display preferences now live in
// tesla_vehicle_unit_history (000181) populated by internal/tesla/unit_history.

// formatSignalName converts camelCase signal names to snake_case for MQTT topic consistency.
var _ = formatSignalName // kept for potential future use
func formatSignalName(name string) string {
	return strings.ToLower(name)
}
