package mqtt

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
)

func startTestPersistenceWorkers(t *testing.T, sub *PipelineSubscriber) {
	t.Helper()
	sub.persistenceShards = makePersistenceShards(
		sub.cfg.PersistenceConcurrency,
		sub.cfg.PersistenceQueueCapacity,
	)
	sub.startPersistenceWorkers()
	t.Cleanup(func() {
		sub.persistenceStarted.Store(false)
		sub.cancel()
		sub.persistenceWG.Wait()
	})
}

func TestMakePersistenceShards_PreservesTotalQueueCapacity(t *testing.T) {
	shards := makePersistenceShards(4, 6)
	if len(shards) != 4 {
		t.Fatalf("shards = %d, want 4", len(shards))
	}
	totalCapacity := 0
	for _, shard := range shards {
		totalCapacity += cap(shard)
	}
	if totalCapacity != 6 {
		t.Fatalf("total queue capacity = %d, want 6", totalCapacity)
	}
}

func TestPersistenceBatcher_CoalescesSameVehicleTimestamp(t *testing.T) {
	pipeline := &fakePipeline{}
	sub := newTestSubscriber(t, pipeline, &fakeDLQ{}, staticResolver(42))
	sub.cfg.BatchWindow = 25 * time.Millisecond
	sub.cfg.BatchMaxMessages = 16
	sub.cfg.PersistenceConcurrency = 1
	sub.cfg.PersistenceQueueCapacity = 16
	startTestPersistenceWorkers(t, sub)

	ts := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	inputs := [][]codec.Atomic{
		{{Field: "Soc", Value: float32(75), EmittedAt: ts, VehicleID: "VIN"}},
		{{Field: "VehicleSpeed", Value: float32(12), EmittedAt: ts, VehicleID: "VIN"}},
	}
	errs := make(chan error, len(inputs))
	for _, atomics := range inputs {
		atomics := atomics
		go func() {
			errs <- sub.persistAtomics(context.Background(), 42, atomics)
		}()
	}
	for range inputs {
		if err := <-errs; err != nil {
			t.Fatalf("persistAtomics: %v", err)
		}
	}

	calls := pipeline.Calls()
	if len(calls) != 1 {
		t.Fatalf("ProcessAtomics calls = %d, want 1", len(calls))
	}
	if len(calls[0].Atomics) != 2 {
		t.Fatalf("batch atomic count = %d, want 2", len(calls[0].Atomics))
	}
	if calls[0].VehicleID != 42 {
		t.Fatalf("vehicle ID = %d, want 42", calls[0].VehicleID)
	}
}

func TestPersistenceBatcher_ProcessesSourceTimestampsInOrder(t *testing.T) {
	pipeline := &fakePipeline{}
	sub := newTestSubscriber(t, pipeline, &fakeDLQ{}, staticResolver(42))
	sub.cfg.BatchWindow = 25 * time.Millisecond
	sub.cfg.BatchMaxMessages = 16
	sub.cfg.PersistenceConcurrency = 1
	sub.cfg.PersistenceQueueCapacity = 16
	startTestPersistenceWorkers(t, sub)

	older := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	newer := older.Add(time.Second)
	errs := make(chan error, 2)
	go func() {
		errs <- sub.persistAtomics(context.Background(), 42, []codec.Atomic{{
			Field: "Soc", Value: float32(76), EmittedAt: newer, VehicleID: "VIN",
		}})
	}()
	go func() {
		errs <- sub.persistAtomics(context.Background(), 42, []codec.Atomic{{
			Field: "Soc", Value: float32(75), EmittedAt: older, VehicleID: "VIN",
		}})
	}()
	for range 2 {
		if err := <-errs; err != nil {
			t.Fatalf("persistAtomics: %v", err)
		}
	}

	calls := pipeline.Calls()
	if len(calls) != 2 {
		t.Fatalf("ProcessAtomics calls = %d, want 2 timestamp groups", len(calls))
	}
	if got := calls[0].Atomics[0].EmittedAt; !got.Equal(older) {
		t.Errorf("first timestamp = %v, want %v", got, older)
	}
	if got := calls[1].Atomics[0].EmittedAt; !got.Equal(newer) {
		t.Errorf("second timestamp = %v, want %v", got, newer)
	}
}

type concurrencyTrackingPipeline struct {
	mu        sync.Mutex
	active    int
	maxActive int
}

type contextBlockingPipeline struct {
	started chan struct{}
	once    sync.Once
}

func (p *contextBlockingPipeline) ProcessAtomics(
	ctx context.Context,
	_ []codec.Atomic,
	_ int64,
) error {
	p.once.Do(func() { close(p.started) })
	<-ctx.Done()
	return ctx.Err()
}

func (p *concurrencyTrackingPipeline) ProcessAtomics(
	ctx context.Context,
	_ []codec.Atomic,
	_ int64,
) error {
	p.mu.Lock()
	p.active++
	if p.active > p.maxActive {
		p.maxActive = p.active
	}
	p.mu.Unlock()

	select {
	case <-time.After(20 * time.Millisecond):
	case <-ctx.Done():
		return ctx.Err()
	}

	p.mu.Lock()
	p.active--
	p.mu.Unlock()
	return nil
}

