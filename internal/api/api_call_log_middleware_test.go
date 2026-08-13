package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	apimw "github.com/ev-dev-labs/teslasync/internal/api/middleware"
	"github.com/ev-dev-labs/teslasync/internal/apilog"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	dto "github.com/prometheus/client_model/go"
)

// counterValue reads the current scalar value of a prometheus Counter without
// pulling in the prometheus/client_golang/prometheus/testutil package (which
// would add an indirect davecgh/go-spew requirement to go.mod).
func counterValue(c interface {
	Write(*dto.Metric) error
}) float64 {
	pb := &dto.Metric{}
	if err := c.Write(pb); err != nil {
		return 0
	}
	return pb.GetCounter().GetValue()
}

// fakeAPILogStore implements APICallLogger and captures every enqueued
// entry. AlwaysFull simulates queue full (drops + counter increment) so tests
// can exercise the drop path without time-based flake.
type fakeAPILogStore struct {
	mu         sync.Mutex
	entries    []*teslamodel.APICallLog
	AlwaysFull bool
	closed     bool
}

func (f *fakeAPILogStore) Enqueue(e *teslamodel.APICallLog) {
	if e == nil {
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.AlwaysFull || f.closed {
		apilog.DropsCounter.Inc()
		return
	}
	f.entries = append(f.entries, e)
}

func (f *fakeAPILogStore) Shutdown(ctx context.Context) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
	return nil
}

func (f *fakeAPILogStore) Entries() []*teslamodel.APICallLog {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]*teslamodel.APICallLog, len(f.entries))
	copy(out, f.entries)
	return out
}

func (f *fakeAPILogStore) Reset() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.entries = nil
	f.closed = false
}

