package tesla

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// newTestClient creates a Tesla client pointed at the given mock server.
func newTestClient(server *httptest.Server) *Client {
	cfg := config.TeslaConfig{
		BaseURL:      server.URL,
		AuthURL:      server.URL,
		ClientID:     "test-client-id",
		ClientSecret: "test-client-secret",
		RedirectURI:  "http://localhost/callback",
		Timeout:      5 * time.Second,
	}
	c := NewClient(cfg)
	c.SetTokens("test-access-token", "test-refresh-token", time.Now().Add(1*time.Hour))
	return c
}

// ---------------------------------------------------------------------------
// ListVehicles tests
// ---------------------------------------------------------------------------

func TestListVehicles_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/1/vehicles" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		// Verify authorization header
		auth := r.Header.Get("Authorization")
		if auth != "Bearer test-access-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"response": []map[string]interface{}{
				{
					"id":           1,
					"vehicle_id":   12345,
					"vin":          "5YJ3E1EA1PF000001",
					"display_name": "Test Car",
					"state":        "online",
				},
			},
			"count": 1,
		})
	}))
	defer server.Close()

	client := newTestClient(server)
	vehicles, err := client.ListVehicles(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(vehicles) != 1 {
		t.Fatalf("expected 1 vehicle, got %d", len(vehicles))
	}
	if vehicles[0].VIN != "5YJ3E1EA1PF000001" {
		t.Errorf("expected VIN 5YJ3E1EA1PF000001, got %s", vehicles[0].VIN)
	}
	if vehicles[0].DisplayName != "Test Car" {
		t.Errorf("expected display name 'Test Car', got %s", vehicles[0].DisplayName)
	}
	if vehicles[0].State != "online" {
		t.Errorf("expected state 'online', got %s", vehicles[0].State)
	}
}

func TestListVehicles_MultipleVehicles(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"response": []map[string]interface{}{
				{"id": 1, "vehicle_id": 111, "vin": "VIN1", "display_name": "Car 1", "state": "online"},
				{"id": 2, "vehicle_id": 222, "vin": "VIN2", "display_name": "Car 2", "state": "asleep"},
			},
			"count": 2,
		})
	}))
	defer server.Close()

	client := newTestClient(server)
	vehicles, err := client.ListVehicles(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(vehicles) != 2 {
		t.Fatalf("expected 2 vehicles, got %d", len(vehicles))
	}
}

func TestListVehicles_EmptyList(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"response": []interface{}{},
			"count":    0,
		})
	}))
	defer server.Close()

	client := newTestClient(server)
	vehicles, err := client.ListVehicles(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(vehicles) != 0 {
		t.Errorf("expected 0 vehicles, got %d", len(vehicles))
	}
}

// ---------------------------------------------------------------------------
// GetVehicleData tests
// ---------------------------------------------------------------------------

func TestGetVehicleData_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"response": map[string]interface{}{
				"id":           12345,
				"vehicle_id":   12345,
				"vin":          "5YJ3E1EA1PF000001",
				"display_name": "Test Car",
				"state":        "online",
				"charge_state": map[string]interface{}{
					"battery_level": 75,
					"battery_range": 220.5,
				},
				"climate_state": map[string]interface{}{
					"inside_temp":  22.5,
					"outside_temp": 18.0,
				},
				"drive_state": map[string]interface{}{
					"latitude":  37.7749,
					"longitude": -122.4194,
				},
				"vehicle_state": map[string]interface{}{
					"odometer": 15000.5,
					"locked":   true,
				},
				"vehicle_config": map[string]interface{}{
					"car_type": "model3",
				},
			},
		})
	}))
	defer server.Close()

	client := newTestClient(server)
	data, err := client.GetVehicleData(context.Background(), "5YJ3E1EA1PF000001")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if data.VIN != "5YJ3E1EA1PF000001" {
		t.Errorf("expected battery level 75, got %d", data.ChargeState.BatteryLevel)
	}
	if data.VehicleState.Locked != true {
		t.Error("expected vehicle to be locked")
	}
}

