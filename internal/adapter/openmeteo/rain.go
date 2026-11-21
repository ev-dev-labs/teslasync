package openmeteo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

const (
	rainForecastURL = "https://api.open-meteo.com/v1/forecast"
	maxRainResponse = 16 << 10
)

type RainClient struct {
	client   *http.Client
	endpoint string
	now      func() time.Time
}

var _ port.WindowRainForecastSource = (*RainClient)(nil)

func NewRainClient(transport http.RoundTripper, now func() time.Time) *RainClient {
	if transport == nil {
		transport = http.DefaultTransport
	}
	if now == nil {
		now = time.Now
	}
	return &RainClient{
		client: &http.Client{
			Transport:     httputil.NewPrivateTransport(transport),
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		endpoint: rainForecastURL,
		now:      now,
	}
}

type rainForecastResponse struct {
	UTCOffset *int              `json:"utc_offset_seconds"`
	Units     map[string]string `json:"hourly_units"`
	Hourly    struct {
		Time        []string   `json:"time"`
		Precip      []*float64 `json:"precipitation_probability"`
		Rain        []*float64 `json:"rain"`
		RainShowers []*float64 `json:"showers"`
	} `json:"hourly"`
}

func (c *RainClient) ForecastRain(
	ctx context.Context, latitude, longitude float64, authorize func(context.Context) error,
) (domain.RainForecast, error) {
	if authorize == nil || !between(latitude, -90, 90) || !between(longitude, -180, 180) ||
		(latitude == 0 && longitude == 0) {
		return domain.RainForecast{}, errors.New("invalid Open-Meteo forecast input")
	}
	query := url.Values{
		"latitude":       {strconv.FormatFloat(latitude, 'f', 2, 64)},
		"longitude":      {strconv.FormatFloat(longitude, 'f', 2, 64)},
		"hourly":         {"precipitation_probability,rain,showers"},
		"forecast_hours": {"4"},
		"timezone":       {"UTC"},
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint+"?"+query.Encode(), nil)
	if err != nil {
		return domain.RainForecast{}, errors.New("could not build Open-Meteo request")
	}
	req.Header.Set("Accept", "application/json")
	if err := authorize(ctx); err != nil {
		return domain.RainForecast{}, err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return domain.RainForecast{}, ctx.Err()
		}
		return domain.RainForecast{}, errors.New("Open-Meteo request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return domain.RainForecast{}, fmt.Errorf("Open-Meteo returned HTTP %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxRainResponse+1))
	var out rainForecastResponse
	if err != nil || len(raw) > maxRainResponse || json.Unmarshal(raw, &out) != nil {
		return domain.RainForecast{}, errors.New("invalid Open-Meteo response")
	}
	if err := authorize(ctx); err != nil {
		return domain.RainForecast{}, err
	}
	return out.forecast(c.now().UTC())
}

func (r rainForecastResponse) forecast(now time.Time) (domain.RainForecast, error) {
	h := r.Hourly
	n := len(h.Time)
	if r.UTCOffset == nil || *r.UTCOffset != 0 || r.Units["time"] != "iso8601" ||
		r.Units["precipitation_probability"] != "%" || r.Units["rain"] != "mm" || r.Units["showers"] != "mm" ||
		n < 1 || n > 4 || len(h.Precip) != n || len(h.Rain) != n || len(h.RainShowers) != n {
		return domain.RainForecast{}, errors.New("invalid Open-Meteo hourly forecast")
	}
	result := domain.RainForecast{ReceivedAt: now, Hours: make([]domain.RainForecastHour, 0, n)}
	var prior time.Time
	for i, value := range h.Time {
		end, err := time.Parse("2006-01-02T15:04", value)
		if err != nil || end.Minute() != 0 || (!prior.IsZero() && end.Sub(prior) != time.Hour) {
			return domain.RainForecast{}, errors.New("invalid Open-Meteo forecast intervals")
		}
		prior = end
		pct, rain, showers := h.Precip[i], h.Rain[i], h.RainShowers[i]
		if pct == nil || rain == nil || showers == nil || !between(*pct, 0, 100) ||
			!between(*rain, 0, 500) || !between(*showers, 0, 500) {
			continue
		}
		result.Hours = append(result.Hours, domain.RainForecastHour{
			EndsAt: end, PrecipChancePct: *pct, RainAndShowersM: (*rain + *showers) / 1000,
		})
	}
	return result, nil
}

func between(v, min, max float64) bool {
	return v >= min && v <= max
}