// waitForEntries polls store.Entries() until at least n are present or the
// timeout elapses. The middleware's defer runs synchronously when a request
// reaches the end of the chain, but the SERVER goroutine may still be
// running the chain's defers when the CLIENT-side resp.Body.Close() returns
// (HTTP/1.1 with chunked body responses can let the client drain ahead of
// the handler's outer-middleware defers). Tests with N>1 requests therefore
// need a small wait window to deflake.
func waitForEntries(store *fakeAPILogStore, n int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for {
		if got := len(store.Entries()); got >= n {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// echoBody handler: reads the request body and writes it back as the response,
// allowing body-capture assertions on both ends.
func echoBody(w http.ResponseWriter, r *http.Request) {
	b, _ := io.ReadAll(r.Body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(b)
}

// largeBody handler: writes n bytes of dummy payload.
func largeBody(n int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Drain request body so io.LimitReader/teeReader runs to completion.
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		buf := bytes.Repeat([]byte("x"), n)
		_, _ = w.Write(buf)
	}
}

// newTestRouterWithLogger builds a chi router with the same global middleware
// stack used in production (RequestID, RealIP, Tracing, Logger, Recovery,
// APICallLogMiddleware, Compress) plus a small set of test handlers covering
// 200 / panic / health / metrics / api-logs / events / sse-token / system.
func newTestRouterWithLogger(t *testing.T, store APICallLogger, captureBodies bool) http.Handler {
	t.Helper()
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(apimw.Tracing)
	r.Use(apimw.Logger)
	r.Use(apimw.Recovery)
	r.Use(APICallLogMiddleware(store, captureBodies, DefaultAPILogSkip))

	// Skipped paths
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Get("/metrics", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/admin/api-logs", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
		r.Get("/admin/api-logs/stats", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
		r.Get("/api-logs", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
		r.Get("/api-logs/stats", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
		r.Get("/events", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
		r.Get("/sse-token", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
		r.Get("/system/status", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
		r.Post("/tesla/vehicle-pricing", echoBody)
		r.Post("/vehicles/{vehicleID}/enterprise-payer", echoBody)

		// Recorded paths
		r.Get("/vehicles", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("[]"))
		})
		r.Post("/vehicles", echoBody)
		r.Get("/vehicles/{vehicleID}/state", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("{}"))
		})
		r.Get("/test-panic", func(w http.ResponseWriter, r *http.Request) {
			panic(errors.New("boom"))
		})
		r.Get("/large", largeBody(15*1024))
	})
	// Non-/api/v1 path that should still be recorded
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("home"))
	})
	return r
}

// T01: happy path GET /api/v1/vehicles → exactly one entry, service tag
// "teslasync-api", correct method/endpoint/status, body fields nil when
// capture is OFF.
func TestT01_HappyPath_GET_Vehicles_RecordsOneRow_ServiceTeslasyncApi(t *testing.T) {
	store := &fakeAPILogStore{}
	srv := httptest.NewServer(newTestRouterWithLogger(t, store, false))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v1/vehicles")
	if err != nil {
		t.Fatalf("GET failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want 200", resp.StatusCode)
	}

	entries := store.Entries()
	if len(entries) != 1 {
		t.Fatalf("entries=%d, want 1", len(entries))
	}
	e := entries[0]
	if e.Service != APILogServiceTag {
		t.Errorf("service=%q, want %q", e.Service, APILogServiceTag)
	}
	if e.HTTPMethod != "GET" {
		t.Errorf("method=%q, want GET", e.HTTPMethod)
	}
	if !strings.Contains(e.Endpoint, "/api/v1/vehicles") {
		t.Errorf("endpoint=%q, want contains /api/v1/vehicles", e.Endpoint)
	}
	if e.StatusCode != 200 {
		t.Errorf("status=%d, want 200", e.StatusCode)
	}
	if e.RequestBody != nil {
		t.Errorf("request_body=%v, want nil (capture OFF)", *e.RequestBody)
	}
	if e.ResponseBody != nil {
		t.Errorf("response_body=%v, want nil (capture OFF)", *e.ResponseBody)
	}
	if e.VehicleID != nil {
		t.Errorf("vehicle_id=%v, want nil (inbound never attributes a vehicle)", *e.VehicleID)
	}
	// Duration should be > 0 nanoseconds; we record millis as int32 so we
	// only assert non-negative (sub-millisecond requests legitimately round
	// to zero and should not fail this test).
	if e.DurationMs < 0 {
		t.Errorf("duration_ms=%d, want >= 0", e.DurationMs)
	}
}

// T02: body capture ON → request and response bodies are recorded.
func TestT02_BodyCaptureOn_RecordsRequestAndResponseBodies(t *testing.T) {
	store := &fakeAPILogStore{}
	srv := httptest.NewServer(newTestRouterWithLogger(t, store, true))
	defer srv.Close()

	body := `{"display_name":"Roadster"}`
	resp, err := http.Post(srv.URL+"/api/v1/vehicles", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST failed: %v", err)
	}
	resp.Body.Close()

	entries := store.Entries()
	if len(entries) != 1 {
		t.Fatalf("entries=%d, want 1", len(entries))
	}
	e := entries[0]
	if e.RequestBody == nil {
		t.Fatal("request_body=nil, want captured")
	}
	if !strings.Contains(*e.RequestBody, "Roadster") {
		t.Errorf("request_body=%q, want contains Roadster", *e.RequestBody)
	}
	if e.ResponseBody == nil {
		t.Fatal("response_body=nil, want captured")
	}
	if !strings.Contains(*e.ResponseBody, "Roadster") {
		t.Errorf("response_body=%q, want contains Roadster (echoed)", *e.ResponseBody)
	}
}

// T03: body capture truncates request and response at 10 KB.
func TestT03_BodyCaptureOn_TruncatesAt10240Bytes_RequestAndResponse(t *testing.T) {
	store := &fakeAPILogStore{}
	srv := httptest.NewServer(newTestRouterWithLogger(t, store, true))
	defer srv.Close()

	largeReq := bytes.Repeat([]byte("a"), 12*1024)
	resp, err := http.Get(srv.URL + "/api/v1/large") // 15 KB response
	if err != nil {
		t.Fatalf("GET large failed: %v", err)
	}
	resp.Body.Close()

	// Also POST with 12 KB body to assert request truncation.
	postReq, _ := http.NewRequest("POST", srv.URL+"/api/v1/vehicles", bytes.NewReader(largeReq))
	postReq.Header.Set("Content-Type", "application/octet-stream")
	postResp, err := http.DefaultClient.Do(postReq)
	if err != nil {
		t.Fatalf("POST large failed: %v", err)
	}
	postResp.Body.Close()

	if !waitForEntries(store, 2, 2*time.Second) {
		t.Fatalf("entries=%d, want 2 (timed out waiting)", len(store.Entries()))
	}
	entries := store.Entries()
	if len(entries) != 2 {
		t.Fatalf("entries=%d, want 2", len(entries))
	}

	// The GET /api/v1/large entry should have ResponseBody capped at 10 KB
	// (plus the truncation marker).
	var getEntry, postEntry *teslamodel.APICallLog
	for _, e := range entries {
		if e.HTTPMethod == "GET" {
			getEntry = e
		} else if e.HTTPMethod == "POST" {
			postEntry = e
		}
	}
	if getEntry == nil || postEntry == nil {
		t.Fatalf("missing GET/POST entries: %+v", entries)
	}
	if getEntry.ResponseBody == nil {
		t.Fatal("GET response_body=nil, want captured+truncated")
	}
	rb := *getEntry.ResponseBody
	if len(rb) < MaxAPILogBodyBytes || len(rb) > MaxAPILogBodyBytes+len(truncationMarker) {
		t.Errorf("GET response_body len=%d, want between %d and %d", len(rb), MaxAPILogBodyBytes, MaxAPILogBodyBytes+len(truncationMarker))
	}
	if !strings.HasSuffix(rb, truncationMarker) {
		t.Errorf("GET response_body missing truncation marker; suffix=%q", lastN(rb, 30))
	}

	if postEntry.RequestBody == nil {
		t.Fatal("POST request_body=nil, want captured+truncated")
	}
	prq := *postEntry.RequestBody
	if len(prq) < MaxAPILogBodyBytes || len(prq) > MaxAPILogBodyBytes+len(truncationMarker) {
		t.Errorf("POST request_body len=%d, want between %d and %d", len(prq), MaxAPILogBodyBytes, MaxAPILogBodyBytes+len(truncationMarker))
	}
	if !strings.HasSuffix(prq, truncationMarker) {
		t.Errorf("POST request_body missing truncation marker; suffix=%q", lastN(prq, 30))
	}
}

func lastN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

// T04: skipped paths produce zero entries.
func TestT04_SkippedPaths_NoRowsEnqueued(t *testing.T) {
	store := &fakeAPILogStore{}
	srv := httptest.NewServer(newTestRouterWithLogger(t, store, false))
	defer srv.Close()

	skipPaths := []string{
		"/healthz",
		"/readyz",
		"/metrics",
		"/api/v1/admin/api-logs",
		"/api/v1/admin/api-logs/stats",
		"/api/v1/api-logs",
		"/api/v1/api-logs/stats",
		"/api/v1/events",
		"/api/v1/sse-token",
		"/api/v1/system/status",
	}

	for _, p := range skipPaths {
		resp, err := http.Get(srv.URL + p)
		if err != nil {
			t.Fatalf("GET %s failed: %v", p, err)
		}
		resp.Body.Close()
	}
	if got := len(store.Entries()); got != 0 {
		t.Fatalf("entries=%d, want 0 (skipped paths)", got)
	}
}

func TestOpaqueVehicleManagementBodiesAreNeverCaptured(t *testing.T) {
	store := &fakeAPILogStore{}
	srv := httptest.NewServer(newTestRouterWithLogger(t, store, true))
	defer srv.Close()

	tests := []string{
		"/api/v1/tesla/vehicle-pricing",
		"/api/v1/tesla/vehicle-pricing/",
		"/api/v1/vehicles/42/enterprise-payer",
		"/api/v1/vehicles/42/enterprise-payer/",
	}
	for _, path := range tests {
		req, err := http.NewRequest(
			http.MethodPost,
			srv.URL+path,
			strings.NewReader(`{"payload":{"possible_pii":"must-not-persist"}}`),
		)
		if err != nil {
			t.Fatalf("build request for %s: %v", path, err)
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("POST %s: %v", path, err)
		}
		resp.Body.Close()
	}

	if got := len(store.Entries()); got != 0 {
		t.Fatalf("opaque management requests enqueued %d audit row(s), want 0", got)
	}
}

// T05: redaction of Authorization, Cookie, and ?api_key= query param.
// Non-secret query params are kept; visible body-capture tokens never
// appear in the stored body.
func TestT05_RedactsAuthorizationHeaderInStoredEndpointAndHeadersSnapshot(t *testing.T) {
	store := &fakeAPILogStore{}
	srv := httptest.NewServer(newTestRouterWithLogger(t, store, true))
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/api/v1/vehicles?api_key=SECRET&visible=ok", nil)
	req.Header.Set("Authorization", "Bearer abc.def.ghi")
	req.Header.Set("Cookie", "session=xyz")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET failed: %v", err)
	}
	resp.Body.Close()

	entries := store.Entries()
	if len(entries) != 1 {
		t.Fatalf("entries=%d, want 1", len(entries))
	}
	e := entries[0]
	if !strings.Contains(e.Endpoint, "api_key=REDACTED") {
		t.Errorf("endpoint=%q, want api_key=REDACTED", e.Endpoint)
	}
	if !strings.Contains(e.Endpoint, "visible=ok") {
		t.Errorf("endpoint=%q, want visible=ok preserved", e.Endpoint)
	}
	// Bodies should not leak any of the secret material via headers.
	if e.RequestBody != nil {
		s := *e.RequestBody
		for _, secret := range []string{"abc.def.ghi", "session=xyz", "SECRET"} {
			if strings.Contains(s, secret) {
				t.Errorf("request_body leaks %q: %q", secret, s)
			}
		}
	}
	if e.ResponseBody != nil {
		s := *e.ResponseBody
		for _, secret := range []string{"abc.def.ghi", "session=xyz", "SECRET"} {
			if strings.Contains(s, secret) {
				t.Errorf("response_body leaks %q: %q", secret, s)
			}
		}
	}

	// Unit-level: redactURLAndHeaders directly returns a sanitized header
	// snapshot with Authorization and Cookie REDACTED.
	r2, _ := http.NewRequest("GET", "/x?api_key=SECRET&visible=ok", nil)
	r2.Header.Set("Authorization", "Bearer abc.def.ghi")
	r2.Header.Set("Cookie", "session=xyz")
	r2.Header.Set("X-Trace-Id", "keep-me")
	urlOut, hdrs := redactURLAndHeaders(r2)
	if !strings.Contains(urlOut, "api_key=REDACTED") {
		t.Errorf("redacted url=%q, want api_key=REDACTED", urlOut)
	}
	if !strings.Contains(urlOut, "visible=ok") {
		t.Errorf("redacted url=%q, want visible=ok preserved", urlOut)
	}
	if hdrs["Authorization"] != "REDACTED" {
		t.Errorf("Authorization=%q, want REDACTED", hdrs["Authorization"])
	}
	if hdrs["Cookie"] != "REDACTED" {
		t.Errorf("Cookie=%q, want REDACTED", hdrs["Cookie"])
	}
	if hdrs["X-Trace-Id"] != "keep-me" {
		t.Errorf("X-Trace-Id=%q, want keep-me", hdrs["X-Trace-Id"])
	}
}

