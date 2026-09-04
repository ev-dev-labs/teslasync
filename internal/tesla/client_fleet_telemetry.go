package tesla

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"go.opentelemetry.io/otel/attribute"
)

// SubscribeFleetTelemetry configures vehicles to connect to a self-hosted fleet-telemetry server.
// This endpoint must be called through the Vehicle Command HTTP Proxy for signing.
// POST /api/1/vehicles/fleet_telemetry_config
func (c *Client) SubscribeFleetTelemetry(ctx context.Context, config FleetTelemetrySubscription) (respBody []byte, statusCode int, err error) {
	ctx, span := startSpan(ctx, "tesla.SubscribeFleetTelemetry",
		attribute.Int("tesla.fleet_telemetry.vin_count", len(config.VINs)),
	)
	defer endSpan(span, &err)

	body, err := json.Marshal(config)
	if err != nil {
		return nil, 0, fmt.Errorf("marshal fleet telemetry config: %w", err)
	}
	path := "/api/1/vehicles/fleet_telemetry_config"
	if c.commandProxyURL != "" {
		return c.doProxyRequestWithResponse(ctx, http.MethodPost, path, bytes.NewReader(body))
	}
	return c.doRequest(ctx, http.MethodPost, path, bytes.NewReader(body))
}

// GetFleetTelemetryConfig fetches a vehicle's fleet telemetry configuration.
// GET /api/1/vehicles/{vin}/fleet_telemetry_config
func (c *Client) GetFleetTelemetryConfig(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/fleet_telemetry_config", vin)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// DeleteFleetTelemetryConfig removes fleet telemetry configuration from a vehicle.
// DELETE /api/1/vehicles/{vin}/fleet_telemetry_config
func (c *Client) DeleteFleetTelemetryConfig(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/fleet_telemetry_config", vin)
	return c.doRequest(ctx, http.MethodDelete, path, nil)
}

// GetFleetTelemetryErrors returns recent fleet telemetry errors for a vehicle.
// GET /api/1/vehicles/{vin}/fleet_telemetry_errors
func (c *Client) GetFleetTelemetryErrors(ctx context.Context, vin string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/vehicles/%s/fleet_telemetry_errors", vin)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetFleetTelemetryErrorVINs calls GET /api/1/partner_accounts/fleet_telemetry_error_vins
// using a partner token. Returns VINs with telemetry errors across the entire fleet.
func (c *Client) GetFleetTelemetryErrorVINs(ctx context.Context) ([]byte, int, error) {
	partnerToken, err := c.GetPartnerToken(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("get partner token: %w", err)
	}
	return c.doRequestWithToken(ctx, http.MethodGet, "/api/1/partner_accounts/fleet_telemetry_error_vins", nil, partnerToken)
}

// GetPartnerFleetTelemetryErrors calls GET /api/1/partner_accounts/fleet_telemetry_errors
// using a partner token. Returns detailed error logs across the entire fleet.
func (c *Client) GetPartnerFleetTelemetryErrors(ctx context.Context) ([]byte, int, error) {
	partnerToken, err := c.GetPartnerToken(ctx)
	if err != nil {
		return nil, 0, fmt.Errorf("get partner token: %w", err)
	}
	return c.doRequestWithToken(ctx, http.MethodGet, "/api/1/partner_accounts/fleet_telemetry_errors", nil, partnerToken)
}

// FleetTelemetrySubscription is the configuration payload for fleet telemetry.
type FleetTelemetrySubscription struct {
	VINs   []string                    `json:"vins"`
	Config FleetTelemetryConfigPayload `json:"config"`
}

// FleetTelemetryConfigPayload describes the streaming server and fields to subscribe.
type FleetTelemetryConfigPayload struct {
	Hostname   string                         `json:"hostname"`
	CA         *string                        `json:"ca,omitempty"`
	Fields     map[string]FleetTelemetryField `json:"fields"`
	AlertTypes []string                       `json:"alert_types,omitempty"`
	Port       int                            `json:"port"`
	Exp        int64                          `json:"exp,omitempty"`
}

// FleetTelemetryField describes a single telemetry field subscription.
type FleetTelemetryField struct {
	IntervalSeconds int      `json:"interval_seconds"`
	MinimumDelta    *float64 `json:"minimum_delta,omitempty"`
	IncludeFields   []string `json:"include_fields,omitempty"`
}
