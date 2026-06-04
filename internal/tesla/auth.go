package tesla

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"go.opentelemetry.io/otel/attribute"
)

// teslaAuthClientTimeout is the default timeout for OAuth token exchanges.
// Token requests must complete quickly; SetAuthSink can override at startup
// (callers pass cfg.Tesla.Timeout from main.go).
const teslaAuthClientTimeout = 30 * time.Second

var (
	// authHTTPClientMu guards swaps of authHTTPClient. The pointer is read
	// on every OAuth token exchange so the swap MUST be race-safe.
	authHTTPClientMu sync.RWMutex
	// authHTTPClient is the package-level outbound *http.Client used by
	// ExchangeCode/RefreshTokens (auth.go::tokenRequest). It is SEPARATE
	// from Client.httpClient — Client.httpClient is the Fleet API client
	// whose every call already lands in api_call_logs via SetLogCallback
	// (service="tesla-api"). Splitting auth out lets OAuth requests carry
	// the distinct service="tesla-auth" tag without double-recording Fleet
	// API rows.
	authHTTPClient = httputil.NewClient(httputil.ClientConfig{
		Name:          "tesla-auth",
		Timeout:       teslaAuthClientTimeout,
		EnableLogging: true,
	})
)

// SetAuthSink rebuilds the package-level Tesla OAuth HTTP client (used by
// ExchangeCode / RefreshTokens) to route every token exchange through the
// supplied APICallSink. Production wiring (cmd/teslasync/main.go and
// cmd/automation-worker/main.go) calls this once at startup. timeout==0
// keeps the historical 30s budget; pass cfg.Tesla.Timeout to mirror the
// Fleet API client's timeout.
//
// SCOPE: This setter only covers OAuth code-grant + refresh exchanges in
// internal/tesla/auth.go. internal/tesla/client_auth.go::GetPartnerToken
// and internal/tesla/client.go::doRequest still use Client.httpClient.
// Fleet API rows already flow through SetLogCallback; partner-token
// auth logging remains separate.
func SetAuthSink(sink httputil.APICallSink, timeout time.Duration) {
	if timeout <= 0 {
		timeout = teslaAuthClientTimeout
	}
	c := httputil.NewClient(httputil.ClientConfig{
		Name:          "tesla-auth",
		Timeout:       timeout,
		Sink:          sink,
		EnableLogging: true,
	})
	authHTTPClientMu.Lock()
	authHTTPClient = c
	authHTTPClientMu.Unlock()
}

// authClient returns the current package-level OAuth client under the
// authHTTPClientMu read lock so the pointer is observed coherently with
// the last SetAuthSink swap.
func authClient() *http.Client {
	authHTTPClientMu.RLock()
	defer authHTTPClientMu.RUnlock()
	return authHTTPClient
}

// TokenResponse represents an OAuth token response from Tesla.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

// ExchangeCode exchanges an authorization code for tokens.
func (c *Client) ExchangeCode(ctx context.Context, code string) (resp *TokenResponse, err error) {
	ctx, span := startSpan(ctx, "tesla.ExchangeCode")
	defer endSpan(span, &err)

	form := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {c.clientID},
		"client_secret": {c.clientSec},
		"code":          {code},
		"redirect_uri":  {c.redirectURI},
	}

	return c.tokenRequest(ctx, form)
}

// RefreshTokens refreshes the access token using the refresh token.
func (c *Client) RefreshTokens(ctx context.Context) (resp *TokenResponse, err error) {
	ctx, span := startSpan(ctx, "tesla.RefreshTokens")
	defer endSpan(span, &err)

	c.mu.RLock()
	refresh := c.refreshTok
	c.mu.RUnlock()

	if refresh == "" {
		return nil, fmt.Errorf("no refresh token available")
	}

	form := url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {c.clientID},
		"refresh_token": {refresh},
	}

	return c.tokenRequest(ctx, form)
}

func (c *Client) tokenRequest(ctx context.Context, form url.Values) (resp *TokenResponse, err error) {
	tokenURL := c.authURL + "/oauth2/v3/token"
	ctx, span := startSpan(ctx, "tesla.tokenRequest",
		attribute.String("http.request.method", http.MethodPost),
		attribute.String("http.url", tokenURL),
	)
	defer endSpan(span, &err)

	req, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if reqErr != nil {
		return nil, fmt.Errorf("create token request: %w", reqErr)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	httpResp, doErr := authClient().Do(req)
	if doErr != nil {
		return nil, fmt.Errorf("token request: %w", doErr)
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token request failed: status %d", httpResp.StatusCode)
	}

	var tokenResp TokenResponse
	if decErr := json.NewDecoder(httpResp.Body).Decode(&tokenResp); decErr != nil {
		return nil, fmt.Errorf("decode token response: %w", decErr)
	}

	expiresAt := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	c.SetTokens(tokenResp.AccessToken, tokenResp.RefreshToken, expiresAt)

	return &tokenResp, nil
}