// T06: body redaction by case-insensitive key match (recursive).
func TestT06_RedactsBodyFieldsByCaseInsensitiveKey(t *testing.T) {
	store := &fakeAPILogStore{}
	srv := httptest.NewServer(newTestRouterWithLogger(t, store, true))
	defer srv.Close()

	body := `{"username":"u","password":"p","api_token":"t","Note":"keep","nested":{"secret":"s","ok":"k"},"list":[{"PASSWORD":"x","label":"a"}]}`
	resp, err := http.Post(srv.URL+"/api/v1/vehicles", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST failed: %v", err)
	}
	resp.Body.Close()

	entries := store.Entries()
	if len(entries) != 1 {
		t.Fatalf("entries=%d, want 1", len(entries))
	}
	e := entries[0]
	if e.RequestBody == nil {
		t.Fatal("request_body=nil")
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(*e.RequestBody), &parsed); err != nil {
		t.Fatalf("request_body not valid JSON: %v\n%s", err, *e.RequestBody)
	}
	if got := parsed["password"]; got != "REDACTED" {
		t.Errorf("password=%v, want REDACTED", got)
	}
	if got := parsed["api_token"]; got != "REDACTED" {
		t.Errorf("api_token=%v, want REDACTED", got)
	}
	if got := parsed["username"]; got != "u" {
		t.Errorf("username=%v, want u (kept)", got)
	}
	if got := parsed["Note"]; got != "keep" {
		t.Errorf("Note=%v, want keep (no match)", got)
	}
	nested, _ := parsed["nested"].(map[string]any)
	if got := nested["secret"]; got != "REDACTED" {
		t.Errorf("nested.secret=%v, want REDACTED", got)
	}
	if got := nested["ok"]; got != "k" {
		t.Errorf("nested.ok=%v, want k (kept)", got)
	}
	list, _ := parsed["list"].([]any)
	if len(list) != 1 {
		t.Fatalf("list len=%d, want 1", len(list))
	}
	first, _ := list[0].(map[string]any)
	if got := first["PASSWORD"]; got != "REDACTED" {
		t.Errorf("list[0].PASSWORD=%v, want REDACTED (case-insensitive)", got)
	}
	if got := first["label"]; got != "a" {
		t.Errorf("list[0].label=%v, want a (kept)", got)
	}
}

