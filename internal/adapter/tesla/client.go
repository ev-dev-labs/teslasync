package tesla

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/platform/config"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"github.com/ev-dev-labs/teslasync/internal/port/external"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// defaultTimeout is applied when the configured Tesla API timeout is unset or
// non-positive. Passing a zero/negative duration to context.WithTimeout yields
// an already-expired context that would fail every request immediately.
const defaultTimeout = 30 * time.Second

// Client implements external.TeslaClient with rate limiting and circuit breaker.
type Client struct {
	httpClient *http.Client
	baseURL    string
	authURL    string
	cb         *httputil.CircuitBreaker
	timeout    time.Duration
}

// NewClient creates a new Tesla API client.
func NewClient(cfg config.TeslaConfig) *Client {
	transport := &httputil.RetryableTransport{
		Base:   http.DefaultTransport,
		Config: httputil.DefaultRetryConfig(),
	}

	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}

	return &Client{
		httpClient: &http.Client{Transport: otelhttp.NewTransport(transport)},
		baseURL:    cfg.BaseURL,
		authURL:    cfg.AuthURL,
		cb:         httputil.NewCircuitBreaker("tesla_api", httputil.DefaultCircuitBreakerConfig()),
		timeout:    timeout,
	}
}

func (c *Client) GetVehicleState(ctx context.Context, vin string) (*external.VehicleState, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	var state external.VehicleState
	err := c.cb.Execute(func() error {
		url := fmt.Sprintf("%s/api/1/vehicles/%s/vehicle_data", c.baseURL, vin)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return fmt.Errorf("creating request: %w", err)
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("executing request: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("tesla API returned status %d", resp.StatusCode)
		}

		var apiResp struct {
			Response json.RawMessage `json:"response"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
			return fmt.Errorf("decoding response: %w", err)
		}

		state, err = mapVehicleState(apiResp.Response)
		return err
	})

	if err != nil {
		return nil, fmt.Errorf("getting vehicle state for %s: %w", vin, err)
	}
	return &state, nil
}

func (c *Client) GetVehicleData(ctx context.Context, vin string) (map[string]interface{}, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	var data map[string]interface{}
	err := c.cb.Execute(func() error {
		url := fmt.Sprintf("%s/api/1/vehicles/%s/vehicle_data", c.baseURL, vin)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return fmt.Errorf("creating request: %w", err)
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("executing request: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("tesla API returned status %d", resp.StatusCode)
		}

		if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
			return fmt.Errorf("decoding response: %w", err)
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("getting vehicle data for %s: %w", vin, err)
	}
	return data, nil
}

func (c *Client) WakeUp(ctx context.Context, vin string) error {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	return c.cb.Execute(func() error {
		url := fmt.Sprintf("%s/api/1/vehicles/%s/wake_up", c.baseURL, vin)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
		if err != nil {
			return fmt.Errorf("creating wake request: %w", err)
		}
		resp, err := c.httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("executing wake request: %w", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("wake_up returned status %d", resp.StatusCode)
		}
		return nil
	})
}

func (c *Client) SendCommand(ctx context.Context, vin string, command string, params map[string]interface{}) error {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	return c.cb.Execute(func() error {
		url := fmt.Sprintf("%s/api/1/vehicles/%s/command/%s", c.baseURL, vin, command)

		var body io.Reader
		if len(params) > 0 {
			payload, err := json.Marshal(params)
			if err != nil {
				return fmt.Errorf("marshaling command params: %w", err)
			}
			body = bytes.NewReader(payload)
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, body)
		if err != nil {
			return fmt.Errorf("creating command request: %w", err)
		}
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("executing command: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("command %s returned status %d", command, resp.StatusCode)
		}
		return nil
	})
}

func (c *Client) RefreshToken(ctx context.Context, refreshToken string) (*external.TokenPair, error) {
	return nil, fmt.Errorf("RefreshToken: not yet implemented")
}

func (c *Client) RevokeToken(ctx context.Context, accessToken string) error {
	return fmt.Errorf("RevokeToken: not yet implemented")
}
