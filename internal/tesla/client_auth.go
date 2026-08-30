package tesla

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
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

// ErrPartnerCredentialsMissing indicates that a partner-scoped Fleet API call
// cannot be attempted because Tesla client credentials are not configured.
// It is intentionally distinct from ErrUnauthorized, which represents the
// user's OAuth token.
var ErrPartnerCredentialsMissing = errors.New("Tesla partner credentials are not configured")

type partnerScope string

const (
	partnerScopeDefault              partnerScope = "openid vehicle_device_data vehicle_location vehicle_cmds vehicle_charging_cmds"
	partnerScopeVehicleSpecs         partnerScope = "vehicle_specs"
	partnerScopeVehiclePricing       partnerScope = "vehicle_pricing_info"
	partnerScopeEnterpriseManagement partnerScope = "enterprise_management"
)

// partnerTokenError reports only the Fleet Auth HTTP status. Tesla's response
// body can contain authentication details and must never be propagated into
// application logs or handler responses.
type partnerTokenError struct {
	statusCode int
}

func (e *partnerTokenError) Error() string {
	return fmt.Sprintf("partner token request failed with status %d", e.statusCode)
}

// ClientID returns the configured OAuth client ID.
func (c *Client) ClientID() string { return c.clientID }

// ClientSecret returns the configured OAuth client secret.
func (c *Client) ClientSecret() string { return c.clientSec }

// GetPartnerToken obtains a client_credentials token for partner-level API calls.
// Partner tokens use a separate auth endpoint (fleet-auth) from the user OAuth flow.
func (c *Client) GetPartnerToken(ctx context.Context) (token string, err error) {
	return c.getPartnerToken(ctx, partnerScopeDefault)
}

// getPartnerToken obtains a client_credentials token with one fixed,
// call-site-owned scope. Keeping this private prevents request callers from
// supplying arbitrary scopes while preserving GetPartnerToken's historical
// default scope set for partner registration and Fleet Telemetry operations.
func (c *Client) getPartnerToken(ctx context.Context, scope partnerScope) (token string, err error) {
	ctx, span := startSpan(ctx, "tesla.GetPartnerToken",
		attribute.String("tesla.partner.scope", string(scope)),
	)
	defer endSpan(span, &err)

	if strings.TrimSpace(c.clientID) == "" || strings.TrimSpace(c.clientSec) == "" {
		return "", ErrPartnerCredentialsMissing
	}

	// Partner token endpoint is fleet-auth, not auth.tesla.com.
	// Derive from base URL: https://fleet-api.prd.na.vn.cloud.tesla.com
	//                     → https://fleet-auth.prd.vn.cloud.tesla.com
	partnerAuthURL := c.partnerAuthURL()

	formData := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {c.clientID},
		"client_secret": {c.clientSec},
		"scope":         {string(scope)},
		"audience":      {c.baseURL},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, partnerAuthURL+"/oauth2/v3/token", bytes.NewReader([]byte(formData.Encode())))
	if err != nil {
		return "", fmt.Errorf("create partner token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	log.Debug().Str("scope", string(scope)).Msg("requesting Tesla partner token")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("partner token request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read partner token response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", &partnerTokenError{statusCode: resp.StatusCode}
	}

	var result struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("decode partner token: %w", err)
	}
	if strings.TrimSpace(result.AccessToken) == "" {
		return "", errors.New("partner token response did not include an access token")
	}
	return result.AccessToken, nil
}

func partnerTokenStatus(err error) int {
	var tokenErr *partnerTokenError
	if errors.As(err, &tokenErr) {
		return tokenErr.statusCode
	}
	return 0
}

// partnerAuthURL derives the fleet-auth URL from the configured base URL.
// e.g. https://fleet-api.prd.na.vn.cloud.tesla.com → https://fleet-auth.prd.vn.cloud.tesla.com
// Falls back to https://fleet-auth.prd.vn.cloud.tesla.com if parsing fails.
func (c *Client) partnerAuthURL() string {
	regionMap := map[string]string{
		"https://fleet-api.prd.na.vn.cloud.tesla.com": "https://fleet-auth.prd.vn.cloud.tesla.com",
		"https://fleet-api.prd.eu.vn.cloud.tesla.com": "https://fleet-auth.prd.vn.cloud.tesla.com",
		"https://fleet-api.prd.cn.vn.cloud.tesla.com": "https://fleet-auth.prd.vn.cloud.tesla.com",
	}
	if authURL, ok := regionMap[c.baseURL]; ok {
		return authURL
	}
	return "https://fleet-auth.prd.vn.cloud.tesla.com"
}