// T07: queue full → entry dropped, request still 200, drop counter +1, no
// entry in store.
func TestT07_QueueFull_DropsEntry_RequestStillSucceeds(t *testing.T) {
	store := &fakeAPILogStore{AlwaysFull: true}
	srv := httptest.NewServer(newTestRouterWithLogger(t, store, false))
	defer srv.Close()

	before := counterValue(apilog.DropsCounter)
	resp, err := http.Get(srv.URL + "/api/v1/vehicles")
	if err != nil {
		t.Fatalf("GET failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d, want 200", resp.StatusCode)
	}
	after := counterValue(apilog.DropsCounter)
	if delta := after - before; delta != 1 {
		t.Errorf("api_call_log_drops_total delta=%v, want 1", delta)
	}
	if got := len(store.Entries()); got != 0 {
		t.Errorf("entries=%d, want 0 (dropped)", got)
	}
}

// T08: handler panic → status_code=500, exactly one entry recorded with
// status 500 (defer fires inside RecoveryMiddleware).
func TestT08_HandlerPanic_StillRecordsRequest_StatusCode500(t *testing.T) {
	store := &fakeAPILogStore{}
	srv := httptest.NewServer(newTestRouterWithLogger(t, store, false))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v1/test-panic")
	if err != nil {
		t.Fatalf("GET failed: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("status=%d, want 500", resp.StatusCode)
	}
	entries := store.Entries()
	if len(entries) != 1 {
		t.Fatalf("entries=%d, want 1", len(entries))
	}
	e := entries[0]
	if e.StatusCode != 500 {
		t.Errorf("status=%d, want 500", e.StatusCode)
	}
	if !strings.Contains(e.Endpoint, "/api/v1/test-panic") {
		t.Errorf("endpoint=%q, want contains /api/v1/test-panic", e.Endpoint)
	}
}

// fakeBatchInserter records all batches submitted via CreateBatch. Used by
// T09 to assert drain behavior of the production async logger.
type fakeBatchInserter struct {
	mu      sync.Mutex
	batches [][]*teslamodel.APICallLog
	delay   time.Duration
}

func (f *fakeBatchInserter) CreateBatch(ctx context.Context, batch []*teslamodel.APICallLog) error {
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := make([]*teslamodel.APICallLog, len(batch))
	copy(cp, batch)
	f.batches = append(f.batches, cp)
	return nil
}

func (f *fakeBatchInserter) Total() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, b := range f.batches {
		n += len(b)
	}
	return n
}

