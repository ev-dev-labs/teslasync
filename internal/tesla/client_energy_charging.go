package tesla

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"

	"go.opentelemetry.io/otel/attribute"
)

// GetChargingHistory calls GET /api/1/dx/charging/history with pagination.
// Returns raw response bytes, HTTP status code, and error.
func (c *Client) GetChargingHistory(ctx context.Context, vin string, startTime, endTime string, pageNo, pageSize int) (respBody []byte, statusCode int, err error) {
	ctx, span := startSpan(ctx, "tesla.GetChargingHistory",
		attribute.String("tesla.vehicle.vin", vin),
		attribute.Int("tesla.page.no", pageNo),
		attribute.Int("tesla.page.size", pageSize),
	)
	defer endSpan(span, &err)

	params := url.Values{}
	if vin != "" {
		params.Set("vin", vin)
	}
	if startTime != "" {
		params.Set("startTime", startTime)
	}
	if endTime != "" {
		params.Set("endTime", endTime)
	}
	params.Set("pageNo", strconv.Itoa(pageNo))
	params.Set("pageSize", strconv.Itoa(pageSize))
	// Tesla's sort-field allowlist is not stable; omit optional server-side
	// sorting and let the repository/page order the persisted results.

	path := "/api/1/dx/charging/history?" + params.Encode()
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetChargingInvoice calls GET /api/1/dx/charging/invoice/{contentID} and returns the PDF bytes.
func (c *Client) GetChargingInvoice(ctx context.Context, contentID string) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/dx/charging/invoice/%s", contentID)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetChargingSessions calls GET /api/1/dx/charging/sessions (business accounts only).
// Returns raw response bytes, HTTP status code, and error.
func (c *Client) GetChargingSessions(ctx context.Context, vin, dateFrom, dateTo string, limit, offset int) ([]byte, int, error) {
	params := url.Values{}
	if vin != "" {
		params.Set("vin", vin)
	}
	if dateFrom != "" {
		params.Set("date_from", dateFrom)
	}
	if dateTo != "" {
		params.Set("date_to", dateTo)
	}
	params.Set("limit", strconv.Itoa(limit))
	params.Set("offset", strconv.Itoa(offset))

	path := "/api/1/dx/charging/sessions?" + params.Encode()
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetProducts calls GET /api/1/products to fetch the user's vehicles and energy products.
func (c *Client) GetProducts(ctx context.Context) ([]byte, int, error) {
	return c.doRequest(ctx, http.MethodGet, "/api/1/products", nil)
}

// GetEnergySiteCalendarHistory calls GET /api/1/energy_sites/{id}/calendar_history.
// kind: "backup" or "energy". period: "day", "week", "month", "year".
// Dates are ISO 8601 (YYYY-MM-DD). timeZone is IANA (e.g. "America/Los_Angeles").
func (c *Client) GetEnergySiteCalendarHistory(ctx context.Context, energySiteID int64, kind, startDate, endDate, period, timeZone string) ([]byte, int, error) {
	params := url.Values{}
	params.Set("kind", kind)
	params.Set("start_date", startDate)
	params.Set("end_date", endDate)
	params.Set("period", period)
	params.Set("time_zone", timeZone)

	path := fmt.Sprintf("/api/1/energy_sites/%d/calendar_history?%s", energySiteID, params.Encode())
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetEnergySiteTelemetryHistory calls GET /api/1/energy_sites/{id}/telemetry_history.
// kind: "charge" for wall connector history. Dates are ISO 8601 (YYYY-MM-DD).
func (c *Client) GetEnergySiteTelemetryHistory(ctx context.Context, energySiteID int64, kind, startDate, endDate, timeZone string) ([]byte, int, error) {
	params := url.Values{}
	params.Set("kind", kind)
	params.Set("start_date", startDate)
	params.Set("end_date", endDate)
	params.Set("time_zone", timeZone)

	path := fmt.Sprintf("/api/1/energy_sites/%d/telemetry_history?%s", energySiteID, params.Encode())
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetEnergySiteLiveStatus calls GET /api/1/energy_sites/{id}/live_status.
// Returns real-time power flow data for a Powerwall/Solar site.
func (c *Client) GetEnergySiteLiveStatus(ctx context.Context, energySiteID int64) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/energy_sites/%d/live_status", energySiteID)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// GetEnergySiteInfo calls GET /api/1/energy_sites/{id}/site_info.
// Returns detailed site configuration: components, backup reserve, operation mode, firmware version.
func (c *Client) GetEnergySiteInfo(ctx context.Context, energySiteID int64) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/energy_sites/%d/site_info", energySiteID)
	return c.doRequest(ctx, http.MethodGet, path, nil)
}

// SetEnergySiteTOUSettings calls POST /api/1/energy_sites/{id}/time_of_use_settings.
// Updates the utility rate plan / tariff for a Powerwall site's time-of-use schedule.
// The body should contain the full tou_settings JSON envelope as expected by the Tesla API.
func (c *Client) SetEnergySiteTOUSettings(ctx context.Context, energySiteID int64, body io.Reader) ([]byte, int, error) {
	path := fmt.Sprintf("/api/1/energy_sites/%d/time_of_use_settings", energySiteID)
	return c.doRequest(ctx, http.MethodPost, path, body)
}
