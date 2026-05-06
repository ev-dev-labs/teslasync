package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	telemetryfsm "github.com/ev-dev-labs/teslasync/internal/fsm/telemetry"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/rs/zerolog/log"
)

// errPipelineNotWired is returned by ProcessBatch when SetPipeline has not yet
// been called. Surfaced as a typed sentinel so the HTTP TelemetryIngest can
// distinguish a misconfigured deployment (return 503) from a transient
// pipeline error (return 500).
var errPipelineNotWired = errors.New("telemetry: normalize pipeline not wired (call SetPipeline before ProcessBatch)")

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

// processSignalsLegacyDeprecated is the legacy map-based ingest path that was
// the spine of the pre-Phase-42a HTTP webhook ingest. It bundled raw
// telemetry capture, live signal store updates, Mongo signal logging, MQTT
// republish, SSE broadcast, FSM dispatch, session/alert tracking, and
// throttled snapshot writes into a single procedure.
//
// Deprecated: phase-42a unified ingest; will be deleted in prompt 0090. Do
// not call from new code. The HTTP webhook (TelemetryIngest) and the MQTT
// subscriber both terminate at (*normalize.Pipeline).ProcessAtomics now;
// the cross-cutting effects formerly inlined here are wired by
// SideEffectsObserver in internal/tesla_pipeline (live store, signal
// history, FSM, sessions+alerts, SSE). HTTP-only effects (raw capture,
// Mongo signal log, streamingState update, MQTT republish) are inlined in
// TelemetryIngest BEFORE handing the batch to ProcessBatch.
//
// The single in-prompt change to this body relative to the pre-0060
// version is the deletion of the legacy unit-normalization call (and
// the helper itself), per Decision #4 — the new pipeline does its own
// unit normalization via normalize.toSI and applying the legacy helper as
// well would silently double-normalize. Today this function has zero
// production callers; deletion (per Decision #6) is deferred to prompt
// 0090 to keep prompt-scope discipline.
func (h *TelemetryHandler) processSignalsLegacyDeprecated(ctx context.Context, vin string, signals map[string]interface{}, publishToMQTT bool) {
	metrics.TelemetryMessagesReceived.Inc()

	// Raw telemetry capture ╬ô├ç├╢ async insert to MongoDB when enabled (before normalization)
	if h.captureEnabled.Load() && h.rawTelemetryRepo != nil {
		source := "mqtt_subscriber"
		if publishToMQTT {
			source = "http_ingest"
		}
		// Copy the signals map to avoid concurrent read/write with downstream
		// goroutines.
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

	// Phase-42a/0060 (Decision #4): the legacy unit-normalization call
	// was deleted from this spine. Unit normalization is now owned by
	// normalize.toSI inside (*normalize.Pipeline).ProcessAtomics; the
	// new HTTP ingest path runs unit normalization there, not here.
	//
	// Phase-42 (prompt 0079a): the legacy telemetry.CanonicalizeMap alias
	// rewrite was a no-op (the SignalAliases map was empty in the old
	// internal/telemetry package) and was removed alongside the
	// internal/telemetry package retirement. Future Tesla signal renames
	// belong in the generated protomodel/router layer (internal/tesla/protomodel
	// + internal/tesla/router/routing.yaml), not in a parallel rename map.

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

// TelemetryIngest receives Fleet Telemetry data via HTTP POST and dispatches
// it through the unified normalize.Pipeline (Phase-42a/0060). The ingest
// flow is:
//
//  1. Decode the JSON payload (telemetryPayload).
//  2. Increment TelemetryMessagesReceived (counter retained from the
//     legacy ProcessSignals spine).
//  3. Resolve VIN -> vehicleID (best-effort; missing vehicle is logged
//     and the batch is dropped before pipeline dispatch — same as the
//     legacy spine and ProcessBatch).
//  4. Build []codec.Atomic from payload.Signals + payload.Data, parsing
//     per-signal Timestamp into atomic.EmittedAt (falling back to
//     payload.CreatedAt then time.Now() so a malformed timestamp never
//     drops the whole batch).
//  5. Preserve the HTTP-only side effects that SideEffectsObserver does
//     NOT cover: raw telemetry capture (Mongo), Mongo signal log,
//     streamingState update (read by /telemetry/status), MQTT
//     republish.
//  6. Dispatch to h.ProcessBatch; on error respond 503 (pipeline not
//     wired) or 500 (transient pipeline failure).
//  7. Sample-log via APICallLog (every 100th batch per VIN).
//  8. Respond 200 with a tiny accounting envelope.
//
// Per ADR-004 #2 the actual signal -> typed-table fan-out (positions,
// climate, charging_telemetry, security_events, signal_log, etc.) happens
// inside (*normalize.Pipeline).ProcessAtomics. SideEffectsObserver runs
// after the route loop and is responsible for live signal store,
// Postgres signal_history, FSM dispatch, session+alert evaluation, and
// SSE broadcast. The HTTP webhook adapter does NOT replicate those
// effects — they happen exactly once via the pipeline.
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

	metrics.TelemetryMessagesReceived.Inc()

	// Resolve VIN -> vehicleID up-front so the HTTP-only side effects
	// (Mongo signal log, streamingState) and the pipeline dispatch share
	// the same identity. A missing vehicle is logged and the batch
	// dropped — same as ProcessBatch and the legacy spine.
	veh, vehErr := h.vehicleRepo.GetByVIN(r.Context(), payload.VIN)
	if vehErr != nil || veh == nil {
		log.Warn().Err(vehErr).Str("vin", payload.VIN).Msg("TelemetryIngest: vehicle not found; dropping batch")
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status":  "dropped",
			"reason":  "vehicle not registered",
			"signals": len(payload.Signals),
			"vin":     payload.VIN,
		})
		return
	}
	vehicleID := veh.ID

	// Resolve the batch-level timestamp (used as fallback EmittedAt for
	// any signal that lacks its own per-signal Timestamp). Malformed
	// payload.CreatedAt falls back to time.Now() rather than failing
	// the whole batch — consistent with the legacy spine which never
	// rejected a batch on a bad CreatedAt.
	batchEmittedAt := parseBatchTimestamp(payload.CreatedAt, time.Now().UTC())

	// Build []codec.Atomic from the JSON wire format. payload.Signals
	// preserves Tesla emission order; payload.Data is a key/value map
	// (Fleet Telemetry server may use either format). Order-within-the
	// -slice still matters for the pipeline (sortAtomicsSettingUnitFirst
	// preserves intra-group order); collapsing payload.Data into the
	// same slice in iteration order is acceptable because Data has no
	// canonical ordering anyway.
	atomics := make([]codec.Atomic, 0, len(payload.Signals)+len(payload.Data))
	signals := make(map[string]interface{}, len(payload.Signals)+len(payload.Data))
	for _, sig := range payload.Signals {
		emittedAt := parseSignalTimestamp(sig.Timestamp, batchEmittedAt)
		atomics = append(atomics, codec.Atomic{
			Field:     sig.Name,
			Value:     sig.Value,
			EmittedAt: emittedAt,
			VehicleID: payload.VIN,
		})
		signals[sig.Name] = sig.Value
	}
	for k, v := range payload.Data {
		if _, exists := signals[k]; exists {
			continue
		}
		atomics = append(atomics, codec.Atomic{
			Field:     k,
			Value:     v,
			EmittedAt: batchEmittedAt,
			VehicleID: payload.VIN,
		})
		signals[k] = v
	}

	// HTTP-only side effects that SideEffectsObserver does NOT cover.
	// These run BEFORE pipeline dispatch so a pipeline failure does not
	// suppress them — they are accounting / capture / health concerns
	// that should fire even if the typed-table writes ultimately fail.

	// (a) Raw telemetry capture — async Mongo insert when enabled.
	if h.captureEnabled.Load() && h.rawTelemetryRepo != nil {
		rec := &models.RawTelemetrySignal{
			VIN:         payload.VIN,
			Source:      "http_ingest",
			SignalCount: len(signals),
		}
		safeGo("raw-telemetry-insert", func() {
			captureCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := h.rawTelemetryRepo.Insert(captureCtx, rec); err != nil {
				log.Warn().Err(err).Str("vin", payload.VIN).Msg("telemetry: failed to capture raw signals")
			}
		})
	}

	// (b) Per-signal Mongo log — async batch write when enabled.
	if h.signalLogRepo != nil {
		signalsCopy := make(map[string]interface{}, len(signals))
		for k, v := range signals {
			signalsCopy[k] = v
		}
		safeGo("signal-log-mongodb", func() {
			logCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := h.signalLogRepo.WriteBatch(logCtx, vehicleID, signalsCopy); err != nil {
				log.Warn().Err(err).Str("vin", payload.VIN).Msg("telemetry: failed to log signals to MongoDB")
			}
		})
	}

	// (c) streamingState update — read by /telemetry/status (HTTP) and
	//     the frontend Telemetry health page. MUST happen for the HTTP
	//     ingest path (the MQTT path updates this via PipelineSubscriber's
	//     post-dispatch hook in cmd/teslasync; HTTP has no analogous
	//     hook so it is inlined here).
	h.recordStreamingHealth(payload.VIN, len(signals), signals)

	// (d) MQTT republish — HTTP-only feature so MQTT subscribers (e.g.,
	//     external automations) see signals that arrive via the webhook
	//     dispatcher. This is intentionally NOT mirrored on the MQTT
	//     ingest path because that would create a publish loop.
	h.republishToMQTT(payload.VIN, signals)

	// Dispatch to the unified pipeline. ProcessBatch handles VIN -> vehicleID
	// resolution again (single source of truth), connFSM update, and the
	// pipeline.ProcessAtomics call.
	if err := h.ProcessBatch(r.Context(), payload.VIN, atomics); err != nil {
		if errors.Is(err, errPipelineNotWired) {
			log.Error().Err(err).Str("vin", payload.VIN).Msg("TelemetryIngest: pipeline not wired; ingest unavailable")
			writeError(w, http.StatusServiceUnavailable, "telemetry pipeline not wired")
			return
		}
		log.Error().Err(err).Str("vin", payload.VIN).Msg("TelemetryIngest: ProcessBatch failed")
		writeError(w, http.StatusInternalServerError, "telemetry ingest failed")
		return
	}

	// Sample-log every 100th batch to avoid flooding the api_call_log
	// table with one row per webhook invocation.
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

