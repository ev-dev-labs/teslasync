// Package stormguard watches severe weather at each armed vehicle's home
// location (Open-Meteo, keyless) and pre-charges the car before the storm
// hits: when a warning-level forecast is in effect and the battery sits
// below the configured target, the hourly evaluator raises the charge
// limit via the Tesla Fleet API so an outage starts with a full pack.
package stormguard

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// meteoTimeout bounds the Open-Meteo forecast call (project rule:
// external HTTP calls wrap with context.WithTimeout).
const meteoTimeout = 10 * time.Second

// defaultMeteoBase is the keyless Open-Meteo forecast endpoint.
const defaultMeteoBase = "https://api.open-meteo.com/v1/forecast"

// Forecast is the hourly severe-weather signal subset we assess.
type Forecast struct {
	Times      []time.Time
	Weather    []int
	WindGustMS []float64
}

type meteoHourly struct {
	Time        []string  `json:"time"`
	WeatherCode []int     `json:"weathercode"`
	WindGusts   []float64 `json:"windgusts_10m"`
}

type meteoResponse struct {
	Hourly meteoHourly `json:"hourly"`
}

// Client fetches Open-Meteo forecasts. BaseURL and HTTPClient are
// overridable for tests (httptest). Safe for concurrent use.
type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

// NewClient wires a production client.
func NewClient() *Client {
	return &Client{BaseURL: defaultMeteoBase, HTTPClient: http.DefaultClient}
}

// Fetch returns the 48-hour hourly forecast for lat/lng in UTC.
func (c *Client) Fetch(ctx context.Context, lat, lng float64) (*Forecast, error) {
	base := c.BaseURL
	if base == "" {
		base = defaultMeteoBase
	}
	q := url.Values{
		"latitude":      {strconv.FormatFloat(lat, 'f', 5, 64)},
		"longitude":     {strconv.FormatFloat(lng, 'f', 5, 64)},
		"hourly":        {"weathercode,windgusts_10m"},
		"forecast_days": {"3"},
		"timezone":      {"UTC"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"?"+q.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("stormguard: build meteo request: %w", err)
	}
	req.Header.Set("User-Agent", "TeslaSync/1.0")

	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	callCtx, cancel := context.WithTimeout(ctx, meteoTimeout)
	defer cancel()
	resp, err := client.Do(req.WithContext(callCtx))
	if err != nil {
		return nil, fmt.Errorf("stormguard: meteo fetch: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("stormguard: meteo read: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("stormguard: meteo status %d", resp.StatusCode)
	}

	var mr meteoResponse
	if err := json.Unmarshal(raw, &mr); err != nil {
		return nil, fmt.Errorf("stormguard: meteo decode: %w", err)
	}
	n := len(mr.Hourly.Time)
	if len(mr.Hourly.WeatherCode) < n || len(mr.Hourly.WindGusts) < n {
		return nil, fmt.Errorf("stormguard: meteo ragged series (n=%d)", n)
	}
	f := &Forecast{
		Times:      make([]time.Time, 0, n),
		Weather:    make([]int, 0, n),
		WindGustMS: make([]float64, 0, n),
	}
	for i := 0; i < n; i++ {
		ts, err := time.Parse("2006-01-02T15:04", mr.Hourly.Time[i])
		if err != nil {
			return nil, fmt.Errorf("stormguard: meteo time %q: %w", mr.Hourly.Time[i], err)
		}
		f.Times = append(f.Times, ts.UTC())
		f.Weather = append(f.Weather, mr.Hourly.WeatherCode[i])
		f.WindGustMS = append(f.WindGustMS, mr.Hourly.WindGusts[i])
	}
	return f, nil
}
