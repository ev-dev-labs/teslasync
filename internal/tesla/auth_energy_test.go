package tesla

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

type energyOAuthTestTransport func(*http.Request) (*http.Response, error)

func (f energyOAuthTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestEnergyReadAuthorizationDoesNotMutateInstallationTokens(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/oauth2/v3/token" || r.ParseForm() != nil {
			t.Error("unexpected token exchange request")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if r.Form.Get("client_id") != "synthetic-client" {
			t.Error("missing client ID")
		}
		switch r.Form.Get("grant_type") {
		case "authorization_code":
			if r.Form.Get("audience") != "https://fleet-api.prd.eu.vn.cloud.tesla.com" ||
				r.Form.Get("redirect_uri") != "https://example.test"+EnergyReadOAuthCallback ||
				r.Form.Get("client_secret") != "synthetic-secret" {
				t.Error("incorrect Fleet OAuth code exchange contract")
			}
			if r.Form.Get("code") == "synthetic-over-scoped" {
				_, _ = w.Write([]byte(`{"access_token":"synthetic-private","refresh_token":"synthetic-refresh","expires_in":3600,"token_type":"Bearer","scope":"energy_device_data energy_cmds"}`))
				return
			}
			if r.Form.Get("code") != "synthetic-code" {
				t.Error("unexpected code")
			}
		case "refresh_token":
			if r.Form.Get("refresh_token") != "synthetic-refresh" || r.Form.Has("client_secret") {
				t.Error("incorrect Fleet refresh contract")
			}
		default:
			t.Error("unexpected flow")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`{"access_token":"synthetic-private","refresh_token":"synthetic-next","expires_in":3600,"token_type":"Bearer","scope":"openid offline_access energy_device_data"}`))
	}))
	defer server.Close()
	destination, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	client := newTestClient(server)
	client.authURL = "https://auth.tesla.com"
	client.baseURL = "https://fleet-api.prd.eu.vn.cloud.tesla.com"
	client.redirectURI = "https://example.test/api/v1/auth/callback"
	client.clientID, client.clientSec = "synthetic-client", "synthetic-secret"
	client.privateClient.Transport = energyOAuthTestTransport(func(req *http.Request) (*http.Response, error) {
		if req.URL.Scheme != "https" || req.URL.Host != "fleet-auth.prd.vn.cloud.tesla.com" {
			t.Error("exchange did not target Tesla Fleet Auth")
		}
		local := req.Clone(req.Context())
		local.URL.Scheme, local.URL.Host = destination.Scheme, destination.Host
		return http.DefaultTransport.RoundTrip(local)
	})
	link, err := client.EnergyReadAuthURL("synthetic-state+")
	if err != nil {
		t.Fatal(err)
	}
	authorize, err := url.Parse(link)
	if err != nil || authorize.Host != "auth.tesla.com" || authorize.Path != "/oauth2/v3/authorize" ||
		authorize.Query().Get("scope") != "openid offline_access energy_device_data" ||
		authorize.Query().Get("state") != "synthetic-state+" ||
		authorize.Query().Get("redirect_uri") != "https://example.test"+EnergyReadOAuthCallback {
		t.Fatalf("incorrect energy authorization URL: %v, %v", authorize, err)
	}
	client.SetTokens("synthetic-installation-access", "synthetic-installation-refresh", time.Now().Add(time.Hour))
	for name, exchange := range map[string]func() (*TokenResponse, error){
		"code":    func() (*TokenResponse, error) { return client.ExchangeEnergyReadCode(t.Context(), "synthetic-code") },
		"refresh": func() (*TokenResponse, error) { return client.RefreshEnergyReadGrant(t.Context(), "synthetic-refresh") },
	} {
		t.Run(name, func(t *testing.T) {
			result, err := exchange()
			if err != nil || result.AccessToken != "synthetic-private" || result.RefreshToken != "synthetic-next" {
				t.Fatalf("read-only energy token exchange failed: %v", err)
			}
			if client.accessToken != "synthetic-installation-access" || client.refreshTok != "synthetic-installation-refresh" {
				t.Fatal("energy grant changed installation-wide Tesla tokens")
			}
		})
	}
	if result, err := client.ExchangeEnergyReadCode(t.Context(), "synthetic-over-scoped"); result != nil || err == nil {
		t.Fatal("a response granting Energy commands was accepted")
	}
}
