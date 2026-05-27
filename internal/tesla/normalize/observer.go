package normalize

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
)

// AtomicsObserver receives the full slice of atomics for a payload
// AFTER the dispatch loop in Pipeline.processAtomics has completed.
// It is the architectural seam locked by ADR-004 #11 (added in
// Phase-42a/0000) for cross-cutting per-payload side effects that do
// not fit inside a per-destination router.Writer:
//
//   - L1 live-state updates  (signal.LiveSignalStore.UpdateAll)
//   - FSM dispatch           (FSMHandler.ProcessSignals)
//   - sessions + alerts      (TelemetrySessionTracker.ProcessSignals
//   - TelemetryAlertEvaluator.Evaluate)
//   - SSE fanout             (TelemetryHandler.broadcastSSE)
//
// (Durable signal_log writes are owned by the router signal_log
// writer, not the observer.)
//
// Each of those callbacks reads "signals as a map[string]any" rather
// than per-destination columns, and has its own lifecycle/timing
// concerns that would couple a router.Writer to FSM / SSE state if
// embedded there. The AtomicsObserver pattern keeps writers focused
// on per-column persistence and routes the cross-cutting work
// through a single normalize-package seam.
//
// Contract:
//
//   - OnPayloadProcessed is called EXACTLY ONCE per successful
//     codec.Decode, AFTER the route loop in processAtomics has
//     drained every atomic. It is NOT called when codec.Decode
//     itself fails (no atomics to observe — the payload is dropped
//     under the ErrPayloadDrop sentinel and the MQTT subscriber's
//     poison-pill path takes over).
//
//   - The atomics slice is the same in-process slice the Pipeline
//     used for routing. Per-atomic Value fields hold the POST-
//     conversion SI value for unit-bearing fields that converted
//     successfully (UnitKindDistance / UnitKindTemperature /
//     UnitKindPressure + the speed-override list); pass-through
//     fields and Setting*Unit atomics retain their codec-original
//     Value. Atomics whose toSI step failed retain their raw Value
//     and are NOT routed — observers see them in the slice
//     regardless. Observers MUST NOT mutate the slice in place; the
//     Pipeline does not defensively copy (perf), so a downstream
//     observer that needs to filter or transform must make its own
//     copy.
//
//   - Observers are invoked SEQUENTIALLY in registration order. A
//     panic in any observer is recovered + logged at WARN inside
//     notifyObserver — observer failures MUST NOT fail the payload
//     (per Phase-42a/0000 Decision #2). Subsequent observers still
//     run even if a prior one panicked.
//
//   - The interface intentionally returns no error. The two
//     legitimate failure modes (a) "I do not handle this kind of
//     payload" and (b) "downstream service is unavailable" are
//     expected to be swallowed inside the implementation: case (a)
//     is a programming bug discovered in tests, and case (b) is
//     handled by the implementation's own retry / circuit-breaker
//     policy — the Pipeline does not retry on the observer's
//     behalf.
type AtomicsObserver interface {
	OnPayloadProcessed(ctx context.Context, vehicleID int64, atomics []codec.Atomic)
}