func TestGetVehicleData_Unauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error": "unauthorized"}`))
	}))
	defer server.Close()

	client := newTestClient(server)
	_, err := client.GetVehicleData(context.Background(), "5YJ3E1EA1PF000001")
	if !errors.Is(err, ErrUnauthorized){
		t.Errorf("expected ErrUnauthorized, got %v", err)
	}
}

func TestGetVehicleData_RateLimited(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()

	client := newTestClient(server)
	_, err := client.GetVehicleData(context.Background(), "5YJ3E1EA1PF000001")
	if err == nil {
		t.Error("expected error on 429, got nil")
	}
}

func TestGetVehicleData_VehicleAsleep(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusRequestTimeout)
	}))
	defer server.Close()

	client := newTestClient(server)
	_, err := client.GetVehicleData(context.Background(), "5YJ3E1EA1PF000001")
	if !errors.Is(err, ErrVehicleAsleep){
		t.Errorf("expected ErrVehicleAsleep, got %v", err)
	}
}

func TestGetVehicleData_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client := newTestClient(server)
	_, err := client.GetVehicleData(context.Background(), "5YJ3E1EA1PF000001")
	if err == nil {
		t.Error("expected error on 500, got nil")
	}
}

// ---------------------------------------------------------------------------
// WakeUp tests
// ---------------------------------------------------------------------------

