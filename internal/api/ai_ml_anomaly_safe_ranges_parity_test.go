// Phase-50 / 0062 — ML1 Learned per-vehicle anomaly baselines.
//
// safe-range parity test: pins
// internal/api.safeRanges <-> internal/ml/anomaly.StaticEnvelope()
// byte-for-byte. The two maps MUST stay identical for the lifetime
// of the slice; if a future change updates one but not the other,
// learned-baseline fallback would silently disagree with the
// deterministic detector and the off-mode contract (ADR-015 §I3)
// would regress without anyone noticing.
//
// The duplication is intentional and documented in
// internal/ml/anomaly/safe_ranges.go; this test is the load-bearing
// guard that keeps the duplication safe.

package api

import (
	"reflect"
	"sort"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ml/anomaly"
)

// TestSafeRangesParity_APIvsMLAnomaly proves the two copies of the
// canonical safe-range envelope stay byte-equal. A failure here
// means either:
//
//   - The deterministic detector at internal/api/anomaly_handler.go
//     was updated without mirroring the change to
//     internal/ml/anomaly/safe_ranges.go (or vice-versa), OR
//   - A new signal was added to one map but not the other — the
//     learned-baseline trainer's fallback would diverge from the
//     off-mode detector for that signal, silently breaking the
//     ADR-015 §I3 baseline-coexistence guarantee.
//
// Either way: update BOTH maps in the same commit and re-run.
func TestSafeRangesParity_APIvsMLAnomaly(t *testing.T) {
	t.Parallel()

	apiCopy := safeRanges
	mlCopy := anomaly.StaticEnvelope()

	if len(apiCopy) != len(mlCopy) {
		t.Fatalf("safe-range key count drift: api=%d ml=%d", len(apiCopy), len(mlCopy))
	}

	if !reflect.DeepEqual(apiCopy, mlCopy) {
		// Build a sorted diff so the failure message is deterministic.
		apiKeys := make([]string, 0, len(apiCopy))
		for k := range apiCopy {
			apiKeys = append(apiKeys, k)
		}
		sort.Strings(apiKeys)

		for _, k := range apiKeys {
			a, ok := mlCopy[k]
			if !ok {
				t.Errorf("signal %q present in internal/api.safeRanges, missing from anomaly.StaticEnvelope()", k)
				continue
			}
			if a != apiCopy[k] {
				t.Errorf("signal %q bounds drift: api=%v ml=%v", k, apiCopy[k], a)
			}
		}
		for k := range mlCopy {
			if _, ok := apiCopy[k]; !ok {
				t.Errorf("signal %q present in anomaly.StaticEnvelope(), missing from internal/api.safeRanges", k)
			}
		}
		t.Fatal("safe-range maps drifted — see errors above; update BOTH copies in the same commit")
	}
}

// TestSafeRangesParity_MLEnvelopeReturnsCopy is a cheap defensive
// check that anomaly.StaticEnvelope() returns a fresh map each call
// — mutating one consumer's result must NOT corrupt the canonical
// internal table that the trainer's fallback consults.
func TestSafeRangesParity_MLEnvelopeReturnsCopy(t *testing.T) {
	t.Parallel()
	first := anomaly.StaticEnvelope()
	first["BatteryLevel"] = [2]float64{-999, 999}
	second := anomaly.StaticEnvelope()
	if second["BatteryLevel"] == ([2]float64{-999, 999}) {
		t.Fatal("anomaly.StaticEnvelope() leaked the canonical map; mutation by one caller corrupted the next")
	}
}
