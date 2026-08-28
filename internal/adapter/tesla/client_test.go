package tesla

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/platform/config"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// ── NewClient ──────────────────────────────────────────────────────────────

func TestNewClient(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		cfg         config.TeslaConfig
		wantTimeout time.Duration
	}{
		{
			name:        "explicit timeout preserved",
			cfg:         config.TeslaConfig{BaseURL: "https://api", AuthURL: "https://auth", Timeout: 12 * time.Second},
			wantTimeout: 12 * time.Second,
		},
		{
			name:        "zero timeout falls back to default",
			cfg:         config.TeslaConfig{BaseURL: "https://api", AuthURL: "https://auth", Timeout: 0},
			wantTimeout: defaultTimeout,
		},
		{
			name:        "negative timeout falls back to default",
			cfg:         config.TeslaConfig{BaseURL: "https://api", Timeout: -5 * time.Second},
			wantTimeout: defaultTimeout,
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			c := NewClient(tt.cfg)
			if c == nil {
				t.Fatal("NewClient returned nil")
			}
			assertEq(t, "timeout", c.timeout, tt.wantTimeout)
			assertEq(t, "baseURL", c.baseURL, tt.cfg.BaseURL)
			assertEq(t, "authURL", c.authURL, tt.cfg.AuthURL)
			if c.httpClient == nil {
				t.Error("httpClient is nil")
			}
			if c.cb == nil {
				t.Error("circuit breaker is nil")
			}
		})
	}
}

// ── GetVehicleState ────────────────────────────────────────────────────────

func TestGetVehicleState_Success(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if want := "/api/1/vehicles/VIN1/vehicle_data"; r.URL.Path != want {
			t.Errorf("path = %s, want %s", r.URL.Path, want)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"response":{
			"vin":"VIN1","state":"online",
			"charge_state":{"battery_level":80,"charging_state":"Charging","conn_charge_cable":"IEC"},
			"drive_state":{"speed":33}
		}}`)
	}))
	defer srv.Close()

	c := newTestClient(srv.URL, 5*time.Second)
	state, err := c.GetVehicleState(context.Background(), "VIN1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	assertEq(t, "VIN", state.VIN, "VIN1")
	assertEq(t, "State", state.State, "online")
	assertEq(t, "BatteryLevel", state.BatteryLevel, 80)
	assertEq(t, "IsCharging", state.IsCharging, true)
	assertEq(t, "ChargerConnected", state.ChargerConnected, true)
	assertEqf(t, "Speed", state.Speed, 33)
}

func TestGetVehicleState_Errors(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		status  int
		body    string
		wantSub string
	}{
		{"non-200 returns status error", http.StatusServiceUnavailable, `{"response":{}}`, "status 503"},
		{"unauthorized returns status error", http.StatusUnauthorized, `{}`, "status 401"},
		{"malformed outer json", http.StatusOK, `{{{not json`, "decoding response"},
		{"wrong-shape response body", http.StatusOK, `{"response":[1,2,3]}`, "unmarshaling vehicle state"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
				_, _ = io.WriteString(w, tt.body)
			}))
			defer srv.Close()

			c := newTestClient(srv.URL, 5*time.Second)
			state, err := c.GetVehicleState(context.Background(), "VIN1")
			if err == nil {
				t.Fatalf("expected error, got state %+v", state)
			}
			if state != nil {
				t.Errorf("expected nil state on error, got %+v", state)
			}
			if !strings.Contains(err.Error(), tt.wantSub) {
				t.Errorf("error %q does not contain %q", err.Error(), tt.wantSub)
			}
		})
	}
}

func TestGetVehicleState_RequestError(t *testing.T) {
	t.Parallel()

	c := newRequestErrorClient(5 * time.Second)
	_, err := c.GetVehicleState(context.Background(), "VIN1")
	if err == nil {
		t.Fatal("expected request error, got nil")
	}
	if !strings.Contains(err.Error(), "executing request") {
		t.Errorf("error %q does not mention executing request", err.Error())
	}
}

// ── GetVehicleData ─────────────────────────────────────────────────────────

func TestGetVehicleData_Success(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if want := "/api/1/vehicles/VINX/vehicle_data"; r.URL.Path != want {
			t.Errorf("path = %s, want %s", r.URL.Path, want)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"response":{"battery_level":55},"count":1}`)
	}))
	defer srv.Close()

	c := newTestClient(srv.URL, 5*time.Second)
	data, err := c.GetVehicleData(context.Background(), "VINX")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if data == nil {
		t.Fatal("expected data map, got nil")
	}
	if _, ok := data["response"]; !ok {
		t.Errorf("expected response key in %v", data)
	}
}