// T09: Shutdown drains pending entries; subsequent Enqueue is silently
// dropped (no panic).
func TestT09_Shutdown_DrainsPendingEntries_LaterEnqueueDropped(t *testing.T) {
	inserter := &fakeBatchInserter{}
	logger := NewAsyncAPICallLogger(inserter, AsyncLoggerOptions{
		QueueCapacity: 16,
		BatchSize:     100,           // large enough that flush won't trigger by size
		FlushInterval: 1 * time.Hour, // very long so flush only happens on shutdown
	})

	for i := 0; i < 3; i++ {
		logger.Enqueue(&teslamodel.APICallLog{
			Service:    APILogServiceTag,
			HTTPMethod: "GET",
			Endpoint:   fmt.Sprintf("/api/v1/test-%d", i),
			StatusCode: 200,
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := logger.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown returned error: %v", err)
	}

	if got := inserter.Total(); got != 3 {
		t.Errorf("inserted=%d, want 3 (drain)", got)
	}

	before := counterValue(apilog.DropsCounter)
	// MUST NOT panic
	logger.Enqueue(&teslamodel.APICallLog{
		Service:    APILogServiceTag,
		HTTPMethod: "GET",
		Endpoint:   "/api/v1/post-shutdown",
		StatusCode: 200,
	})
	after := counterValue(apilog.DropsCounter)
	if delta := after - before; delta != 1 {
		t.Errorf("post-shutdown drop delta=%v, want 1", delta)
	}
	if got := inserter.Total(); got != 3 {
		t.Errorf("inserted=%d after post-shutdown enqueue, want 3 (dropped)", got)
	}
}

// T10: vehicle_id is always nil for inbound, even on /api/v1/vehicles/{id}/state.
func TestT10_VehicleIDIsAlwaysNullForInboundEvenForVehicleScopedURL(t *testing.T) {
	store := &fakeAPILogStore{}
	srv := httptest.NewServer(newTestRouterWithLogger(t, store, false))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/v1/vehicles/42/state")
	if err != nil {
		t.Fatalf("GET failed: %v", err)
	}
	resp.Body.Close()

	entries := store.Entries()
	if len(entries) != 1 {
		t.Fatalf("entries=%d, want 1", len(entries))
	}
	e := entries[0]
	if e.VehicleID != nil {
		t.Errorf("vehicle_id=%v, want nil (inbound never attributes a vehicle)", *e.VehicleID)
	}
	if !strings.Contains(e.Endpoint, "/api/v1/vehicles/42/state") {
		t.Errorf("endpoint=%q, want contains /api/v1/vehicles/42/state", e.Endpoint)
	}
}

// T11: latency overhead with body capture OFF — wrapped vs unwrapped 200
// requests. Loose 5x bound to absorb CI variability while still catching a
// regression to a synchronous DB call on the request path.
func TestT11_LatencyOverhead_BodyCaptureOff_NoMeasurableRegression(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping latency comparison in -short mode")
	}
	store := &fakeAPILogStore{}
	wrappedSrv := httptest.NewServer(newTestRouterWithLogger(t, store, false))
	defer wrappedSrv.Close()

	bareR := chi.NewRouter()
	bareR.Get("/api/v1/vehicles", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("[]"))
	})
	baseSrv := httptest.NewServer(bareR)
	defer baseSrv.Close()

	measure := func(url string) time.Duration {
		const N = 200
		// Warm-up
		for i := 0; i < 10; i++ {
			resp, err := http.Get(url)
			if err != nil {
				t.Fatalf("warmup GET %s: %v", url, err)
			}
			resp.Body.Close()
		}
		samples := make([]time.Duration, 0, N)
		for i := 0; i < N; i++ {
			start := time.Now()
			resp, err := http.Get(url)
			if err != nil {
				t.Fatalf("GET %s: %v", url, err)
			}
			resp.Body.Close()
			samples = append(samples, time.Since(start))
		}
		sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
		// p95
		return samples[(len(samples)*95)/100]
	}

	bareP95 := measure(baseSrv.URL + "/api/v1/vehicles")
	wrappedP95 := measure(wrappedSrv.URL + "/api/v1/vehicles")
	t.Logf("p95 bare=%v wrapped=%v", bareP95, wrappedP95)

	// Loose threshold: wrapped p95 must not exceed 5x baseline + 10ms slack.
	// This still catches a synchronous DB write per request (which would add
	// many milliseconds) without being flaky on slow CI.
	threshold := bareP95*5 + 10*time.Millisecond
	if wrappedP95 > threshold {
		t.Errorf("wrapped p95=%v exceeds threshold %v (baseline=%v)", wrappedP95, threshold, bareP95)
	}
}

