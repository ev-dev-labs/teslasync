package tesla

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/rs/zerolog/log"
	"github.com/sony/gobreaker"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
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
	budgetMu        sync.RWMutex
	requestBudget   RequestBudget

	mu          sync.RWMutex
	accessToken string
	refreshTok  string
	expiresAt   time.Time

	// logCallback is called after each API request for audit logging.
	logCallback func(method, url string, statusCode int, reqBody, respBody []byte, durationMs int, err error)
}

// NewClient creates a Tesla API client with rate limiting and a circuit
// breaker to prevent cascading calls to an unhealthy Tesla API.
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

	// Process-local burst smoother. This is intentionally not described as
	// Tesla's quota: Fleet API limits vary by endpoint and vehicle, while the
	// durable request budget below is the account-wide cost control.
	limiter := rate.NewLimiter(rate.Every(100*time.Millisecond), 5)

	// HTTP client for the Vehicle Command Proxy (self-signed TLS in Docker)
	proxyTransport := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	proxyClient := &http.Client{
		Timeout:   cfg.Timeout,
		Transport: otelhttp.NewTransport(proxyTransport),
	}

	c := &Client{
		httpClient:      &http.Client{Timeout: cfg.Timeout, Transport: otelhttp.NewTransport(http.DefaultTransport)},
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
	policy := NewBudgetPolicy(cfg.DailyBudgetUSD, cfg.CommandReserveUSD)
	if policy.Enabled() {
		c.requestBudget = NewMemoryRequestBudget(policy)
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

// SetRequestBudget replaces the process-local budget with a shared durable
// implementation. Composition roots with a database must call this before
// issuing Fleet API requests.
func (c *Client) SetRequestBudget(budget RequestBudget) {
	if c == nil {
		return
	}
	c.budgetMu.Lock()
	c.requestBudget = budget
	c.budgetMu.Unlock()
}

// BudgetSnapshot returns the current UTC-day cost reservation state.
func (c *Client) BudgetSnapshot(ctx context.Context) (BudgetSnapshot, bool, error) {
	if c == nil {
		return BudgetSnapshot{}, false, nil
	}
	c.budgetMu.RLock()
	budget := c.requestBudget
	c.budgetMu.RUnlock()
	if budget == nil {
		return BudgetSnapshot{}, false, nil
	}
	snapshot, err := budget.Snapshot(ctx)
	return snapshot, true, err
}

func (c *Client) reserveBudget(ctx context.Context, method, path string) error {
	c.budgetMu.RLock()
	budget := c.requestBudget
	c.budgetMu.RUnlock()
	if budget == nil {
		return nil
	}
	if _, err := budget.Reserve(ctx, ClassifyBudgetCharge(method, path)); err != nil {
		if errors.Is(err, ErrBudgetExceeded) || errors.Is(err, ErrInvalidBudgetCharge) {
			return fmt.Errorf("reserve Fleet API request budget: %w", err)
		}
		return fmt.Errorf("%w: %w", ErrBudgetUnavailable, err)
	}
	return nil
}

func budgetHTTPStatus(err error) int {
	if errors.Is(err, ErrBudgetExceeded) {
		return http.StatusTooManyRequests
	}
	return http.StatusServiceUnavailable
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

// BucketSnapshot is a thread-safe, read-only view of the Fleet API
// rate limiter's current state. Returned by BucketSnapshot() so the
// /system/rate-limits status panel can show callers how much
// client-side rate-limit headroom they have before the next Tesla
// request will be queued or rejected.
//
// Tokens / Burst yields a "% of burst capacity remaining" gauge:
// when Tokens drops to zero, the next outbound call will block on
// limiter.Wait until the bucket refills at Limit tokens/sec.
//
// This is only the process-local burst smoother. Account-wide estimated
// spend is exposed separately through BudgetSnapshot.
type BucketSnapshot struct {
	// Tokens is the number of tokens currently available in the bucket.
	// Reads x/time/rate.Limiter.Tokens(); may be fractional and may
	// briefly exceed Burst when the limiter has been idle.
	Tokens float64 `json:"tokens"`
	// Burst is the bucket's maximum capacity (configured in NewClient).
	Burst int `json:"burst"`
	// Limit is the steady-state refill rate in tokens/second.
	Limit float64 `json:"limit"`
}

// BucketSnapshot returns a read-only view of the Fleet API client's
// rate-limit bucket state. Safe to call from any goroutine; the
// underlying x/time/rate.Limiter is internally synchronised.
func (c *Client) BucketSnapshot() BucketSnapshot {
	if c == nil || c.limiter == nil {
		return BucketSnapshot{}
	}
	return BucketSnapshot{
		Tokens: c.limiter.Tokens(),
		Burst:  c.limiter.Burst(),
		Limit:  float64(c.limiter.Limit()),
	}
}

// BaseURL returns the configured Fleet API base URL.
func (c *Client) BaseURL() string { return c.baseURL }

// GetUserRegion calls GET /api/1/users/region to detect the account's Fleet API region.
func (c *Client) GetUserRegion(ctx context.Context) (body []byte, status int, err error) {
	ctx, span := startSpan(ctx, "tesla.GetUserRegion")
	defer endSpan(span, &err)
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

// ErrRateLimited is returned when Tesla API returns 429 Too Many Requests.
var ErrRateLimited = fmt.Errorf("rate limited (429): too many requests")

// doRequest performs an authenticated API request through the circuit breaker.
func (c *Client) doRequest(ctx context.Context, method, path string, body io.Reader) (respBody []byte, statusCode int, err error) {
	ctx, span := startSpan(ctx, "tesla.HTTP "+method+" "+path,
		attribute.String("http.request.method", method),
		attribute.String("tesla.api.path", path),
	)
	defer func() {
		recordHTTPStatus(span, method, c.baseURL+path, statusCode)
		endSpan(span, &err)
	}()

	if waitErr := c.limiter.Wait(ctx); waitErr != nil {
		return nil, 0, fmt.Errorf("rate limiter: %w", waitErr)
	}
	if budgetErr := c.reserveBudget(ctx, method, path); budgetErr != nil {
		return nil, budgetHTTPStatus(budgetErr), budgetErr
	}

	url := c.baseURL + path
	start := time.Now()

	var reqBodyBytes []byte
	if body != nil {
		reqBodyBytes, _ = io.ReadAll(body)
		body = bytes.NewReader(reqBodyBytes)
	}

	result, cbErr := c.cb.Execute(func() (interface{}, error) {
		req, reqErr := http.NewRequestWithContext(ctx, method, url, body)
		if reqErr != nil {
			return nil, fmt.Errorf("create request: %w", reqErr)
		}

		c.mu.RLock()
		token := c.accessToken
		c.mu.RUnlock()

		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")

		resp, doErr := c.httpClient.Do(req)
		if doErr != nil {
			return nil, fmt.Errorf("do request: %w", doErr)
		}
		defer resp.Body.Close()

		data, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return nil, fmt.Errorf("read body: %w", readErr)
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

	if cbErr != nil {
		errStatus := 0
		var errRespBody []byte
		if result != nil {
			if resp, ok := result.(*apiResponse); ok {
				errStatus = resp.StatusCode
				errRespBody = resp.Body
			}
		}
		if c.logCallback != nil {
			c.logCallback(method, url, errStatus, reqBodyBytes, errRespBody, durationMs, cbErr)
		}
		err = cbErr
		statusCode = errStatus
		respBody = errRespBody
		return respBody, statusCode, err
	}

	resp := result.(*apiResponse)

	if c.logCallback != nil {
		c.logCallback(method, url, resp.StatusCode, reqBodyBytes, resp.Body, durationMs, nil)
	}

	respBody = resp.Body
	statusCode = resp.StatusCode
	return respBody, statusCode, nil
}

type apiResponse struct {
	StatusCode int
	Body       []byte
}