// parseBatchTimestamp parses payload.CreatedAt as RFC3339 (with or without
// nanoseconds). Falls back to the supplied default on parse failure so a
// malformed CreatedAt never drops the whole batch — the legacy spine had
// the same defensive behaviour.
func parseBatchTimestamp(raw string, fallback time.Time) time.Time {
	if raw == "" {
		return fallback
	}
	if t, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return t.UTC()
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t.UTC()
	}
	return fallback
}

// parseSignalTimestamp parses a per-signal Timestamp string with the same
// dual RFC3339 / RFC3339Nano fallback as parseBatchTimestamp. Returns the
// supplied batch-level fallback if the per-signal Timestamp is empty or
// malformed.
func parseSignalTimestamp(raw string, fallback time.Time) time.Time {
	if raw == "" {
		return fallback
	}
	if t, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return t.UTC()
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t.UTC()
	}
	return fallback
}

// recordStreamingHealth updates the per-VIN streaming health record read by
// /telemetry/status. Extracted from the legacy ProcessSignals spine so the
// HTTP TelemetryIngest can keep the contract intact post-Phase-42a/0060
// without depending on the deprecated spine.
func (h *TelemetryHandler) recordStreamingHealth(vin string, signalCount int, signals map[string]interface{}) {
	h.mu.Lock()
	state, ok := h.streamingState[vin]
	if !ok {
		state = &VehicleStreamState{VIN: vin, FirstReceived: time.Now().UTC()}
		h.streamingState[vin] = state
	}
	state.LastReceived = time.Now().UTC()
	state.SignalCount += int64(signalCount)
	state.BatchCount++
	state.IsStreaming = true
	state.DataSource = "fleet_telemetry"
	last := make(map[string]interface{}, len(signals))
	for k, v := range signals {
		last[k] = v
	}
	state.LastSignals = last
	h.mu.Unlock()
}

