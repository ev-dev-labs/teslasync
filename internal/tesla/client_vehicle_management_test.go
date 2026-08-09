package tesla

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

type vehicleManagementRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn vehicleManagementRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

type capturedManagementRequest struct {
	method        string
	host          string
	path          string
	authorization string
	body          string
}

type capturedAuditCall struct {
	url      string
	reqBody  []byte
	respBody []byte
	status   int
}

func newVehicleManagementClient(
	t *testing.T,
	tokenStatus int,
	apiStatus int,
) (*Client, *[]capturedManagementRequest) {
	t.Helper()

	requests := []capturedManagementRequest{}
	client := NewClient(config.TeslaConfig{
		BaseURL:      "https://fleet-api.prd.na.vn.cloud.tesla.com",
		AuthURL:      "https://auth.tesla.com",
		ClientID:     "partner-client",
		ClientSecret: "partner-secret",
		RedirectURI:  "https://example.test/callback",
		Timeout:      5 * time.Second,
	})
	client.httpClient = &http.Client{
		Timeout: 5 * time.Second,
		Transport: vehicleManagementRoundTripFunc(func(req *http.Request) (*http.Response, error) {
			var body []byte
			if req.Body != nil {
				var err error
				body, err = io.ReadAll(req.Body)
				if err != nil {
					t.Fatalf("read outbound body: %v", err)
				}
			}
			requests = append(requests, capturedManagementRequest{
				method:        req.Method,
				host:          req.URL.Host,
				path:          req.URL.RequestURI(),
				authorization: req.Header.Get("Authorization"),
				body:          string(body),
			})

			status := apiStatus
			responseBody := `{"response":{"ok":true}}`
			if req.URL.Path == "/oauth2/v3/token" {
				status = tokenStatus
				responseBody = `{"access_token":"scoped-partner-token"}`
				if status != http.StatusOK {
					responseBody = `{"error":"sensitive-token-detail"}`
				}
			}
			return &http.Response{
				StatusCode: status,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(responseBody)),
				Request:    req,
			}, nil
		}),
	}
	return client, &requests
}

