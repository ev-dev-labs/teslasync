package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	telemetryfsm "github.com/ev-dev-labs/teslasync/internal/fsm/telemetry"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/rs/zerolog/log"
)

func (h *TelemetryHandler) liveStoreForTelemetry() signal.LiveSignalStore {
	if h.liveSignalStore != nil {
		return h.liveSignalStore
	}
	if h.signalStore == nil {
		return nil
	}
	liveStore, err := signal.NewHybridLiveSignalStore(h.signalStore, h.redisCache, signal.LiveSignalStoreModeHybrid)
	if err != nil {
		log.Error().Err(err).Msg("telemetry: failed to construct fallback live signal store")
		return nil
	}
	return liveStore
}

func (h *TelemetryHandler) updateLiveSignals(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
	liveStore := h.liveStoreForTelemetry()
	if liveStore == nil {
		return
	}
	if err := liveStore.UpdateNonBlocking(ctx, vehicleID, signals); err != nil {
		log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("telemetry: live signal store update failed")
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

	// Phase-42 (prompt 0079a): the legacy telemetry.CanonicalizeMap alias
	// rewrite was a no-op (SignalAliases was empty in internal/telemetry/
	// signal_alias.go) and was removed alongside the internal/telemetry
	// package retirement. Future Tesla signal renames belong in the
	// generated protomodel/router layer (internal/tesla/protomodel +
	// internal/tesla/router/routing.yaml), not in a parallel alias map.

	// Find vehicle by VIN (needed for SignalStore keying and all downstream)
	var vehicleID int64
	err := h.db.Pool.QueryRow(ctx, "SELECT id FROM vehicles WHERE vin = $1", vin).Scan(&vehicleID)
	if err != nil {
		log.Warn().Err(err).Str("vin", vin).Msg("telemetry: vehicle not found or DB error")
	}

	// Update LiveSignalStore once per batch: local L1 is synchronous for FSM,
	// sessions, and snapshot merge; Redis L2 mirroring is bounded and async.
	if vehicleID > 0 {
		h.updateLiveSignals(ctx, vehicleID, signals)
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
	// per-table wire format. After phase-42 (prompts 0077, 0078, 0079a) the
	// only surviving hot table is `positions` — the climate / charging /
	// motor / vehicle_live_state / security tables were dropped CASCADE and
	// per-field updates are delivered via the dedicated `signal_change`
	// channel (prompt 0071). The wire shape stays {vehicle_id, ts, tables}
	// so the frontend's vehicle_update consumer (web/src/lib/sseManager.ts)
	// keeps working unchanged.
	if h.eventHub != nil && vehicleID > 0 {
		ts := time.Now().UTC()
		hotRows := map[string]map[string]any{}
		if pos := h.extractPosition(signals); pos != nil {
			row := positionToHotRow(*pos)
			if len(row) > 0 {
				hotRows["positions"] = row
			}
		}
		h.broadcastSSE(buildSSEPayload(vehicleID, ts, hotRows))
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

			// Phase-42 (prompt 0077): trackMileage / trackSecurity /
			// trackUserPreferences were removed with the daily_mileage,
			// security_events, and vehicle_units tables. The underlying
			// signals (Odometer, Locked, SentryMode, DoorState, FdWindow,
			// SettingDistanceUnit, etc.) still flow through the typed
			// signal_log pipeline (000167+). Per-vehicle unit display
			// preferences are now persisted via internal/tesla/unit_history
			// → tesla_vehicle_unit_history.

			// Store vehicle config snapshots
			h.trackVehicleConfig(bgCtx, vehicleID, writeSignals)

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

// trackTirePressure stores tire pressure snapshots when TPMS signals arrive.

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

	// Build the signal map for downstream consumers. payload.Signals
	// preserves Tesla emission order on the wire, but ProcessSignals
	// operates on a map, so we collapse the ordered slice into a map
	// here. Enum-prefix stripping and compound flattening run inside
	// ProcessSignals via normalizeFleetUnits — which is idempotent for
	// these per-signal transforms — so callers don't need to pre-normalize.
	signals := make(map[string]interface{}, len(payload.Signals)+len(payload.Data))
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
			HTTPMethod: "POST",
			Endpoint:   fmt.Sprintf("/api/v1/telemetry (VIN: %s)", payload.VIN),
			StatusCode: int16(statusCode),
			DurationMs: int32(durationMs),
			Service:    "fleet-telemetry",
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

// ProcessBatch is the slice-oriented write-path entrypoint for callers that
// already have an ordered batch of codec.Atomic (decoded in Tesla emission
// order via internal/tesla/codec.Decode). Production ingest goes through
// (*internal/tesla/normalize.Pipeline).Process — see ADR-004 #2 — which
// already runs codec + normalize + router internally; this method is the
// thin adapter that integration tests and the legacy HTTP debug path use
// to feed pre-decoded atomics through the surrounding TelemetryHandler
// orchestration (FSM, session tracker, position writer, SSE).
//
// Phase-42 (prompt 0079a): the legacy bucket / buildHotRow / LookupHot
// fan-out was removed because every hot table other than `positions` was
// dropped CASCADE in prompt 0078. Cold residue and per-field updates are
// already handled by the typed signal_log pipeline (000167+) and the
// `signal_change` SSE channel (prompt 0071) downstream of this call.
func (h *TelemetryHandler) ProcessBatch(ctx context.Context, vin string, decoded []codec.Atomic) error {
	startedAt := time.Now()
	// Resolve vehicle by VIN up-front so downstream stages (FSM hooks,
	// position writer) all share the same identity columns. A missing
	// vehicle is fatal for this batch — without an FK we cannot persist
	// anything.
	veh, err := h.vehicleRepo.GetByVIN(ctx, vin)
	if err != nil || veh == nil {
		log.Warn().Err(err).Str("vin", vin).Msg("ProcessBatch: vehicle not found; dropping batch")
		return nil
	}
	vehicleID := veh.ID
	ts := time.Now().UTC()

	// Collapse the ordered atomics into a map so the FSM, position
	// extractor, and SSE wire-builder can keep their map-based contracts.
	// Order within a batch is preserved by codec.Decode; later atomics
	// for the same field win, matching the legacy NormalizeFleetUnits
	// behaviour where the last (most recent) value for a name was kept.
	signals := make(map[string]any, len(decoded))
	for _, a := range decoded {
		signals[a.Field] = a.Value
	}
	normalizeFleetUnits(signals)

	log.Debug().
		Int("atomics", len(decoded)).
		Int("unique_signals", len(signals)).
		Msg("ProcessBatch: decoded payload")

	// FSM hooks fire BEFORE write fan-out so connection-state, drive,
	// charge, and automation rule FSMs see every batch in arrival order.
	// Per prompt 27: even if writes fail, the FSM has already observed
	// the transition and follow-up batches keep its state coherent.
	//
	// 1. Connection FSM: per-vehicle health/staleness tracker. Lookup is
	//    guarded by connFSMMu; the map is initialised in NewTelemetryHandler
	//    (e516fef nil-map regression guard).
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
		cfsm.RecordBatch(len(decoded), "fleet_telemetry")
	}

	// 2. Vehicle/drive/charge FSM: feed it the same flattened signal map
	//    so its trackStateTransition / commitStateTransition logic sees
	//    every field. FSM internals are unchanged.
	if vehicleID > 0 && h.fsmHandler != nil {
		h.fsmHandler.ProcessSignals(ctx, vehicleID, signals)
	}

	// Position write — the only surviving hot-table destination after
	// prompt 0078. extractPosition returns nil if no GPS coordinates are
	// present, which keeps the table clean of (0,0) noise.
	hotRows := map[string]map[string]any{}
	if pos := h.extractPosition(signals); pos != nil {
		row := positionToHotRow(*pos)
		if len(row) > 0 {
			hotRows["positions"] = row
		}
		pos.VehicleID = vehicleID
		pos.Ts = ts
		pos.Source = "fleet_telemetry"
		if err := h.posRepo.BulkInsert(ctx, []models.Position{*pos}); err != nil {
			log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("ProcessBatch: failed to store position")
		}
	}

	// Typed-tables SSE broadcast (Phase 6 wire format, narrowed to
	// `positions` after prompt 0078). Uses Redis Pub/Sub when available
	// for multi-pod delivery.
	h.broadcastSSE(buildSSEPayload(vehicleID, ts, hotRows))

	log.Info().
		Str("vin", vin).
		Int64("vehicle_id", vehicleID).
		Int("atomics", len(decoded)).
		Int("unique_signals", len(signals)).
		Int("hot_rows", len(hotRows)).
		Dur("duration", time.Since(startedAt)).
		Msg("telemetry batch processed")

	return nil
}

// buildSSEPayload assembles the Phase-6 typed-tables SSE payload from the
// already-built hot rows. Wire shape:
//
//	{ vehicle_id, ts, tables: {<table>: {<col>: <val>}} }
//
// Empty hot rows are skipped. The frontend (Phase 7) reads
// tables.<name>.<column> instead of the legacy raw_state/signals jsonb shape.
//
// Phase-42 (prompt 0077): the `cold` array (signal_observations residue) was
// removed from the wire format. Cold signals flow through the typed
// signal_log pipeline (000167+) and SSE consumers receive them via the
// dedicated `signal_change` channel (prompt 0071).
func buildSSEPayload(vehicleID int64, ts time.Time, hotRows map[string]map[string]any) map[string]any {
	tables := map[string]map[string]any{}
	for table, row := range hotRows {
		if len(row) == 0 {
			continue
		}
		tables[table] = row
	}
	return map[string]any{
		"vehicle_id": vehicleID,
		"ts":         ts,
		"tables":     tables,
	}
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

// Phase-42 (prompt 0079a): the buildHotRow / bucketAtomics / bucketResult
// helpers and the cold-residue routing they implemented were removed
// alongside internal/telemetry. Hot-table fan-out is now narrowed to
// `positions` (the only surviving destination after prompt 0078); cold
// signals flow through the typed signal_log pipeline (000167+) downstream
// of this file.

// positionToHotRow folds a *models.Position into the SI column map the
// `positions` hypertable expects (lat / lng / heading_deg / speed_mps /
// altitude_m / gps_state — see internal/database/position_repo.go::
// positionColumns). Returns an empty map if no GPS coordinates are set
// so the caller can skip the SSE write entirely.
func positionToHotRow(p models.Position) map[string]any {
	if p.Latitude == 0 && p.Longitude == 0 {
		return map[string]any{}
	}
	row := map[string]any{
		"lat": p.Latitude,
		"lng": p.Longitude,
	}
	if p.Heading != nil {
		row["heading_deg"] = float64(*p.Heading)
	}
	if p.SpeedMph != nil {
		// SI canonical column is m/s; legacy models.Position carries mph.
		row["speed_mps"] = *p.SpeedMph * 0.44704
	}
	if p.ElevationM != nil {
		row["altitude_m"] = *p.ElevationM
	}
	if p.GpsState != nil {
		row["gps_state"] = *p.GpsState
	}
	return row
}

// normalizeFleetUnits applies the Tesla Fleet Telemetry enum-prefix
// stripping and compound-map flattening that the legacy
// internal/telemetry.NormalizeFleetUnits helper used to perform on the
// map-based ProcessSignals path. The map is mutated in place.
//
// Phase-42 forward-only note: production ingest goes through
// (*internal/tesla/normalize.Pipeline).Process which handles enum/unit
// conversion via the typed protomodel + units packages. This map-based
// helper exists ONLY for the legacy MQTT subscriber callback in
// cmd/teslasync/main.go (which still hands ProcessSignals a
// map[string]interface{}) and the HTTP debug ingest endpoint. A future
// prompt that switches main.go to mqtt.NewPipelineSubscriber will retire
// this helper alongside ProcessSignals.
func normalizeFleetUnits(signals map[string]interface{}) {
	for name, val := range signals {
		switch name {
		case "Gear":
			if parsed := enums.ParseGear(toString(val)); parsed != "" {
				signals[name] = parsed
			}
		case "ForwardCollisionWarning":
			signals[name] = enums.ParseForwardCollisionWarning(toString(val))
		case "LaneDepartureAvoidance":
			signals[name] = enums.ParseLaneDepartureAvoidance(toString(val))
		case "SpeedLimitWarning":
			signals[name] = enums.ParseSpeedLimitWarning(toString(val))
		case "CruiseFollowDistance":
			signals[name] = enums.ParseCruiseFollowDistance(toString(val))
		case "SentryMode":
			signals[name] = enums.ParseSentryMode(toString(val))
		case "CenterDisplay":
			signals[name] = enums.ParseCenterDisplay(toString(val))
		case "BMSState":
			signals[name] = enums.ParseBMSState(toString(val))
		case "ChargePort":
			signals[name] = enums.ParseChargePort(toString(val))
		case "ChargePortLatch":
			signals[name] = enums.ParseChargePortLatch(toString(val))
		case "ChargeState":
			signals[name] = enums.ParseChargeState(toString(val))
		case "DetailedChargeState":
			signals[name] = enums.ParseDetailedChargeState(toString(val))
		case "ScheduledChargingMode":
			signals[name] = enums.ParseScheduledChargingMode(toString(val))
		case "CabinOverheatProtectionMode":
			signals[name] = enums.ParseCabinOverheatMode(toString(val))
		case "ClimateKeeperMode":
			signals[name] = enums.ParseClimateKeeperMode(toString(val))
		case "LightsTurnSignal":
			signals[name] = enums.ParseTurnSignal(toString(val))
		case "TonneauPosition":
			signals[name] = enums.ParseTonneauPosition(toString(val))
		case "TonneauTentMode":
			signals[name] = enums.ParseTonneauTentMode(toString(val))
		case "DefrostMode":
			signals[name] = enums.ParseDefrostMode(toString(val))
		case "HvacAutoMode":
			signals[name] = enums.ParseHvacAutoMode(toString(val))
		case "FdWindow", "FpWindow", "RdWindow", "RpWindow":
			signals[name] = enums.ParseWindowState(toString(val))
		case "PowershareStatus":
			signals[name] = enums.ParsePowershareStatus(toString(val))
		case "PowershareStopReason":
			signals[name] = enums.ParsePowershareStopReason(toString(val))
		case "PowershareType":
			signals[name] = enums.ParsePowershareType(toString(val))
		}

		// Compound flattening for the same 5 signals the legacy
		// SignalRegistry classified as TypeDoors / TypeTireLocation /
		// TypeTime. Done in the same pass so each entry is visited
		// exactly once. Other compound signals (e.g., Location) are
		// handled by (*normalize.Pipeline).Process on the production
		// MQTT path and intentionally NOT touched by this legacy
		// helper.
		switch name {
		case "DoorState", "TpmsHardWarnings", "TpmsSoftWarnings":
			signals[name] = flattenCompoundMapValue(signals[name])
		case "ScheduledChargingStartTime", "ScheduledDepartureTime":
			signals[name] = flattenCompoundTimeValue(signals[name])
		}
	}
}

// flattenCompoundMapValue renders a {DriverFront,...} or {FrontLeft,...}
// compound map as a JSON string. Returns the input unchanged when it is
// already a string or has an unsupported shape — this matches the legacy
// internal/telemetry.flattenCompoundMap behaviour the FSM/SignalStore
// consumers depend on.
func flattenCompoundMapValue(v any) any {
	if v == nil {
		return v
	}
	if _, ok := v.(string); ok {
		return v
	}
	m, ok := v.(map[string]interface{})
	if !ok {
		return v
	}
	if inner, has := m["value"]; has {
		if innerMap, ok := inner.(map[string]interface{}); ok {
			m = innerMap
		} else if s, ok := inner.(string); ok {
			return s
		}
	}
	if jsonBytes, err := json.Marshal(m); err == nil {
		return string(jsonBytes)
	}
	return v
}

// flattenCompoundTimeValue renders a {hour, minute, second} compound as
// an "HH:MM:SS" string. Returns the input unchanged for malformed or
// out-of-range values rather than corrupting them to "00:00:00".
func flattenCompoundTimeValue(v any) any {
	if v == nil {
		return v
	}
	if _, ok := v.(string); ok {
		return v
	}
	m, ok := v.(map[string]interface{})
	if !ok {
		return v
	}
	if inner, has := m["value"]; has {
		if innerMap, ok := inner.(map[string]interface{}); ok {
			m = innerMap
		} else if s, ok := inner.(string); ok {
			return s
		}
	}
	hour, hOk := extractCompoundTimeField(m, "hour")
	minute, mOk := extractCompoundTimeField(m, "minute")
	if !hOk || !mOk {
		return v
	}
	second, _ := extractCompoundTimeField(m, "second")
	if hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59 {
		return v
	}
	return fmt.Sprintf("%02d:%02d:%02d", hour, minute, second)
}

// extractCompoundTimeField pulls an integer time component from a compound
// time map. Accepts the standard JSON-decoded number types plus json.Number.
func extractCompoundTimeField(m map[string]interface{}, key string) (int, bool) {
	v, ok := m[key]
	if !ok {
		return 0, false
	}
	switch val := v.(type) {
	case float64:
		return int(val), true
	case int:
		return val, true
	case int64:
		return int(val), true
	case json.Number:
		f, err := val.Float64()
		return int(f), err == nil
	}
	return 0, false
}