func TestGetVehicleData_Errors(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		status  int
		body    string
		wantSub string
	}{
		// Regression guard: a 500 with a JSON error body must surface an
		// error, not be returned as if it were vehicle data.
		{"server error surfaces error", http.StatusInternalServerError, `{"error":"boom"}`, "status 500"},
		{"unauthorized surfaces error", http.StatusUnauthorized, `{"error":"nope"}`, "status 401"},
		{"malformed json body", http.StatusOK, `not json`, "decoding response"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
				_, _ = io.WriteString(w, tt.body)
			}))
			defer srv.Close()

			c := newTestClient(srv.URL, 5*time.Second)
			data, err := c.GetVehicleData(context.Background(), "VINX")
			if err == nil {
				t.Fatalf("expected error, got data %v", data)
			}
			if data != nil {
				t.Errorf("expected nil data on error, got %v", data)
			}
			if !strings.Contains(err.Error(), tt.wantSub) {
				t.Errorf("error %q does not contain %q", err.Error(), tt.wantSub)
			}
		})
	}
}

// ── WakeUp ─────────────────────────────────────────────────────────────────

func TestWakeUp(t *testing.T) {
	t.Parallel()
	t.Run("success", func(t *testing.T) {
		t.Parallel()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				t.Errorf("method = %s, want POST", r.Method)
			}
			if want := "/api/1/vehicles/VINW/wake_up"; r.URL.Path != want {
				t.Errorf("path = %s, want %s", r.URL.Path, want)
			}
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()

		c := newTestClient(srv.URL, 5*time.Second)
		if err := c.WakeUp(context.Background(), "VINW"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("non-200 returns error", func(t *testing.T) {
		t.Parallel()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusRequestTimeout)
		}))
		defer srv.Close()

		c := newTestClient(srv.URL, 5*time.Second)
		err := c.WakeUp(context.Background(), "VINW")
		if err == nil {
			t.Fatal("expected error for non-200, got nil")
		}
		if !strings.Contains(err.Error(), "status 408") {
			t.Errorf("error %q does not contain status 408", err.Error())
		}
	})

	t.Run("request error", func(t *testing.T) {
		t.Parallel()

		c := newRequestErrorClient(5 * time.Second)
		if err := c.WakeUp(context.Background(), "VINW"); err == nil {
			t.Fatal("expected request error, got nil")
		}
	})
}

// ── SendCommand ────────────────────────────────────────────────────────────

