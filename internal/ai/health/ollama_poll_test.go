package health

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeSuspender records calls for assertion.
type fakeSuspender struct {
	mu    sync.Mutex
	calls []suspendCall
}

type suspendCall struct {
	name  string
	until time.Time
}

func (s *fakeSuspender) SuspendProvider(name string, until time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, suspendCall{name: name, until: until})
}

func (s *fakeSuspender) lastCall() (suspendCall, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.calls) == 0 {
		return suspendCall{}, false
	}
	return s.calls[len(s.calls)-1], true
}

func (s *fakeSuspender) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.calls)
}

// fakeDoer implements Doer; the per-probe behaviour is determined by
// a sequence of canned responses.
type fakeDoer struct {
	responses []*http.Response
	errors    []error
	calls     atomic.Int32
}

func (f *fakeDoer) Do(req *http.Request) (*http.Response, error) {
	idx := int(f.calls.Add(1)) - 1
	if idx < len(f.errors) && f.errors[idx] != nil {
		return nil, f.errors[idx]
	}
	if idx < len(f.responses) {
		return f.responses[idx], nil
	}
	// Default: 200 OK with a minimal body.
	return okResponse(""), nil
}

func okResponse(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Status:     "200 OK",
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func errResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     http.StatusText(status),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

type fixedClock struct {
	t time.Time
}

func (c fixedClock) Now() time.Time { return c.t }

func TestNewOllamaPoller_NilOnEmptyBaseURL(t *testing.T) {
	t.Parallel()
	p := NewOllamaPoller(Config{}, &fakeSuspender{})
	if p != nil {
		t.Errorf("expected nil for empty BaseURL, got %v", p)
	}
}

func TestNewOllamaPoller_NilOnNilSuspender(t *testing.T) {
	t.Parallel()
	p := NewOllamaPoller(Config{BaseURL: "http://localhost:11434"}, nil)
	if p != nil {
		t.Errorf("expected nil for nil Suspender, got %v", p)
	}
}

func TestNewOllamaPoller_AppliesDefaults(t *testing.T) {
	t.Parallel()
	p := NewOllamaPoller(Config{BaseURL: "http://localhost:11434"}, &fakeSuspender{})
	if p == nil {
		t.Fatal("expected non-nil poller")
	}
	if p.cfg.ProviderName != "ollama" {
		t.Errorf("default ProviderName = %q, want ollama", p.cfg.ProviderName)
	}
	if p.cfg.Interval != DefaultInterval {
		t.Errorf("default Interval = %v, want %v", p.cfg.Interval, DefaultInterval)
	}
	if p.cfg.FailureThreshold != DefaultFailureThreshold {
		t.Errorf("default FailureThreshold = %d, want %d", p.cfg.FailureThreshold, DefaultFailureThreshold)
	}
	if p.cfg.SuspendDuration != DefaultSuspendDuration {
		t.Errorf("default SuspendDuration = %v, want %v", p.cfg.SuspendDuration, DefaultSuspendDuration)
	}
}

func TestProbeOnce_HealthyResetsCounter(t *testing.T) {
	t.Parallel()
	suspender := &fakeSuspender{}
	doer := &fakeDoer{}
	p := NewOllamaPoller(Config{
		BaseURL:    "http://localhost:11434",
		HTTPClient: doer,
	}, suspender)

	p.consecFails.Store(2) // simulate prior failures
	p.probeOnce(context.Background())
	if got := p.ConsecutiveFailures(); got != 0 {
		t.Errorf("expected counter reset to 0; got %d", got)
	}
	if p.LastStatus() != "ok" {
		t.Errorf("LastStatus = %q, want ok", p.LastStatus())
	}
	if suspender.callCount() != 0 {
		t.Errorf("healthy probe should NOT suspend; got %d calls", suspender.callCount())
	}
}

func TestProbeOnce_TransportErrorIncrementsCounter(t *testing.T) {
	t.Parallel()
	suspender := &fakeSuspender{}
	doer := &fakeDoer{errors: []error{errors.New("connection refused")}}
	p := NewOllamaPoller(Config{
		BaseURL:          "http://localhost:11434",
		HTTPClient:       doer,
		FailureThreshold: 5,
	}, suspender)

	p.probeOnce(context.Background())
	if got := p.ConsecutiveFailures(); got != 1 {
		t.Errorf("expected counter=1, got %d", got)
	}
	if p.LastStatus() != "fail" {
		t.Errorf("LastStatus = %q, want fail", p.LastStatus())
	}
	if suspender.callCount() != 0 {
		t.Errorf("below threshold should NOT suspend; got %d calls", suspender.callCount())
	}
}

func TestProbeOnce_Non200StatusIncrementsCounter(t *testing.T) {
	t.Parallel()
	suspender := &fakeSuspender{}
	doer := &fakeDoer{responses: []*http.Response{errResponse(503, "service unavailable")}}
	p := NewOllamaPoller(Config{
		BaseURL:          "http://localhost:11434",
		HTTPClient:       doer,
		FailureThreshold: 5,
	}, suspender)

	p.probeOnce(context.Background())
	if got := p.ConsecutiveFailures(); got != 1 {
		t.Errorf("expected counter=1 on 503, got %d", got)
	}
}

func TestProbeOnce_OOMBodyTriggersFailure(t *testing.T) {
	t.Parallel()
	suspender := &fakeSuspender{}
	doer := &fakeDoer{responses: []*http.Response{okResponse(`{"error":"out of memory: cannot load model"}`)}}
	p := NewOllamaPoller(Config{
		BaseURL:          "http://localhost:11434",
		HTTPClient:       doer,
		FailureThreshold: 5,
	}, suspender)

	p.probeOnce(context.Background())
	if got := p.ConsecutiveFailures(); got != 1 {
		t.Errorf("expected counter=1 on OOM body, got %d", got)
	}
}

func TestProbeOnce_SuspensionFiresAtThreshold(t *testing.T) {
	t.Parallel()
	suspender := &fakeSuspender{}
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	clk := fixedClock{t: now}
	doer := &fakeDoer{
		errors: []error{errors.New("e1"), errors.New("e2"), errors.New("e3")},
	}
	p := NewOllamaPoller(Config{
		BaseURL:          "http://localhost:11434",
		HTTPClient:       doer,
		FailureThreshold: 3,
		SuspendDuration:  90 * time.Second,
		Clock:            clk,
	}, suspender)

	for i := 0; i < 3; i++ {
		p.probeOnce(context.Background())
	}
	if got := suspender.callCount(); got != 1 {
		t.Errorf("expected 1 suspend call after 3 failures; got %d", got)
	}
	last, _ := suspender.lastCall()
	if last.name != "ollama" {
		t.Errorf("suspend name = %q, want ollama", last.name)
	}
	wantUntil := now.Add(90 * time.Second)
	if !last.until.Equal(wantUntil) {
		t.Errorf("suspend until = %v, want %v", last.until, wantUntil)
	}
}

func TestProbeOnce_HealthyAfterSuspensionResetsCounter(t *testing.T) {
	t.Parallel()
	suspender := &fakeSuspender{}
	doer := &fakeDoer{
		errors: []error{errors.New("e1"), errors.New("e2"), errors.New("e3"), nil},
	}
	p := NewOllamaPoller(Config{
		BaseURL:          "http://localhost:11434",
		HTTPClient:       doer,
		FailureThreshold: 3,
	}, suspender)

	for i := 0; i < 3; i++ {
		p.probeOnce(context.Background())
	}
	if suspender.callCount() != 1 {
		t.Errorf("expected 1 suspend; got %d", suspender.callCount())
	}
	// Fourth probe is healthy — counter resets.
	p.probeOnce(context.Background())
	if got := p.ConsecutiveFailures(); got != 0 {
		t.Errorf("expected counter=0 after healthy probe; got %d", got)
	}
	if p.LastStatus() != "ok" {
		t.Errorf("status = %q, want ok", p.LastStatus())
	}
}

func TestProbeOnce_CustomProviderName(t *testing.T) {
	t.Parallel()
	suspender := &fakeSuspender{}
	doer := &fakeDoer{errors: []error{errors.New("e")}}
	p := NewOllamaPoller(Config{
		BaseURL:          "http://localhost:11434",
		ProviderName:     "ollama-gpu",
		HTTPClient:       doer,
		FailureThreshold: 1,
	}, suspender)
	p.probeOnce(context.Background())
	last, ok := suspender.lastCall()
	if !ok || last.name != "ollama-gpu" {
		t.Errorf("expected suspend for ollama-gpu, got %v", last)
	}
}

func TestRun_ExitsOnContextCancel(t *testing.T) {
	t.Parallel()
	suspender := &fakeSuspender{}
	doer := &fakeDoer{}
	p := NewOllamaPoller(Config{
		BaseURL:    "http://localhost:11434",
		HTTPClient: doer,
		Interval:   10 * time.Millisecond,
	}, suspender)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- p.Run(ctx) }()

	// Let a few probes fire.
	time.Sleep(50 * time.Millisecond)
	cancel()

	select {
	case err := <-done:
		if err != nil {
			t.Errorf("Run returned err = %v, want nil", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Run did not exit after ctx cancel")
	}
	if doer.calls.Load() < 1 {
		t.Errorf("expected at least 1 probe; got %d", doer.calls.Load())
	}
}

func TestRun_InitialProbeFiresImmediately(t *testing.T) {
	t.Parallel()
	suspender := &fakeSuspender{}
	doer := &fakeDoer{}
	p := NewOllamaPoller(Config{
		BaseURL:    "http://localhost:11434",
		HTTPClient: doer,
		Interval:   time.Hour, // long enough that ticker won't fire
	}, suspender)

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	go func() { _ = p.Run(ctx) }()

	// Wait briefly; one probe should have fired before the ticker.
	time.Sleep(100 * time.Millisecond)
	if got := doer.calls.Load(); got < 1 {
		t.Errorf("expected initial probe; got %d calls", got)
	}
}

func TestRun_RequestPathIsApiTags(t *testing.T) {
	t.Parallel()
	var captured atomic.Value
	doer := doerFunc(func(req *http.Request) (*http.Response, error) {
		captured.Store(req.URL.String())
		return okResponse(""), nil
	})
	suspender := &fakeSuspender{}
	p := NewOllamaPoller(Config{
		BaseURL:    "http://example.com:11434/",
		HTTPClient: doer,
	}, suspender)
	p.probeOnce(context.Background())
	got, _ := captured.Load().(string)
	if got != "http://example.com:11434/api/tags" {
		t.Errorf("URL = %q, want http://example.com:11434/api/tags", got)
	}
}

// doerFunc adapts a function value to Doer.
type doerFunc func(*http.Request) (*http.Response, error)

func (f doerFunc) Do(req *http.Request) (*http.Response, error) { return f(req) }
