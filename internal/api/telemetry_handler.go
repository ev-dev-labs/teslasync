package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/events"
	telemetryfsm "github.com/ev-dev-labs/teslasync/internal/fsm/telemetry"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/normalize"
)

// pipelineDispatcher is the interface seam through which TelemetryHandler
// dispatches pre-decoded telemetry batches to the unified normalize.Pipeline.
// Production wiring substitutes the concrete *normalize.Pipeline (which
// satisfies this interface via its public ProcessAtomics method, added in
// Phase-42a/0060). Tests substitute a recording fake to assert dispatch
// behaviour without standing up the full pipeline + writers + observers.
//
// The interface lives here (not in the normalize package) so the api
// package owns the seam — normalize.Pipeline must not know about its
// callers per ADR-004 #2's "single pipeline, two adapters" shape.
type pipelineDispatcher interface {
	ProcessAtomics(ctx context.Context, atomics []codec.Atomic, vehicleIntID int64) error
}

// Compile-time guard: TelemetryHandler must satisfy mqtt.StreamingHealthRecorder
// so the PipelineSubscriber can notify the MQTT Inspector of per-VIN
// streaming activity (Phase-48 fix — pre-fix the inspector silently
// zeroed out after the per-field MQTT cutover).
var _ mqtt.StreamingHealthRecorder = (*TelemetryHandler)(nil)

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

	// pipeline is THE unified ingest dispatcher (Phase-42a/0060). HTTP
	// webhook batches and (post-0050) MQTT batches both terminate in
	// normalize.Pipeline.ProcessAtomics so ADR-004 #2's "single pipeline,
	// every value visited exactly once" invariant holds across both
	// ingress paths. Wired by cmd/teslasync via SetPipeline AFTER
	// normalize.New is constructed; nil while the dispatcher is being
	// stood up at process start. ProcessBatch returns a "pipeline not
	// wired" error if invoked before SetPipeline has run, so a
	// misconfigured production deployment fails loud rather than
	// silently swallowing batches.
	pipeline pipelineDispatcher
}

// SetPipeline wires the unified ingest dispatcher used by ProcessBatch
// (Phase-42a/0060). Accepting *normalize.Pipeline (rather than the
// internal pipelineDispatcher interface) on the public seam preserves
// Decision #1 of the prompt: only the canonical normalize.Pipeline is
// allowed to satisfy the field on the production wire path. Passing
// nil clears the dispatcher, which causes subsequent ProcessBatch
// calls to fail with "pipeline not wired" — useful for shutdown
// drains where new batches must be rejected.
func (h *TelemetryHandler) SetPipeline(p *normalize.Pipeline) {
	if p == nil {
		h.pipeline = nil
		return
	}
	h.pipeline = p
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
