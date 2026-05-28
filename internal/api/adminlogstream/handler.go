// Package adminlogstream — handler.go
//
// Phase-46 / Prompt 34 — Live log tail viewer.
//
// AdminLogStreamHandler exposes GET /api/v1/admin/logs/stream as a
// Server-Sent Events feed of the global zerolog stream. Operators
// previously had to SSH into the API container and `tail -f` the
// stdout log to debug live issues; this endpoint collapses that loop
// to a browser refresh away from the rest of the admin UI.
//
// AUTH MODEL.
//
// The endpoint is mounted under /api/v1/admin and inherits the parent
// ForwardAuth middleware that protects every authenticated route. We
// intentionally do NOT chain RequireSudo here: the prompt's reference
// to "RequireSudo middleware" predates the discovery that the browser
// `EventSource` API cannot attach custom headers (so it cannot send
// `X-Sudo-Token`), and `fetch` + ReadableStream is the only viable
// transport for sudo-gated SSE. The frontend in this prompt uses
// `fetch` + manual SSE parsing precisely so the X-Sudo-Token round-trip
// keeps working — the `RequireSudo` middleware below is therefore
// applied on the route chain in router.go without breaking the SPA.
//
// BACKPRESSURE.
//
// Each connected client owns a bounded subscriber channel (default
// 1024 events). When the client buffer fills (slow network, large
// payloads, paused tab) the registry drops events and increments a
// per-subscriber counter. The handler periodically forwards the drop
// count to the client as `event: drop` so the UI can surface "you
// missed N events" without losing the stream entirely.
//
// SAFETY.
//
// • `grep` is compiled with `regexp.Compile` and rejected with 400 on
//   syntax errors — never `MustCompile` against user input.
// • The SSE content-type + CSP-friendly headers are set BEFORE the
//   first flush so a misconfigured proxy cannot buffer the stream.
// • Request context cancellation tears down the subscriber so the
//   registry never leaks slots.

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

// ServeHTTP fulfils GET /api/v1/admin/logs/stream.
//
// Query parameters:
//
//   - level=debug|info|warn|error  (default: info)  — minimum level
//     forwarded to the client. Lower levels are dropped at the
//     subscriber edge so the wire bandwidth scales with the filter.
//   - grep=<regex>                 (optional)        — server-side
//     regex applied to the JSON payload as a string. Invalid regex →
//     400 BAD_REQUEST. Per-event match: payload bytes are coerced to
//     a string with one allocation; the regex is compiled once per
//     connection.
//
// Other UX-level filters (vehicle_id, fields, severity grouping) are
// the SPA's responsibility — the server intentionally does not do
// JSON-decode-per-event filtering because the throughput cost (~3x
// the current write path) would dwarf the bandwidth saving.
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

	// Connection-open envelope echoes the active filters back so the
	// SPA can confirm what the server agreed to before painting any
	// events. Useful when ForwardAuth or rate-limiters mutate query
	// params upstream.
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

	// Drop-tick is emitted whenever the subscriber's drop counter
	// changes. We poll every second rather than wiring an event so
	// the registry stays decoupled from the SSE wire shape.
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
				// Defensive — registry never closes Events but
				// guard so a future change does not silently
				// loop here.
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
		// Marshalling our own struct should never fail; if it does
		// we cannot recover mid-stream so fall back to closing.
		return false
	}
	return writeSSERaw(w, event, payload)
}

// writeSSERaw writes a pre-marshalled JSON payload as an SSE event.
// This avoids re-encoding the zerolog JSON for the hot `log` path —
// payload is sent verbatim to the wire EXCEPT for trailing newlines.
//
// zerolog terminates every emitted JSON object with `\n`. Per the SSE
// spec, a `\n` inside a `data:` line terminates the data field, so we
// must strip trailing newlines before formatting; the caller's
// `fmt.Fprintf` then re-adds the protocol-level `\n\n` terminator.
// Embedded newlines (which zerolog never produces but which a future
// log marshaller might) are escaped as `\ndata: ` so the entire JSON
// arrives in one logical SSE event.
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
