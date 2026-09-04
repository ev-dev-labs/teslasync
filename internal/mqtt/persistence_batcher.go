package mqtt

import (
	"context"
	"errors"
	"fmt"
	"runtime/debug"
	"sort"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
)

var (
	telemetryPersistenceInFlight = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "tesla",
		Subsystem: "mqtt",
		Name:      "persistence_batches_in_flight",
		Help:      "Telemetry persistence batches currently executing. Bounded by the configured persistence concurrency.",
	})
	telemetryPersistenceAdmissionWait = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "tesla",
		Subsystem: "mqtt",
		Name:      "persistence_admission_wait_seconds",
		Help:      "Time MQTT handlers wait for bounded persistence queue admission.",
		Buckets:   []float64{0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30},
	})
	telemetryPersistenceQueueWait = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "tesla",
		Subsystem: "mqtt",
		Name:      "persistence_queue_wait_seconds",
		Help:      "Time admitted telemetry waits before a persistence worker begins its batch.",
		Buckets:   []float64{0.001, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30},
	})
	telemetryPersistenceBatchSize = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "tesla",
		Subsystem: "mqtt",
		Name:      "persistence_batch_messages",
		Help:      "Number of per-field MQTT messages coalesced into one normalize/router persistence call.",
		Buckets:   []float64{1, 2, 4, 8, 16, 32, 64, 128, 256},
	})
	telemetryPersistenceBatches = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "tesla",
		Subsystem: "mqtt",
		Name:      "persistence_batches_total",
		Help:      "Telemetry persistence batches by bounded outcome.",
	}, []string{"outcome"})
)

type persistenceWork struct {
	ctx        context.Context
	vehicleID  int64
	atomics    []codec.Atomic
	result     chan error
	enqueuedAt time.Time
}

func makePersistenceShards(concurrency, totalCapacity int) []chan persistenceWork {
	if concurrency < 1 {
		concurrency = 1
	}
	if totalCapacity < 0 {
		totalCapacity = 0
	}
	shards := make([]chan persistenceWork, concurrency)
	for i := range shards {
		capacity := totalCapacity / concurrency
		if i < totalCapacity%concurrency {
			capacity++
		}
		shards[i] = make(chan persistenceWork, capacity)
	}
	return shards
}

func (s *PipelineSubscriber) startPersistenceWorkers() {
	if !s.persistenceStarted.CompareAndSwap(false, true) {
		return
	}
	for i := range s.persistenceShards {
		s.persistenceWG.Add(1)
		go s.persistenceWorker(i, s.persistenceShards[i])
	}
}