// T12: 100 concurrent requests → exactly 100 entries; race-safe under
// `go test -race`.
func TestT12_ConcurrentRequests_NoRaceNoLostRows(t *testing.T) {
	store := &fakeAPILogStore{}
	srv := httptest.NewServer(newTestRouterWithLogger(t, store, false))
	defer srv.Close()

	const N = 100
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			resp, err := http.Get(srv.URL + "/api/v1/vehicles")
			if err != nil {
				t.Errorf("GET failed: %v", err)
				return
			}
			resp.Body.Close()
		}()
	}
	wg.Wait()

	if got := len(store.Entries()); got != N {
		t.Errorf("entries=%d, want %d", got, N)
	}
}

// T13: drop counter only increments on the drop path (not on success).
func TestT13_PrometheusCounter_IncrementsOnDrop_NotOnSuccess(t *testing.T) {
	store := &fakeAPILogStore{}
	srv := httptest.NewServer(newTestRouterWithLogger(t, store, false))
	defer srv.Close()

	before := counterValue(apilog.DropsCounter)
	resp, err := http.Get(srv.URL + "/api/v1/vehicles")
	if err != nil {
		t.Fatalf("GET failed: %v", err)
	}
	resp.Body.Close()
	after := counterValue(apilog.DropsCounter)
	if delta := after - before; delta != 0 {
		t.Errorf("drop counter delta=%v on success path, want 0", delta)
	}
}

