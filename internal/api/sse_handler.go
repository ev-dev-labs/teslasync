package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/rs/zerolog/log"
)

// EventHub manages SSE connections for real-time updates.
type EventHub struct {
	mu      sync.RWMutex
	clients map[string]chan []byte
}

// NewEventHub creates a new SSE event hub.
func NewEventHub() *EventHub {
	return &EventHub{
		clients: make(map[string]chan []byte),
	}
}

// Subscribe adds a client to the hub and returns a channel + unsubscribe func.
func (h *EventHub) Subscribe(id string) (<-chan []byte, func()) {
	ch := make(chan []byte, 64)
	h.mu.Lock()
	h.clients[id] = ch
	h.mu.Unlock()
	SSEConnectionsActive.Inc()
	SSEConnectionsTotal.Inc()

	return ch, func() {
		h.mu.Lock()
		delete(h.clients, id)
		close(ch)
		h.mu.Unlock()
		SSEConnectionsActive.Dec()
	}
}

// Broadcast sends a message to all connected clients.
func (h *EventHub) Broadcast(eventType string, data interface{}) {
	payload, err := json.Marshal(data)
	if err != nil {
		log.Error().Err(err).Msg("failed to marshal SSE event")
		return
	}

	msg := fmt.Appendf(nil, "event: %s\ndata: %s\n\n", eventType, payload)
	msgLen := float64(len(msg))

	start := time.Now()
	h.mu.RLock()
	defer h.mu.RUnlock()

	for id, ch := range h.clients {
		select {
		case ch <- msg:
			SSEEventsSent.WithLabelValues(eventType).Inc()
			SSEBytesSent.Add(msgLen)
		default:
			SSEEventsDropped.WithLabelValues(eventType).Inc()
			log.Warn().Str("client", id).Msg("SSE client buffer full, dropping event")
		}
	}
	SSEBroadcastDuration.Observe(time.Since(start).Seconds())
}

// ClientCount returns the number of connected SSE clients.
func (h *EventHub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
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
			// payload is pre-formatted SSE data: "event: vehicle_update\ndata: ...\n\n"
			msg := []byte(payload)
			h.mu.RLock()
			for id, c := range h.clients {
				select {
				case c <- msg:
					SSEEventsSent.WithLabelValues("vehicle_update").Inc()
					SSEBytesSent.Add(float64(len(msg)))
				default:
					SSEEventsDropped.WithLabelValues("vehicle_update").Inc()
					log.Warn().Str("client", id).Msg("SSE client buffer full (redis), dropping event")
				}
			}
			h.mu.RUnlock()
		}
		log.Info().Msg("SSE event hub: Redis Pub/Sub subscription ended")
	}()
}

// SSEHandler handles Server-Sent Events connections.
func SSEHandler(hub *EventHub) http.HandlerFunc {
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
		fmt.Fprintf(w, "event: connected\ndata: {\"client_id\":\"%s\"}\n\n", clientID)
		flusher.Flush()

		// Heartbeat ticker
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				log.Info().Str("client", clientID).Msg("SSE client disconnected")
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
