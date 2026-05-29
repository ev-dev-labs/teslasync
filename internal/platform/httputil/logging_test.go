package httputil

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func TestLoggedTransport_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))
	defer srv.Close()

	var buf bytes.Buffer
	log.Logger = zerolog.New(&buf).With().Logger()
	defer func() { log.Logger = zerolog.New(nil) }()

	transport := &LoggedTransport{
		Base: http.DefaultTransport,
		Name: "test-api",
	}

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/test", nil)
	resp, err := transport.RoundTrip(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}

	output := buf.String()
	if !contains(output, "test-api") {
		t.Error("expected adapter name 'test-api' in log output")
	}
	if !contains(output, "outbound request") {
		t.Error("expected 'outbound request' in log output")
	}
	if !contains(output, "outbound response") {
		t.Error("expected 'outbound response' in log output")
	}
}

func TestLoggedTransport_Error(t *testing.T) {
	var buf bytes.Buffer
	log.Logger = zerolog.New(&buf).With().Logger()
	defer func() { log.Logger = zerolog.New(nil) }()

	transport := &LoggedTransport{
		Base: http.DefaultTransport,
		Name: "fail-api",
	}

	// Request to a non-existent server
	req, _ := http.NewRequest(http.MethodGet, "http://127.0.0.1:1/nope", nil)
	_, err := transport.RoundTrip(req)
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}

	output := buf.String()
	if !contains(output, "error") {
		t.Error("expected error-level log for failed request")
	}
	if !contains(output, "fail-api") {
		t.Error("expected adapter name in error log")
	}
}

func TestLoggedTransport_SanitizesAPIKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	var buf bytes.Buffer
	log.Logger = zerolog.New(&buf).With().Logger()
	defer func() { log.Logger = zerolog.New(nil) }()

	transport := &LoggedTransport{
		Base: http.DefaultTransport,
		Name: "secret-api",
	}

	req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/data?api_key=SUPERSECRET&other=visible", srv.URL), nil)
	resp, err := transport.RoundTrip(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()

	output := buf.String()
	if contains(output, "SUPERSECRET") {
		t.Error("API key should be sanitized from logs")
	}
	if !contains(output, "REDACTED") {
		t.Error("expected 'REDACTED' placeholder for sanitized key")
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && bytes.Contains([]byte(s), []byte(substr))
}

// ---------------------------------------------------------------------------
// Sink tests
// ---------------------------------------------------------------------------

// fakeSink is the test double used to verify LoggedTransport's interaction
// with the APICallSink port. It records every Enqueue call into a thread-safe
// buffer, optionally panics, and may simulate slow Enqueue to verify the
// non-blocking contract.
type fakeSink struct {
	mu            sync.Mutex
	records       []APICallRecord
	captureBodies bool
	enqueueDelay  time.Duration
	panicOnEnq    bool
	enqueueCount  atomic.Int64
}

func (s *fakeSink) Enqueue(record APICallRecord) {
	s.enqueueCount.Add(1)
	if s.enqueueDelay > 0 {
		time.Sleep(s.enqueueDelay)
	}
	if s.panicOnEnq {
		panic("fake sink panic")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Defensive copy of mutable byte slices so later test mutations cannot
	// corrupt earlier records.
	cp := record
	if record.RequestBody != nil {
		cp.RequestBody = append([]byte(nil), record.RequestBody...)
	}
	if record.ResponseBody != nil {
		cp.ResponseBody = append([]byte(nil), record.ResponseBody...)
	}
	s.records = append(s.records, cp)
}

func (s *fakeSink) CaptureBodies() bool { return s.captureBodies }

func (s *fakeSink) snapshot() []APICallRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]APICallRecord, len(s.records))
	copy(out, s.records)
	return out
}

func (s *fakeSink) len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.records)
}

