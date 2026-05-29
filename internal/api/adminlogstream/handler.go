// Package adminlogstream exposes the admin log-tail SSE endpoint.
//
// It keeps filtering server-side but reports subscriber drops instead of
// blocking slow clients; router.go owns auth and zerolog tap wiring.

package adminlogstream

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/platform"
)

// AdminLogStreamPath is the canonical SSE route this handler serves.
// Exported so middleware/skip predicates can reference it without
// hard-coding the string in two places.
const AdminLogStreamPath = "/api/v1/admin/logs/stream"

// adminLogStreamHeartbeatInterval is the cadence at which the handler
// emits an empty `heartbeat` event. Picked at 25s so any reasonable
// reverse-proxy idle-timeout (typically 30-60s) sees liveness traffic
// and does not nuke the connection.
const adminLogStreamHeartbeatInterval = 25 * time.Second

// adminLogStreamMaxGrepLen is a defensive cap on the user-supplied
// grep pattern to prevent compile-time DoS via pathological regex.
// 256 bytes is generous for any plausible search expression.
const adminLogStreamMaxGrepLen = 256

// AdminLogStreamHandler is the SSE handler for the admin log stream.
// Construct one per process via NewAdminLogStreamHandler and share it
// across the route table. The registry is the only required dep; an
// optional `nowFn` seam exists for tests that need deterministic
// drop-tick timestamps.
type AdminLogStreamHandler struct {
	registry *platform.LogSubscriberRegistry
	now      func() time.Time
}

// NewAdminLogStreamHandler constructs the handler. registry must be
// non-nil; passing a nil registry returns nil so callers crash at
// wire-time rather than producing a 500-loop in production.
func NewAdminLogStreamHandler(registry *platform.LogSubscriberRegistry) *AdminLogStreamHandler {
	if registry == nil {
		return nil
	}
	return &AdminLogStreamHandler{
		registry: registry,
		now:      func() time.Time { return time.Now().UTC() },
	}
}

// ServeHTTP streams server-filtered admin logs.
//
// The server handles level and regex filters but leaves JSON-level UX filters
// to the SPA to avoid decoding every event on the hot path.
func (h *AdminLogStreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.registry == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "log stream not configured")
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.WriteError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// Parse + validate query params BEFORE writing any SSE headers so
	// a 400 carries a normal JSON error body the SPA can decode.
	level, levelStr, err := parseLogStreamLevel(r.URL.Query().Get("level"))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	grepRaw := strings.TrimSpace(r.URL.Query().Get("grep"))
	if len(grepRaw) > adminLogStreamMaxGrepLen {
		httpx.WriteError(w, http.StatusBadRequest,
			fmt.Sprintf("grep pattern exceeds %d bytes", adminLogStreamMaxGrepLen))
		return
	}
	var grepRe *regexp.Regexp
	if grepRaw != "" {
		grepRe, err = regexp.Compile(grepRaw)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest,
				fmt.Sprintf("invalid grep pattern: %v", err))
			return
		}
	}

	// SSE headers. X-Accel-Buffering disables nginx buffering; without
	// it the stream sits in the proxy buffer until 8KiB accumulates.
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	sub := h.registry.Subscribe(level)
	defer sub.Close()

	// Echo active filters so the SPA can detect upstream query mutation.
	connectedPayload := struct {
		Level string `json:"level"`
		Grep  string `json:"grep,omitempty"`
	}{Level: levelStr, Grep: grepRaw}
	if !writeSSEEvent(w, "connected", connectedPayload) {
		return
	}
	flusher.Flush()

	heartbeat := time.NewTicker(adminLogStreamHeartbeatInterval)
	defer heartbeat.Stop()

	// Poll drops so the registry stays decoupled from the SSE wire shape.
	dropCheck := time.NewTicker(time.Second)
	defer dropCheck.Stop()

	var lastDrops uint64

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-sub.Done():
			return
		case <-heartbeat.C:
			if !writeSSEEvent(w, "heartbeat", map[string]string{
				"at": h.now().Format(time.RFC3339),
			}) {
				return
			}
			flusher.Flush()
		case <-dropCheck.C:
			cur := sub.Drops()
			if cur != lastDrops {
				delta := cur - lastDrops
				lastDrops = cur
				if !writeSSEEvent(w, "drop", map[string]uint64{
					"missed": delta,
					"total":  cur,
				}) {
					return
				}
				flusher.Flush()
			}
		case evt, ok := <-sub.Events():
			if !ok {
				// Defensive: avoid a silent spin if the registry ever closes Events.
				return
			}
			if grepRe != nil && !grepRe.Match(evt.Payload) {
				continue
			}
			if !writeSSERaw(w, "log", evt.Payload) {
				return
			}
			flusher.Flush()
		}
	}
}

