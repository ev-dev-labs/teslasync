package tesla

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

func TestNewClientSetsFields(t *testing.T) {
	cfg := config.TeslaConfig{
		ClientID:     "cid",
		ClientSecret: "csec",
		BaseURL:      "https://fleet.example.com",
		AuthURL:      "https://auth.example.com",
		RedirectURI:  "http://localhost:4000/cb",
		Timeout:      15 * time.Second,
	}
	c := NewClient(cfg)
	if c == nil {
		t.Fatal("NewClient() returned nil")
	}
	if c.baseURL != cfg.BaseURL {
		t.Errorf("baseURL = %q, want %q", c.baseURL, cfg.BaseURL)
	}
	if c.authURL != cfg.AuthURL {
		t.Errorf("authURL = %q, want %q", c.authURL, cfg.AuthURL)
	}
	if c.clientID != cfg.ClientID {
		t.Errorf("clientID = %q, want %q", c.clientID, cfg.ClientID)
	}
	if c.clientSec != cfg.ClientSecret {
		t.Errorf("clientSec = %q, want %q", c.clientSec, cfg.ClientSecret)
	}
	if c.redirectURI != cfg.RedirectURI {
		t.Errorf("redirectURI = %q, want %q", c.redirectURI, cfg.RedirectURI)
	}
}

func TestHasValidTokenNoTokenSet(t *testing.T) {
	cfg := config.TeslaConfig{BaseURL: "http://localhost", AuthURL: "http://localhost", Timeout: 5 * time.Second}
	c := NewClient(cfg)
	if c.HasValidToken() {
		t.Error("HasValidToken() = true with no token set, want false")
	}
}

func TestHasValidTokenValid(t *testing.T) {
	cfg := config.TeslaConfig{BaseURL: "http://localhost", AuthURL: "http://localhost", Timeout: 5 * time.Second}
	c := NewClient(cfg)
	c.SetTokens("tok", "ref", time.Now().Add(1*time.Hour))
	if !c.HasValidToken() {
		t.Error("HasValidToken() = false with valid token, want true")
	}
}

func TestHasValidTokenExpired(t *testing.T) {
	cfg := config.TeslaConfig{BaseURL: "http://localhost", AuthURL: "http://localhost", Timeout: 5 * time.Second}
	c := NewClient(cfg)
	c.SetTokens("tok", "ref", time.Now().Add(-1*time.Minute))
	if c.HasValidToken() {
		t.Error("HasValidToken() = true with expired token, want false")
	}
}

func TestSetTokensUpdatesAllFields(t *testing.T) {
	cfg := config.TeslaConfig{BaseURL: "http://localhost", AuthURL: "http://localhost", Timeout: 5 * time.Second}
	c := NewClient(cfg)

	exp := time.Now().Add(2 * time.Hour)
	c.SetTokens("new-access", "new-refresh", exp)

	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.accessToken != "new-access" {
		t.Errorf("accessToken = %q, want %q", c.accessToken, "new-access")
	}
	if c.refreshTok != "new-refresh" {
		t.Errorf("refreshTok = %q, want %q", c.refreshTok, "new-refresh")
	}
	if !c.expiresAt.Equal(exp) {
		t.Errorf("expiresAt = %v, want %v", c.expiresAt, exp)
	}
}

func TestExpiresWithinExpiringSoon(t *testing.T) {
	cfg := config.TeslaConfig{BaseURL: "http://localhost", AuthURL: "http://localhost", Timeout: 5 * time.Second}
	c := NewClient(cfg)
	c.SetTokens("tok", "ref", time.Now().Add(2*time.Minute))
	if !c.ExpiresWithin(5 * time.Minute) {
		t.Error("ExpiresWithin(5m) = false, want true (expires in 2m)")
	}
}

func TestExpiresWithinNotExpiring(t *testing.T) {
	cfg := config.TeslaConfig{BaseURL: "http://localhost", AuthURL: "http://localhost", Timeout: 5 * time.Second}
	c := NewClient(cfg)
	c.SetTokens("tok", "ref", time.Now().Add(1*time.Hour))
	if c.ExpiresWithin(5 * time.Minute) {
		t.Error("ExpiresWithin(5m) = true, want false (expires in 1h)")
	}
}

func TestExpiresWithinNoToken(t *testing.T) {
	cfg := config.TeslaConfig{BaseURL: "http://localhost", AuthURL: "http://localhost", Timeout: 5 * time.Second}
	c := NewClient(cfg)
	if c.ExpiresWithin(5 * time.Minute) {
		t.Error("ExpiresWithin() = true with no token, want false")
	}
}

func TestErrVehicleAsleepAndErrUnauthorizedAreDistinct(t *testing.T) {
	if errors.Is(ErrVehicleAsleep, ErrUnauthorized) {
		t.Error("ErrVehicleAsleep should not equal ErrUnauthorized")
	}
	if errors.Is(ErrUnauthorized, ErrVehicleAsleep) {
		t.Error("ErrUnauthorized should not equal ErrVehicleAsleep")
	}
	if ErrVehicleAsleep.Error() == ErrUnauthorized.Error() {
		t.Error("error messages should differ")
	}
}

func TestListVehiclesMockResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/1/vehicles" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"response": []map[string]interface{}{
				{"id": 1, "vehicle_id": 100, "vin": "TESTVIN", "display_name": "Car", "state": "online"},
			},
			"count": 1,
		})
	}))
	defer server.Close()

	c := newTestClient(server)
	vehicles, err := c.ListVehicles(context.Background())
	if err != nil {
		t.Fatalf("ListVehicles() error = %v", err)
	}
	if len(vehicles) != 1 {
		t.Fatalf("len = %d, want 1", len(vehicles))
	}
	if vehicles[0].VIN != "TESTVIN" {
		t.Errorf("VIN = %q, want TESTVIN", vehicles[0].VIN)
	}
}

func TestGetVehicleDataMockResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"response": map[string]interface{}{
				"id": 1, "vehicle_id": 100, "vin": "TESTVIN",
				"display_name": "Car", "state": "online",
				"charge_state":   map[string]interface{}{"battery_level": 85, "battery_range": 260.0, "charging_state": "Disconnected"},
				"climate_state":  map[string]interface{}{"inside_temp": 21.0, "outside_temp": 15.0},
				"drive_state":    map[string]interface{}{"latitude": 40.7128, "longitude": -74.0060, "heading": 180},
				"vehicle_state":  map[string]interface{}{"odometer": 30000.0, "locked": false, "software_update": map[string]interface{}{"status": "", "version": ""}},
				"vehicle_config": map[string]interface{}{"car_type": "modely"},
			},
		})
	}))
	defer server.Close()

	c := newTestClient(server)
	data, err := c.GetVehicleData(context.Background(), "TESTVIN100")
	if err != nil {
		t.Fatalf("GetVehicleData() error = %v", err)
	}
	if data.ChargeState.BatteryLevel != 85 {
		t.Errorf("BatteryLevel = %d, want 85", data.ChargeState.BatteryLevel)
	}
	if data.VehicleConfig.CarType != "modely" {
		t.Errorf("CarType = %q, want modely", data.VehicleConfig.CarType)
	}
}

func TestDoRequest401(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	c := newTestClient(server)
	_, err := c.ListVehicles(context.Background())
	if !errors.Is(err, ErrUnauthorized) {
		t.Errorf("error = %v, want ErrUnauthorized", err)
	}
}

func TestDoRequest429(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()

	c := newTestClient(server)
	_, err := c.ListVehicles(context.Background())
	if err == nil {
		t.Fatal("expected rate limit error")
	}
}

func TestDoRequest500(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	c := newTestClient(server)
	_, err := c.ListVehicles(context.Background())
	if err == nil {
		t.Fatal("expected server error")
	}
}

func TestDoRequestStopsBeforeNetworkWhenBudgetIsExceeded(t *testing.T) {
	var requests atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	c := NewClient(config.TeslaConfig{
		BaseURL:           server.URL,
		AuthURL:           server.URL,
		Timeout:           5 * time.Second,
		DailyBudgetUSD:    0.0005,
		CommandReserveUSD: 0,
	})
	_, err := c.ListVehicles(context.Background())
	if !errors.Is(err, ErrBudgetExceeded) {
		t.Fatalf("ListVehicles error = %v, want ErrBudgetExceeded", err)
	}
	if got := requests.Load(); got != 0 {
		t.Fatalf("network requests = %d, want 0", got)
	}
}

type unavailableRequestBudget struct{}

func (unavailableRequestBudget) Reserve(context.Context, BudgetCharge) (BudgetSnapshot, error) {
	return BudgetSnapshot{}, errors.New("database unavailable")
}

func (unavailableRequestBudget) Snapshot(context.Context) (BudgetSnapshot, error) {
	return BudgetSnapshot{}, errors.New("database unavailable")
}

func TestDoRequestMapsBudgetStoreFailureToServiceUnavailable(t *testing.T) {
	var requests atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	c := newTestClient(server)
	c.SetRequestBudget(unavailableRequestBudget{})

	_, status, err := c.doRequest(context.Background(), http.MethodGet, "/api/1/vehicles", nil)
	if !errors.Is(err, ErrBudgetUnavailable) {
		t.Fatalf("doRequest error = %v, want ErrBudgetUnavailable", err)
	}
	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", status, http.StatusServiceUnavailable)
	}
	if got := requests.Load(); got != 0 {
		t.Fatalf("network requests = %d, want 0", got)
	}
}

func TestSendCommandUnknownReturnsError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	c := newTestClient(server)
	err := c.SendCommand(context.Background(), "TESTVIN1", "nonexistent", nil)
	if err == nil {
		t.Fatal("expected error for unknown command")
	}
}

func TestSendCommandKnownSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"response":{"result":true}}`))
	}))
	defer server.Close()

	c := newTestClient(server)
	commands := []string{"lock", "unlock", "climate_on", "climate_off", "honk", "flash"}
	for _, cmd := range commands {
		err := c.SendCommand(context.Background(), "TESTVIN1", cmd, nil)
		if err != nil {
			t.Errorf("SendCommand(%q) error = %v", cmd, err)
		}
	}
}

func TestWakeUpSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"response":{"state":"online"}}`))
	}))
	defer server.Close()

	c := newTestClient(server)
	if err := c.WakeUp(context.Background(), "TESTVIN1"); err != nil {
		t.Errorf("WakeUp() error = %v", err)
	}
}

func TestGetAuthURLContainsParams(t *testing.T) {
	cfg := config.TeslaConfig{
		BaseURL:     "http://localhost",
		AuthURL:     "https://auth.tesla.com",
		ClientID:    "my-id",
		RedirectURI: "http://localhost/cb",
		Timeout:     5 * time.Second,
	}
	c := NewClient(cfg)
	url := c.GetAuthURL("mystate")

	if !contains(url, "state=mystate") {
		t.Errorf("URL should contain state=mystate: %q", url)
	}
	if !contains(url, "client_id=my-id") {
		t.Errorf("URL should contain client_id: %q", url)
	}
	if !contains(url, "response_type=code") {
		t.Errorf("URL should contain response_type=code: %q", url)
	}
}