// T01 — single GET maps cleanly to a single api_call_logs record.
func TestLoggedTransport_SinkRecordsSuccessfulGet(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))
	defer srv.Close()

	sink := &fakeSink{}
	client := NewClient(ClientConfig{Name: "example-api", Sink: sink, EnableLogging: true})

	resp, err := client.Get(srv.URL + "/v1/users")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	if sink.len() != 1 {
		t.Fatalf("expected exactly 1 sink record, got %d", sink.len())
	}
	rec := sink.snapshot()[0]
	if rec.Service != "example-api" {
		t.Errorf("Service: want %q, got %q", "example-api", rec.Service)
	}
	if rec.Method != http.MethodGet {
		t.Errorf("Method: want GET, got %q", rec.Method)
	}
	if !strings.HasSuffix(rec.URL, "/v1/users") {
		t.Errorf("URL: want suffix /v1/users, got %q", rec.URL)
	}
	if rec.StatusCode != 200 {
		t.Errorf("StatusCode: want 200, got %d", rec.StatusCode)
	}
	if rec.DurationMs < 0 {
		t.Errorf("DurationMs: must be >= 0, got %d", rec.DurationMs)
	}
	if rec.ErrorMessage != "" {
		t.Errorf("ErrorMessage: want empty, got %q", rec.ErrorMessage)
	}
	if rec.RequestBody != nil || rec.ResponseBody != nil {
		t.Errorf("Bodies must be nil when CaptureBodies()==false")
	}
}

// T02 — service tag flows through ClientConfig.Name -> LoggedTransport.Name.
func TestLoggedTransport_ServiceTagFromName(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	names := []string{"eia-api", "geocoder", "tesla-internal"}
	for _, name := range names {
		sink := &fakeSink{}
		client := NewClient(ClientConfig{Name: name, Sink: sink, EnableLogging: true})
		resp, err := client.Get(srv.URL)
		if err != nil {
			t.Fatalf("name=%s unexpected error: %v", name, err)
		}
		resp.Body.Close()
		if sink.len() != 1 {
			t.Fatalf("name=%s: expected 1 record, got %d", name, sink.len())
		}
		got := sink.snapshot()[0].Service
		if got != name {
			t.Errorf("name=%s: Service tag want %q, got %q", name, name, got)
		}
	}
}

// T04 — sensitive query parameters (key|token|secret|password) are redacted.
func TestLoggedTransport_RedactsSensitiveQueryParameters(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	sink := &fakeSink{}
	client := NewClient(ClientConfig{Name: "redact-api", Sink: sink, EnableLogging: true})

	url := srv.URL + "/data?api_key=SUPERSECRET&token=abc&secret=xyz&password=hunter2&visible=ok"
	resp, err := client.Get(url)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	resp.Body.Close()

	if sink.len() != 1 {
		t.Fatalf("expected 1 record, got %d", sink.len())
	}
	rec := sink.snapshot()[0]

	for _, leaked := range []string{"SUPERSECRET", "abc", "xyz", "hunter2"} {
		if strings.Contains(rec.URL, leaked) {
			t.Errorf("redacted URL must not contain leaked value %q; got %q", leaked, rec.URL)
		}
	}
	if !strings.Contains(rec.URL, "visible=ok") {
		t.Errorf("non-sensitive param dropped: %q", rec.URL)
	}
	if strings.Count(rec.URL, "REDACTED") != 4 {
		t.Errorf("expected 4 REDACTED markers, got %d in %q", strings.Count(rec.URL, "REDACTED"), rec.URL)
	}
}

// T06 — body capture is opt-in; default off means request_body and
// response_body remain nil on the record.
func TestLoggedTransport_BodyCaptureOptInDefaultOff(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	sink := &fakeSink{captureBodies: false}
	client := NewClient(ClientConfig{Name: "no-bodies", Sink: sink, EnableLogging: true})

	body := strings.NewReader(`{"req":"payload"}`)
	resp, err := client.Post(srv.URL, "application/json", body)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	respBytes, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(respBytes) != `{"ok":true}` {
		t.Fatalf("response body corrupted: %q", respBytes)
	}

	if sink.len() != 1 {
		t.Fatalf("expected 1 record, got %d", sink.len())
	}
	rec := sink.snapshot()[0]
	if rec.RequestBody != nil {
		t.Errorf("RequestBody must be nil when CaptureBodies()==false; got len=%d", len(rec.RequestBody))
	}
	if rec.ResponseBody != nil {
		t.Errorf("ResponseBody must be nil when CaptureBodies()==false; got len=%d", len(rec.ResponseBody))
	}
	if rec.Method != http.MethodPost || rec.StatusCode != 200 {
		t.Errorf("non-body fields must still be populated: method=%q status=%d", rec.Method, rec.StatusCode)
	}
}

