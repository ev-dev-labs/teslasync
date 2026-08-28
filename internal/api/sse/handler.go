package sse

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	oteltrace "go.opentelemetry.io/otel/trace"
)

// sseTracerName scopes spans emitted by the SSE event hub. Per-broadcast
// spans give visibility into fan-out latency + drop rate.
const sseTracerName = "internal/api/sse"

func sseTracer() oteltrace.Tracer { return otel.Tracer(sseTracerName) }

// SignalChangeEvent is the typed-envelope SSE payload emitted by
// BroadcastSignalChange for a single live-signal update. Wire shape:
//
//	{ "stream_id": <server-epoch>, "sequence": <monotonic uint64>,
//	  "vehicle_id": <int64>, "field": <proto-name>, "kind": <ValueKind>,
//	  "value": <typed primitive>, "ts": <RFC3339> }
//
// `kind` is the protomodel.ValueKind discriminator (matching redis_cache's
// typed envelope) so a frontend reader can switch on it and decode `value`
// without runtime type-sniffing. `value` carries signal.Value.Raw verbatim:
// json.Marshal handles every concrete type the codec emits (bool, int32,
// int64, float32, float64, string, time.Time, ftproto enums) without
// reflection or stringification fallbacks.
type SignalChangeEvent struct {
	StreamID  string               `json:"stream_id"`
	Sequence  uint64               `json:"sequence"`
	VehicleID int64                `json:"vehicle_id"`
	Field     string               `json:"field"`
	Kind      protomodel.ValueKind `json:"kind"`
	Value     interface{}          `json:"value"`
	TS        time.Time            `json:"ts"`
}

// EventHub manages SSE connections for real-time updates.
type EventHub struct {
	mu             sync.RWMutex
	clients        map[string]chan []byte
	streamID       string
	signalSequence atomic.Uint64
}

// NewEventHub creates a new SSE event hub.
func NewEventHub() *EventHub {
	return &EventHub{
		clients:  make(map[string]chan []byte),
		streamID: uuid.NewString(),
	}
}

// StreamID identifies this process lifetime so clients can distinguish a
// sequence reset after a pod restart from a dropped frame within one stream.
func (h *EventHub) StreamID() string {
	return h.streamID
}

// Subscribe adds a client to the hub and returns a channel + unsubscribe func.
func (h *EventHub) Subscribe(id string) (<-chan []byte, func()) {
	ch := make(chan []byte, 64)
	h.mu.Lock()
	h.clients[id] = ch
	h.mu.Unlock()
	metrics.SSEConnectionsActive.Inc()
	metrics.SSEConnectionsTotal.Inc()

	return ch, func() {
		h.mu.Lock()
		delete(h.clients, id)
		close(ch)
		maxSaturation := 0.0
		for _, client := range h.clients {
			if saturation := channelSaturation(client); saturation > maxSaturation {
				maxSaturation = saturation
			}
		}
		h.mu.Unlock()
		metrics.SSEConnectionsActive.Dec()
		metrics.SSEClientBufferSaturationRatio.Set(maxSaturation)
	}
}

// Broadcast sends a message to all connected clients.
//
// Deprecated: prefer BroadcastWithContext so the per-broadcast span nests
// under the caller's trace context. This shim exists only for back-compat
// with non-ctx call sites and silently runs without parent linkage.
func (h *EventHub) Broadcast(eventType string, data interface{}) {
	h.BroadcastWithContext(context.Background(), eventType, data)
}

