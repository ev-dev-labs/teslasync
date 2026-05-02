package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	telemetryfsm "github.com/ev-dev-labs/teslasync/internal/fsm/telemetry"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/telemetry"
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

	// Canonicalize signal names — handle Tesla renames via alias registry.
	// Must run before any consumer (SignalStore, Redis, history writer, FSM)
	// so all downstream code sees canonical names only.
	telemetry.CanonicalizeMap(signals)

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
	// per-table wire format. We re-run the legacy map batch through the same
	// flatten/bucket/hot-row pipeline ProcessBatch uses, so both write-paths
	// publish an identical shape: {vehicle_id, ts, tables:{<table>:{<col>:<val>}},
	// cold:[{name,value}]}. No raw map / legacy jsonb fields are emitted.
	if h.eventHub != nil && vehicleID > 0 {
		named := make([]telemetry.NamedValue, 0, len(signals))
		for k, v := range signals {
			named = append(named, telemetry.NamedValue{Name: k, Value: v})
		}
		atomics := make([]telemetry.Atomic, 0, len(named)*2)
		for _, nv := range named {
			flat, ferr := telemetry.Flatten(nv.Name, nv.Value)
			if ferr != nil {
				continue
			}
			atomics = append(atomics, flat...)
		}
		bk := bucketAtomics(atomics)
		ts := time.Now().UTC()
		hotRows := map[string]map[string]any{}
		for table, items := range bk.HotByTable {
			row := h.buildHotRow(table, items, &bk.Cold)
			if len(row) > 0 {
				hotRows[table] = row
			}
		}
		coldObs := h.buildColdObservations(vehicleID, ts, bk.Cold)
		h.broadcastSSE(buildSSEPayload(vehicleID, ts, hotRows, coldObs))
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

			// Update daily mileage from odometer readings
			h.trackMileage(bgCtx, vehicleID, writeSignals)

			// Store security events
			h.trackSecurity(bgCtx, vehicleID, writeSignals)

			// Store vehicle config snapshots
			h.trackVehicleConfig(bgCtx, vehicleID, writeSignals)

			// Update vehicle_units with car display preferences
			h.trackUserPreferences(bgCtx, vehicleID, writeSignals)

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

	// Build the signal map for downstream consumers. We first walk
	// payload.Signals in Tesla emission order, normalize that ordered
	// batch via telemetry.NormalizeFleetUnits, then merge into a map
	// for the legacy map-based ProcessSignals pipeline. ProcessSignals
	// will run normalization again as a safety net for the MQTT path,
	// which is idempotent for these per-signal transforms.
	ordered := make([]telemetry.NamedValue, 0, len(payload.Signals))
	for _, sig := range payload.Signals {
		ordered = append(ordered, telemetry.NamedValue{Name: sig.Name, Value: sig.Value})
	}
	ordered = telemetry.NormalizeFleetUnits(ordered)

	signals := make(map[string]interface{}, len(ordered)+len(payload.Data))
	for _, nv := range ordered {
		signals[nv.Name] = nv.Value
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

// ProcessBatch is the new slice-oriented write-path entrypoint that will
// eventually replace the map-based ProcessSignals pipeline. It accepts an
// ordered batch of telemetry.NamedValue (decoded in Tesla emission order)
// and walks it through normalize -> flatten -> bucket -> persist stages.
//
// This method is being assembled incrementally across the db-refactor
// prompts. Today it covers stages 1-2 (normalize + flatten); subsequent
// prompts add hot-route bucketing and per-table writers.
func (h *TelemetryHandler) ProcessBatch(ctx context.Context, vin string, decoded []telemetry.NamedValue) error {
	startedAt := time.Now()
	// Resolve vehicle by VIN up-front so downstream stages (FSM hooks, hot/cold
	// writers) all share the same identity columns. A missing vehicle is fatal
	// for this batch — without an FK we cannot persist anything.
	veh, err := h.vehicleRepo.GetByVIN(ctx, vin)
	if err != nil || veh == nil {
		log.Warn().Err(err).Str("vin", vin).Msg("ProcessBatch: vehicle not found; dropping batch")
		return nil
	}
	vehicleID := veh.ID
	ts := time.Now().UTC()

	normalized := telemetry.NormalizeFleetUnits(decoded)

	atomics := make([]telemetry.Atomic, 0, len(normalized)*2)
	var flattenErrs int
	for _, nv := range normalized {
		flat, err := telemetry.Flatten(nv.Name, nv.Value)
		if err != nil {
			flattenErrs++
			log.Warn().
				Err(err).
				Str("signal", nv.Name).
				Msg("flatten failed; skipping signal")
			continue
		}
		atomics = append(atomics, flat...)
	}
	log.Debug().
		Int("normalized", len(normalized)).
		Int("atomics", len(atomics)).
		Int("flatten_errors", flattenErrs).
		Msg("flatten step complete")

	buckets := bucketAtomics(atomics)
	log.Debug().
		Int("hot_tables", len(buckets.HotByTable)).
		Int("cold_atomics", len(buckets.Cold)).
		Msg("bucket step complete")

	// Catalog upsert: dedupe AllNames in-place (stable order) and register
	// every observed signal name in signal_catalog before any cold inserts
	// so the signal_observations FK resolves. Single round-trip per batch.
	seen := make(map[string]struct{}, len(buckets.AllNames))
	unique := buckets.AllNames[:0]
	for _, n := range buckets.AllNames {
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		unique = append(unique, n)
	}
	newCount, err := h.signalCatalogRepo.BulkUpsertObserved(ctx, unique)
	if err != nil {
		log.Error().Err(fmt.Errorf("catalog upsert: %w", err)).
			Str("vin", vin).
			Int("unique_names", len(unique)).
			Msg("catalog upsert failed; aborting batch")
		return fmt.Errorf("catalog upsert: %w", err)
	}
	log.Debug().
		Int("unique_names", len(unique)).
		Int("new_names", newCount).
		Msg("catalog upsert complete")

	hotRows := map[string]map[string]any{}
	for table, items := range buckets.HotByTable {
		hotRows[table] = h.buildHotRow(table, items, &buckets.Cold)
	}
	log.Debug().
		Int("hot_rows", len(hotRows)).
		Int("cold_atomics_after_transform", len(buckets.Cold)).
		Msg("hot row build step complete")

	coldObs := h.buildColdObservations(vehicleID, ts, buckets.Cold)
	log.Debug().
		Int("cold_observations", len(coldObs)).
		Msg("cold observation build step complete")

	// FSM hooks — fire AFTER the bucket/transform step but BEFORE write fan-out
	// so connection-state, drive, charge, and automation rule FSMs see every
	// batch in arrival order. Order with writes matters (prompt 27): if writes
	// were to fail, the FSM has already observed the transition and follow-up
	// batches will keep its state coherent.
	//
	// 1. Connection FSM: per-vehicle health/staleness tracker. Lookup is guarded
	//    by connFSMMu; the map is initialized in NewTelemetryHandler (e516fef
	//    nil-map regression guard).
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
		cfsm.RecordBatch(len(atomics), "fleet_telemetry")
	}

	// 2. Vehicle/drive/charge FSM: feed it the same atomic stream the buckets
	//    were built from, adapted to the legacy map shape its trackStateTransition
	//    / commitStateTransition logic still expects. FSM internals are unchanged.
	if vehicleID > 0 && h.fsmHandler != nil {
		fsmSignals := make(map[string]interface{}, len(atomics))
		for _, a := range atomics {
			fsmSignals[a.Name] = a.Value
		}
		h.fsmHandler.ProcessSignals(ctx, vehicleID, fsmSignals)
	}

	// Fan-out: dispatch each populated hot row to its per-table repo, then the
	// cold residue to signal_observations. Errors are aggregated (not returned)
	// so a slow/failing table does not lose writes destined for sibling tables;
	// terminal handling of writeErrs is layered in the next prompt (28).
	type writeErr struct {
		table string
		err   error
	}
	var writeErrs []writeErr
	dispatch := func(table string, fn func() error) {
		if err := fn(); err != nil {
			writeErrs = append(writeErrs, writeErr{table, err})
		}
	}
	for table, row := range hotRows {
		if len(row) == 0 {
			continue
		}
		switch table {
		case "positions":
			dispatch(table, func() error {
				return h.posRepo.InsertFromMap(ctx, vehicleID, ts, row)
			})
		case "security_events":
			dispatch(table, func() error {
				return h.securityRepo.InsertFromMap(ctx, vehicleID, ts, row)
			})
		default:
			// Tables whose repos were removed (vehicle_live_state, charging_telemetry,
			// climate_snapshots, motor_snapshots, vehicle_meta_snapshots) are silently
			// skipped — their signals already land in signal_log via signalHistoryWriter.
		}
	}
	if len(coldObs) > 0 {
		dispatch("signal_observations", func() error {
			return h.signalObsRepo.BulkInsert(ctx, coldObs)
		})
	}

	// Typed-tables SSE broadcast (Phase 6 wire format). Frontend SSE consumer
	// rewrite to read `tables.<name>.<column>` is Phase 7's responsibility.
	// Uses Redis Pub/Sub when available for multi-pod delivery.
	h.broadcastSSE(buildSSEPayload(vehicleID, ts, hotRows, coldObs))

	total := len(hotRows) + boolToInt(len(coldObs) > 0)
	failed := len(writeErrs)

	for _, we := range writeErrs {
		log.Error().
			Err(we.err).
			Str("table", we.table).
			Msg("telemetry write failed")
	}

	log.Info().
		Str("vin", vin).
		Int64("vehicle_id", vehicleID).
		Int("normalized", len(normalized)).
		Int("atomics", len(atomics)).
		Int("hot_writes", len(hotRows)).
		Int("cold_writes", len(coldObs)).
		Int("write_failures", failed).
		Dur("duration", time.Since(startedAt)).
		Msg("telemetry batch processed")

	if total > 0 && failed == total {
		return fmt.Errorf("all %d write targets failed (systemic)", total)
	}
	return nil
}

// boolToInt returns 1 when b is true, else 0. Used to count the cold-write
// target as one of the batch's total write targets without inflating the hot
// row count.
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// pickValue returns the populated value_* field of a SignalObservation, or nil.
// Cold observations have exactly one of ValueNumeric/ValueText/ValueBool set.
func pickValue(o models.SignalObservation) any {
	switch {
	case o.ValueNumeric != nil:
		return *o.ValueNumeric
	case o.ValueText != nil:
		return *o.ValueText
	case o.ValueBool != nil:
		return *o.ValueBool
	default:
		return nil
	}
}

// buildSSEPayload assembles the Phase-6 typed-tables SSE payload from the
// already-built hot rows and cold observations. Wire shape:
//
//	{ vehicle_id, ts, tables: {<table>: {<col>: <val>}}, cold: [{name, value}] }
//
// Empty hot rows are skipped; cold is omitted entirely when there are no
// observations. The frontend (Phase 7) reads tables.<name>.<column> instead of
// the legacy raw_state/signals jsonb shape.
func buildSSEPayload(vehicleID int64, ts time.Time, hotRows map[string]map[string]any, coldObs []models.SignalObservation) map[string]any {
	tables := map[string]map[string]any{}
	for table, row := range hotRows {
		if len(row) == 0 {
			continue
		}
		tables[table] = row
	}
	payload := map[string]any{
		"vehicle_id": vehicleID,
		"ts":         ts,
		"tables":     tables,
	}
	if len(coldObs) > 0 {
		cold := make([]map[string]any, 0, len(coldObs))
		for _, o := range coldObs {
			cold = append(cold, map[string]any{
				"name":  o.SignalName,
				"value": pickValue(o),
			})
		}
		payload["cold"] = cold
	}
	return payload
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

// buildColdObservations converts cold atomics (originally cold + transform-demoted)
// into SignalObservation rows ready for signalObsRepo.BulkInsert. Each atomic's
// Go type selects the correct value_* column; nulls are skipped. Unknown types
// are stringified defensively into value_text with a warn log so no data is lost.
func (h *TelemetryHandler) buildColdObservations(vehicleID int64, ts time.Time, cold []telemetry.Atomic) []models.SignalObservation {
	out := make([]models.SignalObservation, 0, len(cold))
	for _, a := range cold {
		obs := models.SignalObservation{
			VehicleID:  vehicleID,
			Ts:         ts,
			SignalName: a.Name,
			Source:     "fleet_telemetry",
		}
		switch v := a.Value.(type) {
		case nil:
			continue
		case bool:
			b := v
			obs.ValueBool = &b
		case float64:
			f := v
			obs.ValueNumeric = &f
		case float32:
			f := float64(v)
			obs.ValueNumeric = &f
		case int:
			f := float64(v)
			obs.ValueNumeric = &f
		case int32:
			f := float64(v)
			obs.ValueNumeric = &f
		case int64:
			f := float64(v)
			obs.ValueNumeric = &f
		case string:
			s := v
			obs.ValueText = &s
		default:
			s := fmt.Sprintf("%v", v)
			obs.ValueText = &s
			log.Warn().
				Str("signal", a.Name).
				Str("type", fmt.Sprintf("%T", v)).
				Msg("cold signal had unexpected type; stringified")
		}
		out = append(out, obs)
	}
	return out
}

// buildHotRow folds a slice of atomics that all target the same table into one
// column->value map, applying each route's Transformer where present. A
// transform error does NOT abort the row — the offending atomic is appended to
// demoteCold so the data still lands losslessly in signal_observations.
func (h *TelemetryHandler) buildHotRow(table string, atomics []telemetry.Atomic, demoteCold *[]telemetry.Atomic) map[string]any {
	row := map[string]any{}
	for _, a := range atomics {
		hot := telemetry.LookupHot(a.Name)
		if hot == nil || hot.Column == "" {
			*demoteCold = append(*demoteCold, a)
			continue
		}
		v := a.Value
		if hot.Transformer != nil {
			tv, err := hot.Transformer(v)
			if err != nil {
				log.Warn().
					Err(err).
					Str("signal", a.Name).
					Str("table", table).
					Msg("transform failed; demoting to cold")
				*demoteCold = append(*demoteCold, a)
				continue
			}
			v = tv
		}
		row[hot.Column] = v
	}
	return row
}

// bucketResult partitions a flattened atomic stream into per-hot-table queues
// and a cold residue (atomics with no HotCatalog mapping). AllNames preserves
// every atomic name in arrival order for the catalog upsert step.
type bucketResult struct {
	HotByTable map[string][]telemetry.Atomic
	Cold       []telemetry.Atomic
	AllNames   []string
}

// bucketAtomics walks atomics and routes each one via telemetry.LookupHot.
// Compound parents (HotRoute with empty Column) should never reach here —
// Flatten expands them into atomics first. If one slips through, treat it as
// unmapped and route to cold so we don't lose the data.
func bucketAtomics(atomics []telemetry.Atomic) bucketResult {
	res := bucketResult{
		HotByTable: map[string][]telemetry.Atomic{},
		Cold:       make([]telemetry.Atomic, 0),
		AllNames:   make([]string, 0, len(atomics)),
	}
	for _, a := range atomics {
		res.AllNames = append(res.AllNames, a.Name)
		hot := telemetry.LookupHot(a.Name)
		if hot == nil || hot.Column == "" {
			res.Cold = append(res.Cold, a)
			continue
		}
		res.HotByTable[hot.Table] = append(res.HotByTable[hot.Table], a)
	}
	return res
}

// normalizeFleetSignals adapts the slice-based telemetry.NormalizeFleetUnits
// helper to the legacy map-based ProcessSignals path.
//
// ProcessSignals (and the FSM/SignalStore consumers downstream) still use
// map[string]interface{}, so we round-trip through the ordered slice API
// for the duration of the normalization step. New code paths should call
// telemetry.NormalizeFleetUnits directly with an ordered batch decoded
// from Tesla emission order.
func normalizeFleetUnits(signals map[string]interface{}) {
	nvs := telemetry.FromMap(signals)
	nvs = telemetry.NormalizeFleetUnits(nvs)
	telemetry.WriteIntoMap(nvs, signals)
}
