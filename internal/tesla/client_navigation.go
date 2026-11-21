package tesla

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
)

type NavigationOutcome string

const (
	NavigationAccepted NavigationOutcome = "accepted"
	NavigationRejected NavigationOutcome = "rejected"
	NavigationUnknown  NavigationOutcome = "delivery_unknown"
	NavigationNotSent  NavigationOutcome = "not_sent"

	navigationVehiclePath = "/api/1/vehicles/{vin}"
	navigationWakePath    = navigationVehiclePath + "/wake_up"
)

var errNavigationNotSent = errors.New("navigation transport did not dispatch")

func navigationCommandPath() string {
	return navigationVehiclePath + "/command/" + commands["navigation_request"].endpoint
}

func (c *Client) NavigationAllowed(ctx context.Context) bool {
	return c != nil && c.HasValidToken() &&
		c.checkEndpointControls(ctx, http.MethodGet, navigationVehiclePath) == nil &&
		c.checkEndpointControls(ctx, http.MethodPost, navigationCommandPath()) == nil
}

// NavigationConnectivity checks Tesla's reported connection state without asking the car for live data.
func (c *Client) NavigationConnectivity(ctx context.Context, vin string) string {
	data, status, err := c.privateNavigationRequest(ctx, http.MethodGet, vin, navigationVehiclePath, nil, nil)
	if err != nil || status != http.StatusOK {
		return ""
	}
	return navigationConnectionState(data)
}

// RequestNavigationWake issues a separate, single wake request. Its caller must have explicit wake consent.
func (c *Client) RequestNavigationWake(ctx context.Context, vin string, authorize func(context.Context) error) (string, NavigationOutcome) {
	data, status, err := c.privateNavigationRequest(ctx, http.MethodPost, vin, navigationWakePath, nil, authorize)
	if result := navigationHTTPOutcome(status, err); result != NavigationAccepted {
		return "", result
	}
	state := navigationConnectionState(data)
	if state == "" {
		return "", NavigationUnknown
	}
	return state, NavigationAccepted
}

func navigationConnectionState(data []byte) string {
	var response struct {
		Response struct {
			State string `json:"state"`
		} `json:"response"`
		Error string `json:"error"`
	}
	if json.Unmarshal(data, &response) == nil && response.Error == "" {
		switch response.Response.State {
		case "online", "asleep", "offline":
			return response.Response.State
		}
	}
	return ""
}

// SendNavigationAddress sends the existing address-share command once. The Tesla SDK
// forwards this command directly to Fleet REST without opening a command session.
func (c *Client) SendNavigationAddress(ctx context.Context, vin, address string, authorize func(context.Context) error) NavigationOutcome {
	address = strings.TrimSpace(address)
	if address == "" || len(address) > 400 || strings.ContainsFunc(address, unicode.IsControl) {
		return NavigationRejected
	}
	params := struct {
		Type   string            `json:"type"`
		Value  map[string]string `json:"value"`
		Locale string            `json:"locale"`
	}{
		Type:   "share_ext_content_raw",
		Value:  map[string]string{"android.intent.extra.TEXT": address},
		Locale: "en-US",
	}
	body, err := json.Marshal(params)
	if err != nil {
		return NavigationRejected
	}
	data, status, err := c.privateNavigationRequest(ctx, http.MethodPost, vin, navigationCommandPath(), body, authorize)
	if result := navigationHTTPOutcome(status, err); result != NavigationAccepted {
		return result
	}
	var response struct {
		Response struct {
			Result *bool  `json:"result"`
			Reason string `json:"reason"`
		} `json:"response"`
		Error string `json:"error"`
	}
	if json.Unmarshal(data, &response) != nil || response.Error != "" || response.Response.Result == nil {
		return NavigationUnknown
	}
	if !*response.Response.Result {
		return NavigationRejected
	}
	if response.Response.Reason != "" {
		return NavigationUnknown
	}
	return NavigationAccepted
}

func (c *Client) privateNavigationRequest(
	ctx context.Context, method, vin, route string, body []byte, authorize func(context.Context) error,
) ([]byte, int, error) {
	c.mu.RLock()
	token, expires := c.accessToken, c.expiresAt
	c.mu.RUnlock()
	if len(vin) != 17 || strings.ContainsFunc(vin, func(c rune) bool {
		return !(c >= '0' && c <= '9' || c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z')
	}) || token == "" || !time.Now().Before(expires) {
		return nil, http.StatusUnauthorized, ErrUnauthorized
	}
	path := strings.Replace(route, "{vin}", url.PathEscape(vin), 1)
	if method == http.MethodGet {
		return c.doFleetRequest(ctx, method, path, nil, route, token)
	}
	admit := func(ctx context.Context) error {
		if authorize == nil || c.checkEndpointControls(ctx, method, path) != nil || authorize(ctx) != nil || ctx.Err() != nil {
			return errNavigationNotSent
		}
		c.mu.RLock()
		defer c.mu.RUnlock()
		if token != c.accessToken || !time.Now().Before(c.expiresAt) {
			return errNavigationNotSent
		}
		return nil
	}
	return c.doFleetRequestAdmitted(ctx, method, path, bytes.NewReader(body), route, token, admit)
}

func navigationHTTPOutcome(status int, err error) NavigationOutcome {
	if errors.Is(err, errNavigationNotSent) {
		return NavigationNotSent
	}
	switch status {
	case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound,
		http.StatusUnprocessableEntity, http.StatusTooManyRequests:
		return NavigationRejected
	case http.StatusOK:
		if err == nil {
			return NavigationAccepted
		}
	}
	// Tesla can time out before or after executing the command.
	return NavigationUnknown
}