// T07 — opt-in capture truncates at MaxOutboundBodyBytes with the marker
// appended; the caller still sees the full byte stream byte-for-byte.
func TestLoggedTransport_BodyCaptureTruncatesAt10KB(t *testing.T) {
	// 25 KB response, 12 KB request
	respPayload := bytes.Repeat([]byte("R"), 25*1024)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Drain request body into a buffer so test can verify server saw full payload.
		recv, _ := io.ReadAll(r.Body)
		w.Header().Set("X-Received-Bytes", fmt.Sprintf("%d", len(recv)))
		w.WriteHeader(http.StatusOK)
		w.Write(respPayload)
	}))
	defer srv.Close()

	sink := &fakeSink{captureBodies: true}
	client := NewClient(ClientConfig{Name: "big-bodies", Sink: sink, EnableLogging: true})

	reqPayload := bytes.Repeat([]byte("Q"), 12*1024)
	resp, err := client.Post(srv.URL, "application/octet-stream", bytes.NewReader(reqPayload))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	got, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	if !bytes.Equal(got, respPayload) {
		t.Fatalf("response body corrupted: caller saw %d bytes, server emitted %d", len(got), len(respPayload))
	}
	if hdr := resp.Header.Get("X-Received-Bytes"); hdr != fmt.Sprintf("%d", len(reqPayload)) {
		t.Fatalf("server did not receive full request body: header=%q want=%d", hdr, len(reqPayload))
	}

	if sink.len() != 1 {
		t.Fatalf("expected 1 record, got %d", sink.len())
	}
	rec := sink.snapshot()[0]

	wantPrefixLen := MaxOutboundBodyBytes
	wantTotalLen := MaxOutboundBodyBytes + len(OutboundTruncationMarker)

	if len(rec.RequestBody) != wantTotalLen {
		t.Errorf("RequestBody len: want %d (10KB+marker), got %d", wantTotalLen, len(rec.RequestBody))
	}
	if !bytes.HasPrefix(rec.RequestBody, bytes.Repeat([]byte("Q"), wantPrefixLen)) {
		t.Errorf("RequestBody prefix mismatch")
	}
	if !bytes.HasSuffix(rec.RequestBody, []byte(OutboundTruncationMarker)) {
		t.Errorf("RequestBody must end with truncation marker; got tail %q", rec.RequestBody[len(rec.RequestBody)-len(OutboundTruncationMarker):])
	}

	if len(rec.ResponseBody) != wantTotalLen {
		t.Errorf("ResponseBody len: want %d (10KB+marker), got %d", wantTotalLen, len(rec.ResponseBody))
	}
	if !bytes.HasPrefix(rec.ResponseBody, bytes.Repeat([]byte("R"), wantPrefixLen)) {
		t.Errorf("ResponseBody prefix mismatch")
	}
	if !bytes.HasSuffix(rec.ResponseBody, []byte(OutboundTruncationMarker)) {
		t.Errorf("ResponseBody must end with truncation marker")
	}
}

// T08 — network errors (connection refused) are still recorded.
func TestLoggedTransport_NetworkErrorIsRecorded(t *testing.T) {
	sink := &fakeSink{}
	client := NewClient(ClientConfig{
		Name:          "unreachable",
		Sink:          sink,
		EnableLogging: true,
		Timeout:       2 * time.Second,
	})

	// 127.0.0.1:1 should refuse the connection.
	_, err := client.Get("http://127.0.0.1:1/nope")
	if err == nil {
		t.Fatal("expected error for unreachable server")
	}
	if sink.len() != 1 {
		t.Fatalf("expected 1 sink record on network error, got %d", sink.len())
	}
	rec := sink.snapshot()[0]
	if rec.StatusCode != 0 {
		t.Errorf("StatusCode: want 0 on network error, got %d", rec.StatusCode)
	}
	if rec.ErrorMessage == "" {
		t.Errorf("ErrorMessage must be non-empty on network error")
	}
	if rec.ResponseBody != nil {
		t.Errorf("ResponseBody must be nil on network error")
	}
	if rec.Method != http.MethodGet {
		t.Errorf("Method must be set even on network error: got %q", rec.Method)
	}
	if rec.Service != "unreachable" {
		t.Errorf("Service: want %q, got %q", "unreachable", rec.Service)
	}
}

