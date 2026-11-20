package tesla

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const (
	EnergyReadOAuthCallback = "/api/v1/smart-charging/solar/connection/callback"
	energyReadScope         = "openid offline_access energy_device_data"
)

var ErrEnergyReadAuthorization = errors.New("Tesla energy read authorization unavailable")

func (c *Client) EnergyReadAuthURL(state string) (string, error) {
	callback, err := c.energyReadCallbackURL()
	if err != nil || state == "" {
		return "", ErrEnergyReadAuthorization
	}
	provider, err := url.Parse(c.authURL)
	if err != nil || provider.Scheme != "https" || provider.Hostname() == "" || provider.User != nil ||
		provider.RawQuery != "" || provider.Fragment != "" {
		return "", ErrEnergyReadAuthorization
	}
	query := url.Values{
		"client_id": {c.clientID}, "redirect_uri": {callback}, "response_type": {"code"},
		"scope": {energyReadScope}, "state": {state}, "prompt": {"consent"},
	}
	provider.Path, provider.RawPath, provider.RawQuery = "/oauth2/v3/authorize", "", query.Encode()
	return provider.String(), nil
}

func (c *Client) ExchangeEnergyReadCode(ctx context.Context, code string) (*TokenResponse, error) {
	callback, err := c.energyReadCallbackURL()
	if err != nil || code == "" {
		return nil, ErrEnergyReadAuthorization
	}
	return c.energyReadTokenRequest(ctx, url.Values{
		"grant_type": {"authorization_code"}, "client_id": {c.clientID}, "client_secret": {c.clientSec},
		"code": {code}, "redirect_uri": {callback}, "audience": {c.baseURL},
	})
}

func (c *Client) RefreshEnergyReadGrant(ctx context.Context, refreshToken string) (*TokenResponse, error) {
	if c.clientID == "" || refreshToken == "" {
		return nil, ErrEnergyReadAuthorization
	}
	return c.energyReadTokenRequest(ctx, url.Values{
		"grant_type": {"refresh_token"}, "client_id": {c.clientID}, "refresh_token": {refreshToken},
	})
}

func (c *Client) energyReadCallbackURL() (string, error) {
	if c.clientID == "" || c.clientSec == "" {
		return "", ErrEnergyReadAuthorization
	}
	callback, err := url.Parse(c.redirectURI)
	if err != nil || callback.Scheme != "https" || callback.Hostname() == "" || callback.User != nil ||
		callback.RawQuery != "" || callback.Fragment != "" {
		return "", ErrEnergyReadAuthorization
	}
	callback.Path, callback.RawPath = EnergyReadOAuthCallback, ""
	return callback.String(), nil
}

func (c *Client) energyReadTokenRequest(ctx context.Context, form url.Values) (_ *TokenResponse, err error) {
	ctx, span := startSpan(ctx, "tesla.energy_read_token_exchange")
	defer endSpan(span, &err)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.partnerAuthURL()+"/oauth2/v3/token", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, ErrEnergyReadAuthorization
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := c.privateClient.Do(req)
	if err != nil {
		return nil, ErrEnergyReadAuthorization
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, ErrEnergyReadAuthorization
	}
	const maxTokenResponse = 64 << 10
	body, err := io.ReadAll(io.LimitReader(response.Body, maxTokenResponse+1))
	if err != nil || len(body) > maxTokenResponse {
		return nil, ErrEnergyReadAuthorization
	}
	var responseToken struct {
		TokenResponse
		Scope string `json:"scope"`
	}
	if json.Unmarshal(body, &responseToken) != nil || responseToken.AccessToken == "" || responseToken.RefreshToken == "" ||
		!strings.EqualFold(responseToken.TokenType, "Bearer") || responseToken.ExpiresIn <= 0 ||
		responseToken.ExpiresIn > 7*24*60*60 || !validEnergyReadScope(responseToken.Scope) {
		return nil, ErrEnergyReadAuthorization
	}
	return &responseToken.TokenResponse, nil
}

func validEnergyReadScope(scope string) bool {
	if scope == "" {
		// Tesla's documented token response need not echo the requested scope.
		return true
	}
	var energyRead bool
	for _, field := range strings.Fields(scope) {
		switch field {
		case "energy_device_data":
			energyRead = true
		case "openid", "offline_access":
		default:
			return false
		}
	}
	return energyRead
}
