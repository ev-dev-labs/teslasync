package platform

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWindowCounter_IncrementCount(t *testing.T) {
	c := NewWindowCounterWithBuckets(60*time.Second, 60)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	c.SetNowForTests(func() time.Time { return now })

	for i := 0; i < 5; i++ {
		c.Increment()
	}

	if got := c.Count(); got != 5 {
		t.Fatalf("Count: want 5, got %d", got)
	}
}

func TestWindowCounter_BucketRollover(t *testing.T) {
	c := NewWindowCounterWithBuckets(10*time.Second, 10)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	c.SetNowForTests(func() time.Time { return now })
	c.Increment()
	c.Increment()
	if got := c.Count(); got != 2 {
		t.Fatalf("immediate count: want 2, got %d", got)
	}

	// Advance past the window — every bucket falls off.
	now = now.Add(11 * time.Second)
	if got := c.Count(); got != 0 {
		t.Fatalf("after window: want 0, got %d", got)
	}
}

func TestWindowCounter_PartialRollover(t *testing.T) {
	c := NewWindowCounterWithBuckets(10*time.Second, 10)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	c.SetNowForTests(func() time.Time { return now })

	c.Increment() // bucket 0

	now = now.Add(3 * time.Second) // bucket 3
	c.Increment()
	c.Increment()

	now = now.Add(5 * time.Second) // bucket 8
	c.Increment()

	if got := c.Count(); got != 4 {
		t.Fatalf("partial rollover: want 4, got %d", got)
	}

	// Roll forward 5s — the original bucket 0 (3 + 5 = 8s ago) and
	// bucket-3 entries (5s ago) are still inside the 10s window.
	// Only after another bucket boundary will they drop off. Advance
	// to t=15s — buckets 0 (15s ago) and 3 (12s ago) drop, bucket 8
	// (7s ago) survives.
	now = now.Add(7 * time.Second)
	if got := c.Count(); got != 1 {
		t.Fatalf("after partial expiry: want 1, got %d", got)
	}
}

func TestWindowCounter_Window(t *testing.T) {
	c := NewWindowCounterWithBuckets(120*time.Second, 60)
	if got := c.Window(); got != 120*time.Second {
		t.Fatalf("Window: want 120s, got %v", got)
	}
}

func TestWindowCounter_DefaultsOnInvalidArgs(t *testing.T) {
	c := NewWindowCounterWithBuckets(0, 0)
	if got := c.Window(); got != DefaultWindowCounterWindow {
		t.Fatalf("default window: want %v, got %v", DefaultWindowCounterWindow, got)
	}
	if got := len(c.buckets); got != DefaultWindowCounterBuckets {
		t.Fatalf("default buckets: want %d, got %d", DefaultWindowCounterBuckets, got)
	}
}

func TestWindowCounter_Middleware_CountsAll(t *testing.T) {
	c := NewWindowCounterWithBuckets(60*time.Second, 60)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	c.SetNowForTests(func() time.Time { return now })

	mw := c.Middleware(nil)
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	for _, m := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
		req := httptest.NewRequest(m, "/foo", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
	}

	if got := c.Count(); got != 3 {
		t.Fatalf("count all methods: want 3, got %d", got)
	}
}

func TestWindowCounter_Middleware_WriteFilter(t *testing.T) {
	c := NewWindowCounterWithBuckets(60*time.Second, 60)
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	c.SetNowForTests(func() time.Time { return now })

	mw := c.Middleware(WriteMethodFilter())
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	cases := []struct {
		method string
		want   bool
	}{
		{http.MethodGet, false},
		{http.MethodHead, false},
		{http.MethodOptions, false},
		{http.MethodPost, true},
		{http.MethodPut, true},
		{http.MethodPatch, true},
		{http.MethodDelete, true},
	}

	expected := 0
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, "/foo", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if tc.want {
			expected++
		}
	}

	if got := c.Count(); got != expected {
		t.Fatalf("write filter: want %d, got %d", expected, got)
	}
}

func TestWindowCounter_NewDefaults(t *testing.T) {
	c := NewWindowCounter()
	if got := c.Window(); got != DefaultWindowCounterWindow {
		t.Fatalf("default ctor window: want %v, got %v", DefaultWindowCounterWindow, got)
	}
}