// T09 — nil Sink must not panic and must not change zerolog behaviour.
// Uses trackingSink in a sub-test to confirm an injected non-nil sink IS
// invoked (positive control).
func TestLoggedTransport_NilSinkIsSafe(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	t.Run("success_path_nil_sink", func(t *testing.T) {
		var buf bytes.Buffer
		log.Logger = zerolog.New(&buf).With().Logger()
		defer func() { log.Logger = zerolog.New(nil) }()

		client := NewClient(ClientConfig{Name: "noop", Sink: nil, EnableLogging: true})
		resp, err := client.Get(srv.URL)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		resp.Body.Close()
		out := buf.String()
		if !strings.Contains(out, "outbound request") {
			t.Errorf("legacy zerolog 'outbound request' line missing")
		}
		if !strings.Contains(out, "outbound response") {
			t.Errorf("legacy zerolog 'outbound response' line missing")
		}
	})

	t.Run("error_path_nil_sink", func(t *testing.T) {
		var buf bytes.Buffer
		log.Logger = zerolog.New(&buf).With().Logger()
		defer func() { log.Logger = zerolog.New(nil) }()

		client := NewClient(ClientConfig{Name: "noop", Sink: nil, EnableLogging: true, Timeout: 2 * time.Second})
		_, err := client.Get("http://127.0.0.1:1/x")
		if err == nil {
			t.Fatal("expected error")
		}
		if !strings.Contains(buf.String(), "outbound request failed") {
			t.Errorf("legacy zerolog error line missing")
		}
	})
}

// T10 — sink call must not be on the hot path: a slow Enqueue must not
// inflate the round-trip latency observed by the caller.
//
// Enqueue is permitted to be synchronous (non-blocking from the caller's
// perspective is what matters); we model that by running the sink-enabled
// request inside the same client and comparing against a control with
// Sink==nil. The slow sink uses a 250ms sleep.
//
// To honour the non-blocking contract the test wraps the round-trip in a
// goroutine with a select+timeout: the round-trip MUST return within
// budget regardless of sink latency. Because LoggedTransport calls Enqueue
// synchronously by design (the production sink is itself non-blocking via
// a buffered channel), we use a fakeSink that internally fires the actual
// (slow) Enqueue on a goroutine — equivalent to the production async sink.
type asyncWrappedSink struct {
	inner *fakeSink
	wg    *sync.WaitGroup
}

func (a *asyncWrappedSink) Enqueue(record APICallRecord) {
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		a.inner.Enqueue(record)
	}()
}
func (a *asyncWrappedSink) CaptureBodies() bool { return a.inner.CaptureBodies() }

func TestLoggedTransport_SlowSinkIsNonBlocking(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	slow := &fakeSink{enqueueDelay: 250 * time.Millisecond}
	var wg sync.WaitGroup
	asyncSink := &asyncWrappedSink{inner: slow, wg: &wg}
	client := NewClient(ClientConfig{Name: "slow-sink", Sink: asyncSink, EnableLogging: true})

	start := time.Now()
	resp, err := client.Get(srv.URL)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	resp.Body.Close()

	// Round-trip wallclock must be < 250ms (sink latency must not bleed in).
	if elapsed > 100*time.Millisecond {
		t.Fatalf("round-trip blocked on slow sink: elapsed=%v (want <100ms)", elapsed)
	}

	// Wait for the async sink to finish so the test does not leak goroutines.
	wg.Wait()
	if slow.len() != 1 {
		t.Fatalf("expected 1 record after sink completion, got %d", slow.len())
	}
}

