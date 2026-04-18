package tesla

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/sony/gobreaker"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"golang.org/x/time/rate"
)

// Client is a resilient Tesla Fleet API client with circuit breaker and rate limiter.
type Client struct {
	httpClient      *http.Client
	proxyClient     *http.Client
	baseURL         string
	commandProxyURL string
	authURL         string
	clientID        string
	clientSec       string
	redirectURI     string
	cb              *gobreaker.CircuitBreaker
	limiter         *rate.Limiter

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
		MaxRequests: 5,
		Interval:    120 * time.Second,
		Timeout:     60 * time.Second,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures > 10
		},
		OnStateChange: func(name string, from, to gobreaker.State) {
			log.Warn().Str("breaker", name).Str("from", from.String()).Str("to", to.String()).Msg("circuit breaker state change")
		},
	}

	// Rate limiter: ~10 requests/second with burst of 5.
	// Tesla allows 200 req/10min for vehicle_data endpoints but some
	// endpoints have lower limits. This keeps us well within budget.
	limiter := rate.NewLimiter(rate.Every(100*time.Millisecond), 5)

	// HTTP client for the Vehicle Command Proxy (self-signed TLS in Docker)
	proxyTransport := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	proxyClient := &http.Client{
		Timeout:   cfg.Timeout,
		Transport: proxyTransport,
	}

	c := &Client{
		httpClient:      &http.Client{Timeout: cfg.Timeout},
		proxyClient:     proxyClient,
		baseURL:         cfg.BaseURL,
		commandProxyURL: cfg.CommandProxyURL,
		authURL:         cfg.AuthURL,
		clientID:        cfg.ClientID,
		clientSec:       cfg.ClientSecret,
		redirectURI:     cfg.RedirectURI,
		cb:              gobreaker.NewCircuitBreaker(cbSettings),
		limiter:         limiter,
	}

	if c.commandProxyURL != "" {
		log.Info().Str("proxy_url", c.commandProxyURL).Msg("vehicle command proxy configured — signed commands enabled")
	} else {
		log.Warn().Msg("no TESLA_COMMAND_PROXY_URL set — vehicle commands will be sent unsigned (may fail on 2021+ vehicles)")
	}

	return c
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
		"%s/oauth2/v3/authorize?client_id=%s&redirect_uri=%s&response_type=code&scope=%s&state=%s&prompt=consent",
		c.authURL, c.clientID, c.redirectURI,
		"openid+offline_access+vehicle_device_data+vehicle_location+vehicle_cmds+vehicle_charging_cmds",
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
// This endpoint must be called through the Vehicle Command HTTP Proxy for signing.
// POST /api/1/vehicles/fleet_telemetry_config
func (c *Client) SubscribeFleetTelemetry(ctx context.Context, config FleetTelemetrySubscription) ([]byte, int, error) {
	body, err := json.Marshal(config)
	if err != nil {
		return nil, 0, fmt.Errorf("marshal fleet telemetry config: %w", err)
	}
	path := "/api/1/vehicles/fleet_telemetry_config"
	if c.commandProxyURL != "" {
		return c.doProxyRequestWithResponse(ctx, http.MethodPost, path, bytes.NewReader(body))
	}
	return c.doRequest(ctx, http.MethodPost, path, bytes.NewReader(body))
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

// GetNearbyChargingSites returns charging sites near the vehicle's current location.
// GET /api/1/vehicles/{vin}/nearby_charging_sites
func (c *Client) GetNearbyChargingSites(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/nearby_charging_sites", vin)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetReleaseNotes returns firmware release notes for a vehicle.
// GET /api/1/vehicles/{vin}/release_notes
func (c *Client) GetReleaseNotes(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/release_notes", vin)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetRecentAlerts returns recent vehicle alerts (recalls, service reminders).
// GET /api/1/vehicles/{vin}/recent_alerts
func (c *Client) GetRecentAlerts(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/recent_alerts", vin)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetServiceData returns service history and status for a vehicle.
// GET /api/1/vehicles/{vin}/service_data
func (c *Client) GetServiceData(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/service_data", vin)
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
	CA         *string                         `json:"ca,omitempty"`
	Fields     map[string]FleetTelemetryField  `json:"fields"`
	AlertTypes []string                        `json:"alert_types,omitempty"`
	Port       int                             `json:"port"`
	Exp        int64                           `json:"exp,omitempty"`
}

// FleetTelemetryField describes a single telemetry field subscription.
type FleetTelemetryField struct {
	IntervalSeconds int      `json:"interval_seconds"`
	MinimumDelta    *float64 `json:"minimum_delta,omitempty"`
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
		"scope":         {"openid vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds"},
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
func (c *Client) PairKey(ctx context.Context, vin string, publicKeyPEM string) ([]byte, int, error) {
	body := fmt.Sprintf(`{"public_key":"%s"}`, publicKeyPEM)
	path := fmt.Sprintf("/api/1/vehicles/%s/paired_keys", vin)
	return c.doRequest(ctx, http.MethodPost, path, bytes.NewReader([]byte(body)))
}

// ErrRateLimited is returned when Tesla API returns 429 Too Many Requests.
var ErrRateLimited = fmt.Errorf("rate limited (429): too many requests")

// doRequest performs an authenticated API request through the circuit breaker.
func (c *Client) doRequest(ctx context.Context, method, path string, body io.Reader) ([]byte, int, error) {
	// Rate limit all Tesla API calls
	if err := c.limiter.Wait(ctx); err != nil {
		return nil, 0, fmt.Errorf("rate limiter: %w", err)
	}

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
	if err := c.limiter.Wait(ctx); err != nil {
		return nil, 0, fmt.Errorf("rate limiter: %w", err)
	}

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
// be reached (408/504). The optional endpoints parameter specifies which
// vehicle_data sub-endpoints to request; if empty, all endpoints are requested.
func (c *Client) GetVehicleData(ctx context.Context, vin string, endpoints ...string) (*VehicleDataResponse, error) {
	epStr := "charge_state;climate_state;drive_state;location_data;vehicle_state;vehicle_config"
	if len(endpoints) > 0 {
		epStr = strings.Join(endpoints, ";")
	}
	path := fmt.Sprintf("/api/1/vehicles/%s/vehicle_data?endpoints=%s", vin, epStr)
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
func (c *Client) WakeUp(ctx context.Context, vin string) error {
	path := fmt.Sprintf("/api/1/vehicles/%s/wake_up", vin)
	_, status, err := c.doRequest(ctx, http.MethodPost, path, nil)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("wake up: status %d", status)
	}
	return nil
}

// commandDef defines how a frontend command name maps to the Tesla API.
type commandDef struct {
	endpoint string                 // Tesla API endpoint name
	params   map[string]interface{} // default params to merge with user-provided params
	noProxy  bool                   // true = send directly to Fleet API (e.g. wake_up)
}

// commands maps frontend command names to Tesla Fleet API endpoints with default params.
// Reference: https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands
var commands = map[string]commandDef{
	// Wake — does NOT require signing, goes direct to Fleet API
	"wake":    {endpoint: "wake_up", noProxy: true},
	"wake_up": {endpoint: "wake_up", noProxy: true},

	// Security & Access
	"lock":             {endpoint: "door_lock"},
	"unlock":           {endpoint: "door_unlock"},
	"set_sentry_mode":  {endpoint: "set_sentry_mode", params: map[string]interface{}{"on": true}},
	"sentry_on":        {endpoint: "set_sentry_mode", params: map[string]interface{}{"on": true}},
	"sentry_off":       {endpoint: "set_sentry_mode", params: map[string]interface{}{"on": false}},
	"speed_limit_on":   {endpoint: "speed_limit_activate"},
	"speed_limit_off":  {endpoint: "speed_limit_deactivate"},
	"guest_mode_on":    {endpoint: "guest_mode", params: map[string]interface{}{"enable": true}},
	"guest_mode_off":   {endpoint: "guest_mode", params: map[string]interface{}{"enable": false}},
	"erase_user_data":  {endpoint: "erase_user_data"},

	// PIN to Drive
	"set_pin_to_drive":         {endpoint: "set_pin_to_drive"},
	"reset_pin_to_drive_pin":   {endpoint: "reset_pin_to_drive_pin"},
	"clear_pin_to_drive_admin": {endpoint: "clear_pin_to_drive_admin"},

	// Climate
	"climate_on":  {endpoint: "auto_conditioning_start"},
	"climate_off": {endpoint: "auto_conditioning_stop"},
	"set_temps":   {endpoint: "set_temps"},

	// Climate Protection
	"bioweapon_on":          {endpoint: "set_bioweapon_mode", params: map[string]interface{}{"on": true, "manual_override": true}},
	"bioweapon_off":         {endpoint: "set_bioweapon_mode", params: map[string]interface{}{"on": false, "manual_override": false}},
	"cop_on":                {endpoint: "set_cabin_overheat_protection", params: map[string]interface{}{"on": true, "fan_only": false}},
	"cop_fan_only":          {endpoint: "set_cabin_overheat_protection", params: map[string]interface{}{"on": true, "fan_only": true}},
	"cop_off":               {endpoint: "set_cabin_overheat_protection", params: map[string]interface{}{"on": false, "fan_only": false}},
	"set_cop_temp":          {endpoint: "set_cop_temp"},
	"climate_keeper_off":    {endpoint: "set_climate_keeper_mode", params: map[string]interface{}{"climate_keeper_mode": 0}},
	"climate_keeper_on":     {endpoint: "set_climate_keeper_mode", params: map[string]interface{}{"climate_keeper_mode": 1}},
	"dog_mode":              {endpoint: "set_climate_keeper_mode", params: map[string]interface{}{"climate_keeper_mode": 2}},
	"camp_mode":             {endpoint: "set_climate_keeper_mode", params: map[string]interface{}{"climate_keeper_mode": 3}},
	"preconditioning_max":   {endpoint: "set_preconditioning_max", params: map[string]interface{}{"on": true}},
	"preconditioning_reset": {endpoint: "set_preconditioning_max", params: map[string]interface{}{"on": false}},

	// Charging
	"open_charge_port":  {endpoint: "charge_port_door_open"},
	"close_charge_port": {endpoint: "charge_port_door_close"},
	"charge_port_open":  {endpoint: "charge_port_door_open"},
	"charge_port_close": {endpoint: "charge_port_door_close"},
	"charge_start":      {endpoint: "charge_start"},
	"charge_stop":       {endpoint: "charge_stop"},
	"set_charge_limit":  {endpoint: "set_charge_limit"},
	"set_charging_amps": {endpoint: "set_charging_amps"},
	"charge_max_range":  {endpoint: "charge_max_range"},
	"charge_standard":   {endpoint: "charge_standard"},

	// Doors & Trunk
	"actuate_frunk": {endpoint: "actuate_trunk", params: map[string]interface{}{"which_trunk": "front"}},
	"actuate_trunk": {endpoint: "actuate_trunk", params: map[string]interface{}{"which_trunk": "rear"}},
	"frunk":         {endpoint: "actuate_trunk", params: map[string]interface{}{"which_trunk": "front"}},
	"frunk_open":    {endpoint: "actuate_trunk", params: map[string]interface{}{"which_trunk": "front"}},
	"trunk_open":    {endpoint: "actuate_trunk", params: map[string]interface{}{"which_trunk": "rear"}},

	// Alerts
	"honk_horn":    {endpoint: "honk_horn"},
	"honk":         {endpoint: "honk_horn"},
	"flash_lights": {endpoint: "flash_lights"},
	"flash":        {endpoint: "flash_lights"},

	// Boombox
	"boombox_fart":   {endpoint: "remote_boombox", params: map[string]interface{}{"sound": 0}},
	"boombox_ping":   {endpoint: "remote_boombox", params: map[string]interface{}{"sound": 2000}},
	"remote_boombox": {endpoint: "remote_boombox"},

	// Windows
	"vent_windows":  {endpoint: "window_control", params: map[string]interface{}{"command": "vent"}},
	"close_windows": {endpoint: "window_control", params: map[string]interface{}{"command": "close"}},

	// HomeLink
	"trigger_homelink": {endpoint: "trigger_homelink"},

	// Drive
	"remote_start_drive": {endpoint: "remote_start_drive"},

	// Media
	"media_toggle_playback": {endpoint: "media_toggle_playback"},
	"media_next_track":      {endpoint: "media_next_track"},
	"media_prev_track":      {endpoint: "media_prev_track"},
	"media_next_fav":        {endpoint: "media_next_fav"},
	"media_prev_fav":        {endpoint: "media_prev_fav"},
	"media_volume_down":     {endpoint: "media_volume_down"},
	"adjust_volume":         {endpoint: "adjust_volume"},

	// Scheduling (legacy)
	"set_scheduled_departure": {endpoint: "set_scheduled_departure"},
	"set_scheduled_charging":  {endpoint: "set_scheduled_charging"},

	// Schedules (firmware 2024.26+)
	"add_charge_schedule":          {endpoint: "add_charge_schedule"},
	"remove_charge_schedule":       {endpoint: "remove_charge_schedule"},
	"add_precondition_schedule":    {endpoint: "add_precondition_schedule"},
	"remove_precondition_schedule": {endpoint: "remove_precondition_schedule"},

	// Navigation
	"navigation_request":     {endpoint: "navigation_request"},
	"navigation_gps_request": {endpoint: "navigation_gps_request"},
	"navigation_sc_request":  {endpoint: "navigation_sc_request"},
}

// SendCommand sends a named command to a vehicle via the Fleet API or the
// Vehicle Command Proxy (if configured). Commands that require signing are
// routed through the proxy; wake_up goes directly to Fleet API.
func (c *Client) SendCommand(ctx context.Context, vin string, command string, params map[string]interface{}) error {
	def, ok := commands[command]
	if !ok {
		return fmt.Errorf("unknown command: %s", command)
	}

	// Merge default params with user-provided params
	merged := make(map[string]interface{})
	for k, v := range def.params {
		merged[k] = v
	}
	for k, v := range params {
		merged[k] = v
	}

	var bodyReader io.Reader
	if len(merged) > 0 {
		bodyBytes, err := json.Marshal(merged)
		if err != nil {
			return fmt.Errorf("marshal params: %w", err)
		}
		bodyReader = bytes.NewReader(bodyBytes)
	}

	path := fmt.Sprintf("/api/1/vehicles/%s/command/%s", vin, def.endpoint)

	// Route through Vehicle Command Proxy for signed commands
	if !def.noProxy && c.commandProxyURL != "" {
		return c.doProxyRequest(ctx, path, bodyReader)
	}

	_, status, err := c.doRequest(ctx, http.MethodPost, path, bodyReader)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("command %s: status %d", command, status)
	}
	return nil
}

// doProxyRequest sends a command through the Vehicle Command Proxy for signing.
func (c *Client) doProxyRequest(ctx context.Context, path string, body io.Reader) error {
	if err := c.limiter.Wait(ctx); err != nil {
		return fmt.Errorf("rate limiter: %w", err)
	}

	reqURL := c.commandProxyURL + path

	var reqBodyBytes []byte
	if body != nil {
		reqBodyBytes, _ = io.ReadAll(body)
		body = bytes.NewReader(reqBodyBytes)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, body)
	if err != nil {
		return fmt.Errorf("create proxy request: %w", err)
	}

	c.mu.RLock()
	token := c.accessToken
	c.mu.RUnlock()

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	start := time.Now()
	resp, err := c.proxyClient.Do(req)
	duration := time.Since(start).Milliseconds()

	if err != nil {
		log.Error().Err(err).Str("url", reqURL).Msg("proxy request failed")
		return fmt.Errorf("proxy request: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	log.Debug().
		Str("url", reqURL).
		Int("status", resp.StatusCode).
		Int64("duration_ms", duration).
		Msg("proxy command sent")

	if c.logCallback != nil {
		c.logCallback(http.MethodPost, reqURL, resp.StatusCode, reqBodyBytes, respBody, int(duration), nil)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("proxy command failed: HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	// Check Tesla response for result
	var result struct {
		Response struct {
			Result bool   `json:"result"`
			Reason string `json:"reason"`
		} `json:"response"`
	}
	if err := json.Unmarshal(respBody, &result); err == nil && !result.Response.Result && result.Response.Reason != "" {
		return fmt.Errorf("command rejected: %s", result.Response.Reason)
	}

	return nil
}

// doProxyRequestWithResponse sends a request through the Vehicle Command Proxy
// and returns the raw response body and status code (for endpoints like fleet_telemetry_config).
func (c *Client) doProxyRequestWithResponse(ctx context.Context, method, path string, body io.Reader) ([]byte, int, error) {
	if err := c.limiter.Wait(ctx); err != nil {
		return nil, 0, fmt.Errorf("rate limiter: %w", err)
	}

	reqURL := c.commandProxyURL + path

	var reqBodyBytes []byte
	if body != nil {
		reqBodyBytes, _ = io.ReadAll(body)
		body = bytes.NewReader(reqBodyBytes)
	}

	req, err := http.NewRequestWithContext(ctx, method, reqURL, body)
	if err != nil {
		return nil, 0, fmt.Errorf("create proxy request: %w", err)
	}

	c.mu.RLock()
	token := c.accessToken
	c.mu.RUnlock()

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	start := time.Now()
	resp, err := c.proxyClient.Do(req)
	duration := time.Since(start).Milliseconds()

	if err != nil {
		log.Error().Err(err).Str("url", reqURL).Msg("proxy request failed")
		return nil, 0, fmt.Errorf("proxy request: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	log.Debug().
		Str("url", reqURL).
		Int("status", resp.StatusCode).
		Int64("duration_ms", duration).
		Msg("proxy request sent")

	if c.logCallback != nil {
		c.logCallback(method, reqURL, resp.StatusCode, reqBodyBytes, respBody, int(duration), nil)
	}

	return respBody, resp.StatusCode, nil
}
