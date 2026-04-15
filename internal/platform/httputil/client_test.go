package httputil

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestNewClient_FullChain(t *testing.T) {
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		callCount++
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))
	defer srv.Close()

	client := NewClient(ClientConfig{
		Name:    "test-service",
		Timeout: 5 * time.Second,
		Retry: RetryConfig{
			MaxAttempts:     2,
			InitialDelay:    1 * time.Millisecond,
			MaxDelay:        10 * time.Millisecond,
			Multiplier:      2.0,
			RetryableStatus: []int{500, 502, 503},
		},
		RateLimit:     NewRateLimiter(100, 10),
		EnableLogging: true,
	})

	resp, err := client.Get(srv.URL + "/test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	if callCount != 1 {
		t.Errorf("expected 1 call (no retries needed), got %d", callCount)
	}
}

func TestNewClient_DefaultTimeout(t *testing.T) {
	client := NewClient(ClientConfig{
		Name: "default-timeout",
	})
	if client.Timeout != 10*time.Second {
		t.Errorf("expected default 10s timeout, got %v", client.Timeout)
	}
}

func TestNewClient_NoOptionalLayers(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// Minimal config — no retry, no rate limit, no logging
	client := NewClient(ClientConfig{
		Name:    "minimal",
		Timeout: 2 * time.Second,
	})

	resp, err := client.Get(srv.URL + "/test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
}

func TestNewClient_RetryOn500(t *testing.T) {
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		callCount++
		if callCount < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client := NewClient(ClientConfig{
		Name:    "retry-test",
		Timeout: 5 * time.Second,
		Retry: RetryConfig{
			MaxAttempts:     3,
			InitialDelay:    1 * time.Millisecond,
			MaxDelay:        10 * time.Millisecond,
			Multiplier:      2.0,
			RetryableStatus: []int{500},
		},
	})

	resp, err := client.Get(srv.URL + "/retry")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200 after retries, got %d", resp.StatusCode)
	}
	if callCount != 3 {
		t.Errorf("expected 3 calls (2 retries + success), got %d", callCount)
	}
}