func TestVehicleManagementPartnerCallsUseExactScopeMethodPathAndBody(t *testing.T) {
	payload := JSONRequestObject{
		"opaque": json.RawMessage(`{"nested":[1,true]}`),
	}
	tests := []struct {
		name       string
		scope      string
		method     string
		path       string
		wantBody   JSONRequestObject
		invokeCall func(context.Context, *Client) ([]byte, int, error)
	}{
		{
			name:   "paid specs",
			scope:  "vehicle_specs",
			method: http.MethodGet,
			path:   "/api/1/vehicles/TESTVIN/specs",
			invokeCall: func(ctx context.Context, client *Client) ([]byte, int, error) {
				return client.GetVehicleSpecs(ctx, "TESTVIN")
			},
		},
		{
			name:     "vehicle pricing",
			scope:    "vehicle_pricing_info",
			method:   http.MethodPost,
			path:     "/api/1/dx/vehicles/pricing",
			wantBody: payload,
			invokeCall: func(ctx context.Context, client *Client) ([]byte, int, error) {
				return client.GetVehiclePricing(ctx, payload)
			},
		},
		{
			name:   "enterprise roles",
			scope:  "enterprise_management",
			method: http.MethodGet,
			path:   "/api/1/dx/enterprise/v1/TESTVIN/roles",
			invokeCall: func(ctx context.Context, client *Client) ([]byte, int, error) {
				return client.GetEnterpriseRoles(ctx, "TESTVIN")
			},
		},
		{
			name:     "enterprise payer",
			scope:    "enterprise_management",
			method:   http.MethodPost,
			path:     "/api/1/dx/enterprise/v1/TESTVIN/payer",
			wantBody: payload,
			invokeCall: func(ctx context.Context, client *Client) ([]byte, int, error) {
				return client.SetEnterprisePayer(ctx, "TESTVIN", payload)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, requests := newVehicleManagementClient(t, http.StatusOK, http.StatusOK)
			auditCalls := []capturedAuditCall{}
			client.SetLogCallback(func(_ string, requestURL string, statusCode int, reqBody, respBody []byte, _ int, _ error) {
				auditCalls = append(auditCalls, capturedAuditCall{
					url:      requestURL,
					reqBody:  reqBody,
					respBody: respBody,
					status:   statusCode,
				})
			})

			_, status, err := tt.invokeCall(context.Background(), client)
			if err != nil {
				t.Fatalf("call returned error: %v", err)
			}
			if status != http.StatusOK {
				t.Fatalf("status = %d, want 200", status)
			}
			if len(*requests) != 2 {
				t.Fatalf("requests = %d, want token + API request", len(*requests))
			}

			tokenReq := (*requests)[0]
			if tokenReq.method != http.MethodPost || tokenReq.path != "/oauth2/v3/token" {
				t.Fatalf("token request = %s %s", tokenReq.method, tokenReq.path)
			}
			form, err := url.ParseQuery(tokenReq.body)
			if err != nil {
				t.Fatalf("parse token form: %v", err)
			}
			if got := form.Get("scope"); got != tt.scope {
				t.Fatalf("scope = %q, want %q", got, tt.scope)
			}

			apiReq := (*requests)[1]
			if apiReq.method != tt.method || apiReq.path != tt.path {
				t.Fatalf("API request = %s %s, want %s %s", apiReq.method, apiReq.path, tt.method, tt.path)
			}
			if apiReq.authorization != "Bearer scoped-partner-token" {
				t.Fatalf("authorization = %q", apiReq.authorization)
			}
			if tt.wantBody == nil {
				if apiReq.body != "" {
					t.Fatalf("body = %q, want empty", apiReq.body)
				}
			} else {
				var got JSONRequestObject
				if err := json.Unmarshal([]byte(apiReq.body), &got); err != nil {
					t.Fatalf("decode API body: %v", err)
				}
				if !reflect.DeepEqual(got, tt.wantBody) {
					t.Fatalf("body = %#v, want %#v", got, tt.wantBody)
				}
			}

			if len(auditCalls) != 1 {
				t.Fatalf("audit calls = %d, want 1", len(auditCalls))
			}
			if auditCalls[0].status != http.StatusOK {
				t.Fatalf("audit status = %d, want 200", auditCalls[0].status)
			}
			if len(auditCalls[0].reqBody) != 0 || len(auditCalls[0].respBody) != 0 {
				t.Fatal("private management request or response body reached audit callback")
			}
			if strings.Contains(auditCalls[0].url, "TESTVIN") {
				t.Fatalf("VIN reached audit callback URL: %q", auditCalls[0].url)
			}
		})
	}
}

func TestVehicleManagementUserCallsUseExactMethodAndPath(t *testing.T) {
	tests := []struct {
		name       string
		path       string
		invokeCall func(context.Context, *Client) ([]byte, int, error)
	}{
		{
			name: "vehicle options",
			path: "/api/1/dx/vehicles/options?vin=TESTVIN",
			invokeCall: func(ctx context.Context, client *Client) ([]byte, int, error) {
				return client.GetVehicleOptions(ctx, "TESTVIN")
			},
		},
		{
			name: "warranty details",
			path: "/api/1/dx/warranty/details?vin=TESTVIN",
			invokeCall: func(ctx context.Context, client *Client) ([]byte, int, error) {
				return client.GetWarrantyDetails(ctx, "TESTVIN")
			},
		},
		{
			name: "subscription eligibility",
			path: "/api/1/dx/vehicles/subscriptions/eligibility?vin=TESTVIN",
			invokeCall: func(ctx context.Context, client *Client) ([]byte, int, error) {
				return client.GetSubscriptionEligibility(ctx, "TESTVIN")
			},
		},
		{
			name: "upgrade eligibility",
			path: "/api/1/dx/vehicles/upgrades/eligibility?vin=TESTVIN",
			invokeCall: func(ctx context.Context, client *Client) ([]byte, int, error) {
				return client.GetUpgradeEligibility(ctx, "TESTVIN")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, requests := newVehicleManagementClient(t, http.StatusOK, http.StatusOK)
			client.SetTokens("user-access-token", "", time.Now().Add(time.Hour))

			_, status, err := tt.invokeCall(context.Background(), client)
			if err != nil {
				t.Fatalf("call returned error: %v", err)
			}
			if status != http.StatusOK {
				t.Fatalf("status = %d, want 200", status)
			}
			if len(*requests) != 1 {
				t.Fatalf("requests = %d, want one Fleet API request", len(*requests))
			}
			request := (*requests)[0]
			if request.method != http.MethodGet || request.path != tt.path {
				t.Fatalf(
					"API request = %s %s, want GET %s",
					request.method,
					request.path,
					tt.path,
				)
			}
			if request.authorization == "" {
				t.Fatal("user-token request is missing authorization")
			}
		})
	}
}

