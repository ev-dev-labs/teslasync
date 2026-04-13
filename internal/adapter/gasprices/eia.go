package gasprices

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/port/external"
)

// defaultGallonToKWhFactor converts a gallon price to kWh-equivalent cost.
// Based on average gas car efficiency (~25 MPG) vs average EV efficiency
// (~3.5 mi/kWh): 25 / 3.5 ≈ 7.14 kWh-equivalent per gallon.
const defaultGallonToKWhFactor = 7.14

const defaultEIABaseURL = "https://api.eia.gov/v2/petroleum/pri/gnd/data/"

// eiaResponse models the JSON returned by the EIA petroleum price API.
type eiaResponse struct {
	Response struct {
		Data []struct {
			Value  string `json:"value"`
			Period string `json:"period"`
		} `json:"data"`
	} `json:"response"`
}

// EIAAdapter implements external.GasPriceProvider using the US Energy
// Information Administration (EIA) API for gasoline/electricity prices.
type EIAAdapter struct {
	apiKey      string
	httpClient  *http.Client
	baseURL     string
	gallonToKWh float64
	cacheTTL    time.Duration

	mu          sync.RWMutex
	cachedPrice *external.EnergyPrice
	cachedAt    time.Time
}

// Option configures the EIA adapter.
type Option func(*EIAAdapter)

// WithCacheTTL sets the cache duration. Default is 1 hour.
func WithCacheTTL(d time.Duration) Option {
	return func(a *EIAAdapter) { a.cacheTTL = d }
}

// WithGallonToKWhFactor sets the gallon-to-kWh conversion factor. Default is 7.14.
func WithGallonToKWhFactor(f float64) Option {
	return func(a *EIAAdapter) { a.gallonToKWh = f }
}

// WithHTTPClient overrides the default HTTP client.
func WithHTTPClient(c *http.Client) Option {
	return func(a *EIAAdapter) { a.httpClient = c }
}

// WithBaseURL overrides the EIA API base URL (useful for testing).
func WithBaseURL(url string) Option {
	return func(a *EIAAdapter) { a.baseURL = url }
}

// NewEIAAdapter creates a new EIA adapter with the given API key.
func NewEIAAdapter(apiKey string, opts ...Option) *EIAAdapter {
	a := &EIAAdapter{
		apiKey:      apiKey,
		httpClient:  &http.Client{Timeout: 10 * time.Second},
		baseURL:     defaultEIABaseURL,
		gallonToKWh: defaultGallonToKWhFactor,
		cacheTTL:    time.Hour,
	}
	for _, opt := range opts {
		opt(a)
	}
	return a
}

// GetCurrentPrice fetches the latest US gasoline price from the EIA API
// and converts it to a kWh-equivalent cost.
func (a *EIAAdapter) GetCurrentPrice(ctx context.Context, region string) (*external.EnergyPrice, error) {
	// Check cache first
	a.mu.RLock()
	if a.cachedPrice != nil && time.Since(a.cachedAt) < a.cacheTTL {
		cached := *a.cachedPrice
		a.mu.RUnlock()
		return &cached, nil
	}
	a.mu.RUnlock()

	price, err := a.fetchFromEIA(ctx, region)
	if err != nil {
		return nil, err
	}

	// Update cache
	a.mu.Lock()
	a.cachedPrice = price
	a.cachedAt = time.Now()
	a.mu.Unlock()

	return price, nil
}

// fetchFromEIA performs the actual HTTP request to the EIA API.
func (a *EIAAdapter) fetchFromEIA(ctx context.Context, region string) (*external.EnergyPrice, error) {
	url := fmt.Sprintf(
		"%s?api_key=%s&frequency=weekly&data[]=value&facets[product][]=EPMR&facets[duoarea][]=NUS&sort[0][column]=period&sort[0][direction]=desc&length=1",
		a.baseURL, a.apiKey,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("eia: create request: %w", err)
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("eia: request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("eia: non-200 response (%d): %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return nil, fmt.Errorf("eia: read body: %w", err)
	}

	var eia eiaResponse
	if err := json.Unmarshal(body, &eia); err != nil {
		return nil, fmt.Errorf("eia: parse response: %w", err)
	}

	if len(eia.Response.Data) == 0 {
		return nil, fmt.Errorf("eia: empty data in response")
	}

	gallonPrice, err := strconv.ParseFloat(eia.Response.Data[0].Value, 64)
	if err != nil {
		return nil, fmt.Errorf("eia: parse price value %q: %w", eia.Response.Data[0].Value, err)
	}

	kwhPrice := gallonPrice / a.gallonToKWh

	if region == "" {
		region = "US"
	}

	log.Debug().
		Float64("gallon_price", gallonPrice).
		Float64("kwh_price", kwhPrice).
		Str("region", region).
		Str("period", eia.Response.Data[0].Period).
		Msg("eia adapter: fetched price")

	return &external.EnergyPrice{
		PricePerKWh: kwhPrice,
		Currency:    "USD",
		Region:      region,
	}, nil
}
