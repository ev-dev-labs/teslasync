package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// ── config helpers ─────────────────────────────────────────────────────────

func TestEnvOr(t *testing.T) {
	const key = "OCPP_TEST_ENV_OR"
	tests := []struct {
		name  string
		set   bool
		value string
		def   string
		want  string
	}{
		{"unset returns default", false, "", "fallback", "fallback"},
		{"empty value returns default", true, "", "fallback", "fallback"},
		{"set value overrides default", true, ":19090", "fallback", ":19090"},
		{"whitespace value is preserved verbatim", true, "  spaced  ", "fallback", "  spaced  "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.set {
				t.Setenv(key, tt.value)
			} else if err := os.Unsetenv(key); err != nil {
				t.Fatalf("unset %s: %v", key, err)
			}
			if got := envOr(key, tt.def); got != tt.want {
				t.Errorf("envOr(%q, %q) = %q, want %q", key, tt.def, got, tt.want)
			}
		})
	}
}

func TestEnvDurationOr(t *testing.T) {
	const key = "OCPP_TEST_ENV_DUR"
	def := 300 * time.Second
	tests := []struct {
		name  string
		set   bool
		value string
		want  time.Duration
	}{
		{"unset returns default", false, "", def},
		{"empty value returns default", true, "", def},
		{"valid seconds", true, "45s", 45 * time.Second},
		{"valid composite", true, "1h30m", 90 * time.Minute},
		{"valid millis", true, "250ms", 250 * time.Millisecond},
		{"unparsable string falls back to default", true, "not-a-duration", def},
		{"bare number without unit falls back to default", true, "60", def},
		{"zero parses to zero", true, "0s", 0},
		{"negative parses through verbatim", true, "-5s", -5 * time.Second},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.set {
				t.Setenv(key, tt.value)
			} else if err := os.Unsetenv(key); err != nil {
				t.Fatalf("unset %s: %v", key, err)
			}
			if got := envDurationOr(key, def); got != tt.want {
				t.Errorf("envDurationOr(%q=%q, def=%v) = %v, want %v", key, tt.value, def, got, tt.want)
			}
		})
	}
}

func TestLoadConfig_Defaults(t *testing.T) {
	// Blank env vars must resolve to the spec defaults.
	t.Setenv("OCPP_LISTEN_ADDR", "")
	t.Setenv("OCPP_HEARTBEAT_INTERVAL", "")
	t.Setenv("OCPP_READ_DEADLINE", "")

	cfg := loadConfig()
	if cfg.listenAddr != defaultListenAddr {
		t.Errorf("listenAddr = %q, want %q", cfg.listenAddr, defaultListenAddr)
	}
	if cfg.heartbeatInterval != defaultHeartbeatInterval {
		t.Errorf("heartbeatInterval = %v, want %v", cfg.heartbeatInterval, defaultHeartbeatInterval)
	}
	if cfg.readDeadline != defaultReadDeadline {
		t.Errorf("readDeadline = %v, want %v", cfg.readDeadline, defaultReadDeadline)
	}
}

func TestLoadConfig_Overrides(t *testing.T) {
	t.Setenv("OCPP_LISTEN_ADDR", "127.0.0.1:19999")
	t.Setenv("OCPP_HEARTBEAT_INTERVAL", "30s")
	t.Setenv("OCPP_READ_DEADLINE", "90s")

	cfg := loadConfig()
	if cfg.listenAddr != "127.0.0.1:19999" {
		t.Errorf("listenAddr = %q, want 127.0.0.1:19999", cfg.listenAddr)
	}
	if cfg.heartbeatInterval != 30*time.Second {
		t.Errorf("heartbeatInterval = %v, want 30s", cfg.heartbeatInterval)
	}
	if cfg.readDeadline != 90*time.Second {
		t.Errorf("readDeadline = %v, want 90s", cfg.readDeadline)
	}
}

