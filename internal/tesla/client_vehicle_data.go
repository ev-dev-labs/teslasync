package tesla

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"go.opentelemetry.io/otel/attribute"
)

const (
	vehicleSpecsRouteTemplate    = "/api/1/vehicles/{vin}/specs"
	enterpriseRolesRouteTemplate = "/api/1/dx/enterprise/v1/{vin}/roles"
	enterprisePayerRouteTemplate = "/api/1/dx/enterprise/v1/{vin}/payer"
	vehiclePricingPath           = "/api/1/dx/vehicles/pricing"
)

// JSONRequestObject is an opaque, non-empty JSON object accepted by Tesla
// endpoints whose request schema is not publicly documented. RawMessage
// values preserve nested JSON without resorting to map[string]interface{}.
type JSONRequestObject map[string]json.RawMessage

// ErrEmptyJSONRequestObject is returned before token acquisition or any Fleet
// API call when an opaque request object contains no fields.
var ErrEmptyJSONRequestObject = errors.New("Tesla request payload must be a non-empty JSON object")

// GetNearbyChargingSites returns charging sites near the vehicle's current location.
// GET /api/1/vehicles/{vin}/nearby_charging_sites
func (c *Client) GetNearbyChargingSites(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/nearby_charging_sites", vin)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetReleaseNotes returns firmware release notes for a vehicle.
// GET /api/1/vehicles/{vin}/release_notes
func (c *Client) GetReleaseNotes(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/release_notes", vin)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetRecentAlerts returns recent vehicle alerts (recalls, service reminders).
// GET /api/1/vehicles/{vin}/recent_alerts
func (c *Client) GetRecentAlerts(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/recent_alerts", vin)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetServiceData returns service history and status for a vehicle.
// GET /api/1/vehicles/{vin}/service_data
func (c *Client) GetServiceData(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/service_data", vin)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetFleetStatus provides vehicle state information (firmware, telemetry version, etc.).
// POST /api/1/vehicles/fleet_status
func (c *Client) GetFleetStatus(ctx context.Context, vins []string) ([]byte, int, error) {
	body, _ := json.Marshal(map[string]interface{}{"vins": vins})
	return c.doRequest(ctx, http.MethodPost, "/api/1/vehicles/fleet_status", bytes.NewReader(body))
}

// GetMobileEnabled calls GET /api/1/vehicles/{vin}/mobile_enabled.
func (c *Client) GetMobileEnabled(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/mobile_enabled", vin)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetVehicleOptions calls GET /api/1/dx/vehicles/options?vin={vin}.
func (c *Client) GetVehicleOptions(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/dx/vehicles/options?vin=%s", url.QueryEscape(vin))
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetVehicleSpecs calls GET /api/1/vehicles/{vin}/specs using a partner token.
// NOTE: This endpoint costs $0.10 per successful call — cache aggressively.
func (c *Client) GetVehicleSpecs(ctx context.Context, vin string) (body []byte, status int, err error) {
	ctx, span := startSpan(ctx, "tesla.GetVehicleSpecs")
	defer endSpan(span, &err)

	partnerToken, err := c.getPartnerToken(ctx, partnerScopeVehicleSpecs)
	if err != nil {
		return nil, partnerTokenStatus(err), fmt.Errorf("get vehicle specs partner token: %w", err)
	}
	path := fmt.Sprintf("/api/1/vehicles/%s/specs", url.PathEscape(vin))
	return c.doPrivateRequestWithToken(
		ctx,
		http.MethodGet,
		path,
		nil,
		partnerToken,
		vehicleSpecsRouteTemplate,
	)
}

// GetSubscriptionEligibility calls GET /api/1/dx/vehicles/subscriptions/eligibility?vin={vin}.
func (c *Client) GetSubscriptionEligibility(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/dx/vehicles/subscriptions/eligibility?vin=%s", url.QueryEscape(vin))
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetUpgradeEligibility calls GET /api/1/dx/vehicles/upgrades/eligibility?vin={vin}.
func (c *Client) GetUpgradeEligibility(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/dx/vehicles/upgrades/eligibility?vin=%s", url.QueryEscape(vin))
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetWarrantyDetails calls GET /api/1/dx/warranty/details?vin={vin}.
func (c *Client) GetWarrantyDetails(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/dx/warranty/details?vin=%s", url.QueryEscape(vin))
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetVehiclePricing calls POST /api/1/dx/vehicles/pricing with an opaque
// Tesla-controlled request object and the vehicle_pricing_info partner scope.
// The endpoint is a read-only query despite using POST.
func (c *Client) GetVehiclePricing(
	ctx context.Context,
	payload JSONRequestObject,
) (body []byte, status int, err error) {
	ctx, span := startSpan(ctx, "tesla.GetVehiclePricing")
	defer endSpan(span, &err)

	requestBody, err := marshalJSONRequestObject(payload)
	if err != nil {
		return nil, 0, err
	}
	partnerToken, err := c.getPartnerToken(ctx, partnerScopeVehiclePricing)
	if err != nil {
		return nil, partnerTokenStatus(err), fmt.Errorf("get vehicle pricing partner token: %w", err)
	}
	return c.doPrivateRequestWithToken(
		ctx,
		http.MethodPost,
		vehiclePricingPath,
		bytes.NewReader(requestBody),
		partnerToken,
		vehiclePricingPath,
	)
}

// GetEnterpriseRoles calls GET /api/1/dx/enterprise/v1/{vin}/roles with the
// enterprise_management partner scope.
func (c *Client) GetEnterpriseRoles(ctx context.Context, vin string) (body []byte, status int, err error) {
	ctx, span := startSpan(ctx, "tesla.GetEnterpriseRoles")
	defer endSpan(span, &err)

	partnerToken, err := c.getPartnerToken(ctx, partnerScopeEnterpriseManagement)
	if err != nil {
		return nil, partnerTokenStatus(err), fmt.Errorf("get enterprise roles partner token: %w", err)
	}
	path := fmt.Sprintf("/api/1/dx/enterprise/v1/%s/roles", url.PathEscape(vin))
	return c.doPrivateRequestWithToken(
		ctx,
		http.MethodGet,
		path,
		nil,
		partnerToken,
		enterpriseRolesRouteTemplate,
	)
}

// SetEnterprisePayer calls POST /api/1/dx/enterprise/v1/{vin}/payer with an
// opaque Tesla-controlled object. Callers must enforce explicit confirmation
// before invoking this state-changing operation.
func (c *Client) SetEnterprisePayer(
	ctx context.Context,
	vin string,
	payload JSONRequestObject,
) (body []byte, status int, err error) {
	ctx, span := startSpan(ctx, "tesla.SetEnterprisePayer")
	defer endSpan(span, &err)

	requestBody, err := marshalJSONRequestObject(payload)
	if err != nil {
		return nil, 0, err
	}
	partnerToken, err := c.getPartnerToken(ctx, partnerScopeEnterpriseManagement)
	if err != nil {
		return nil, partnerTokenStatus(err), fmt.Errorf("get enterprise payer partner token: %w", err)
	}
	path := fmt.Sprintf("/api/1/dx/enterprise/v1/%s/payer", url.PathEscape(vin))
	return c.doPrivateRequestWithToken(
		ctx,
		http.MethodPost,
		path,
		bytes.NewReader(requestBody),
		partnerToken,
		enterprisePayerRouteTemplate,
	)
}

func marshalJSONRequestObject(payload JSONRequestObject) ([]byte, error) {
	if len(payload) == 0 {
		return nil, ErrEmptyJSONRequestObject
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode Tesla request object: %w", err)
	}
	return body, nil
}

// ListVehicles returns all vehicles associated with the authenticated Tesla account.
func (c *Client) ListVehicles(ctx context.Context) ([]VehicleData, error) {
	data, status, err := c.doRequest(ctx, http.MethodGet, "/api/1/vehicles", nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("list vehicles: status %d", status)
	}

	var resp struct {
		Response []VehicleData `json:"response"`
		Count    int           `json:"count"`
	}
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("decode vehicles: %w", err)
	}
	return resp.Response, nil
}

// GetVehicleData returns the full snapshot of a vehicle's charge, climate,
// drive, and config state. Returns ErrVehicleAsleep if the vehicle cannot
// be reached (408/504). The optional endpoints parameter specifies which
// vehicle_data sub-endpoints to request; if empty, all endpoints are requested.
func (c *Client) GetVehicleData(ctx context.Context, vin string, endpoints ...string) (out *VehicleDataResponse, err error) {
	ctx, span := startSpan(ctx, "tesla.GetVehicleData",
		attribute.String("tesla.vehicle.vin", vin),
		attribute.Int("tesla.vehicle_data.endpoints", len(endpoints)),
	)
	defer endSpan(span, &err)

	epStr := "charge_state;climate_state;drive_state;location_data;vehicle_state;vehicle_config"
	if len(endpoints) > 0 {
		epStr = strings.Join(endpoints, ";")
	}
	path := fmt.Sprintf("/api/1/vehicles/%s/vehicle_data?endpoints=%s", vin, epStr)
	data, status, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	if status == http.StatusRequestTimeout || status == http.StatusGatewayTimeout {
		return nil, ErrVehicleAsleep
	}
	if status == http.StatusTooManyRequests {
		return nil, ErrRateLimited
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("get vehicle data: status %d", status)
	}

	var resp struct {
		Response VehicleDataResponse `json:"response"`
	}
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("decode vehicle data: %w", err)
	}
	return &resp.Response, nil
}

// WakeUp wakes a vehicle.
func (c *Client) WakeUp(ctx context.Context, vin string) error {
	path := fmt.Sprintf("/api/1/vehicles/%s/wake_up", vin)
	_, status, err := c.doRequest(ctx, http.MethodPost, path, nil)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("wake up: status %d", status)
	}
	return nil
}
