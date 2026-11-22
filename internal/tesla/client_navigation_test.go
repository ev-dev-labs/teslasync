package tesla

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

func permitNavigation(context.Context) error { return nil }

func enableSmartNavigation(c *Client) *smartFleetControls {
	return enableSmartTestEndpoints(c, "vehicles.connectivity", "vehicles.wake_up", "command.navigation_request")
}

func TestSendNavigationAddressUsesPrivateSingleAttempt(t *testing.T) {
	const vin = "SYNTHETICVEHICLE1"
	const address = "100 Synthetic Way"
	const dispatch = "/api/1/vehicles/" + vin + "/command/navigation_request"
	for _, test := range []struct {
		name string
		body string
		code int
		want NavigationOutcome
	}{
		{"accepted", `{"response":{"result":true,"reason":""}}`, http.StatusOK, NavigationAccepted},
		{"explicit rejection", `{"response":{"result":false,"reason":"100 Synthetic Way"}}`, http.StatusOK, NavigationRejected},
		{"ambiguous success", `{"response":{}}`, http.StatusOK, NavigationUnknown},
		{"conflicting response", `{"response":{"result":true},"error":"invalid_command"}`, http.StatusOK, NavigationUnknown},
		{"vehicle unavailable", `{"error":"vehicle unavailable"}`, http.StatusRequestTimeout, NavigationUnknown},
		{"gateway timeout", `{"error":"timeout"}`, http.StatusGatewayTimeout, NavigationUnknown},
		{"unauthorized", `{"error":"expired token"}`, http.StatusUnauthorized, NavigationRejected},
		{"redirect", "", http.StatusTemporaryRedirect, NavigationUnknown},
	} {
		t.Run(test.name, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Method != http.MethodPost || r.URL.Path != dispatch || r.Header.Get("Authorization") != "Bearer synthetic-token" {
					t.Errorf("unexpected navigation request %s %s", r.Method, r.URL.Path)
				}
				var fields map[string]json.RawMessage
				err := json.NewDecoder(r.Body).Decode(&fields)
				if err != nil || len(fields) != 3 || string(fields["type"]) != `"share_ext_content_raw"` ||
					string(fields["locale"]) != `"en-US"` || string(fields["value"]) != `{"android.intent.extra.TEXT":"`+address+`"}` {
					t.Errorf("unexpected destination payload: %v %v", fields, err)
				}
				if test.code == http.StatusTemporaryRedirect {
					w.Header().Set("Location", "/must-not-follow")
				}
				w.WriteHeader(test.code)
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()
			client := NewClient(config.TeslaConfig{BaseURL: server.URL, Timeout: time.Second})
			enableSmartNavigation(client)
			client.SetTokens("synthetic-token", "", time.Now().Add(time.Hour))
			var audits int
			client.SetLogCallback(func(method, path string, _ int, request, response []byte, _ int, err error) {
				audits++
				if method != http.MethodPost || !strings.HasSuffix(path, "/vehicles/{vin}/command/navigation_request") ||
					strings.Contains(path, vin) || request != nil || response != nil ||
					(err != nil && (strings.Contains(err.Error(), vin) || strings.Contains(err.Error(), address))) {
					t.Error("navigation audit must not capture identifiers or bodies")
				}
			})
			if got := client.SendNavigationAddress(t.Context(), vin, address, permitNavigation); got != test.want {
				t.Errorf("navigation outcome %s, want %s", got, test.want)
			}
			if calls.Load() != 1 || audits != 1 {
				t.Fatalf("want exactly one request and one sanitized audit, got %d and %d", calls.Load(), audits)
			}
		})
	}
}