// parseLogStreamLevel maps a query param to a zerolog.Level. Empty
// input → InfoLevel (default). Unrecognised input → 400. Trace and
// disabled levels are intentionally rejected: trace would flood the
// stream with spans the operator did not ask for, and disabled is
// non-sensical for a tail.
func parseLogStreamLevel(raw string) (zerolog.Level, string, error) {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		return zerolog.InfoLevel, "info", nil
	}
	switch raw {
	case "debug":
		return zerolog.DebugLevel, "debug", nil
	case "info":
		return zerolog.InfoLevel, "info", nil
	case "warn", "warning":
		return zerolog.WarnLevel, "warn", nil
	case "error", "err":
		return zerolog.ErrorLevel, "error", nil
	case "fatal":
		return zerolog.FatalLevel, "fatal", nil
	case "panic":
		return zerolog.PanicLevel, "panic", nil
	}
	return zerolog.NoLevel, "", fmt.Errorf("unsupported level %q", raw)
}

// writeSSEEvent JSON-encodes data and writes it as a named SSE event.
// Returns false on any write error so the caller can exit the loop —
// EOF on the wire is the standard "client disconnected" signal.
func writeSSEEvent(w http.ResponseWriter, event string, data interface{}) bool {
	payload, err := json.Marshal(data)
	if err != nil {
		// Cannot recover mid-stream; close on unexpected marshal failure.
		return false
	}
	return writeSSERaw(w, event, payload)
}

// writeSSERaw preserves pre-marshalled JSON and prefixes each physical line
// so future multi-line payloads remain valid SSE.
func writeSSERaw(w http.ResponseWriter, event string, payload []byte) bool {
	for len(payload) > 0 && payload[len(payload)-1] == '\n' {
		payload = payload[:len(payload)-1]
	}
	if _, err := fmt.Fprintf(w, "event: %s\ndata: ", event); err != nil {
		return false
	}
	// Hot path: no embedded newlines (the common case for zerolog).
	if !bytesContainsByte(payload, '\n') {
		if _, err := w.Write(payload); err != nil {
			return false
		}
		if _, err := fmt.Fprint(w, "\n\n"); err != nil {
			return false
		}
		return true
	}
	// Cold path: split on '\n' and re-prefix each line per SSE spec.
	for i, line := range splitOnNewline(payload) {
		if i > 0 {
			if _, err := fmt.Fprint(w, "\ndata: "); err != nil {
				return false
			}
		}
		if _, err := w.Write(line); err != nil {
			return false
		}
	}
	if _, err := fmt.Fprint(w, "\n\n"); err != nil {
		return false
	}
	return true
}

// bytesContainsByte is a tiny inlinable helper that avoids an allocation
// vs. bytes.IndexByte for the hot fast-path.
func bytesContainsByte(b []byte, c byte) bool {
	for _, x := range b {
		if x == c {
			return true
		}
	}
	return false
}

func splitOnNewline(b []byte) [][]byte {
	out := make([][]byte, 0, 2)
	start := 0
	for i, c := range b {
		if c == '\n' {
			out = append(out, b[start:i])
			start = i + 1
		}
	}
	out = append(out, b[start:])
	return out
}