// BroadcastWithContext is the ctx-aware variant of Broadcast. The emitted
// sse.broadcast span carries the parent trace context from ctx so a full
// chain from API request (or MQTT consume) -> signal update -> SSE
// fan-out is one continuous trace in Tempo.
func (h *EventHub) BroadcastWithContext(ctx context.Context, eventType string, data interface{}) {
	ctx, span := sseTracer().Start(ctx, "sse.broadcast",
		oteltrace.WithSpanKind(oteltrace.SpanKindProducer),
		oteltrace.WithAttributes(
			attribute.String("sse.event_type", eventType),
		),
	)
	defer span.End()

	payload, err := json.Marshal(data)
	if err != nil {
		span.RecordError(err)
		log.Error().Err(err).Msg("failed to marshal SSE event")
		return
	}

	msg := fmt.Appendf(nil, "event: %s\ndata: %s\n\n", eventType, payload)
	msgLen := float64(len(msg))
	span.SetAttributes(attribute.Int("sse.message_size_bytes", len(msg)))

	start := time.Now()
	h.mu.RLock()
	clientCount := len(h.clients)
	delivered := 0
	dropped := 0
	maxSaturation := 0.0
	for id, ch := range h.clients {
		select {
		case ch <- msg:
			metrics.SSEEventsSent.WithLabelValues(eventType).Inc()
			metrics.SSEBytesSent.Add(msgLen)
			delivered++
		default:
			metrics.SSEEventsDropped.WithLabelValues(eventType).Inc()
			dropped++
			log.Warn().Str("client", id).Msg("SSE client buffer full, dropping event")
		}
		if saturation := channelSaturation(ch); saturation > maxSaturation {
			maxSaturation = saturation
		}
	}
	h.mu.RUnlock()
	metrics.SSEClientBufferSaturationRatio.Set(maxSaturation)
	metrics.SSEBroadcastDuration.Observe(time.Since(start).Seconds())
	span.SetAttributes(
		attribute.Int("sse.client_count", clientCount),
		attribute.Int("sse.delivered_count", delivered),
		attribute.Int("sse.dropped_count", dropped),
	)
	_ = ctx
}