func TestNavigationStatusAndWakeAreSeparateFromSending(t *testing.T) {
	const vin = "SYNTHETICVEHICLE1"
	const path = "/api/1/vehicles/" + vin
	requests := make(chan string, 5)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.Method + " " + r.URL.Path
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(`{"response":{"state":"asleep"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"response":{"state":"online"}}`))
	}))
	defer server.Close()
	client := NewClient(config.TeslaConfig{BaseURL: server.URL, Timeout: time.Second})
	controls := enableSmartNavigation(client)
	if got := client.SendNavigationAddress(t.Context(), vin, "100 Synthetic Way", permitNavigation); got != NavigationRejected {
		t.Fatalf("missing authorization returned %s", got)
	}
	client.SetTokens("synthetic-token", "", time.Now().Add(time.Hour))
	if !client.NavigationAllowed(t.Context()) {
		t.Fatal("enabled navigation must use the installation's Fleet endpoint catalog")
	}
	if got := client.SendNavigationAddress(t.Context(), vin, "", permitNavigation); got != NavigationRejected {
		t.Fatalf("invalid destination returned %s", got)
	}
	if got := client.NavigationConnectivity(t.Context(), vin); got != "asleep" {
		t.Fatalf("connectivity = %q", got)
	}
	if state, result := client.RequestNavigationWake(t.Context(), vin, permitNavigation); state != "online" || result != NavigationAccepted {
		t.Fatalf("wake returned %q, %q", state, result)
	}
	if len(requests) != 2 || <-requests != "GET "+path || <-requests != "POST "+path+"/wake_up" {
		t.Fatal("only the explicit status and wake calls may reach Tesla")
	}
	delete(controls.config.SmartEndpoints, "command.navigation_request")
	if client.NavigationAllowed(t.Context()) || client.SendNavigationAddress(t.Context(), vin, "100 Synthetic Way", permitNavigation) != NavigationRejected ||
		len(requests) != 0 {
		t.Fatal("disabled command must hide navigation and prevent requests")
	}
	delete(controls.config.SmartEndpoints, "vehicles.connectivity")
	delete(controls.config.SmartEndpoints, "vehicles.wake_up")
	if client.NavigationConnectivity(t.Context(), vin) != "" {
		t.Fatal("disabled connectivity must not read from Tesla")
	}
	if _, got := client.RequestNavigationWake(t.Context(), vin, permitNavigation); got != NavigationRejected || len(requests) != 0 {
		t.Fatal("disabled wake must not reach Tesla")
	}
}

func TestNavigationLastAdmissionRejectsRevocationAndTokenChange(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("revoked navigation reached Tesla")
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()
	client := NewClient(config.TeslaConfig{BaseURL: server.URL, Timeout: time.Second})
	flags := enableSmartNavigation(client)
	client.SetTokens("synthetic-token", "", time.Now().Add(time.Hour))
	const vin, address = "SYNTHETICVEHICLE1", "100 Synthetic Way"
	if got := client.SendNavigationAddress(t.Context(), vin, address, nil); got != NavigationNotSent {
		t.Errorf("missing admission returned %s", got)
	}
	if _, got := client.RequestNavigationWake(t.Context(), vin, func(context.Context) error {
		return errors.New("synthetic permission revoked")
	}); got != NavigationNotSent {
		t.Errorf("revoked wake returned %s", got)
	}
	if got := client.SendNavigationAddress(t.Context(), vin, address, func(context.Context) error {
		client.SetTokens("new-synthetic-token", "", time.Now().Add(time.Hour))
		return nil
	}); got != NavigationNotSent {
		t.Errorf("changed token returned %s", got)
	}
	if got := client.SendNavigationAddress(t.Context(), vin, address, func(context.Context) error {
		delete(flags.config.SmartEndpoints, "command.navigation_request")
		return nil
	}); got != NavigationRejected {
		t.Errorf("permission revoked during admission returned %s", got)
	}
}

func TestNavigationNetworkTimeoutDoesNotReplay(t *testing.T) {
	var calls atomic.Int32
	received := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		if calls.Add(1) == 1 {
			close(received)
		}
		<-r.Context().Done()
	}))
	defer server.Close()
	client := NewClient(config.TeslaConfig{BaseURL: server.URL, Timeout: 3 * time.Second})
	enableSmartNavigation(client)
	client.SetTokens("synthetic-token", "", time.Now().Add(time.Hour))
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	go func() {
		select {
		case <-received:
			cancel()
		case <-ctx.Done():
		}
	}()
	if got := client.SendNavigationAddress(ctx, "SYNTHETICVEHICLE1", "100 Synthetic Way", permitNavigation); got != NavigationUnknown || calls.Load() != 1 {
		t.Fatalf("interrupted dispatch must not replay or report success: %s (%d calls)", got, calls.Load())
	}
}
