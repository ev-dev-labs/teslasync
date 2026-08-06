package geocoding

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// AzureClient implements Geocoder using Azure Maps Search API.
type AzureClient struct {
	apiKey string
	client *http.Client
}

func NewAzureClient(apiKey string) *AzureClient {
	return &AzureClient{
		apiKey: apiKey,
		client: httputil.NewClient(httputil.ClientConfig{
			Name:          "geocoder-azure",
			Timeout:       config.HTTPClientTimeout,
			Sink:          currentGeoSink(),
			EnableLogging: true,
		}),
	}
}

type azureReverseResponse struct {
	Addresses []azureReverseAddress `json:"addresses"`
}

type azureReverseAddress struct {
	Address azureAddress `json:"address"`
}

type azureAddress struct {
	FreeformAddress         string `json:"freeformAddress"`
	StreetNumber            string `json:"streetNumber"`
	StreetName              string `json:"streetName"`
	MunicipalitySubdivision string `json:"municipalitySubdivision"`
	Municipality            string `json:"municipality"`
	CountrySubdivision      string `json:"countrySubdivision"`
	Country                 string `json:"country"`
	PostalCode              string `json:"postalCode"`
}

func (c *AzureClient) ReverseGeocode(ctx context.Context, lat, lon float64) (*GeoResult, error) {
	url := fmt.Sprintf(
		"https://atlas.microsoft.com/search/address/reverse/json?api-version=1.0&query=%f,%f&subscription-key=%s",
		lat, lon, c.apiKey,
	)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("azure geocode request: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("azure geocode: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("azure geocode: status %d", resp.StatusCode)
	}

	var result azureReverseResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("azure geocode decode: %w", err)
	}

	if len(result.Addresses) == 0 {
		return &GeoResult{DisplayName: fmt.Sprintf("%.4f, %.4f", lat, lon)}, nil
	}

	addr := result.Addresses[0].Address
	return &GeoResult{
		DisplayName: addr.FreeformAddress,
		HouseNumber: addr.StreetNumber,
		Road:        addr.StreetName,
		Suburb:      addr.MunicipalitySubdivision,
		City:        addr.Municipality,
		State:       addr.CountrySubdivision,
		Country:     addr.Country,
		PostCode:    addr.PostalCode,
	}, nil
}