func TestLoadConfig_InvalidDurationsFallBack(t *testing.T) {
	t.Setenv("OCPP_LISTEN_ADDR", ":7070")
	t.Setenv("OCPP_HEARTBEAT_INTERVAL", "garbage")
	t.Setenv("OCPP_READ_DEADLINE", "also-bad")

	cfg := loadConfig()
	if cfg.listenAddr != ":7070" {
		t.Errorf("listenAddr = %q, want :7070", cfg.listenAddr)
	}
	if cfg.heartbeatInterval != defaultHeartbeatInterval {
		t.Errorf("heartbeatInterval = %v, want default %v", cfg.heartbeatInterval, defaultHeartbeatInterval)
	}
	if cfg.readDeadline != defaultReadDeadline {
		t.Errorf("readDeadline = %v, want default %v", cfg.readDeadline, defaultReadDeadline)
	}
}

// ── HTTP surface ───────────────────────────────────────────────────────────

func TestHealthz(t *testing.T) {
	rr := httptest.NewRecorder()
	healthz(rr, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	if body := strings.TrimSpace(rr.Body.String()); body != `{"status":"ok"}` {
		t.Errorf("body = %q, want {\"status\":\"ok\"}", body)
	}
	// Body must be valid JSON, not just a matching string.
	var payload map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("healthz body is not valid JSON: %v", err)
	}
	if payload["status"] != "ok" {
		t.Errorf("status field = %q, want ok", payload["status"])
	}
}

func TestNewMux_Routing(t *testing.T) {
	// A stub stands in for the OCPP WebSocket handler so we can assert
	// routing without a real upgrade handshake.
	var ocppHits int
	stub := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		ocppHits++
		w.WriteHeader(http.StatusTeapot)
	})
	mux := newMux(stub)

	tests := []struct {
		name        string
		path        string
		wantStatus  int
		wantOCPPHit bool
	}{
		{"healthz routes to probe", "/healthz", http.StatusOK, false},
		{"ocpp prefix routes to ws handler", "/ocpp/wallbox-1", http.StatusTeapot, true},
		{"ocpp bare prefix routes to ws handler", "/ocpp/", http.StatusTeapot, true},
		{"unknown path is 404", "/does-not-exist", http.StatusNotFound, false},
		{"root path is 404", "/", http.StatusNotFound, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ocppHits = 0
			rr := httptest.NewRecorder()
			mux.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, tt.path, nil))
			if rr.Code != tt.wantStatus {
				t.Errorf("status for %s = %d, want %d", tt.path, rr.Code, tt.wantStatus)
			}
			if got := ocppHits > 0; got != tt.wantOCPPHit {
				t.Errorf("ocpp handler hit for %s = %v, want %v", tt.path, got, tt.wantOCPPHit)
			}
		})
	}
}

func TestNewServer_Shape(t *testing.T) {
	srv := newServer(config{
		listenAddr:        "127.0.0.1:0",
		heartbeatInterval: 30 * time.Second,
		readDeadline:      0,
	})
	if srv == nil {
		t.Fatal("newServer returned nil")
	}
	if srv.Handler == nil {
		t.Fatal("newServer produced a server with a nil Handler")
	}
	if srv.ReadHeaderTimeout != readHeaderTimeout {
		t.Errorf("ReadHeaderTimeout = %v, want %v", srv.ReadHeaderTimeout, readHeaderTimeout)
	}
	// The wired handler must serve the health probe.
	rr := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rr.Code != http.StatusOK {
		t.Errorf("wired handler healthz status = %d, want 200", rr.Code)
	}
}

// ── run() lifecycle ────────────────────────────────────────────────────────

