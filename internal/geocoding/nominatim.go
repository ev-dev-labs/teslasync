package geocoding

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// Outbound api_call_logs sink registry for package geocoding.
//
// All geocoding adapters share a single outbound APICallSink installed once
// at startup via SetSink. Each adapter constructor builds httputil.NewClient
// inline so the service-name literal stays next to the adapter.
//
// Disabled mode (cfg.APILogs.Enabled=false) installs nil; LoggedTransport
// tolerates a nil sink and falls back to zerolog only.

var (
	geoOutboundSinkMu sync.RWMutex
	geoOutboundSink   httputil.APICallSink
)

// SetSink installs the package-level APICallSink that every constructor in
// package geocoding (NewClient, NewGoogleClient, NewAzureClient,
// NewSearcher) reads when building its *http.Client. cmd/teslasync/main.go
// must call this BEFORE constructing any geocoder so the first request
// already routes through LoggedTransport's tee.
func SetSink(sink httputil.APICallSink) {
	geoOutboundSinkMu.Lock()
	geoOutboundSink = sink
	geoOutboundSinkMu.Unlock()
}

// currentGeoSink returns the most recently installed sink under the
// package-level RWMutex so each constructor's inline httputil.NewClient
// call captures the current value into its adapter.
func currentGeoSink() httputil.APICallSink {
	geoOutboundSinkMu.RLock()
	defer geoOutboundSinkMu.RUnlock()
	return geoOutboundSink
}

// NominatimResult represents the JSON response from Nominatim reverse geocoding.
type NominatimResult struct {
	DisplayName string `json:"display_name"`
	// Name carries the POI label ("Costco Wholesale") when the matched OSM
	// element is a named feature rather than a bare road segment.
	Name    string           `json:"name"`
	Address NominatimAddress `json:"address"`
}

type NominatimAddress struct {
	Amenity       string `json:"amenity"`
	Shop          string `json:"shop"`
	Building      string `json:"building"`
	HouseNumber   string `json:"house_number"`
	Road          string `json:"road"`
	Neighbourhood string `json:"neighbourhood"`
	Suburb        string `json:"suburb"`
	City          string `json:"city"`
	Town          string `json:"town"`
	Village       string `json:"village"`
	County        string `json:"county"`
	State         string `json:"state"`
	Country       string `json:"country"`
	PostCode      string `json:"postcode"`
}

// Client provides reverse geocoding via OpenStreetMap Nominatim (free, no API key).
type Client struct {
	httpClient *http.Client
	mu         sync.Mutex
	lastCall   time.Time
	userAgent  string
}

// NewClient creates a Nominatim client that respects the 1 req/sec rate limit.
func NewClient(userAgent string) *Client {
	return &Client{
		httpClient: httputil.NewClient(httputil.ClientConfig{
			Name:          "geocoder-nominatim",
			Timeout:       config.HTTPClientTimeout,
			Sink:          currentGeoSink(),
			EnableLogging: true,
		}),
		userAgent: userAgent,
	}
}

// ReverseGeocode returns a GeoResult for the given coordinates (implements Geocoder).
func (c *Client) ReverseGeocode(ctx context.Context, lat, lon float64) (*GeoResult, error) {
	// Rate limit: max 1 request per second per Nominatim usage policy
	c.mu.Lock()
	elapsed := time.Since(c.lastCall)
	if elapsed < time.Second {
		time.Sleep(time.Second - elapsed)
	}
	c.lastCall = time.Now()
	c.mu.Unlock()

	url := fmt.Sprintf(
		"https://nominatim.openstreetmap.org/reverse?format=json&lat=%.6f&lon=%.6f&zoom=18&addressdetails=1",
		lat, lon,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("nominatim: failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", c.userAgent)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("nominatim: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("nominatim: unexpected status %d", resp.StatusCode)
	}

	var raw NominatimResult
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("nominatim: failed to decode response: %w", err)
	}

	return raw.toGeoResult(), nil
}

// toGeoResult converts a NominatimResult to the common GeoResult type.
func (r *NominatimResult) toGeoResult() *GeoResult {
	a := r.Address
	city := a.City
	if city == "" {
		city = a.Town
	}
	if city == "" {
		city = a.Village
	}

	// A named feature can arrive either as the top-level `name` or, with
	// addressdetails=1, as the amenity/shop/building tag that matched.
	name := r.Name
	if name == "" {
		name = a.Amenity
	}
	if name == "" {
		name = a.Shop
	}
	if name == "" {
		name = a.Building
	}

	suburb := a.Neighbourhood
	if suburb == "" {
		suburb = a.Suburb
	}

	return &GeoResult{
		DisplayName: r.DisplayName,
		Name:        name,
		HouseNumber: a.HouseNumber,
		Road:        a.Road,
		Suburb:      suburb,
		City:        city,
		State:       a.State,
		Country:     a.Country,
		PostCode:    a.PostCode,
	}
}

// ShortName returns a short, human-readable location name from the result.
// It delegates to GeoResult.ShortName so provider-specific and canonical
// results can never drift into two different labelling rules.
func (r *NominatimResult) ShortName() string {
	return r.toGeoResult().ShortName()
}
