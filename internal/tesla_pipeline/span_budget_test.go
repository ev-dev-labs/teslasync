package teslapipeline

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
)

// Span budget gate for telemetry observer traces.
//
// The instrumentation emits roughly 8 spans for a single
// observer.OnPayloadProcessed call (parent + 6 cross-cutting children
// + the VIN resolver). With the mqtt.consume + normalize.* + router
// + writer spans added at the MQTT entry point, the END-TO-END trace
// for ONE atomic is ~12-14 spans. We budget 25 — generous slack for
// future spans, but tight enough that an accidental N² span bug
// (e.g. starting a span inside a per-row hot loop) trips CI.
//
// To raise this budget, update SpanBudgetPerPayload and document why
// the additional spans are worth the ingest overhead.
const SpanBudgetPerPayload = 25

// TestSpanBudget_OneAtomic asserts that processing a single atomic
// through the SideEffectsObserver emits at most SpanBudgetPerPayload
// spans. The mqtt.consume + normalize chain are NOT included here
// because they live in different packages; the budget is for the
// observer subtree only; end-to-end ingest also includes producer and
// MQTT/normalize spans that this test doesn't exercise.
//
// The test must remain stable across refactors that move spans
// between packages — moving a span out of the observer subtree
// SHRINKS our local count, which is fine.
func TestSpanBudget_OneAtomic(t *testing.T) {
	rec := installSpanRecorder(t)
	obs, _, _, _, _, _, _ := newDefaultObserver(t)

	ctx, root := otel.Tracer("mqtt").Start(context.Background(), "mqtt.consume")
	atomics := []codec.Atomic{
		{Field: "VehicleSpeed", Value: 12.5, EmittedAt: time.Unix(1700000000, 0).UTC(), VehicleID: "VIN-A"},
	}
	obs.OnPayloadProcessed(ctx, 42, atomics)
	root.End()

	got := len(rec.Ended())
	if got > SpanBudgetPerPayload {
		t.Fatalf("observer subtree emitted %d spans for ONE atomic, budget is %d.\n"+
			"Either (a) trim the span graph, (b) batch a hot-loop span out of "+
			"OnPayloadProcessed, or (c) raise SpanBudgetPerPayload AND document "+
			"the new spans in the Phase-10 acceptance.\nRecorded spans: %v",
			got, SpanBudgetPerPayload, spanNamesList(rec.Ended()))
	}
}

// TestSpanBudget_TenAtomics asserts that processing a batch of ten
// atomics does NOT linearly scale the observer subtree's span count.
// The whole point of the observer pattern is to batch cross-cutting
// concerns by vehicle, not by atomic — a regression that moves a
// span inside the per-atomic loop would show up here as a 10x blowup.
func TestSpanBudget_TenAtomics(t *testing.T) {
	rec := installSpanRecorder(t)
	obs, _, _, _, _, _, _ := newDefaultObserver(t)

	ctx, root := otel.Tracer("mqtt").Start(context.Background(), "mqtt.consume")
	atomics := make([]codec.Atomic, 10)
	for i := range atomics {
		atomics[i] = codec.Atomic{
			Field:     "VehicleSpeed",
			Value:     float64(i),
			EmittedAt: time.Unix(1700000000+int64(i), 0).UTC(),
			VehicleID: "VIN-A",
		}
	}
	obs.OnPayloadProcessed(ctx, 42, atomics)
	root.End()

	got := len(rec.Ended())
	if got > SpanBudgetPerPayload {
		t.Fatalf("observer subtree emitted %d spans for 10 atomics, budget is %d.\n"+
			"Per-atomic span explosion detected — a span was added inside a hot "+
			"loop. Move it outside the loop or batch it.\nRecorded spans: %v",
			got, SpanBudgetPerPayload, spanNamesList(rec.Ended()))
	}
}
