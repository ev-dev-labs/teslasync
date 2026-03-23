package tesla

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/sony/gobreaker"
	"github.com/ev-dev-labs/teslasync/internal/config"
)

// Client is a resilient Tesla Fleet API client with circuit breaker.
type Client struct {
	httpClient  *http.Client
	baseURL     string
	authURL     string
	clientID    string
	clientSec   string
	redirectURI string
	cb          *gobreaker.CircuitBreaker

	mu          sync.RWMutex
	accessToken string
	refreshTok  string
	expiresAt   time.Time

	// logCallback is called after each API request for audit logging.
	logCallback func(method, url string, statusCode int, reqBody, respBody []byte, durationMs int, err error)
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

// SetLogCallback sets the callback function for logging API calls.
func (c *Client) SetLogCallback(cb func(method, url string, statusCode int, reqBody, respBody []byte, durationMs int, err error)) {
	c.logCallback = cb
}

// CircuitBreakerState returns the current state of the Tesla API circuit breaker.
func (c *Client) CircuitBreakerState() string {
	return c.cb.State().String()
}

// CircuitBreakerCounts returns the current circuit breaker request counts.
func (c *Client) CircuitBreakerCounts() map[string]interface{} {
	counts := c.cb.Counts()
	return map[string]interface{}{
		"requests":              counts.Requests,
		"total_successes":       counts.TotalSuccesses,
		"total_failures":        counts.TotalFailures,
		"consecutive_successes": counts.ConsecutiveSuccesses,
		"consecutive_failures":  counts.ConsecutiveFailures,
	}
}

// ErrUnauthorized is returned when the Tesla API rejects the current token.
var ErrUnauthorized = fmt.Errorf("unauthorized (401): token expired or invalid")

// BaseURL returns the configured Fleet API base URL.
func (c *Client) BaseURL() string { return c.baseURL }

// ClientID returns the configured OAuth client ID.
func (c *Client) ClientID() string { return c.clientID }

// ClientSecret returns the configured OAuth client secret.
func (c *Client) ClientSecret() string { return c.clientSec }

// GetUserRegion calls GET /api/1/users/region to detect the account's Fleet API region.
func (c *Client) GetUserRegion(ctx context.Context) ([]byte, int, error) {
	return c.doRequest(ctx, http.MethodGet, "/api/1/users/region", nil)
}

// RegisterPartner calls POST /api/1/partner_accounts to register this app in the current region.
// It requires the partner token (client_credentials), not the user's OAuth token.
func (c *Client) RegisterPartner(ctx context.Context, partnerToken, domain string) ([]byte, int, error) {
	body := fmt.Sprintf(`{"domain":"%s"}`, domain)
	return c.doRequestWithToken(ctx, http.MethodPost, "/api/1/partner_accounts", bytes.NewReader([]byte(body)), partnerToken)
}

// SubscribeFleetTelemetry configures vehicles to connect to a self-hosted fleet-telemetry server.
// POST /api/1/vehicles/fleet_telemetry_config
func (c *Client) SubscribeFleetTelemetry(ctx context.Context, config FleetTelemetrySubscription) ([]byte, int, error) {
	body, err := json.Marshal(config)
	if err != nil {
		return nil, 0, fmt.Errorf("marshal fleet telemetry config: %w", err)
	}
	return c.doRequest(ctx, http.MethodPost, "/api/1/vehicles/fleet_telemetry_config", bytes.NewReader(body))
}

// GetFleetTelemetryConfig fetches a vehicle's fleet telemetry configuration.
// GET /api/1/vehicles/{vin}/fleet_telemetry_config
func (c *Client) GetFleetTelemetryConfig(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/fleet_telemetry_config", vin)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// DeleteFleetTelemetryConfig removes fleet telemetry configuration from a vehicle.
// DELETE /api/1/vehicles/{vin}/fleet_telemetry_config
func (c *Client) DeleteFleetTelemetryConfig(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/fleet_telemetry_config", vin)
	return c.doRequest(ctx, http.MethodDelete, path, nil)
}

// GetFleetTelemetryErrors returns recent fleet telemetry errors for a vehicle.
// GET /api/1/vehicles/{vin}/fleet_telemetry_errors
func (c *Client) GetFleetTelemetryErrors(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/fleet_telemetry_errors", vin)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetFleetStatus provides vehicle state information (firmware, telemetry version, etc.).
// POST /api/1/vehicles/fleet_status
func (c *Client) GetFleetStatus(ctx context.Context, vins []string) ([]byte, int, error) {
	body, _ := json.Marshal(map[string]interface{}{"vins": vins})
	return c.doRequest(ctx, http.MethodPost, "/api/1/vehicles/fleet_status", bytes.NewReader(body))
}

// FleetTelemetrySubscription is the configuration payload for fleet telemetry.
type FleetTelemetrySubscription struct {
	VINs   []string                       `json:"vins"`
	Config FleetTelemetryConfigPayload    `json:"config"`
}

// FleetTelemetryConfigPayload describes the streaming server and fields to subscribe.
type FleetTelemetryConfigPayload struct {
	Hostname   string                          `json:"hostname"`
	CA         string                          `json:"ca,omitempty"`
	Fields     map[string]FleetTelemetryField  `json:"fields"`
	AlertTypes []string                        `json:"alert_types,omitempty"`
	Port       int                             `json:"port"`
	Exp        int64                           `json:"exp,omitempty"`
}

// FleetTelemetryField describes a single telemetry field subscription.
type FleetTelemetryField struct {
	IntervalSeconds int `json:"interval_seconds"`
}

// GetPartnerToken obtains a client_credentials token for partner-level API calls.
// Partner tokens use a separate auth endpoint (fleet-auth) from the user OAuth flow.
func (c *Client) GetPartnerToken(ctx context.Context) (string, error) {
	// Partner token endpoint is fleet-auth, not auth.tesla.com.
	// Derive from base URL: https://fleet-api.prd.na.vn.cloud.tesla.com
	//                     → https://fleet-auth.prd.vn.cloud.tesla.com
	partnerAuthURL := c.partnerAuthURL()

	formData := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {c.clientID},
		"client_secret": {c.clientSec},
		"scope":         {"openid vehicle_device_data vehicle_cmds vehicle_charging_cmds"},
		"audience":      {c.baseURL},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, partnerAuthURL+"/oauth2/v3/token", bytes.NewReader([]byte(formData.Encode())))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	log.Debug().
		Str("url", partnerAuthURL+"/oauth2/v3/token").
		Str("client_id", c.clientID).
		Str("audience", c.baseURL).
		Msg("requesting partner token")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("partner token request: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("partner token failed (%d): %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("decode partner token: %w", err)
	}
	return result.AccessToken, nil
}

// partnerAuthURL derives the fleet-auth URL from the configured base URL.
// e.g. https://fleet-api.prd.na.vn.cloud.tesla.com → https://fleet-auth.prd.vn.cloud.tesla.com
// Falls back to https://fleet-auth.prd.vn.cloud.tesla.com if parsing fails.
func (c *Client) partnerAuthURL() string {
	// Known mappings
	regionMap := map[string]string{
		"https://fleet-api.prd.na.vn.cloud.tesla.com": "https://fleet-auth.prd.vn.cloud.tesla.com",
		"https://fleet-api.prd.eu.vn.cloud.tesla.com": "https://fleet-auth.prd.vn.cloud.tesla.com",
		"https://fleet-api.prd.cn.vn.cloud.tesla.com": "https://fleet-auth.prd.vn.cloud.tesla.com",
	}
	if authURL, ok := regionMap[c.baseURL]; ok {
		return authURL
	}
	// Default fallback
	return "https://fleet-auth.prd.vn.cloud.tesla.com"
}

// PairKey pairs the public key with a vehicle for command signing.
func (c *Client) PairKey(ctx context.Context, vehicleID int64, publicKeyPEM string) ([]byte, int, error) {
	body := fmt.Sprintf(`{"public_key":"%s"}`, publicKeyPEM)
	path := fmt.Sprintf("/api/1/vehicles/%d/paired_keys", vehicleID)
	return c.doRequest(ctx, http.MethodPost, path, bytes.NewReader([]byte(body)))
}

// ErrRateLimited is returned when Tesla API returns 429 Too Many Requests.
var ErrRateLimited = fmt.Errorf("rate limited (429): too many requests")

// doRequest performs an authenticated API request through the circuit breaker.
func (c *Client) doRequest(ctx context.Context, method, path string, body io.Reader) ([]byte, int, error) {
	url := c.baseURL + path
	start := time.Now()

	// Read request body for logging if present
	var reqBodyBytes []byte
	if body != nil {
		reqBodyBytes, _ = io.ReadAll(body)
		body = bytes.NewReader(reqBodyBytes)
	}

	result, err := c.cb.Execute(func() (interface{}, error) {
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
			return &apiResponse{StatusCode: resp.StatusCode, Body: data}, ErrUnauthorized
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			// 429 is not a server failure — don't trigger circuit breaker.
			// Return success to the breaker, the caller handles the rate limit.
			return &apiResponse{StatusCode: resp.StatusCode, Body: data}, nil
		}
		if resp.StatusCode >= 500 {
			return &apiResponse{StatusCode: resp.StatusCode, Body: data}, fmt.Errorf("server error: %d", resp.StatusCode)
		}

		return &apiResponse{StatusCode: resp.StatusCode, Body: data}, nil
	})

	durationMs := int(time.Since(start).Milliseconds())

	if err != nil {
		// Log failed requests too
		if c.logCallback != nil {
			statusCode := 0
			var respBody []byte
			if result != nil {
				if resp, ok := result.(*apiResponse); ok {
					statusCode = resp.StatusCode
					respBody = resp.Body
				}
			}
			c.logCallback(method, url, statusCode, reqBodyBytes, respBody, durationMs, err)
		}
		if result != nil {
			if resp, ok := result.(*apiResponse); ok {
				return resp.Body, resp.StatusCode, err
			}
		}
		return nil, 0, err
	}

	resp := result.(*apiResponse)

	// Log successful requests
	if c.logCallback != nil {
		c.logCallback(method, url, resp.StatusCode, reqBodyBytes, resp.Body, durationMs, nil)
	}

	return resp.Body, resp.StatusCode, nil
}

type apiResponse struct {
	StatusCode int
	Body       []byte
}

// doRequestWithToken performs an API request using a custom bearer token (e.g. partner token)
// instead of the stored user access token. Runs through the circuit breaker and logging.
func (c *Client) doRequestWithToken(ctx context.Context, method, path string, body io.Reader, token string) ([]byte, int, error) {
	url := c.baseURL + path
	start := time.Now()

	var reqBodyBytes []byte
	if body != nil {
		reqBodyBytes, _ = io.ReadAll(body)
		body = bytes.NewReader(reqBodyBytes)
	}

	result, err := c.cb.Execute(func() (interface{}, error) {
		req, err := http.NewRequestWithContext(ctx, method, url, body)
		if err != nil {
			return nil, fmt.Errorf("create request: %w", err)
		}

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
			return &apiResponse{StatusCode: resp.StatusCode, Body: data}, ErrUnauthorized
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			return &apiResponse{StatusCode: resp.StatusCode, Body: data}, nil
		}
		if resp.StatusCode >= 500 {
			return &apiResponse{StatusCode: resp.StatusCode, Body: data}, fmt.Errorf("server error: %d", resp.StatusCode)
		}

		return &apiResponse{StatusCode: resp.StatusCode, Body: data}, nil
	})

	durationMs := int(time.Since(start).Milliseconds())

	if err != nil {
		if c.logCallback != nil {
			statusCode := 0
			var respBody []byte
			if result != nil {
				if resp, ok := result.(*apiResponse); ok {
					statusCode = resp.StatusCode
					respBody = resp.Body
				}
			}
			c.logCallback(method, url, statusCode, reqBodyBytes, respBody, durationMs, err)
		}
		if result != nil {
			if resp, ok := result.(*apiResponse); ok {
				return resp.Body, resp.StatusCode, err
			}
		}
		return nil, 0, err
	}

	resp := result.(*apiResponse)

	if c.logCallback != nil {
		c.logCallback(method, url, resp.StatusCode, reqBodyBytes, resp.Body, durationMs, nil)
	}

	return resp.Body, resp.StatusCode, nil
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
	if status == http.StatusTooManyRequests {
		return nil, ErrRateLimited
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