func TestRun_GracefulShutdown(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := newServer(config{heartbeatInterval: time.Minute})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- run(ctx, srv, ln, 2*time.Second) }()

	// Poll healthz until the server accepts (bounded, deterministic — the
	// listener is already bound so this resolves near-instantly).
	base := "http://" + ln.Addr().String()
	client := &http.Client{Timeout: time.Second}
	deadline := time.Now().Add(5 * time.Second)
	var resp *http.Response
	for {
		resp, err = client.Get(base + "/healthz")
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("healthz never became reachable: %v", err)
		}
	}
	statusCode := resp.StatusCode
	_ = resp.Body.Close()
	if statusCode != http.StatusOK {
		t.Errorf("healthz status = %d, want 200", statusCode)
	}

	cancel()
	select {
	case rerr := <-done:
		if rerr != nil {
			t.Errorf("run returned error on graceful shutdown: %v", rerr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("run did not return after context cancellation")
	}

	// After shutdown, the port must no longer serve.
	if _, err := client.Get(base + "/healthz"); err == nil {
		t.Error("expected healthz to be unreachable after shutdown")
	}
}

func TestRun_ContextAlreadyCancelled(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := newServer(config{heartbeatInterval: time.Minute})

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already cancelled before run starts

	if err := run(ctx, srv, ln, 2*time.Second); err != nil {
		t.Errorf("run with pre-cancelled context returned %v, want nil", err)
	}
}

func TestRun_ServerClosedExternallyReturnsNil(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := newServer(config{heartbeatInterval: time.Minute})

	// Context never cancels; the serve loop ends only because the server
	// is closed out from under it — Serve then reports ErrServerClosed,
	// which run must normalise to a nil (clean) result.
	done := make(chan error, 1)
	go func() { done <- run(context.Background(), srv, ln, 2*time.Second) }()

	base := "http://" + ln.Addr().String()
	client := &http.Client{Timeout: time.Second}
	deadline := time.Now().Add(5 * time.Second)
	for {
		resp, gerr := client.Get(base + "/healthz")
		if gerr == nil {
			_ = resp.Body.Close()
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("healthz never became reachable: %v", gerr)
		}
	}

	if err := srv.Close(); err != nil {
		t.Fatalf("close server: %v", err)
	}
	select {
	case rerr := <-done:
		if rerr != nil {
			t.Errorf("run returned %v after srv.Close, want nil", rerr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("run did not return after srv.Close")
	}
}

func TestRun_ServeErrorIsWrapped(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	// Closing the listener makes Serve fail immediately with a non-
	// ErrServerClosed error, exercising the startup-failure branch.
	if err := ln.Close(); err != nil {
		t.Fatalf("close listener: %v", err)
	}
	srv := newServer(config{heartbeatInterval: time.Minute})

	rerr := run(context.Background(), srv, ln, 2*time.Second)
	if rerr == nil {
		t.Fatal("run returned nil, want a serve error for a closed listener")
	}
	if !strings.Contains(rerr.Error(), "serve:") {
		t.Errorf("error = %q, want it wrapped with %q", rerr.Error(), "serve:")
	}
}

func TestRun_ShutdownTimeoutIsWrapped(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	// A handler that holds its request open keeps one connection in the
	// active state, so graceful drain cannot complete within the tiny
	// drain window — deterministically exercising the timeout branch.
	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	blocking := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		select {
		case entered <- struct{}{}:
		default:
		}
		<-release
	})
	srv := &http.Server{Handler: blocking, ReadHeaderTimeout: time.Second}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- run(ctx, srv, ln, 50*time.Millisecond) }()

	reqDone := make(chan struct{})
	go func() {
		defer close(reqDone)
		client := &http.Client{Timeout: 5 * time.Second}
		if resp, err := client.Get("http://" + ln.Addr().String() + "/"); err == nil {
			_ = resp.Body.Close()
		}
	}()

	select {
	case <-entered: // the request is now active in the handler
	case <-time.After(5 * time.Second):
		close(release)
		t.Fatal("blocking handler was never reached")
	}

	cancel() // trigger graceful shutdown with a drain window too short to finish
	select {
	case rerr := <-done:
		if rerr == nil {
			t.Fatal("run returned nil, want a graceful-shutdown timeout error")
		}
		if !strings.Contains(rerr.Error(), "graceful shutdown:") {
			t.Errorf("error = %q, want it wrapped with %q", rerr.Error(), "graceful shutdown:")
		}
	case <-time.After(5 * time.Second):
		close(release)
		t.Fatal("run did not return after context cancellation")
	}

	close(release)
	<-reqDone
}