func TestGetPartnerTokenPreservesDefaultScopesAndUserOAuthScopes(t *testing.T) {
	client, requests := newVehicleManagementClient(t, http.StatusOK, http.StatusOK)

	if _, err := client.GetPartnerToken(context.Background()); err != nil {
		t.Fatalf("GetPartnerToken: %v", err)
	}
	if len(*requests) != 1 {
		t.Fatalf("requests = %d, want 1", len(*requests))
	}
	form, err := url.ParseQuery((*requests)[0].body)
	if err != nil {
		t.Fatalf("parse form: %v", err)
	}
	if got := form.Get("scope"); got != string(partnerScopeDefault) {
		t.Fatalf("default scope = %q, want %q", got, partnerScopeDefault)
	}

	userAuthURL := client.GetAuthURL("state")
	for _, partnerOnly := range []string{
		"vehicle_specs",
		"vehicle_pricing_info",
		"enterprise_management",
	} {
		if strings.Contains(userAuthURL, partnerOnly) {
			t.Fatalf("ordinary user OAuth URL contains partner-only scope %q: %s", partnerOnly, userAuthURL)
		}
	}
}

func TestVehicleManagementClientRejectsEmptyObjectBeforeTokenCall(t *testing.T) {
	client, requests := newVehicleManagementClient(t, http.StatusOK, http.StatusOK)

	_, _, err := client.SetEnterprisePayer(context.Background(), "TESTVIN", JSONRequestObject{})
	if !errors.Is(err, ErrEmptyJSONRequestObject) {
		t.Fatalf("error = %v, want ErrEmptyJSONRequestObject", err)
	}
	if len(*requests) != 0 {
		t.Fatalf("requests = %d, want 0", len(*requests))
	}
}

func TestVehicleManagementClientPreservesNon2xxStatusWithoutBodies(t *testing.T) {
	client, _ := newVehicleManagementClient(t, http.StatusOK, http.StatusForbidden)
	auditCalls := []capturedAuditCall{}
	client.SetLogCallback(func(_ string, requestURL string, statusCode int, reqBody, respBody []byte, _ int, _ error) {
		auditCalls = append(auditCalls, capturedAuditCall{
			url: requestURL, reqBody: reqBody, respBody: respBody, status: statusCode,
		})
	})

	body, status, err := client.GetEnterpriseRoles(context.Background(), "TESTVIN")
	if err != nil {
		t.Fatalf("403 should be returned for handler mapping, got error: %v", err)
	}
	if status != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", status)
	}
	if !strings.Contains(string(body), `"ok"`) {
		t.Fatalf("unexpected response body: %s", body)
	}
	if len(auditCalls) != 1 || len(auditCalls[0].respBody) != 0 {
		t.Fatalf("private non-2xx response reached audit callback: %+v", auditCalls)
	}
}

func TestPartnerTokenFailureStatusFlowsToManagementCaller(t *testing.T) {
	client, requests := newVehicleManagementClient(t, http.StatusForbidden, http.StatusOK)

	_, status, err := client.GetVehiclePricing(
		context.Background(),
		JSONRequestObject{"opaque": json.RawMessage(`true`)},
	)
	if err == nil {
		t.Fatal("expected partner token error")
	}
	if status != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", status)
	}
	if strings.Contains(err.Error(), "sensitive-token-detail") {
		t.Fatalf("partner token response leaked through error: %v", err)
	}
	if len(*requests) != 1 {
		t.Fatalf("requests = %d, want token request only", len(*requests))
	}
}
