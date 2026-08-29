package telemetry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	telemetrymodel "github.com/ev-dev-labs/teslasync/internal/models/telemetry"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/rs/zerolog/log"

	dbobs "github.com/ev-dev-labs/teslasync/internal/database/observability"
	telemetryfsm "github.com/ev-dev-labs/teslasync/internal/fsm/telemetry"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
)

// sseRedisPubsubTracerName is the OpenTelemetry tracer name for the SSE
// Redis Pub/Sub publish goroutine span. The trace-coverage audit greps
// for this exact constant.
const sseRedisPubsubTracerName = "signal"

// errPipelineNotWired is returned by ProcessBatch when SetPipeline has not yet
// been called. Surfaced as a typed sentinel so the HTTP TelemetryIngest can
// distinguish a misconfigured deployment (return 503) from a transient
// pipeline error (return 500).
var errPipelineNotWired = errors.New("telemetry: normalize pipeline not wired (call SetPipeline before ProcessBatch)")

func (h *Handler) liveStoreForTelemetry() signal.LiveSignalStore {
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

func (h *Handler) updateLiveSignals(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
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

// TelemetryIngest receives Fleet Telemetry data via HTTP POST and dispatches
// it through the unified normalize.Pipeline. The ingest
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
func (h *Handler) TelemetryIngest(w http.ResponseWriter, r *http.Request) {
	start := time.Now().UTC()
	// Receipt evidence belongs to the HTTP boundary, before body decoding or
	// vehicle lookup. It is not a substitute for a producer timestamp.
	receivedAt := start
	var payload telemetryPayload

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid telemetry payload")
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
		httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
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
	batchEmittedAt, batchSourceEmittedAt := timestampOrReceipt(payload.CreatedAt, receivedAt)

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
		emittedAt, sourceEmittedAt := timestampOrFallback(sig.Timestamp, batchEmittedAt, batchSourceEmittedAt)
		atomics = append(atomics, codec.Atomic{
			Field:           sig.Name,
			Value:           sig.Value,
			EmittedAt:       emittedAt,
			VehicleID:       payload.VIN,
			IngestOrigin:    codec.IngestOriginFleetTelemetryHTTP,
			SourceEmittedAt: sourceEmittedAt,
			ReceivedAt:      &receivedAt,
		})
		signals[sig.Name] = sig.Value
	}
	for k, v := range payload.Data {
		if _, exists := signals[k]; exists {
			continue
		}
		atomics = append(atomics, codec.Atomic{
			Field:           k,
			Value:           v,
			EmittedAt:       batchEmittedAt,
			VehicleID:       payload.VIN,
			IngestOrigin:    codec.IngestOriginFleetTelemetryHTTP,
			SourceEmittedAt: batchSourceEmittedAt,
			ReceivedAt:      &receivedAt,
		})
		signals[k] = v
	}

	// HTTP-only side effects that SideEffectsObserver does NOT cover.
	// These run BEFORE pipeline dispatch so a pipeline failure does not
	// suppress them — they are accounting / capture / health concerns
	// that should fire even if the typed-table writes ultimately fail.

	// (a) Raw telemetry capture — async Mongo insert when enabled.
	if h.captureEnabled.Load() && h.rawTelemetryRepo != nil {
		rec := &telemetrymodel.RawTelemetrySignal{
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
			httpx.WriteError(w, http.StatusServiceUnavailable, "telemetry pipeline not wired")
			return
		}
		log.Error().Err(err).Str("vin", payload.VIN).Msg("TelemetryIngest: ProcessBatch failed")
		httpx.WriteError(w, http.StatusInternalServerError, "telemetry ingest failed")
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
		logEntry := &teslamodel.APICallLog{
			HTTPMethod: "POST",
			Endpoint:   fmt.Sprintf("/api/v1/telemetry (VIN: %s)", payload.VIN),
			StatusCode: int16(statusCode),
			DurationMs: int32(durationMs),
			Service:    "fleet-telemetry",
		}
		_ = h.logRepo.Create(r.Context(), logEntry)
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "accepted",
		"signals": len(signals),
		"vin":     payload.VIN,
	})
}

