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
	"strconv"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/rs/zerolog/log"
	"github.com/sony/gobreaker"
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

// BaseURL returns the configured Fleet API base URL.
func (c *Client) BaseURL() string { return c.baseURL }

// GetUserRegion calls GET /api/1/users/region to detect the account's Fleet API region.
func (c *Client) GetUserRegion(ctx context.Context) ([]byte, int, error) {
	return c.doRequest(ctx, http.MethodGet, "/api/1/users/region", nil)
}

// GetUserFeatureConfig calls GET /api/1/users/feature_config to fetch account feature flags.
func (c *Client) GetUserFeatureConfig(ctx context.Context) ([]byte, int, error) {
	return c.doRequest(ctx, http.MethodGet, "/api/1/users/feature_config", nil)
}

// GetUserOrders calls GET /api/1/users/orders to fetch active Tesla orders.
func (c *Client) GetUserOrders(ctx context.Context) ([]byte, int, error) {
	return c.doRequest(ctx, http.MethodGet, "/api/1/users/orders", nil)
}

// GetUserProfile calls GET /api/1/users/me to fetch the Tesla account owner's profile.
func (c *Client) GetUserProfile(ctx context.Context) ([]byte, int, error) {
	return c.doRequest(ctx, http.MethodGet, "/api/1/users/me", nil)
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

// GetFleetTelemetryErrorVINs calls GET /api/1/partner_accounts/fleet_telemetry_error_vins
// using a partner token. Returns VINs with telemetry errors across the entire fleet.
func (c *Client) GetFleetTelemetryErrorVINs(ctx context.Context) ([]byte, int, error) {
	partnerToken, err := c.GetPartnerToken(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("get partner token: %w", err)
	}
	return c.doRequestWithToken(ctx, http.MethodGet, "/api/1/partner_accounts/fleet_telemetry_error_vins", nil, partnerToken)
}

// GetPartnerFleetTelemetryErrors calls GET /api/1/partner_accounts/fleet_telemetry_errors
// using a partner token. Returns detailed error logs across the entire fleet.
func (c *Client) GetPartnerFleetTelemetryErrors(ctx context.Context) ([]byte, int, error) {
	partnerToken, err := c.GetPartnerToken(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("get partner token: %w", err)
	}
	return c.doRequestWithToken(ctx, http.MethodGet, "/api/1/partner_accounts/fleet_telemetry_errors", nil, partnerToken)
}

// GetPartnerPublicKey calls GET /api/1/partner_accounts/public_key?domain={domain}
// using a partner token to verify the registered public key for the given domain.
func (c *Client) GetPartnerPublicKey(ctx context.Context, domain string) ([]byte, int, error) {
	partnerToken, err := c.GetPartnerToken(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("get partner token: %w", err)
	}
	path := "/api/1/partner_accounts/public_key?domain=" + url.QueryEscape(domain)
	return c.doRequestWithToken(ctx, http.MethodGet, path, nil, partnerToken)
}

// GetVehicleDrivers calls GET /api/1/vehicles/{vin}/drivers to list allowed drivers.
func (c *Client) GetVehicleDrivers(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/drivers", vin)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// RemoveVehicleDriver calls DELETE /api/1/vehicles/{vin}/drivers to revoke a driver's access.
func (c *Client) RemoveVehicleDriver(ctx context.Context, vin string, shareUserID int64) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/drivers", vin)
	body := fmt.Sprintf(`{"share_user_id":%d}`, shareUserID)
	return c.doRequest(ctx, http.MethodDelete, path, bytes.NewReader([]byte(body)))
}

// GetVehicleInvitations calls GET /api/1/vehicles/{vin}/invitations to list share invites.
func (c *Client) GetVehicleInvitations(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/invitations", vin)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// CreateVehicleInvitation calls POST /api/1/vehicles/{vin}/invitations to create a share invite.
func (c *Client) CreateVehicleInvitation(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/invitations", vin)
	return c.doRequest(ctx, http.MethodPost, path, nil)
}

// RevokeVehicleInvitation calls POST /api/1/vehicles/{vin}/invitations/{id}/revoke.
func (c *Client) RevokeVehicleInvitation(ctx context.Context, vin, invitationID string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/invitations/%s/revoke", vin, invitationID)
	return c.doRequest(ctx, http.MethodPost, path, nil)
}

// FleetTelemetrySubscription is the configuration payload for fleet telemetry.
type FleetTelemetrySubscription struct {
	VINs   []string                    `json:"vins"`
	Config FleetTelemetryConfigPayload `json:"config"`
}

// FleetTelemetryConfigPayload describes the streaming server and fields to subscribe.
type FleetTelemetryConfigPayload struct {
	Hostname   string                         `json:"hostname"`
	CA         *string                        `json:"ca,omitempty"`
	Fields     map[string]FleetTelemetryField `json:"fields"`
	AlertTypes []string                       `json:"alert_types,omitempty"`
	Port       int                            `json:"port"`
	Exp        int64                          `json:"exp,omitempty"`
}

// FleetTelemetryField describes a single telemetry field subscription.
type FleetTelemetryField struct {
	IntervalSeconds int      `json:"interval_seconds"`
	MinimumDelta    *float64 `json:"minimum_delta,omitempty"`
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

// GetChargingHistory calls GET /api/1/dx/charging/history with pagination.
// Returns raw response bytes, HTTP status code, and error.
func (c *Client) GetChargingHistory(ctx context.Context, vin string, startTime, endTime string, pageNo, pageSize int) ([]byte, int, error) {
	params := url.Values{}
	if vin != "" {
		params.Set("vin", vin)
	}
	if startTime != "" {
		params.Set("startTime", startTime)
	}
	if endTime != "" {
		params.Set("endTime", endTime)
	}
	params.Set("pageNo", strconv.Itoa(pageNo))
	params.Set("pageSize", strconv.Itoa(pageSize))
	params.Set("sortBy", "chargeStartDateTime")
	params.Set("sortOrder", "DESC")

	path := "/api/1/dx/charging/history?" + params.Encode()
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetChargingInvoice calls GET /api/1/dx/charging/invoice/{contentID} and returns the PDF bytes.
func (c *Client) GetChargingInvoice(ctx context.Context, contentID string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/dx/charging/invoice/%s", contentID)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetChargingSessions calls GET /api/1/dx/charging/sessions (business accounts only).
// Returns raw response bytes, HTTP status code, and error.
func (c *Client) GetChargingSessions(ctx context.Context, vin, dateFrom, dateTo string, limit, offset int) ([]byte, int, error) {
	params := url.Values{}
	if vin != "" {
		params.Set("vin", vin)
	}
	if dateFrom != "" {
		params.Set("date_from", dateFrom)
	}
	if dateTo != "" {
		params.Set("date_to", dateTo)
	}
	params.Set("limit", strconv.Itoa(limit))
	params.Set("offset", strconv.Itoa(offset))

	path := "/api/1/dx/charging/sessions?" + params.Encode()
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetProducts calls GET /api/1/products to fetch the user's vehicles and energy products.
func (c *Client) GetProducts(ctx context.Context) ([]byte, int, error) {
	return c.doRequest(ctx, http.MethodGet, "/api/1/products", nil)
}

// GetEnergySiteCalendarHistory calls GET /api/1/energy_sites/{id}/calendar_history.
// kind: "backup" or "energy". period: "day", "week", "month", "year".
// Dates are ISO 8601 (YYYY-MM-DD). timeZone is IANA (e.g. "America/Los_Angeles").
func (c *Client) GetEnergySiteCalendarHistory(ctx context.Context, energySiteID int64, kind, startDate, endDate, period, timeZone string) ([]byte, int, error) {
	params := url.Values{}
	params.Set("kind", kind)
	params.Set("start_date", startDate)
	params.Set("end_date", endDate)
	params.Set("period", period)
	params.Set("time_zone", timeZone)

	path := fmt.Sprintf("/api/1/energy_sites/%d/calendar_history?%s", energySiteID, params.Encode())
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetEnergySiteTelemetryHistory calls GET /api/1/energy_sites/{id}/telemetry_history.
// kind: "charge" for wall connector history. Dates are ISO 8601 (YYYY-MM-DD).
func (c *Client) GetEnergySiteTelemetryHistory(ctx context.Context, energySiteID int64, kind, startDate, endDate, timeZone string) ([]byte, int, error) {
	params := url.Values{}
	params.Set("kind", kind)
	params.Set("start_date", startDate)
	params.Set("end_date", endDate)
	params.Set("time_zone", timeZone)

	path := fmt.Sprintf("/api/1/energy_sites/%d/telemetry_history?%s", energySiteID, params.Encode())
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetEnergySiteLiveStatus calls GET /api/1/energy_sites/{id}/live_status.
// Returns real-time power flow data for a Powerwall/Solar site.
func (c *Client) GetEnergySiteLiveStatus(ctx context.Context, energySiteID int64) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/energy_sites/%d/live_status", energySiteID)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetEnergySiteInfo calls GET /api/1/energy_sites/{id}/site_info.
// Returns detailed site configuration: components, backup reserve, operation mode, firmware version.
func (c *Client) GetEnergySiteInfo(ctx context.Context, energySiteID int64) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/energy_sites/%d/site_info", energySiteID)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// SetEnergySiteTOUSettings calls POST /api/1/energy_sites/{id}/time_of_use_settings.
// Updates the utility rate plan / tariff for a Powerwall site's time-of-use schedule.
// The body should contain the full tou_settings JSON envelope as expected by the Tesla API.
func (c *Client) SetEnergySiteTOUSettings(ctx context.Context, energySiteID int64, body io.Reader) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/energy_sites/%d/time_of_use_settings", energySiteID)
	return c.doRequest(ctx, http.MethodPost, path, body)
}