// republishToMQTT mirrors the HTTP-ingested signals to MQTT topics so
// external subscribers (e.g., user automations) see them. Extracted from
// the legacy ProcessSignals spine. Skipped when no MQTT client is wired.
// Intentionally NOT called from the MQTT ingest path — that would create
// a publish loop.
func (h *TelemetryHandler) republishToMQTT(vin string, signals map[string]interface{}) {
	if h.mqttClient == nil {
		return
	}
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

// extractPosition builds a Position from available telemetry signals.
//
// Phase-42a/0060: kept for use by the deprecated processSignalsLegacyDeprecated
// spine and for the integration test fixture loader. Production HTTP and
// MQTT ingest both route through normalize.Pipeline now; the position
// writer in internal/tesla/router/writers/positions_writer.go owns the
// per-batch lat/lng pair-up and persistence.
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

// ProcessBatch is the HTTP webhook adapter that dispatches a pre-decoded
// []codec.Atomic batch through the unified normalize.Pipeline (Phase-42a/0060).
// Per ADR-004 #2 the HTTP webhook and MQTT subscriber both terminate at
// (*normalize.Pipeline).ProcessAtomics so every value is visited exactly
// once by the same pipeline.
//
// Responsibilities retained at this boundary (all HTTP-only or per-batch
// concerns that SideEffectsObserver does NOT cover):
//
//  1. Resolve VIN -> vehicleID. A missing vehicle is logged and the batch
//     is dropped (returns nil — same behaviour as the legacy spine).
//  2. Update the per-vehicle connection FSM (RecordBatch). The pipeline
//     observer does not own the connection FSM because the fan-out shape
//     (per-batch arrival) is HTTP-/MQTT-specific.
//  3. Dispatch to h.pipeline.ProcessAtomics. Returns errPipelineNotWired
//     if SetPipeline has not been called (TelemetryIngest maps this to
//     a 503 so a misconfigured deployment fails loud).
//
// Phase-42a/0060: the legacy in-line unit-normalization / extractPosition
// / posRepo.BulkInsert / buildSSEPayload / broadcastSSE were deleted.
// Unit normalization, position writes, and SSE broadcast are now owned by
// the pipeline (positions_writer + SideEffectsObserver). The fsmHandler
// dispatch is also owned by SideEffectsObserver.
func (h *TelemetryHandler) ProcessBatch(ctx context.Context, vin string, decoded []codec.Atomic) error {
	startedAt := time.Now()

	// Resolve vehicle by VIN up-front so the connFSM update and the
	// pipeline dispatch share the same identity. A missing vehicle is
	// fatal for this batch — without an FK we cannot persist anything.
	veh, err := h.vehicleRepo.GetByVIN(ctx, vin)
	if err != nil || veh == nil {
		log.Warn().Err(err).Str("vin", vin).Msg("ProcessBatch: vehicle not found; dropping batch")
		return nil
	}
	vehicleID := veh.ID

	// Connection FSM: per-vehicle health/staleness tracker. Lookup is
	// guarded by connFSMMu; the map is initialised in NewTelemetryHandler
	// (e516fef nil-map regression guard). Records the batch BEFORE
	// pipeline dispatch so per-batch arrival accounting is preserved
	// even if the pipeline returns an error on a transient failure.
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

	if h.pipeline == nil {
		log.Error().Str("vin", vin).Int64("vehicle_id", vehicleID).Msg("ProcessBatch: pipeline not wired (call SetPipeline at startup)")
		return errPipelineNotWired
	}

	if err := h.pipeline.ProcessAtomics(ctx, decoded, vehicleID); err != nil {
		log.Error().Err(err).
			Str("vin", vin).
			Int64("vehicle_id", vehicleID).
			Int("atomics", len(decoded)).
			Msg("ProcessBatch: pipeline.ProcessAtomics returned error")
		return fmt.Errorf("pipeline.ProcessAtomics: %w", err)
	}

	log.Info().
		Str("vin", vin).
		Int64("vehicle_id", vehicleID).
		Int("atomics", len(decoded)).
		Dur("duration", time.Since(startedAt)).
		Msg("telemetry batch processed via pipeline")

	return nil
}

// buildSSEPayload assembles the legacy Phase-6 typed-tables SSE payload
// from already-built hot rows. Wire shape:
//
//	{ vehicle_id, ts, tables: {<table>: {<col>: <val>}} }
//
// Phase-42a/0060: kept for use by the deprecated processSignalsLegacyDeprecated
// spine. Production HTTP and MQTT ingest both broadcast SSE via
// SideEffectsObserver in internal/tesla_pipeline (a different wire shape:
// {vehicle_id, ts, signals}). This helper survives only as long as the
// deprecated spine survives; both retire together in prompt 0090.
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

// Phase-42a/0060: the legacy unit-normalization helper, the compound-map
// flattener, the compound-time flattener, and the time-field extractor
// Decisions #4 and #5. Unit normalization is owned by normalize.toSI on
// the new pipeline; compound flattening is owned by codec.Decode (proto
// path) per ADR-004 #3. The new HTTP webhook adapter feeds raw JSON-decoded
// values directly to (*normalize.Pipeline).ProcessAtomics — JSON-decoded
// compound values arrive as nested maps and are rejected by the
// signal_log_writer's classify (drop-loud per ADR-004 #8). This is the
// same behaviour as the pre-0060 helper, which only flattened a fixed set
// of 5 compound names at the legacy spine, not on the wire to typed-table
// writers; the writer-side rejection has always been the structural
// gate.