func TestPersistenceBatcher_BoundsConcurrentDatabaseWork(t *testing.T) {
	pipeline := &concurrencyTrackingPipeline{}
	sub := newTestSubscriber(t, pipeline, &fakeDLQ{}, staticResolver(1))
	sub.cfg.BatchWindow = time.Millisecond
	sub.cfg.BatchMaxMessages = 1
	sub.cfg.PersistenceConcurrency = 2
	sub.cfg.PersistenceQueueCapacity = 8
	startTestPersistenceWorkers(t, sub)

	const messages = 8
	errs := make(chan error, messages)
	for i := 0; i < messages; i++ {
		vehicleID := int64(i + 1)
		go func() {
			errs <- sub.persistAtomics(context.Background(), vehicleID, []codec.Atomic{{
				Field:     "Soc",
				Value:     float32(50),
				EmittedAt: time.Now().UTC(),
				VehicleID: "VIN",
			}})
		}()
	}
	for range messages {
		if err := <-errs; err != nil {
			t.Fatalf("persistAtomics: %v", err)
		}
	}

	pipeline.mu.Lock()
	maxActive := pipeline.maxActive
	pipeline.mu.Unlock()
	if maxActive > 2 {
		t.Fatalf("max concurrent persistence calls = %d, want <= 2", maxActive)
	}
	if maxActive < 2 {
		t.Fatalf("max concurrent persistence calls = %d, want 2 to prove parallel shards", maxActive)
	}
}

func TestPersistenceBatcher_TimeoutQuarantinesAndAcknowledges(t *testing.T) {
	pipeline := &contextBlockingPipeline{started: make(chan struct{})}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipeline, dlq, staticResolver(42))
	sub.cfg.BatchWindow = time.Millisecond
	sub.cfg.BatchMaxMessages = 1
	sub.cfg.PersistenceConcurrency = 1
	sub.cfg.PersistenceQueueCapacity = 1
	sub.cfg.PersistenceTimeout = 20 * time.Millisecond
	startTestPersistenceWorkers(t, sub)

	var ackCalls atomic.Int32
	sub.handlePayload(context.Background(), mqttPayload{
		Topic:      "telemetry/VIN/v/Soc",
		Payload:    []byte("75"),
		MessageID:  1,
		ReceivedAt: time.Now().UTC(),
		Ack:        func() { ackCalls.Add(1) },
	})

	if got := ackCalls.Load(); got != 1 {
		t.Fatalf("ack calls = %d, want 1 after a non-shutdown timeout", got)
	}
	entries := dlq.Entries()
	if len(entries) != 1 {
		t.Fatalf("DLQ entries = %d, want 1", len(entries))
	}
	if !strings.Contains(entries[0].Reason, context.DeadlineExceeded.Error()) {
		t.Fatalf("DLQ reason = %q, want deadline exceeded", entries[0].Reason)
	}
}

func TestPersistenceBatcher_ShutdownCancellationLeavesMessageUnacknowledged(t *testing.T) {
	pipeline := &contextBlockingPipeline{started: make(chan struct{})}
	dlq := &fakeDLQ{}
	sub := newTestSubscriber(t, pipeline, dlq, staticResolver(42))
	sub.cfg.BatchWindow = time.Millisecond
	sub.cfg.BatchMaxMessages = 1
	sub.cfg.PersistenceConcurrency = 1
	sub.cfg.PersistenceQueueCapacity = 1
	sub.cfg.PersistenceTimeout = time.Second
	startTestPersistenceWorkers(t, sub)

	var ackCalls atomic.Int32
	done := make(chan struct{})
	go func() {
		defer close(done)
		sub.handlePayload(sub.ctx, mqttPayload{
			Topic:      "telemetry/VIN/v/Soc",
			Payload:    []byte("75"),
			MessageID:  1,
			ReceivedAt: time.Now().UTC(),
			Ack:        func() { ackCalls.Add(1) },
		})
	}()

	select {
	case <-pipeline.started:
	case <-time.After(time.Second):
		t.Fatal("pipeline did not begin persistence")
	}
	sub.cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("handler did not stop after subscriber cancellation")
	}

	if got := ackCalls.Load(); got != 0 {
		t.Fatalf("ack calls = %d, want 0 during shutdown", got)
	}
	if got := len(dlq.Entries()); got != 0 {
		t.Fatalf("DLQ entries = %d, want 0 during shutdown", got)
	}
}

func TestPersistenceBatcher_PropagatesPipelineErrorToEveryMessage(t *testing.T) {
	sentinel := errors.New("database unavailable")
	pipeline := &fakePipeline{errs: []error{sentinel}}
	sub := newTestSubscriber(t, pipeline, &fakeDLQ{}, staticResolver(42))
	sub.cfg.BatchWindow = 25 * time.Millisecond
	sub.cfg.BatchMaxMessages = 16
	sub.cfg.PersistenceConcurrency = 1
	sub.cfg.PersistenceQueueCapacity = 16
	startTestPersistenceWorkers(t, sub)

	ts := time.Now().UTC()
	errs := make(chan error, 2)
	for _, field := range []string{"Soc", "VehicleSpeed"} {
		field := field
		go func() {
			errs <- sub.persistAtomics(context.Background(), 42, []codec.Atomic{{
				Field: field, Value: float32(75), EmittedAt: ts, VehicleID: "VIN",
			}})
		}()
	}
	for range 2 {
		if err := <-errs; !errors.Is(err, sentinel) {
			t.Fatalf("persistAtomics error = %v, want %v", err, sentinel)
		}
	}
}