func TestSendCommand_NoParams(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		if want := "/api/1/vehicles/VINC/command/lock"; r.URL.Path != want {
			t.Errorf("path = %s, want %s", r.URL.Path, want)
		}
		body, _ := io.ReadAll(r.Body)
		if len(body) != 0 {
			t.Errorf("expected empty body, got %q", body)
		}
		if ct := r.Header.Get("Content-Type"); ct != "" {
			t.Errorf("expected no Content-Type without params, got %q", ct)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := newTestClient(srv.URL, 5*time.Second)
	if err := c.SendCommand(context.Background(), "VINC", "lock", nil); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSendCommand_WithParams(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if want := "/api/1/vehicles/VINC/command/actuate_trunk"; r.URL.Path != want {
			t.Errorf("path = %s, want %s", r.URL.Path, want)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q, want application/json", ct)
		}
		body, _ := io.ReadAll(r.Body)
		var got map[string]interface{}
		if err := json.Unmarshal(body, &got); err != nil {
			t.Fatalf("body is not valid json (%q): %v", body, err)
		}
		if got["which_trunk"] != "front" {
			t.Errorf("which_trunk = %v, want front", got["which_trunk"])
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := newTestClient(srv.URL, 5*time.Second)
	err := c.SendCommand(context.Background(), "VINC", "actuate_trunk",
		map[string]interface{}{"which_trunk": "front"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSendCommand_Non200(t *testing.T) {
	t.Parallel()
	// Regression guard: a failed command must return an error, not nil.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	c := newTestClient(srv.URL, 5*time.Second)
	err := c.SendCommand(context.Background(), "VINC", "honk_horn", nil)
	if err == nil {
		t.Fatal("expected error for non-200 command, got nil")
	}
	if !strings.Contains(err.Error(), "honk_horn") || !strings.Contains(err.Error(), "status 400") {
		t.Errorf("error %q missing command name or status", err.Error())
	}
}

func TestSendCommand_ParamsMarshalError(t *testing.T) {
	t.Parallel()
	// A channel value cannot be JSON-encoded, exercising the marshal branch
	// before any HTTP call is made.
	c := newTestClient("http://127.0.0.1:0", 5*time.Second)
	err := c.SendCommand(context.Background(), "VINC", "set_temps",
		map[string]interface{}{"bad": make(chan int)})
	if err == nil {
		t.Fatal("expected marshal error, got nil")
	}
	if !strings.Contains(err.Error(), "marshaling command params") {
		t.Errorf("error %q does not mention marshaling", err.Error())
	}
}

func TestSendCommand_RequestError(t *testing.T) {
	t.Parallel()

	c := newRequestErrorClient(5 * time.Second)
	if err := c.SendCommand(context.Background(), "VINC", "lock", nil); err == nil {
		t.Fatal("expected request error, got nil")
	}
}

// ── Circuit breaker ────────────────────────────────────────────────────────

func TestCircuitBreakerOpensAfterFailures(t *testing.T) {
	t.Parallel()
	var calls atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := newTestClientWithBreaker(srv.URL, 5*time.Second, httputil.CircuitBreakerConfig{
		FailureThreshold:    1,
		ResetTimeout:        time.Minute,
		HalfOpenMaxRequests: 1,
	})

	// First call fails with a real HTTP error and trips the breaker open.
	if _, err := c.GetVehicleData(context.Background(), "VIN1"); err == nil {
		t.Fatal("expected first call to fail")
	}
	// Second call must fast-fail from the open breaker without hitting the server.
	_, err := c.GetVehicleData(context.Background(), "VIN1")
	if err == nil {
		t.Fatal("expected second call to fail fast")
	}
	if !errors.Is(err, httputil.ErrCircuitOpen) {
		t.Errorf("expected ErrCircuitOpen, got %v", err)
	}
	if got := calls.Load(); got != 1 {
		t.Errorf("server hit %d times, want 1 (breaker should short-circuit)", got)
	}
}

// ── Context / timeout ──────────────────────────────────────────────────────

func TestClientTimeoutApplies(t *testing.T) {
	t.Parallel()
	// A sub-nanosecond client timeout makes the derived request context expire
	// before the transport can complete, deterministically without sleeps.
	c := newTestClient("http://192.0.2.1:9", time.Nanosecond)
	_, err := c.GetVehicleState(context.Background(), "VIN1")
	if err == nil {
		t.Fatal("expected deadline error, got nil")
	}
}

func TestContextCancellationPropagates(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := newTestClient(srv.URL, 5*time.Second)

	tests := []struct {
		name string
		call func(ctx context.Context) error
	}{
		{"GetVehicleState", func(ctx context.Context) error { _, e := c.GetVehicleState(ctx, "V"); return e }},
		{"GetVehicleData", func(ctx context.Context) error { _, e := c.GetVehicleData(ctx, "V"); return e }},
		{"WakeUp", func(ctx context.Context) error { return c.WakeUp(ctx, "V") }},
		{"SendCommand", func(ctx context.Context) error { return c.SendCommand(ctx, "V", "lock", nil) }},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ctx, cancel := context.WithCancel(context.Background())
			cancel() // already cancelled
			if err := tt.call(ctx); err == nil {
				t.Fatalf("%s: expected error with cancelled context, got nil", tt.name)
			}
		})
	}
}

// ── Unimplemented auth methods ─────────────────────────────────────────────

func TestRefreshToken_NotImplemented(t *testing.T) {
	t.Parallel()
	c := newTestClient("http://127.0.0.1:0", 5*time.Second)
	pair, err := c.RefreshToken(context.Background(), "some-refresh-token")
	if err == nil {
		t.Fatal("expected not-implemented error, got nil")
	}
	if pair != nil {
		t.Errorf("expected nil token pair, got %+v", pair)
	}
}

func TestRevokeToken_NotImplemented(t *testing.T) {
	t.Parallel()
	c := newTestClient("http://127.0.0.1:0", 5*time.Second)
	if err := c.RevokeToken(context.Background(), "some-access-token"); err == nil {
		t.Fatal("expected not-implemented error, got nil")
	}
}