// T14: non-/api/v1 path that is not in the skip list is still recorded.
func TestT14_NonAPIv1Paths_StillRecorded_UnlessSkipped(t *testing.T) {
	store := &fakeAPILogStore{}
	srv := httptest.NewServer(newTestRouterWithLogger(t, store, false))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatalf("GET failed: %v", err)
	}
	resp.Body.Close()

	entries := store.Entries()
	if len(entries) != 1 {
		t.Fatalf("entries=%d, want 1 (non-/api/v1 not skipped)", len(entries))
	}
	if entries[0].Service != APILogServiceTag {
		t.Errorf("service=%q, want %q", entries[0].Service, APILogServiceTag)
	}
}

// T15: redaction is applied BEFORE Enqueue. The entry passed to the writer
// must already have the URL/body redacted; raw secrets never sit in the
// channel buffer even briefly.
func TestT15_RedactionAppliesBeforeEnqueue(t *testing.T) {
	store := &fakeAPILogStore{}
	srv := httptest.NewServer(newTestRouterWithLogger(t, store, true))
	defer srv.Close()

	body := `{"password":"top-secret","name":"keep"}`
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/vehicles?api_key=URLSECRET", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer JWTSECRET")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST failed: %v", err)
	}
	resp.Body.Close()

	entries := store.Entries()
	if len(entries) != 1 {
		t.Fatalf("entries=%d, want 1", len(entries))
	}
	e := entries[0]

	// The stored entry passed to Enqueue MUST already have the URL redacted.
	if strings.Contains(e.Endpoint, "URLSECRET") {
		t.Errorf("endpoint leaks URLSECRET: %q", e.Endpoint)
	}
	if !strings.Contains(e.Endpoint, "api_key=REDACTED") {
		t.Errorf("endpoint=%q, want api_key=REDACTED", e.Endpoint)
	}
	if e.RequestBody != nil {
		s := *e.RequestBody
		if strings.Contains(s, "top-secret") {
			t.Errorf("request_body leaks top-secret: %q", s)
		}
		if strings.Contains(s, "JWTSECRET") {
			t.Errorf("request_body leaks JWTSECRET: %q", s)
		}
		if !strings.Contains(s, "keep") {
			t.Errorf("request_body=%q, want non-secret 'keep' preserved", s)
		}
	}
}
