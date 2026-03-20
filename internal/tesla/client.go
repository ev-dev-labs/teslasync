package tesla

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/sony/gobreaker"
	"github.com/teslasync/teslasync/internal/config"
)

// Client is a resilient Tesla Fleet API client with circuit breaker.
type Client struct {
	httpClient *http.Client
	baseURL    string
	authURL    string
	clientID   string
	clientSec  string
	redirectURI string
	cb         *gobreaker.CircuitBreaker

	mu          sync.RWMutex
	accessToken string
	refreshTok  string
	expiresAt   time.Time
}

// NewClient creates a new Tesla API client configured with the given credentials
// and a circuit breaker that opens after 5 consecutive failures, preventing
// cascading calls to an unhealthy Tesla API.
func NewClient(cfg config.TeslaConfig) *Client {
	cbSettings := gobreaker.Settings{
		Name:        "tesla-api",
		MaxRequests: 3,
		Interval:    60 * time.Second,
		Timeout:     30 * time.Second,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures > 5
		},
		OnStateChange: func(name string, from, to gobreaker.State) {
			log.Warn().Str("breaker", name).Str("from", from.String()).Str("to", to.String()).Msg("circuit breaker state change")
		},
	}

	return &Client{
		httpClient: &http.Client{Timeout: cfg.Timeout},
		baseURL:    cfg.BaseURL,
		authURL:    cfg.AuthURL,
		clientID:   cfg.ClientID,
		clientSec:  cfg.ClientSecret,
		redirectURI: cfg.RedirectURI,
		cb:         gobreaker.NewCircuitBreaker(cbSettings),
	}
}

// SetTokens sets the current OAuth tokens.
func (c *Client) SetTokens(access, refresh string, expiresAt time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.accessToken = access
	c.refreshTok = refresh
	c.expiresAt = expiresAt
}

// GetAuthURL returns the Tesla OAuth authorization URL.
func (c *Client) GetAuthURL(state string) string {
	return fmt.Sprintf(
		"%s/oauth2/v3/authorize?client_id=%s&redirect_uri=%s&response_type=code&scope=%s&state=%s",
		c.authURL, c.clientID, c.redirectURI,
		"openid+offline_access+vehicle_device_data+vehicle_cmds+vehicle_charging_cmds",
		state,
	)
}

// HasValidToken returns whether a valid token is available.
func (c *Client) HasValidToken() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.accessToken != "" && time.Now().Before(c.expiresAt)
}

// ExpiresWithin returns true if the token will expire within the given duration.
func (c *Client) ExpiresWithin(d time.Duration) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.accessToken != "" && time.Until(c.expiresAt) < d
}

// ErrUnauthorized is returned when the Tesla API rejects the current token.
var ErrUnauthorized = fmt.Errorf("unauthorized (401): token expired or invalid")

// doRequest performs an authenticated API request through the circuit breaker.
func (c *Client) doRequest(ctx context.Context, method, path string, body io.Reader) ([]byte, int, error) {
	result, err := c.cb.Execute(func() (interface{}, error) {
		url := c.baseURL + path
		req, err := http.NewRequestWithContext(ctx, method, url, body)
		if err != nil {
			return nil, fmt.Errorf("create request: %w", err)
		}

		c.mu.RLock()
		token := c.accessToken
		c.mu.RUnlock()

		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("do request: %w", err)
		}
		defer resp.Body.Close()

		data, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("read body: %w", err)
		}

		if resp.StatusCode == http.StatusUnauthorized {
			return nil, ErrUnauthorized
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			return nil, fmt.Errorf("rate limited (429)")
		}
		if resp.StatusCode >= 500 {
			return nil, fmt.Errorf("server error: %d", resp.StatusCode)
		}

		return &apiResponse{StatusCode: resp.StatusCode, Body: data}, nil
	})

	if err != nil {
		return nil, 0, err
	}

	resp := result.(*apiResponse)
	return resp.Body, resp.StatusCode, nil
}

type apiResponse struct {
	StatusCode int
	Body       []byte
}

// ListVehicles returns all vehicles associated with the authenticated Tesla account.
func (c *Client) ListVehicles(ctx context.Context) ([]VehicleData, error) {
	data, status, err := c.doRequest(ctx, http.MethodGet, "/api/1/vehicles", nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("list vehicles: status %d", status)
	}

	var resp struct {
		Response []VehicleData `json:"response"`
		Count    int           `json:"count"`
	}
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("decode vehicles: %w", err)
	}
	return resp.Response, nil
}

// GetVehicleData returns the full snapshot of a vehicle's charge, climate,
// drive, and config state. Returns ErrVehicleAsleep if the vehicle cannot
// be reached (408/504).
func (c *Client) GetVehicleData(ctx context.Context, vehicleID int64) (*VehicleDataResponse, error) {
	path := fmt.Sprintf("/api/1/vehicles/%d/vehicle_data?endpoints=%s", vehicleID,
		"charge_state;climate_state;drive_state;location_data;vehicle_state;vehicle_config")
	data, status, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	if status == http.StatusRequestTimeout || status == http.StatusGatewayTimeout {
		return nil, ErrVehicleAsleep
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("get vehicle data: status %d", status)
	}

	var resp struct {
		Response VehicleDataResponse `json:"response"`
	}
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("decode vehicle data: %w", err)
	}
	return &resp.Response, nil
}

// WakeUp wakes a vehicle.
func (c *Client) WakeUp(ctx context.Context, vehicleID int64) error {
	path := fmt.Sprintf("/api/1/vehicles/%d/wake_up", vehicleID)
	_, status, err := c.doRequest(ctx, http.MethodPost, path, nil)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("wake up: status %d", status)
	}
	return nil
}

// commandMap maps frontend command names to Tesla API endpoints.
var commandMap = map[string]string{
	"wake":            "wake_up",
	"lock":            "door_lock",
	"unlock":          "door_unlock",
	"climate_on":      "auto_conditioning_start",
	"climate_off":     "auto_conditioning_stop",
	"sentry_on":       "set_sentry_mode",
	"sentry_off":      "set_sentry_mode",
	"charge_port_open": "charge_port_door_open",
	"charge_start":    "charge_start",
	"charge_stop":     "charge_stop",
	"frunk":           "actuate_trunk",
	"trunk":           "actuate_trunk",
	"honk":            "honk_horn",
	"flash":           "flash_lights",
	"speed_limit":     "speed_limit_activate",
}

// SendCommand sends a named command (e.g. "lock", "climate_on") to a vehicle,
// translating it to the corresponding Tesla API endpoint. Returns an error if
// the command is unknown or the API call fails.
func (c *Client) SendCommand(ctx context.Context, vehicleID int64, command string, params map[string]string) error {
	endpoint, ok := commandMap[command]
	if !ok {
		return fmt.Errorf("unknown command: %s", command)
	}

	// Build request body from params
	var bodyReader io.Reader
	if len(params) > 0 {
		bodyBytes, err := json.Marshal(params)
		if err != nil {
			return fmt.Errorf("marshal params: %w", err)
		}
		bodyReader = bytes.NewReader(bodyBytes)
	}

	path := fmt.Sprintf("/api/1/vehicles/%d/command/%s", vehicleID, endpoint)
	_, status, err := c.doRequest(ctx, http.MethodPost, path, bodyReader)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("command %s: status %d", command, status)
	}
	return nil
}
