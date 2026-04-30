package geocoding

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// googleResponse is the top-level JSON structure returned by the Google Geocoding API.
type googleResponse struct {
	Results []googleResult `json:"results"`
	Status  string         `json:"status"`
}

type googleResult struct {
	FormattedAddress  string                   `json:"formatted_address"`
	AddressComponents []googleAddressComponent `json:"address_components"`
}

type googleAddressComponent struct {
	LongName string   `json:"long_name"`
	Types    []string `json:"types"`
}

// GoogleClient provides reverse geocoding via the Google Maps Geocoding API.
type GoogleClient struct {
	httpClient *http.Client
	apiKey     string
}

// NewGoogleClient creates a Google Maps geocoding client.
func NewGoogleClient(apiKey string) *GoogleClient {
	return &GoogleClient{
		httpClient: &http.Client{Timeout: config.HTTPClientTimeout},
		apiKey:     apiKey,
	}
}

// ReverseGeocode returns a GeoResult for the given coordinates using Google Maps.
func (c *GoogleClient) ReverseGeocode(ctx context.Context, lat, lon float64) (*GeoResult, error) {
	url := fmt.Sprintf(
		"https://maps.googleapis.com/maps/api/geocode/json?latlng=%.6f,%.6f&key=%s",
		lat, lon, c.apiKey,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("google geocoding: failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("google geocoding: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google geocoding: unexpected status %d", resp.StatusCode)
	}

	var gResp googleResponse
	if err := json.NewDecoder(resp.Body).Decode(&gResp); err != nil {
		return nil, fmt.Errorf("google geocoding: failed to decode response: %w", err)
	}

	if gResp.Status != "OK" || len(gResp.Results) == 0 {
		return nil, fmt.Errorf("google geocoding: status %s, no results", gResp.Status)
	}

	return parseGoogleResult(&gResp.Results[0]), nil
}

// parseGoogleResult converts a Google result to a GeoResult.
func parseGoogleResult(r *googleResult) *GeoResult {
	result := &GeoResult{
		DisplayName: r.FormattedAddress,
	}

	for _, comp := range r.AddressComponents {
		for _, t := range comp.Types {
			switch t {
			case "route":
				result.Road = comp.LongName
			case "locality":
				result.City = comp.LongName
			case "administrative_area_level_1":
				result.State = comp.LongName
			case "country":
				result.Country = comp.LongName
			case "postal_code":
				result.PostCode = comp.LongName
			}
		}
	}

	return result
}