// doRequestWithToken performs an API request using a custom bearer token (e.g. partner token)
// instead of the stored user access token. Runs through the circuit breaker and logging.
func (c *Client) doRequestWithToken(ctx context.Context, method, path string, body io.Reader, token string) (respBody []byte, statusCode int, err error) {
	return c.doRequestWithTokenOptions(ctx, method, path, body, token, partnerRequestOptions{
		telemetryPath: path,
		captureBodies: true,
	})
}

type partnerRequestOptions struct {
	telemetryPath string
	captureBodies bool
}

type privatePartnerRequestError struct {
	cause error
}

func (e *privatePartnerRequestError) Error() string {
	return "private Tesla partner request failed"
}

func (e *privatePartnerRequestError) Unwrap() error {
	return e.cause
}

// doPrivateRequestWithToken performs a partner-token request without exposing
// the request/response body or concrete VIN-bearing path to audit callbacks or
// tracing. Opaque pricing/payer payloads and enterprise responses may contain
// PII, so callers must use a fixed route template for telemetryPath.
func (c *Client) doPrivateRequestWithToken(
	ctx context.Context,
	method, path string,
	body io.Reader,
	token, telemetryPath string,
) ([]byte, int, error) {
	return c.doRequestWithTokenOptions(ctx, method, path, body, token, partnerRequestOptions{
		telemetryPath: telemetryPath,
		captureBodies: false,
	})
}

func (c *Client) doRequestWithTokenOptions(
	ctx context.Context,
	method, path string,
	body io.Reader,
	token string,
	opts partnerRequestOptions,
) (respBody []byte, statusCode int, err error) {
	telemetryPath := opts.telemetryPath
	if telemetryPath == "" {
		telemetryPath = path
	}

	ctx, span := startSpan(ctx, "tesla.HTTP "+method+" "+telemetryPath,
		attribute.String("http.request.method", method),
		attribute.String("tesla.api.path", telemetryPath),
		attribute.String("tesla.token.kind", "partner"),
	)
	defer func() {
		recordHTTPStatus(span, method, c.baseURL+telemetryPath, statusCode)
		endSpan(span, &err)
	}()

	if waitErr := c.limiter.Wait(ctx); waitErr != nil {
		return nil, 0, fmt.Errorf("rate limiter: %w", waitErr)
	}
	if budgetErr := c.reserveBudget(ctx, method, telemetryPath); budgetErr != nil {
		return nil, budgetHTTPStatus(budgetErr), budgetErr
	}

	url := c.baseURL + path
	start := time.Now()

	var reqBodyBytes []byte
	if body != nil {
		reqBodyBytes, err = io.ReadAll(body)
		if err != nil {
			return nil, 0, fmt.Errorf("read partner request body: %w", err)
		}
		body = bytes.NewReader(reqBodyBytes)
	}

	result, cbErr := c.cb.Execute(func() (interface{}, error) {
		req, reqErr := http.NewRequestWithContext(ctx, method, url, body)
		if reqErr != nil {
			if !opts.captureBodies {
				return nil, &privatePartnerRequestError{cause: reqErr}
			}
			return nil, fmt.Errorf("create request: %w", reqErr)
		}

		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")

		resp, doErr := c.httpClient.Do(req)
		if doErr != nil {
			if !opts.captureBodies {
				return nil, &privatePartnerRequestError{cause: doErr}
			}
			return nil, fmt.Errorf("do request: %w", doErr)
		}
		defer resp.Body.Close()

		data, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			if !opts.captureBodies {
				return nil, &privatePartnerRequestError{cause: readErr}
			}
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
			callbackURL := url
			callbackReqBody := reqBodyBytes
			callbackRespBody := errRespBody
			if !opts.captureBodies {
				callbackURL = c.baseURL + telemetryPath
				callbackReqBody = nil
				callbackRespBody = nil
			}
			c.logCallback(method, callbackURL, errStatus, callbackReqBody, callbackRespBody, durationMs, cbErr)
		}
		err = cbErr
		statusCode = errStatus
		respBody = errRespBody
		return respBody, statusCode, err
	}

	resp := result.(*apiResponse)

	if c.logCallback != nil {
		callbackURL := url
		callbackReqBody := reqBodyBytes
		callbackRespBody := resp.Body
		if !opts.captureBodies {
			callbackURL = c.baseURL + telemetryPath
			callbackReqBody = nil
			callbackRespBody = nil
		}
		c.logCallback(method, callbackURL, resp.StatusCode, callbackReqBody, callbackRespBody, durationMs, nil)
	}

	respBody = resp.Body
	statusCode = resp.StatusCode
	return respBody, statusCode, nil
}