// ── end-to-end OCPP WebSocket wiring ───────────────────────────────────────

func TestOCPPServer_WebSocketBootNotification(t *testing.T) {
	srv := newServer(config{heartbeatInterval: 42 * time.Second, readDeadline: 0})
	ts := httptest.NewServer(srv.Handler)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ocpp/wallbox-integration"
	dialer := websocket.Dialer{Subprotocols: []string{"ocpp1.6"}}
	c, resp, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.Close()
	if resp != nil && resp.StatusCode != http.StatusSwitchingProtocols {
		t.Errorf("handshake status = %d, want 101", resp.StatusCode)
	}
	if sp := c.Subprotocol(); sp != "ocpp1.6" {
		t.Errorf("negotiated subprotocol = %q, want ocpp1.6", sp)
	}

	boot, err := json.Marshal([]interface{}{
		2, "boot-msg-1", "BootNotification",
		map[string]string{"chargePointVendor": "Wallbox", "chargePointModel": "Pulsar Plus"},
	})
	if err != nil {
		t.Fatalf("marshal boot frame: %v", err)
	}
	if err := c.WriteMessage(websocket.TextMessage, boot); err != nil {
		t.Fatalf("write boot: %v", err)
	}

	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, msg, err := c.ReadMessage()
	if err != nil {
		t.Fatalf("read boot response: %v", err)
	}

	var frame []json.RawMessage
	if err := json.Unmarshal(msg, &frame); err != nil {
		t.Fatalf("decode CallResult envelope %q: %v", msg, err)
	}
	if len(frame) != 3 {
		t.Fatalf("CallResult must have 3 elements, got %d: %s", len(frame), msg)
	}
	if got := strings.TrimSpace(string(frame[0])); got != "3" {
		t.Errorf("message type = %s, want 3 (CallResult)", got)
	}
	var echoedID string
	if err := json.Unmarshal(frame[1], &echoedID); err != nil {
		t.Fatalf("decode message id: %v", err)
	}
	if echoedID != "boot-msg-1" {
		t.Errorf("echoed message id = %q, want boot-msg-1", echoedID)
	}

	var res struct {
		CurrentTime string `json:"currentTime"`
		Interval    int    `json:"interval"`
		Status      string `json:"status"`
	}
	if err := json.Unmarshal(frame[2], &res); err != nil {
		t.Fatalf("decode boot payload: %v", err)
	}
	if res.Status != "Accepted" {
		t.Errorf("status = %q, want Accepted", res.Status)
	}
	if res.Interval != 42 {
		t.Errorf("interval = %d, want 42 (heartbeat config must flow through)", res.Interval)
	}
	if res.CurrentTime == "" {
		t.Error("currentTime is empty, want an ISO-8601 timestamp")
	}
}

func TestOCPPServer_WebSocketRejectsWrongSubprotocol(t *testing.T) {
	srv := newServer(config{heartbeatInterval: time.Minute})
	ts := httptest.NewServer(srv.Handler)
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ocpp/wallbox-x"
	// Dial WITHOUT offering ocpp1.6; the server must refuse the charger.
	c, _, err := dialer(t).Dial(wsURL, nil)
	if err != nil {
		// Some stacks surface the refusal at handshake time — acceptable.
		return
	}
	defer c.Close()
	if sp := c.Subprotocol(); sp != "" {
		t.Errorf("negotiated subprotocol = %q, want none", sp)
	}

	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, _, err := c.ReadMessage(); err == nil {
		t.Fatal("expected the server to close the non-ocpp1.6 connection")
	} else if ce, ok := err.(*websocket.CloseError); ok && ce.Code != websocket.CloseProtocolError {
		t.Errorf("close code = %d, want ProtocolError (%d)", ce.Code, websocket.CloseProtocolError)
	}
}

func dialer(_ *testing.T) *websocket.Dialer {
	return &websocket.Dialer{} // no subprotocols
}
