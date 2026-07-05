package elevation

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNoopProvider_AlwaysReportsNotOK(t *testing.T) {
	meters, ok, err := (NoopProvider{}).Lookup(context.Background(), 45.8329, 6.8648)
	if ok {
		t.Errorf("NoopProvider.Lookup: ok = true, want false")
	}
	if err != nil {
		t.Errorf("NoopProvider.Lookup: err = %v, want nil", err)
	}
	if meters != 0 {
		t.Errorf("NoopProvider.Lookup: meters = %v, want 0", meters)
	}
}

func TestNewClient_PanicsOnEmptyServiceURL(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected panic for empty ServiceURL, got nil")
		}
		msg, ok := r.(string)
		if !ok || !strings.Contains(msg, "ServiceURL must be non-empty") {
			t.Errorf("panic message = %v, want it to mention ServiceURL must be non-empty", r)
		}
	}()
	_ = NewClient(Config{})
}

func TestClient_Lookup_Success(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"elevation": 4805.3, "latitude": 45.8329, "longitude": 6.8648}`)
	}))
	defer srv.Close()

	c := NewClient(Config{ServiceURL: srv.URL, Timeout: 2 * time.Second})
	meters, ok, err := c.Lookup(context.Background(), 45.8329, 6.8648)
	if err != nil {
		t.Fatalf("Lookup: unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("Lookup: ok = false, want true")
	}
	if meters != 4805.3 {
		t.Errorf("Lookup: meters = %v, want 4805.3", meters)
	}
	if gotPath != "/getElevation/45.832900/6.864800" {
		t.Errorf("request path = %q, want /getElevation/45.832900/6.864800", gotPath)
	}
}

func TestClient_Lookup_NegativeCoordinates(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		fmt.Fprint(w, `{"elevation": -15.2}`)
	}))
	defer srv.Close()

	c := NewClient(Config{ServiceURL: srv.URL})
	meters, ok, err := c.Lookup(context.Background(), -33.8688, 151.2093)
	if err != nil {
		t.Fatalf("Lookup: unexpected error: %v", err)
	}
	if !ok || meters != -15.2 {
		t.Errorf("Lookup = (%v, %v), want (-15.2, true)", meters, ok)
	}
	if gotPath != "/getElevation/-33.868800/151.209300" {
		t.Errorf("request path = %q, want /getElevation/-33.868800/151.209300", gotPath)
	}
}

func TestClient_Lookup_NonOKStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := NewClient(Config{ServiceURL: srv.URL})
	_, ok, err := c.Lookup(context.Background(), 45.8329, 6.8648)
	if ok {
		t.Error("Lookup: ok = true, want false on 500 status")
	}
	if err == nil {
		t.Fatal("Lookup: expected error on 500 status, got nil")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("error = %q, want it to mention status 500", err.Error())
	}
}

func TestClient_Lookup_MalformedJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `not json`)
	}))
	defer srv.Close()

	c := NewClient(Config{ServiceURL: srv.URL})
	_, ok, err := c.Lookup(context.Background(), 45.8329, 6.8648)
	if ok {
		t.Error("Lookup: ok = true, want false on malformed body")
	}
	if err == nil {
		t.Fatal("Lookup: expected error on malformed body, got nil")
	}
}

// TestClient_Lookup_CircuitBreakerOpensAfterRepeatedFailures verifies
// the hot-path protection described on NewClient's doc comment: once
// the failure threshold trips, subsequent calls fail fast (ok=false,
// err=ErrCircuitOpen-wrapped) WITHOUT reaching the server, so a down
// elevation service cannot keep imposing its full Timeout on every
// position write.
func TestClient_Lookup_CircuitBreakerOpensAfterRepeatedFailures(t *testing.T) {
	var requestCount int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := NewClient(Config{ServiceURL: srv.URL})

	// DefaultCircuitBreakerConfig's FailureThreshold is 5.
	const failureThreshold = 5
	for i := 0; i < failureThreshold; i++ {
		if _, ok, _ := c.Lookup(context.Background(), 45.8329, 6.8648); ok {
			t.Fatalf("call %d: ok = true, want false", i)
		}
	}
	countAtOpen := requestCount

	// The circuit should now be open: further calls must not reach the server.
	if _, ok, err := c.Lookup(context.Background(), 45.8329, 6.8648); ok || err == nil {
		t.Errorf("post-threshold Lookup = (ok=%v, err=%v), want ok=false, err!=nil", ok, err)
	}
	if requestCount != countAtOpen {
		t.Errorf("requestCount after circuit should be open = %d, want %d (no new request)", requestCount, countAtOpen)
	}
}