// timestampOrReceipt keeps HTTP ingest defensive: malformed or absent
// timestamps use the supplied receipt/order fallback, but return nil source
// evidence so callers can never mistake that fallback for producer time.
func timestampOrReceipt(raw string, receipt time.Time) (time.Time, *time.Time) {
	if raw == "" {
		return receipt, nil
	}
	if t, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		t = t.UTC()
		return t, &t
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		t = t.UTC()
		return t, &t
	}
	return receipt, nil
}

// timestampOrFallback prefers a valid per-signal timestamp, then valid
// payload CreatedAt evidence, and only then a receipt fallback.
func timestampOrFallback(raw string, fallback time.Time, fallbackSource *time.Time) (time.Time, *time.Time) {
	t, source := timestampOrReceipt(raw, fallback)
	if source != nil {
		return t, source
	}
	return fallback, fallbackSource
}

// recordStreamingHealth updates the per-VIN streaming health record read by
// /telemetry/status. Extracted from the legacy ProcessSignals spine so the
// HTTP TelemetryIngest can keep the contract intact without depending
// on the deprecated spine.
func (h *Handler) recordStreamingHealth(vin string, signalCount int, signals map[string]interface{}) {
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

// RecordStream implements mqtt.StreamingHealthRecorder. The MQTT
// PipelineSubscriber invokes this once per successfully dispatched
// per-field message so the /telemetry status endpoint (MQTT Inspector
// page) sees live streaming activity. Previously only the HTTP
// TelemetryIngest path updated streamingState; after the per-field MQTT
// cutover the Inspector silently showed 0 vehicles / 0 signals / 0
// batches despite telemetry flowing into signal_log + drives. Empty VIN
// or zero atomics are no-ops — the codec drop branch is handled upstream
// and never reaches RecordStream.
func (h *Handler) RecordStream(vin string, atomics []codec.Atomic) {
	if vin == "" || len(atomics) == 0 {
		return
	}
	// Build a compact LastSignals snapshot keyed by field name so the
	// inspector retains a small "what was just received" hint without
	// holding the full Atomic[] across calls. Last write wins for
	// repeat fields inside a single batch (rare under per-field MQTT
	// where each message carries one field).
	last := make(map[string]interface{}, len(atomics))
	for _, a := range atomics {
		if a.Field == "" {
			continue
		}
		last[a.Field] = a.Value
	}
	h.recordStreamingHealth(vin, len(atomics), last)
}

// republishToMQTT mirrors the HTTP-ingested signals to MQTT topics so
// external subscribers (e.g., user automations) see them. Extracted from
// the legacy ProcessSignals spine. Skipped when no MQTT client is wired.
// Intentionally NOT called from the MQTT ingest path — that would create
// a publish loop.
func (h *Handler) republishToMQTT(vin string, signals map[string]interface{}) {
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

// ProcessBatch is the HTTP webhook adapter that dispatches a pre-decoded
// []codec.Atomic batch through the unified normalize.Pipeline.
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
// The legacy in-line unit-normalization / extractPosition / posRepo.BulkInsert
// / buildSSEPayload / broadcastSSE were deleted.
// Unit normalization, position writes, and SSE broadcast are now owned by
// the pipeline (positions_writer + SideEffectsObserver). The fsmHandler
// dispatch is also owned by SideEffectsObserver.
func (h *Handler) ProcessBatch(ctx context.Context, vin string, decoded []codec.Atomic) error {
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
	// guarded by connFSMMu; the map is initialised in NewHandler
	// (e516fef nil-map regression guard). Records the batch BEFORE
	// pipeline dispatch so per-batch arrival accounting is preserved
	// even if the pipeline returns an error on a transient failure.
	if vehicleID > 0 {
		h.connFSMMu.Lock()
		cfsm, ok := h.connFSMs[vehicleID]
		if !ok {
			cfsm = telemetryfsm.New(vehicleID, vin,
				telemetryfsm.WithTransitionRepo(dbobs.NewFSMTransitionRepo(h.db)),
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

// broadcastSSE sends a vehicle_update SSE event. When Redis Pub/Sub is
// available the payload is published to the vehicle_signals channel so all
// pods receive it (including this one, via SubscribeRedis). When Redis is
// not configured, falls back to direct in-process broadcast (single-pod mode).
//
// The ctx is threaded through to BroadcastWithContext so the per-broadcast
// sse.broadcast span (and, on the Redis path, the cross-pod sse.redis_fanout
// span) chains under the caller's trace. Callers from the MQTT telemetry
// pipeline pass the normalize.Pipeline.ProcessAtomics ctx so SSE delivery
// becomes a true descendant of the original MQTT consume span.
func (h *Handler) broadcastSSE(ctx context.Context, payload map[string]any) {
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
			h.eventHub.BroadcastWithContext(ctx, "vehicle_update", payload)
			return
		}
		msg := fmt.Appendf(nil, "event: vehicle_update\ndata: %s\n\n", jsonData)
		// trace.continuity=false is set explicitly because the
		// publish goroutine intentionally detaches from the caller ctx
		// via context.Background()+2s timeout — the 2s ceiling is a
		// liveness/back-pressure guarantee and the detach is by design,
		// not a propagation bug. Tempo dashboards filter on
		// trace.continuity=false to flag honestly-detached spans.
		safeGo("redis-pubsub-publish", func() {
			pubCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			pubCtx, span := otel.Tracer(sseRedisPubsubTracerName).Start(
				pubCtx,
				"signal.redis_pubsub.publish",
				trace.WithSpanKind(trace.SpanKindProducer),
				trace.WithAttributes(
					attribute.Bool("trace.continuity", false),
					attribute.String("event_type", "vehicle_update"),
					attribute.Int("payload_size", len(msg)),
				),
			)
			defer span.End()
			if err := h.redisCache.PublishSignals(pubCtx, msg); err != nil {
				span.RecordError(err)
				span.SetStatus(codes.Error, "redis_pubsub.publish")
				log.Warn().Err(err).Msg("redis pub/sub publish failed, falling back to local broadcast")
				h.eventHub.BroadcastWithContext(ctx, "vehicle_update", payload)
			}
		})
		return
	}

	// No Redis — single-pod fallback
	h.eventHub.BroadcastWithContext(ctx, "vehicle_update", payload)
}

// The buildHotRow / bucketAtomics / bucketResult helpers and the cold-residue
// routing they implemented were removed alongside internal/telemetry. Hot-table
// fan-out is now narrowed to `positions`; cold signals flow through the typed
// signal_log pipeline downstream of this file.
//
// positionToHotRow was removed alongside the deprecated
// processSignalsLegacyDeprecated spine — its only caller. The new pipeline
// persists positions through internal/tesla/router/writers/positions_writer.go
// and SideEffectsObserver broadcasts SSE in the {vehicle_id, ts, signals}
// shape, so no per-table hot-row folding is required at this layer any more.

// The legacy unit-normalization helper, the compound-map flattener, the
// compound-time flattener, and the time-field extractor were deleted per design
// decisions #4 and #5. Unit normalization is owned by normalize.toSI on
// the new pipeline; compound flattening is owned by codec.Decode (proto
// path) per ADR-004 #3. The new HTTP webhook adapter feeds raw JSON-decoded
// values directly to (*normalize.Pipeline).ProcessAtomics — JSON-decoded
// compound values arrive as nested maps and are rejected by the
// signal_log_writer's classify (drop-loud per ADR-004 #8). This is the
// same behaviour as the pre-0060 helper, which only flattened a fixed set
// of 5 compound names at the legacy spine, not on the wire to typed-table
// writers; the writer-side rejection has always been the structural
// gate.
