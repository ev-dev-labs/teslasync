package apilog_test

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/ev-dev-labs/teslasync/internal/apilog"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

type fakeInserter struct {
	mu      sync.Mutex
	batches int
	rows    int
	delay   time.Duration
	err     error
}

func (f *fakeInserter) CreateBatch(ctx context.Context, batch []*teslamodel.APICallLog) error {
	if f.delay > 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(f.delay):
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.batches++
	f.rows += len(batch)
	return f.err
}

func (f *fakeInserter) snapshot() (int, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.batches, f.rows
}

func counterValue(c prometheus.Counter) float64 {
	m := &dto.Metric{}
	_ = c.Write(m)
	return m.GetCounter().GetValue()
}

func TestNewAsync_NilInserter_ReturnsNoOp(t *testing.T) {
	t.Parallel()
	l := apilog.NewAsync(nil, apilog.AsyncOptions{})
	l.Enqueue(&teslamodel.APICallLog{Service: "x", Endpoint: "/y"})
	if err := l.Shutdown(context.Background()); err != nil {
		t.Fatalf("noop Shutdown returned error: %v", err)
	}
}

func TestNewAsync_FlushesByBatchSize(t *testing.T) {
	t.Parallel()
	ins := &fakeInserter{}
	l := apilog.NewAsync(ins, apilog.AsyncOptions{
		QueueCapacity: 16,
		BatchSize:     3,
		FlushInterval: time.Hour,
	})
	for i := 0; i < 6; i++ {
		l.Enqueue(&teslamodel.APICallLog{Endpoint: "/x"})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := l.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	b, r := ins.snapshot()
	if r != 6 {
		t.Errorf("rows=%d, want 6", r)
	}
	if b < 1 {
		t.Errorf("batches=%d, want >=1", b)
	}
}

func TestEnqueue_QueueFull_DropsAndIncrementsCounter(t *testing.T) {
	// Tests the non-blocking drop-on-full contract — the same contract the
	// inbound HTTP middleware relies on.
	ins := &fakeInserter{delay: 50 * time.Millisecond}
	l := apilog.NewAsync(ins, apilog.AsyncOptions{
		QueueCapacity: 1,
		BatchSize:     1,
		FlushInterval: time.Hour,
	})
	defer l.Shutdown(context.Background())

	before := counterValue(apilog.DropsCounter)
	// Saturate the queue. The first Enqueue lands in the channel; the
	// worker pulls it and starts a 50ms delayed CreateBatch. The next
	// few Enqueues should land or drop, and at least one drop is
	// guaranteed because the channel cap is 1 and CreateBatch holds
	// the worker for 50ms.
	for i := 0; i < 64; i++ {
		l.Enqueue(&teslamodel.APICallLog{Endpoint: "/x"})
	}
	after := counterValue(apilog.DropsCounter)
	if after-before == 0 {
		t.Errorf("expected DropsCounter to increase; before=%v after=%v", before, after)
	}
}

func TestShutdown_SecondEnqueueIsDropped(t *testing.T) {
	t.Parallel()
	ins := &fakeInserter{}
	l := apilog.NewAsync(ins, apilog.AsyncOptions{
		QueueCapacity: 4,
		BatchSize:     2,
		FlushInterval: time.Hour,
	})
	l.Enqueue(&teslamodel.APICallLog{Endpoint: "/a"})
	if err := l.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	before := counterValue(apilog.DropsCounter)
	l.Enqueue(&teslamodel.APICallLog{Endpoint: "/b"})
	after := counterValue(apilog.DropsCounter)
	if after-before != 1 {
		t.Errorf("post-Shutdown Enqueue: drops delta=%v, want 1", after-before)
	}
}

func TestShutdown_ContextCancelled(t *testing.T) {
	t.Parallel()
	ins := &fakeInserter{delay: time.Second}
	l := apilog.NewAsync(ins, apilog.AsyncOptions{
		QueueCapacity: 4,
		BatchSize:     1,
		FlushInterval: time.Hour,
	})
	l.Enqueue(&teslamodel.APICallLog{Endpoint: "/x"})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	err := l.Shutdown(ctx)
	if err == nil {
		t.Errorf("expected context deadline error, got nil")
	}
}

type capturingLogger struct {
	mu      sync.Mutex
	entries []*teslamodel.APICallLog
}

func (c *capturingLogger) Enqueue(e *teslamodel.APICallLog) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = append(c.entries, e)
}

func (c *capturingLogger) Shutdown(context.Context) error { return nil }

func TestSinkAdapter_NilLogger_ReturnsNoOp(t *testing.T) {
	t.Parallel()
	s := apilog.SinkAdapter(nil, true)
	s.Enqueue(httputil.APICallRecord{Service: "x"})
	if got := s.CaptureBodies(); got {
		t.Errorf("nullSink.CaptureBodies = %v, want false", got)
	}
}

func TestSinkAdapter_RoundTrip(t *testing.T) {
	t.Parallel()
	cl := &capturingLogger{}
	s := apilog.SinkAdapter(cl, true)
	s.Enqueue(httputil.APICallRecord{
		Service:      "tesla",
		Method:       "GET",
		URL:          "https://example.com/x",
		StatusCode:   200,
		DurationMs:   42,
		ErrorMessage: "",
		RequestBody:  []byte(`{"k":1}`),
		ResponseBody: []byte(`{"ok":true}`),
	})
	if !s.CaptureBodies() {
		t.Errorf("CaptureBodies = false, want true")
	}
	cl.mu.Lock()
	defer cl.mu.Unlock()
	if len(cl.entries) != 1 {
		t.Fatalf("entries=%d, want 1", len(cl.entries))
	}
	e := cl.entries[0]
	if e.Service != "tesla" {
		t.Errorf("service=%q, want tesla", e.Service)
	}
	if e.HTTPMethod != "GET" || e.Endpoint != "https://example.com/x" {
		t.Errorf("method/url mismatch: %s %s", e.HTTPMethod, e.Endpoint)
	}
	if e.StatusCode != 200 || e.DurationMs != 42 {
		t.Errorf("status/duration: %d %d", e.StatusCode, e.DurationMs)
	}
	if e.RequestBody == nil || *e.RequestBody != `{"k":1}` {
		t.Errorf("request_body=%v", e.RequestBody)
	}
	if e.ResponseBody == nil || *e.ResponseBody != `{"ok":true}` {
		t.Errorf("response_body=%v", e.ResponseBody)
	}
}

func TestConcurrent_NoRace(t *testing.T) {
	ins := &fakeInserter{}
	l := apilog.NewAsync(ins, apilog.AsyncOptions{
		QueueCapacity: 1024,
		BatchSize:     32,
		FlushInterval: 50 * time.Millisecond,
	})
	var wg sync.WaitGroup
	var sent int64
	for w := 0; w < 8; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 200; i++ {
				l.Enqueue(&teslamodel.APICallLog{Endpoint: "/x"})
				atomic.AddInt64(&sent, 1)
			}
		}()
	}
	wg.Wait()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := l.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
}
