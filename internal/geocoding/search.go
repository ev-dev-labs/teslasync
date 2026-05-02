package geocoding

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// SearchResult represents a forward geocoding result.
type SearchResult struct {
	DisplayName string  `json:"display_name"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
}

// nominatimSearchResult represents a single result from the Nominatim search API.
type nominatimSearchResult struct {
	DisplayName string `json:"display_name"`
	Lat         string `json:"lat"`
	Lon         string `json:"lon"`
}

// Searcher provides forward geocoding (address → coordinates).
type Searcher interface {
	Search(ctx context.Context, query string, limit int) ([]SearchResult, error)
}

// NominatimSearcher implements Searcher using OpenStreetMap Nominatim.
type NominatimSearcher struct {
	httpClient *http.Client
	mu         sync.Mutex
	lastCall   time.Time
	userAgent  string
}

// NewSearcher creates a Nominatim-based forward geocoding searcher.
func NewSearcher(userAgent string) Searcher {
	return &NominatimSearcher{
		httpClient: httputil.NewClient(httputil.ClientConfig{
			Name:          "geocoder-search",
			Timeout:       config.HTTPClientTimeout,
			Sink:          currentGeoSink(),
			EnableLogging: true,
		}),
		userAgent: userAgent,
	}
}

// Search returns geocoding results for the given query string.
func (s *NominatimSearcher) Search(ctx context.Context, query string, limit int) ([]SearchResult, error) {
	if query == "" {
		return nil, nil
	}
	if limit <= 0 || limit > 10 {
		limit = 5
	}

	// Rate limit: max 1 request per second per Nominatim usage policy
	s.mu.Lock()
	elapsed := time.Since(s.lastCall)
	if elapsed < time.Second {
		time.Sleep(time.Second - elapsed)
	}
	s.lastCall = time.Now()
	s.mu.Unlock()

	apiURL := fmt.Sprintf(
		"https://nominatim.openstreetmap.org/search?format=json&q=%s&limit=%d&addressdetails=0",
		url.QueryEscape(query), limit,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("nominatim search: create request: %w", err)
	}
	req.Header.Set("User-Agent", s.userAgent)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("nominatim search: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("nominatim search: unexpected status %d", resp.StatusCode)
	}

	var raw []nominatimSearchResult
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("nominatim search: decode: %w", err)
	}

	results := make([]SearchResult, 0, len(raw))
	for _, r := range raw {
		lat, lng := parseLatLng(r.Lat, r.Lon)
		if lat == 0 && lng == 0 {
			continue
		}
		results = append(results, SearchResult{
			DisplayName: r.DisplayName,
			Lat:         lat,
			Lng:         lng,
		})
	}
	return results, nil
}

func parseLatLng(latStr, lngStr string) (float64, float64) {
	var lat, lng float64
	fmt.Sscanf(latStr, "%f", &lat)
	fmt.Sscanf(lngStr, "%f", &lng)
	return lat, lng
}
