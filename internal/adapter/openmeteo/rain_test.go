package openmeteo

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"sync/atomic"
	"testing"
	"time"
)

func TestRainForecastSendsOnlyConsentedCoarsePointAndWeatherVariables(t *testing.T) {
	var calls atomic.Int32
	wantQuery := url.Values{
		"latitude": {"47.12"}, "longitude": {"-122.35"},
		"hourly": {"precipitation_probability,rain,showers"}, "forecast_hours": {"4"}, "timezone": {"UTC"},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodGet || r.URL.Path != "/v1/forecast" || !reflect.DeepEqual(r.URL.Query(), wantQuery) {
			t.Errorf("unexpected forecast request: %s %s", r.Method, r.URL)
		}
		_, _ = fmt.Fprint(w, `{"utc_offset_seconds":0,"hourly_units":{"time":"iso8601","precipitation_probability":"%","rain":"mm","showers":"mm"},
			"hourly":{"time":["2026-11-20T07:00","2026-11-20T08:00","2026-11-20T09:00"],"precipitation_probability":[80,95,85],
			"rain":[0.4,null,0.3],"showers":[0.3,0.2,0.3]}}`)
	}))
	defer server.Close()
	clock := time.Date(2026, 11, 20, 7, 45, 0, 0, time.UTC)
	client := NewRainClient(nil, func() time.Time { return clock })
	client.endpoint = server.URL + "/v1/forecast"
	denied := errors.New("connector consent revoked")
	latitude, longitude := 47.123424, -122.353333
	deny := func(context.Context) error { return denied }
	if _, err := client.ForecastRain(t.Context(), latitude, longitude, deny); !errors.Is(err, denied) || calls.Load() != 0 {
		t.Fatalf("revoked consent must prevent the provider request: %v, calls=%d", err, calls.Load())
	}
	checks := 0
	result, err := client.ForecastRain(t.Context(), latitude, longitude, func(context.Context) error {
		checks++
		return nil
	})
	if err != nil || len(result.Hours) != 2 || !result.ReceivedAt.Equal(clock) ||
		math.Abs(result.Hours[0].RainAndShowersM-.0007) > 1e-10 || result.Hours[1].EndsAt.Hour() != 9 || checks != 2 {
		t.Fatalf("want qualified UTC forecast in meters, skipping unknowns: %+v, checks=%d (%v)", result, checks, err)
	}
	checks = 0
	if _, err := client.ForecastRain(t.Context(), latitude, longitude, func(context.Context) error {
		checks++
		if checks > 1 {
			return denied
		}
		return nil
	}); !errors.Is(err, denied) || calls.Load() != 2 {
		t.Fatalf("results received after withdrawal must be discarded: %v, calls=%d", err, calls.Load())
	}
}