// ClientCount returns the number of connected SSE clients.
func (h *EventHub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// BroadcastSignalChange emits a "signal_change" SSE event for a single
// live-signal update using the typed envelope. The signal.Value
// is forwarded directly: its Raw becomes the typed `value` field and its
// Timestamp becomes `ts`. The ValueKind is resolved from
// protomodel.SignalsByName[field] so the frontend can switch on it without
// re-inferring the type from the JSON shape. Unknown fields fall back to
// ValueKindUnknown so unmapped/legacy signal names still propagate through
// the SSE channel.
//
// This is the per-signal-change companion to the existing batch
// "vehicle_update" Broadcast: callers that want O(1) keyed dashboard
// updates should publish through this helper instead of re-marshalling an
// entire vehicle map. Cross-pod fanout still flows through Redis Pub/Sub
// vehicle_signals via SubscribeRedis (preserved channel name per
// ARCHITECTURE.md ADR for layered live-state).
func (h *EventHub) BroadcastSignalChange(vehicleID int64, field string, val *signal.Value) {
	h.BroadcastSignalChangeWithContext(context.Background(), vehicleID, field, val)
}

// BroadcastSignalChangeWithContext is the ctx-aware variant. Prefer it
// over BroadcastSignalChange when the caller has a live trace context
// (e.g. MQTT telemetry consumer span) so the resulting sse.broadcast
// span nests under the same trace as the producer.
func (h *EventHub) BroadcastSignalChangeWithContext(ctx context.Context, vehicleID int64, field string, val *signal.Value) {
	if val == nil {
		return
	}
	kind := protomodel.ValueKindUnknown
	if meta, ok := protomodel.SignalsByName[field]; ok && meta != nil {
		kind = meta.ValueKind
	}
	h.BroadcastWithContext(ctx, "signal_change", SignalChangeEvent{
		StreamID:  h.streamID,
		Sequence:  h.signalSequence.Add(1),
		VehicleID: vehicleID,
		Field:     field,
		Kind:      kind,
		Value:     val.Raw,
		TS:        val.Timestamp,
	})
}

// SubscribeRedis listens on the Redis Pub/Sub vehicle_signals channel and
// forwards every message to all connected SSE clients. This enables multi-pod
// deployments where MQTT telemetry arrives on one pod but SSE clients may be
// on any pod. When ctx is cancelled the subscription is torn down.
//
// If redisCache is nil (Redis not configured) this is a no-op and single-pod
// in-process broadcasting remains the only path.
func (h *EventHub) SubscribeRedis(ctx context.Context, redisCache *signal.RedisSignalCache) {
	if redisCache == nil {
		return
	}
	ch := redisCache.SubscribeSignals(ctx)
	go func() {
		log.Info().Msg("SSE event hub: Redis Pub/Sub subscription started")
		for payload := range ch {
			// Each Redis-fanout fan-out gets its own root span because
			// cross-pod trace context propagation through Redis Pub/Sub
			// is out of scope (see plan.md `trace.continuity=false`
			// caveat). Operators can still see fan-out latency + drop
			// rate per message; future work can attach a span Link
			// when the producer pod's trace id is embedded in payload.
			ctx, span := sseTracer().Start(ctx, "sse.redis_fanout",
				oteltrace.WithSpanKind(oteltrace.SpanKindConsumer),
				oteltrace.WithAttributes(
					semconv.MessagingSystemKey.String("redis"),
					semconv.MessagingDestinationName("vehicle_signals"),
					semconv.MessagingOperationTypeKey.String("process"),
					attribute.Bool("trace.continuity", false),
					attribute.Int("messaging.message.payload_size_bytes", len(payload)),
				),
			)
			// payload is pre-formatted SSE data: "event: vehicle_update\ndata: ...\n\n"
			msg := []byte(payload)
			h.mu.RLock()
			clientCount := len(h.clients)
			delivered := 0
			dropped := 0
			maxSaturation := 0.0
			for id, c := range h.clients {
				select {
				case c <- msg:
					metrics.SSEEventsSent.WithLabelValues("vehicle_update").Inc()
					metrics.SSEBytesSent.Add(float64(len(msg)))
					delivered++
				default:
					metrics.SSEEventsDropped.WithLabelValues("vehicle_update").Inc()
					dropped++
					log.Warn().Str("client", id).Msg("SSE client buffer full (redis), dropping event")
				}
				if saturation := channelSaturation(c); saturation > maxSaturation {
					maxSaturation = saturation
				}
			}
			h.mu.RUnlock()
			metrics.SSEClientBufferSaturationRatio.Set(maxSaturation)
			span.SetAttributes(
				attribute.Int("sse.client_count", clientCount),
				attribute.Int("sse.delivered_count", delivered),
				attribute.Int("sse.dropped_count", dropped),
			)
			span.End()
			_ = ctx
		}
		log.Info().Msg("SSE event hub: Redis Pub/Sub subscription ended")
	}()
}

func channelSaturation(ch chan []byte) float64 {
	if cap(ch) == 0 {
		return 0
	}
	return float64(len(ch)) / float64(cap(ch))
}

// HandlerOption configures the SSE handler.
type HandlerOption func(*handlerConfig)

type handlerConfig struct {
	drain <-chan struct{}
}

// WithDrainSignal wires a channel that is closed when the process starts
// draining (the Kubernetes preStop hook flipping the readiness gate).
//
// This matters more than it looks. http.Server.Shutdown does NOT cancel
// the request context of an in-flight handler: it stops accepting new
// connections and then waits. An SSE handler blocked on its event
// channel therefore keeps the shutdown pending for the entire grace
// budget (30s in internal/app), after which every stream is severed
// abruptly. With a drain signal the handler returns immediately, emits a
// `shutdown` event so the SPA can reconnect deliberately instead of
// treating it as an error, and the pod drains in milliseconds.
func WithDrainSignal(ch <-chan struct{}) HandlerOption {
	return func(c *handlerConfig) { c.drain = ch }
}

// SSEHandler handles Server-Sent Events connections.
func SSEHandler(hub *EventHub, opts ...HandlerOption) http.HandlerFunc {
	cfg := handlerConfig{}
	for _, opt := range opts {
		opt(&cfg)
	}
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")

		clientID := fmt.Sprintf("sse-%d", time.Now().UnixNano())
		events, unsub := hub.Subscribe(clientID)
		defer unsub()

		log.Info().Str("client", clientID).Msg("SSE client connected")

		// Send initial heartbeat
		fmt.Fprintf(
			w,
			"event: connected\ndata: {\"client_id\":\"%s\",\"stream_id\":\"%s\"}\n\n",
			clientID,
			hub.StreamID(),
		)
		flusher.Flush()

		// Heartbeat ticker
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				log.Info().Str("client", clientID).Msg("SSE client disconnected")
				return
			case <-cfg.drain:
				fmt.Fprint(w, "event: shutdown\ndata: {\"reason\":\"draining\"}\n\n")
				flusher.Flush()
				log.Info().Str("client", clientID).Msg("SSE client released for pod drain")
				return
			case msg, ok := <-events:
				if !ok {
					return
				}
				_, _ = w.Write(msg)
				flusher.Flush()
			case <-ticker.C:
				fmt.Fprintf(w, "event: heartbeat\ndata: {\"time\":\"%s\"}\n\n", time.Now().UTC().Format(time.RFC3339))
				flusher.Flush()
			}
		}
	}
}