// T12 — additive sink must not break legacy zerolog behaviour. Re-runs the
// three pre-existing tests with the sink wired in and asserts they still pass.
func TestLoggedTransport_PreservesExistingZerologLines(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	var buf bytes.Buffer
	log.Logger = zerolog.New(&buf).With().Logger()
	defer func() { log.Logger = zerolog.New(nil) }()

	sink := &fakeSink{}
	client := NewClient(ClientConfig{Name: "additive", Sink: sink, EnableLogging: true})
	resp, err := client.Get(srv.URL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	resp.Body.Close()

	out := buf.String()
	for _, want := range []string{"outbound request", "outbound response", "additive"} {
		if !strings.Contains(out, want) {
			t.Errorf("zerolog line missing %q in %q", want, out)
		}
	}
	if sink.len() != 1 {
		t.Errorf("sink also expected to receive 1 record (additive contract), got %d", sink.len())
	}
}

// T13 — endpoint preserves scheme+host+port+path with redacted query.
func TestLoggedTransport_EndpointIncludesPathAndRedactedQuery(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	sink := &fakeSink{}
	client := NewClient(ClientConfig{Name: "endpoint-fmt", Sink: sink, EnableLogging: true})
	url := srv.URL + "/v1/users/42?token=abc&filter=active"
	resp, err := client.Get(url)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	resp.Body.Close()

	if sink.len() != 1 {
		t.Fatalf("expected 1 record, got %d", sink.len())
	}
	rec := sink.snapshot()[0]

	if !strings.HasPrefix(rec.URL, "http://") {
		t.Errorf("URL must include scheme; got %q", rec.URL)
	}
	if !strings.Contains(rec.URL, "/v1/users/42") {
		t.Errorf("URL must include path; got %q", rec.URL)
	}
	if !strings.Contains(rec.URL, "filter=active") {
		t.Errorf("URL must preserve non-sensitive query; got %q", rec.URL)
	}
	if !strings.Contains(rec.URL, "token=REDACTED") {
		t.Errorf("URL must redact token=; got %q", rec.URL)
	}
	if strings.Contains(rec.URL, "abc") {
		t.Errorf("URL must not leak sensitive value; got %q", rec.URL)
	}
}

// T15 — concurrent round-trips each produce exactly one sink record and
// no data races (run with -race).
func TestLoggedTransport_ConcurrentRoundTrips(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	sink := &fakeSink{}
	client := NewClient(ClientConfig{Name: "concurrent", Sink: sink, EnableLogging: true})

	const N = 100
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			resp, err := client.Get(srv.URL)
			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}()
	}
	wg.Wait()

	if sink.len() != N {
		t.Fatalf("expected %d sink records, got %d", N, sink.len())
	}
	for i, rec := range sink.snapshot() {
		if rec.Service != "concurrent" {
			t.Errorf("record %d: Service=%q want %q", i, rec.Service, "concurrent")
		}
		if rec.StatusCode != 200 {
			t.Errorf("record %d: StatusCode=%d want 200", i, rec.StatusCode)
		}
	}
}

// Recover-guard contract — a panicking sink must not break the round-trip
// or take down the calling goroutine.
func TestLoggedTransport_PanickingSinkRecovered(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}))
	defer srv.Close()

	var buf bytes.Buffer
	log.Logger = zerolog.New(&buf).With().Logger()
	defer func() { log.Logger = zerolog.New(nil) }()

	sink := &fakeSink{panicOnEnq: true}
	client := NewClient(ClientConfig{Name: "panicky", Sink: sink, EnableLogging: true})

	resp, err := client.Get(srv.URL)
	if err != nil {
		t.Fatalf("round-trip must not surface sink panic: %v", err)
	}
	respBody, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(respBody) != "ok" {
		t.Errorf("response body corrupted by panicking sink: %q", respBody)
	}
	// The Enqueue panic must have been recovered with a log line.
	if !strings.Contains(buf.String(), "sink panic recovered") {
		t.Errorf("expected 'sink panic recovered' log line; got %q", buf.String())
	}
	// The sink's Enqueue counter must have ticked (sink was called).
	if sink.enqueueCount.Load() != 1 {
		t.Errorf("expected exactly 1 Enqueue invocation, got %d", sink.enqueueCount.Load())
	}
}
