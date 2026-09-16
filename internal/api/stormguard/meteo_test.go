package stormguard

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const meteoFixture = `{"hourly":{
	"time":["2026-04-01T12:00","2026-04-01T13:00"],
	"weathercode":[3,95],
	"windgusts_10m":[8.5,30.0]}}`

func TestClientFetch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("hourly") != "weathercode,windgusts_10m" || q.Get("timezone") != "UTC" {
			t.Errorf("unexpected query: %s", r.URL.RawQuery)
		}
		if q.Get("latitude") == "" || q.Get("longitude") == "" {
			t.Errorf("missing coords: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(meteoFixture))
	}))
	defer srv.Close()

	c := &Client{BaseURL: srv.URL, HTTPClient: srv.Client()}
	f, err := c.Fetch(context.Background(), 37.7749, -122.4194)
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(f.Times) != 2 || f.Weather[1] != 95 || f.WindGustMS[1] != 30.0 {
		t.Fatalf("unexpected forecast: %+v", f)
	}
	want := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	if !f.Times[0].Equal(want) {
		t.Fatalf("t0 = %v, want %v", f.Times[0], want)
	}
}

func TestClientFetchErrors(t *testing.T) {
	t.Run("non-200", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusTooManyRequests)
		}))
		defer srv.Close()
		c := &Client{BaseURL: srv.URL, HTTPClient: srv.Client()}
		if _, err := c.Fetch(context.Background(), 0, 0); err == nil {
			t.Fatal("expected error for 429")
		}
	})
	t.Run("ragged series", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"hourly":{"time":["2026-04-01T12:00"],"weathercode":[],"windgusts_10m":[]}}`))
		}))
		defer srv.Close()
		c := &Client{BaseURL: srv.URL, HTTPClient: srv.Client()}
		if _, err := c.Fetch(context.Background(), 0, 0); err == nil {
			t.Fatal("expected error for ragged series")
		}
	})
	t.Run("bad time", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"hourly":{"time":["not-a-time"],"weathercode":[1],"windgusts_10m":[1]}}`))
		}))
		defer srv.Close()
		c := &Client{BaseURL: srv.URL, HTTPClient: srv.Client()}
		if _, err := c.Fetch(context.Background(), 0, 0); err == nil {
			t.Fatal("expected error for bad time")
		}
	})
}

func TestClientFetchHistory(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("hourly") != "temperature_2m,surface_pressure,wind_speed_10m,precipitation" {
			t.Errorf("unexpected hourly: %s", q.Get("hourly"))
		}
		if q.Get("wind_speed_unit") != "ms" || q.Get("timezone") != "UTC" {
			t.Errorf("unexpected units: %s", r.URL.RawQuery)
		}
		if q.Get("start_date") == "" || q.Get("end_date") == "" {
			t.Errorf("missing dates: %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"hourly":{
			"time":["2026-04-01T12:00","2026-04-01T13:00"],
			"temperature_2m":[15.0,16.0],"surface_pressure":[1013.0,1012.0],
			"wind_speed_10m":[3.0,4.0],"precipitation":[0.0,0.2]}}`))
	}))
	defer srv.Close()

	c := &Client{ArchiveBase: srv.URL, HTTPClient: srv.Client()}
	got, err := c.FetchHistory(context.Background(), 37.7749, -122.4194,
		time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(got) != 2 || got[1].TempC != 16.0 || got[1].PrecipMm != 0.2 {
		t.Fatalf("unexpected history: %+v", got)
	}
}
