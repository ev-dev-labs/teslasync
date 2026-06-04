package ocpp

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog/log"
)

// Server is the OCPP-J WebSocket transport. It owns the upgrader,
// per-connection write mutex (gorilla/websocket requires one writer
// at a time), and the lifecycle of inbound message reads.
//
// The Server is intentionally NOT mounted on the main chi router —
// cmd/ocpp-server wraps it in a standalone http.Server so the
// WebSocket handshake doesn't have to coexist with the SPA's chi
// middleware stack (CORS, auth, rate limit) which would all be wrong
// for an outbound charger connection from a private LAN.
type Server struct {
	dispatcher *Dispatcher
	upgrader   websocket.Upgrader
	// readDeadline bounds how long we'll wait for a charger to send
	// the next frame before considering the connection dead. OCPP
	// chargers send Heartbeat every BootNotification.interval — set
	// readDeadline to ~3x that. 0 disables read deadline (tests).
	readDeadline time.Duration
}

// NewServer wraps the protocol-level dispatcher in a WebSocket
// transport. readDeadline of 0 disables the read deadline.
func NewServer(d *Dispatcher, readDeadline time.Duration) *Server {
	return &Server{
		dispatcher:   d,
		readDeadline: readDeadline,
		upgrader: websocket.Upgrader{
			// OCPP-J 1.6 requires the `ocpp1.6` Sec-WebSocket-Protocol.
			// Chargers MAY also offer `ocpp1.5` for backward compat —
			// we don't support 1.5, so don't echo it back.
			Subprotocols: []string{"ocpp1.6"},
			CheckOrigin: func(_ *http.Request) bool {
				// CSMS endpoints are LAN-private. Don't enforce a
				// browser-style same-origin check — chargers don't
				// set an Origin header.
				return true
			},
		},
	}
}

// ServeHTTP implements http.Handler. The URL path is expected to end
// with /{chargePointId}: e.g. ws://csms.lan:9090/ocpp/wallbox-001.
// The charge point id is opaque to OCPP — it's how the operator
// names the physical hardware in their inventory.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	chargePointID := chargePointFromPath(r.URL.Path)
	if chargePointID == "" {
		http.Error(w, "missing charge point id in path", http.StatusBadRequest)
		return
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		// Upgrade already wrote a response.
		log.Warn().Err(err).Str("charge_point", chargePointID).Msg("OCPP upgrade failed")
		return
	}
	defer conn.Close()

	// Negotiated subprotocol must be ocpp1.6 — otherwise the charger
	// doesn't speak our wire format. Refuse the connection.
	if sp := conn.Subprotocol(); sp != "ocpp1.6" {
		log.Warn().Str("subprotocol", sp).Str("charge_point", chargePointID).
			Msg("rejected OCPP connection: charger did not request ocpp1.6")
		_ = conn.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseProtocolError, "ocpp1.6 required"),
			time.Now().Add(2*time.Second))
		return
	}

	log.Info().Str("charge_point", chargePointID).
		Str("remote", r.RemoteAddr).
		Msg("OCPP charger connected")

	s.serve(r.Context(), chargePointID, conn)
}

// serve is the per-connection read loop. Writes are serialized
// through writeMu so concurrent dispatch + heartbeat responses don't
// interleave bytes on the wire (a fatal gorilla/websocket invariant).
func (s *Server) serve(ctx context.Context, chargePointID string, conn *websocket.Conn) {
	var writeMu sync.Mutex
	writeFrame := func(payload []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteMessage(websocket.TextMessage, payload)
	}

	for {
		if s.readDeadline > 0 {
			_ = conn.SetReadDeadline(time.Now().Add(s.readDeadline))
		}
		mt, raw, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err,
				websocket.CloseNormalClosure, websocket.CloseGoingAway,
				websocket.CloseNoStatusReceived) {
				log.Info().Str("charge_point", chargePointID).Msg("OCPP charger disconnected")
			} else {
				log.Warn().Err(err).Str("charge_point", chargePointID).Msg("OCPP read error")
			}
			return
		}
		if mt != websocket.TextMessage {
			// OCPP-J is always JSON-over-text. Binary frames are
			// malformed; ignore + continue.
			continue
		}

		out, err := s.dispatcher.Dispatch(ctx, chargePointID, raw)
		if err != nil {
			log.Warn().Err(err).Str("charge_point", chargePointID).
				Str("raw", truncate(string(raw), 256)).
				Msg("dispatch error; closing connection")
			return
		}
		if err := writeFrame(out); err != nil {
			log.Warn().Err(err).Str("charge_point", chargePointID).Msg("OCPP write error")
			return
		}
	}
}

// chargePointFromPath returns the last non-empty segment of the URL
// path. Empty if no segment is present.
func chargePointFromPath(p string) string {
	// Trim trailing slashes (a common gateway quirk) then take last.
	trimmed := strings.TrimRight(p, "/")
	if trimmed == "" {
		return ""
	}
	idx := strings.LastIndex(trimmed, "/")
	if idx < 0 {
		return trimmed
	}
	return trimmed[idx+1:]
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

var _ = errors.New
