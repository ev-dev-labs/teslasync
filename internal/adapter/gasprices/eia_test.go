package gasprices

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// validEIAResponse returns a realistic EIA API response body.
func validEIAResponse(price string) []byte {
	resp := eiaResponse{}
	resp.Response.Data = []struct {
		Value  string `json:"value"`
		Period string `json:"period"`
	}{
		{Value: price, Period: "2024-03-11"},
	}
	b, _ := json.Marshal(resp)
	return b
}

func TestGetCurrentPrice_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify API key is passed
		if r.URL.Query().Get("api_key") != "test-key" {
			t.Errorf("expected api_key=test-key, got %s", r.URL.Query().Get("api_key"))
		}
		w.WriteHeader(http.StatusOK)
		w.Write(validEIAResponse("3.50"))
	}))
	defer srv.Close()

	adapter := NewEIAAdapter("test-key",
		WithBaseURL(srv.URL+"/"),
		WithGallonToKWhFactor(7.0), // simplified factor for easy math
	)

	price, err := adapter.GetCurrentPrice(context.Background(), "US")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if price.Currency != "USD" {
		t.Errorf("expected currency USD, got %s", price.Currency)
	}
	if price.Region != "US" {
		t.Errorf("expected region US, got %s", price.Region)
	}

	// $3.50 / 7.0 = $0.50/kWh
	expectedKWh := 3.50 / 7.0
	if diff := price.PricePerKWh - expectedKWh; diff > 0.001 || diff < -0.001 {
		t.Errorf("expected PricePerKWh ~%.4f, got %.4f", expectedKWh, price.PricePerKWh)
	}
}

func TestGetCurrentPrice_DefaultRegion(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(validEIAResponse("3.00"))
	}))
	defer srv.Close()

	adapter := NewEIAAdapter("key", WithBaseURL(srv.URL+"/"))

	price, err := adapter.GetCurrentPrice(context.Background(), "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if price.Region != "US" {
		t.Errorf("expected default region US, got %s", price.Region)
	}
}

func TestGetCurrentPrice_APIError500(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal server error"))
	}))
	defer srv.Close()

	adapter := NewEIAAdapter("key", WithBaseURL(srv.URL+"/"))

	_, err := adapter.GetCurrentPrice(context.Background(), "US")
	if err == nil {
		t.Fatal("expected error for 500 response, got nil")
	}
}

func TestGetCurrentPrice_Timeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(2 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	adapter := NewEIAAdapter("key",
		WithBaseURL(srv.URL+"/"),
		WithHTTPClient(&http.Client{Timeout: 100 * time.Millisecond}),
	)

	_, err := adapter.GetCurrentPrice(context.Background(), "US")
	if err == nil {
		t.Fatal("expected timeout error, got nil")
	}
}

func TestGetCurrentPrice_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("not json"))
	}))
	defer srv.Close()

	adapter := NewEIAAdapter("key", WithBaseURL(srv.URL+"/"))

	_, err := adapter.GetCurrentPrice(context.Background(), "US")
	if err == nil {
		t.Fatal("expected parse error, got nil")
	}
}

func TestGetCurrentPrice_EmptyData(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"response":{"data":[]}}`))
	}))
	defer srv.Close()

	adapter := NewEIAAdapter("key", WithBaseURL(srv.URL+"/"))

	_, err := adapter.GetCurrentPrice(context.Background(), "US")
	if err == nil {
		t.Fatal("expected empty data error, got nil")
	}
}

func TestGetCurrentPrice_Caching(t *testing.T) {
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		callCount++
		w.WriteHeader(http.StatusOK)
		w.Write(validEIAResponse("3.50"))
	}))
	defer srv.Close()

	adapter := NewEIAAdapter("key",
		WithBaseURL(srv.URL+"/"),
		WithCacheTTL(1*time.Hour),
	)

	// First call — hits the API
	_, err := adapter.GetCurrentPrice(context.Background(), "US")
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	if callCount != 1 {
		t.Fatalf("expected 1 API call, got %d", callCount)
	}

	// Second call — should use cache
	_, err = adapter.GetCurrentPrice(context.Background(), "US")
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if callCount != 1 {
		t.Errorf("expected cache hit (1 API call), got %d", callCount)
	}
}

func TestGetCurrentPrice_CacheExpiry(t *testing.T) {
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		callCount++
		w.WriteHeader(http.StatusOK)
		w.Write(validEIAResponse("3.50"))
	}))
	defer srv.Close()

	adapter := NewEIAAdapter("key",
		WithBaseURL(srv.URL+"/"),
		WithCacheTTL(50*time.Millisecond),
	)

	// First call
	_, err := adapter.GetCurrentPrice(context.Background(), "US")
	if err != nil {
		t.Fatalf("first call: %v", err)
	}

	// Wait for cache to expire
	time.Sleep(100 * time.Millisecond)

	// Second call — cache expired, should hit API again
	_, err = adapter.GetCurrentPrice(context.Background(), "US")
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if callCount != 2 {
		t.Errorf("expected 2 API calls after cache expiry, got %d", callCount)
	}
}

func TestGetCurrentPrice_RegionPassedCorrectly(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write(validEIAResponse("4.00"))
	}))
	defer srv.Close()

	adapter := NewEIAAdapter("key", WithBaseURL(srv.URL+"/"))

	price, err := adapter.GetCurrentPrice(context.Background(), "CA")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if price.Region != "CA" {
		t.Errorf("expected region CA, got %s", price.Region)
	}
}