func (s *PipelineSubscriber) persistAtomics(
	ctx context.Context,
	vehicleID int64,
	atomics []codec.Atomic,
) error {
	if !s.persistenceStarted.Load() {
		return s.pipeline.ProcessAtomics(ctx, atomics, vehicleID)
	}

	work := persistenceWork{
		ctx:        ctx,
		vehicleID:  vehicleID,
		atomics:    atomics,
		result:     make(chan error, 1),
		enqueuedAt: time.Now(),
	}
	shard := s.persistenceShards[uint64(vehicleID)%uint64(len(s.persistenceShards))]
	admissionStarted := time.Now()
	select {
	case shard <- work:
		telemetryPersistenceAdmissionWait.Observe(time.Since(admissionStarted).Seconds())
	case <-ctx.Done():
		telemetryPersistenceAdmissionWait.Observe(time.Since(admissionStarted).Seconds())
		return ctx.Err()
	}

	select {
	case err := <-work.result:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *PipelineSubscriber) persistenceWorker(_ int, queue <-chan persistenceWork) {
	defer s.persistenceWG.Done()
	for {
		select {
		case <-s.ctx.Done():
			return
		case first := <-queue:
			batch, ok := s.collectPersistenceBatch(queue, first)
			if !ok {
				s.finishPersistenceWorks(batch, context.Canceled)
				return
			}
			s.processPersistenceWorks(batch)
		}
	}
}

func (s *PipelineSubscriber) collectPersistenceBatch(
	queue <-chan persistenceWork,
	first persistenceWork,
) ([]persistenceWork, bool) {
	batch := make([]persistenceWork, 1, s.cfg.BatchMaxMessages)
	batch[0] = first
	if s.cfg.BatchMaxMessages == 1 {
		return batch, true
	}

	timer := time.NewTimer(s.cfg.BatchWindow)
	defer timer.Stop()
	for len(batch) < s.cfg.BatchMaxMessages {
		select {
		case <-s.ctx.Done():
			return batch, false
		case work := <-queue:
			batch = append(batch, work)
		case <-timer.C:
			return batch, true
		}
	}
	return batch, true
}

func (s *PipelineSubscriber) processPersistenceWorks(batch []persistenceWork) {
	for _, work := range batch {
		telemetryPersistenceQueueWait.Observe(time.Since(work.enqueuedAt).Seconds())
	}

	byVehicle := make(map[int64][]persistenceWork)
	vehicleOrder := make([]int64, 0, len(batch))
	for _, work := range batch {
		if _, exists := byVehicle[work.vehicleID]; !exists {
			vehicleOrder = append(vehicleOrder, work.vehicleID)
		}
		byVehicle[work.vehicleID] = append(byVehicle[work.vehicleID], work)
	}
	for _, vehicleID := range vehicleOrder {
		s.processVehiclePersistence(byVehicle[vehicleID])
	}
}

func (s *PipelineSubscriber) processVehiclePersistence(works []persistenceWork) {
	type timestampGroup struct {
		ts    time.Time
		works []persistenceWork
	}

	groupsByTime := make(map[time.Time]*timestampGroup)
	groupOrder := make([]time.Time, 0, len(works))
	for _, work := range works {
		ts := work.atomics[0].EmittedAt.UTC().Round(0)
		group, exists := groupsByTime[ts]
		if !exists {
			group = &timestampGroup{ts: ts}
			groupsByTime[ts] = group
			groupOrder = append(groupOrder, ts)
		}
		group.works = append(group.works, work)
	}
	sort.SliceStable(groupOrder, func(i, j int) bool {
		return groupOrder[i].Before(groupOrder[j])
	})

	var priorErr error
	for _, ts := range groupOrder {
		group := groupsByTime[ts]
		if priorErr != nil {
			s.finishPersistenceWorks(group.works, priorErr)
			continue
		}
		priorErr = s.processTimestampGroup(group.works)
		s.finishPersistenceWorks(group.works, priorErr)
	}
}

func (s *PipelineSubscriber) processTimestampGroup(works []persistenceWork) (err error) {
	atomics := make([]codec.Atomic, 0, len(works))
	links := make([]trace.Link, 0, len(works))
	for _, work := range works {
		atomics = append(atomics, work.atomics...)
		if spanContext := trace.SpanContextFromContext(work.ctx); spanContext.IsValid() {
			links = append(links, trace.Link{SpanContext: spanContext})
		}
	}

	persistCtx, cancel := context.WithTimeout(s.ctx, s.cfg.PersistenceTimeout)
	defer cancel()
	ctx, span := otel.Tracer(mqttTracerName).Start(
		persistCtx,
		"mqtt.persist_batch",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithLinks(links...),
		trace.WithAttributes(
			attribute.Int64("vehicle_id", works[0].vehicleID),
			attribute.Int("messaging.batch.message_count", len(works)),
			attribute.Int("signal.count", len(atomics)),
		),
	)
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("mqtt persistence batch panic: %v", recovered)
			metrics.PanicsRecovered.WithLabelValues("mqtt-persistence-batcher").Inc()
			s.logger.Error().
				Interface("panic", recovered).
				Int64("vehicle_id", works[0].vehicleID).
				Bytes("stack", debug.Stack()).
				Msg("mqtt: recovered telemetry persistence batch panic")
		}
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "persistence batch failed")
			outcome := "error"
			switch {
			case errors.Is(err, context.DeadlineExceeded):
				outcome = "timeout"
			case errors.Is(err, context.Canceled):
				outcome = "canceled"
			}
			telemetryPersistenceBatches.WithLabelValues(outcome).Inc()
		} else {
			telemetryPersistenceBatches.WithLabelValues("ok").Inc()
		}
		span.End()
	}()

	telemetryPersistenceBatchSize.Observe(float64(len(works)))
	telemetryPersistenceInFlight.Inc()
	defer telemetryPersistenceInFlight.Dec()
	return s.pipeline.ProcessAtomics(ctx, atomics, works[0].vehicleID)
}

func (s *PipelineSubscriber) finishPersistenceWorks(works []persistenceWork, err error) {
	for _, work := range works {
		work.result <- err
	}
}