func TestWakeUp_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"response":{"state":"online"}}`))
	}))
	defer server.Close()

	client := newTestClient(server)
	err := client.WakeUp(context.Background(), "5YJ3E1EA1PF000001")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestWakeUp_Unauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	client := newTestClient(server)
	err := client.WakeUp(context.Background(), "5YJ3E1EA1PF000001")
	if !errors.Is(err, ErrUnauthorized){
		t.Errorf("expected ErrUnauthorized, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// SendCommand tests
// ---------------------------------------------------------------------------

func TestSendCommand_Lock(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		// The lock command should map to door_lock
		expectedPath := "/api/1/vehicles/5YJ3E1EA1PF000001/command/door_lock"
		if r.URL.Path != expectedPath {
			t.Errorf("expected path %s, got %s", expectedPath, r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"response":{"result":true}}`))
	}))
	defer server.Close()

	client := newTestClient(server)
	err := client.SendCommand(context.Background(), "5YJ3E1EA1PF000001", "lock", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSendCommand_UnknownCommand(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := newTestClient(server)
	err := client.SendCommand(context.Background(), "5YJ3E1EA1PF000001", "self_destruct", nil)
	if err == nil {
		t.Error("expected error for unknown command")
	}
	if err.Error() != "unknown command: self_destruct" {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestSendCommand_WithParams(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		json.NewDecoder(r.Body).Decode(&body)
		if body["which_trunk"] != "front" {
			t.Errorf("expected param which_trunk=front, got %v", body["which_trunk"])
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"response":{"result":true}}`))
	}))
	defer server.Close()

	client := newTestClient(server)
	err := client.SendCommand(context.Background(), "5YJ3E1EA1PF000001", "frunk", map[string]string{"which_trunk": "front"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Token management tests
// ---------------------------------------------------------------------------

func TestHasValidToken(t *testing.T) {
	cfg := config.TeslaConfig{
		BaseURL: "http://localhost",
		AuthURL: "http://localhost",
		Timeout: 5 * time.Second,
	}
	c := NewClient(cfg)

	if c.HasValidToken() {
		t.Error("expected no valid token initially")
	}

	c.SetTokens("token", "refresh", time.Now().Add(1*time.Hour))
	if !c.HasValidToken() {
		t.Error("expected valid token after SetTokens")
	}

	c.SetTokens("token", "refresh", time.Now().Add(-1*time.Hour))
	if c.HasValidToken() {
		t.Error("expected no valid token after expiry")
	}
}

func TestExpiresWithin(t *testing.T) {
	cfg := config.TeslaConfig{
		BaseURL: "http://localhost",
		AuthURL: "http://localhost",
		Timeout: 5 * time.Second,
	}
	c := NewClient(cfg)

	c.SetTokens("token", "refresh", time.Now().Add(5*time.Minute))
	if !c.ExpiresWithin(10 * time.Minute) {
		t.Error("token expiring in 5m should be within 10m window")
	}
	if c.ExpiresWithin(1 * time.Minute) {
		t.Error("token expiring in 5m should not be within 1m window")
	}
}

func TestGetAuthURL(t *testing.T) {
	cfg := config.TeslaConfig{
		BaseURL:      "http://localhost",
		AuthURL:      "https://auth.tesla.com",
		ClientID:     "my-client-id",
		ClientSecret: "my-secret",
		RedirectURI:  "http://localhost/callback",
		Timeout:      5 * time.Second,
	}
	c := NewClient(cfg)

	url := c.GetAuthURL("random-state")
	if url == "" {
		t.Fatal("expected non-empty URL")
	}
	expected := "https://auth.tesla.com/oauth2/v3/authorize"
	if len(url) < len(expected) || url[:len(expected)] != expected {
		t.Errorf("expected URL to start with %s, got %s", expected, url)
	}
	if !contains(url, "client_id=my-client-id") {
		t.Error("expected client_id in URL")
	}
	if !contains(url, "state=random-state") {
		t.Error("expected state in URL")
	}
}

// ---------------------------------------------------------------------------
// ExchangeCode / RefreshTokens (mock OAuth server)
// ---------------------------------------------------------------------------

func TestExchangeCode_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oauth2/v3/token" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(TokenResponse{
			AccessToken:  "new-access-token",
			RefreshToken: "new-refresh-token",
			ExpiresIn:    3600,
			TokenType:    "Bearer",
		})
	}))
	defer server.Close()

	client := newTestClient(server)
	tokenResp, err := client.ExchangeCode(context.Background(), "auth-code-123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if tokenResp.AccessToken != "new-access-token" {
		t.Errorf("expected access token 'new-access-token', got %s", tokenResp.AccessToken)
	}
	if tokenResp.RefreshToken != "new-refresh-token" {
		t.Errorf("expected refresh token 'new-refresh-token', got %s", tokenResp.RefreshToken)
	}
	// Verify tokens were stored on the client
	if !client.HasValidToken() {
		t.Error("expected valid token after exchange")
	}
}

func TestRefreshTokens_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/oauth2/v3/token" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(TokenResponse{
			AccessToken:  "refreshed-access-token",
			RefreshToken: "refreshed-refresh-token",
			ExpiresIn:    7200,
			TokenType:    "Bearer",
		})
	}))
	defer server.Close()

	client := newTestClient(server)
	tokenResp, err := client.RefreshTokens(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if tokenResp.AccessToken != "refreshed-access-token" {
		t.Errorf("expected 'refreshed-access-token', got %s", tokenResp.AccessToken)
	}
}

func TestRefreshTokens_NoRefreshToken(t *testing.T) {
	cfg := config.TeslaConfig{
		BaseURL: "http://localhost",
		AuthURL: "http://localhost",
		Timeout: 5 * time.Second,
	}
	c := NewClient(cfg)
	// No tokens set — refresh token is empty
	_, err := c.RefreshTokens(context.Background())
	if err == nil {
		t.Error("expected error when no refresh token is available")
	}
}

func TestExchangeCode_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client := newTestClient(server)
	_, err := client.ExchangeCode(context.Background(), "code")
	if err == nil {
		t.Error("expected error on 500 response")
	}
}

// contains checks if s contains substr (simple helper to avoid importing strings).
func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
