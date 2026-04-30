package tesla

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/url"
)

// RegisterPartner calls POST /api/1/partner_accounts to register this app in the current region.
// It requires the partner token (client_credentials), not the user's OAuth token.
func (c *Client) RegisterPartner(ctx context.Context, partnerToken, domain string) ([]byte, int, error) {
	body := fmt.Sprintf(`{"domain":"%s"}`, domain)
	return c.doRequestWithToken(ctx, http.MethodPost, "/api/1/partner_accounts", bytes.NewReader([]byte(body)), partnerToken)
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

// PairKey pairs the public key with a vehicle for command signing.
func (c *Client) PairKey(ctx context.Context, vin string, publicKeyPEM string) ([]byte, int, error) {
	body := fmt.Sprintf(`{"public_key":"%s"}`, publicKeyPEM)
	path := fmt.Sprintf("/api/1/vehicles/%s/paired_keys", vin)
	return c.doRequest(ctx, http.MethodPost, path, bytes.NewReader([]byte(body)))
}
