package geocoding

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
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
		httpClient: httputil.NewClient(httputil.ClientConfig{
			Name:          "geocoder-google",
			Timeout:       config.HTTPClientTimeout,
			Sink:          currentGeoSink(),
			EnableLogging: true,
		}),
		apiKey: apiKey,
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

	// results[0] is the most precise address match. A point-of-interest, when
	// Google knows one, arrives as a *separate* result, so scan the rest for a
	// name rather than losing it.
	res := parseGoogleResult(&gResp.Results[0])
	if res.Name == "" {
		res.Name = googlePOIName(gResp.Results)
	}
	return res, nil
}

// googlePOIName returns the first point-of-interest / premise label found
// across the result set, or "" when Google reported only street addresses.
func googlePOIName(results []googleResult) string {
	for i := range results {
		for _, comp := range results[i].AddressComponents {
			for _, t := range comp.Types {
				if t == "point_of_interest" || t == "establishment" || t == "premise" {
					return comp.LongName
				}
			}
		}
	}
	return ""
}

// parseGoogleResult converts a Google result to a GeoResult.
func parseGoogleResult(r *googleResult) *GeoResult {
	result := &GeoResult{
		DisplayName: r.FormattedAddress,
	}

	for _, comp := range r.AddressComponents {
		for _, t := range comp.Types {
			switch t {
			case "point_of_interest", "establishment", "premise":
				if result.Name == "" {
					result.Name = comp.LongName
				}
			case "street_number":
				result.HouseNumber = comp.LongName
			case "route":
				result.Road = comp.LongName
			case "neighborhood", "sublocality", "sublocality_level_1":
				if result.Suburb == "" {
					result.Suburb = comp.LongName
				}
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
