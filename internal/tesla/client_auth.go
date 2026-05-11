package tesla

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
)

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

// ErrUnauthorized is returned when the Tesla API rejects the current token.
var ErrUnauthorized = fmt.Errorf("unauthorized (401): token expired or invalid")

// ClientID returns the configured OAuth client ID.
func (c *Client) ClientID() string { return c.clientID }

// ClientSecret returns the configured OAuth client secret.
func (c *Client) ClientSecret() string { return c.clientSec }

// GetPartnerToken obtains a client_credentials token for partner-level API calls.
// Partner tokens use a separate auth endpoint (fleet-auth) from the user OAuth flow.
func (c *Client) GetPartnerToken(ctx context.Context) (token string, err error) {
	ctx, span := startSpan(ctx, "tesla.GetPartnerToken")
	defer endSpan(span, &err)

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

// doRequestWithToken performs an API request using a custom bearer token (e.g. partner token)
// instead of the stored user access token. Runs through the circuit breaker and logging.
func (c *Client) doRequestWithToken(ctx context.Context, method, path string, body io.Reader, token string) (respBody []byte, statusCode int, err error) {
	ctx, span := startSpan(ctx, "tesla.HTTP "+method+" "+path,
		attribute.String("http.request.method", method),
		attribute.String("tesla.api.path", path),
		attribute.String("tesla.token.kind", "partner"),
	)
	defer func() {
		recordHTTPStatus(span, method, c.baseURL+path, statusCode)
		endSpan(span, &err)
	}()

	if waitErr := c.limiter.Wait(ctx); waitErr != nil {
		return nil, 0, fmt.Errorf("rate limiter: %w", waitErr)
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
