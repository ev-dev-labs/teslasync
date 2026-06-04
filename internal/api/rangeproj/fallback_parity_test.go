// Range-prediction fallback parity tests.
//
// fallback parity test: pins
// internal/api/rangeproj.defaultEfficiency <-> internal/ml/range.HeuristicWhPerKm
// at representative bucket points. The two formulas MUST stay
// mathematically equivalent at the (temp_bucket × speed_bucket)
// midpoints for the lifetime of the shared fallback; if a future change
// updates one but not the other, the learned-baseline fallback would
// silently disagree with the deterministic Projected Range page and
// the off-mode contract (ADR-015 §I3) would regress without anyone
// noticing.
//
// The duplication is intentional and documented in
// internal/ml/range/linear.go (mlrange.HeuristicWhPerKm references
// the rangeproj-side formula in its docstring); this test is the
// load-bearing guard that keeps the duplication safe.

package rangeproj

import (
	"math"
	"testing"

	mlrange "github.com/ev-dev-labs/teslasync/internal/ml/range"
)

// TestRangeFallbackParity_APIvsMLRange proves the two formulas
// agree at the canonical bucket-midpoint representative points.
//
// Why midpoints rather than every (temp_bucket, speed_bucket)
// combination over the full input range:
//
//   - mlrange.HeuristicWhPerKm pins each bucket to a representative
//     (temp, speed) pair (see representativeTempC /
//     representativeSpeedKmh in linear.go) so the per-bucket Wh/km
//     is a pure function of bucket name. The rangeproj-side
//     defaultEfficiency takes raw (tempC int, speedKmh int) so we
//     evaluate it at the SAME representative midpoints the
//     mlrange package picked.
//
//   - This is the contract the parity test enforces: for the four
//     temp bucket midpoints × three speed bucket midpoints = 12
//     pairs, the rangeproj defaultEfficiency must return EXACTLY the same
//     Wh/km the mlrange.HeuristicWhPerKm returns for the
//     corresponding bucket-name pair.
//
// A failure here means either:
//
//   - The deterministic projection at
//     internal/api/rangeproj/compute.go's defaultEfficiency was updated
//     without mirroring the change to
//     internal/ml/range/linear.go's HeuristicWhPerKm, OR
//
//   - A new bucket boundary or multiplier was added to one formula
//     but not the other — the learned-range trainer's fallback would
//     diverge from the off-mode projection for that bucket, silently
//     breaking the ADR-015 §I3 baseline-coexistence guarantee.
//
// Either way: update BOTH formulas in the same commit and re-run.
func TestRangeFallbackParity_APIvsMLRange(t *testing.T) {
	t.Parallel()

	// (temp_bucket, speed_bucket, midpoint_temp_C, midpoint_speed_kmh)
	cases := []struct {
		tempBucket, speedBucket string
		midTempC, midSpeedKmh   int
	}{
		// freezing midpoint = -5°C (linear.go's representativeTempC)
		{"freezing", "city", -5, 35},
		{"freezing", "suburban", -5, 70},
		{"freezing", "highway", -5, 110},
		// cold midpoint = 5°C
		{"cold", "city", 5, 35},
		{"cold", "suburban", 5, 70},
		{"cold", "highway", 5, 110},
		// mild midpoint = 20°C
		{"mild", "city", 20, 35},
		{"mild", "suburban", 20, 70},
		{"mild", "highway", 20, 110},
		// hot midpoint = 30°C (intentionally below the 35°C trigger so
		// the rangeproj `tempC > 35` branch does NOT fire — the
		// mlrange representative midpoint is pinned at 30 to keep the
		// "hot" bucket a pure speed-driven multiplier).
		{"hot", "city", 30, 35},
		{"hot", "suburban", 30, 70},
		{"hot", "highway", 30, 110},
	}

	for _, tc := range cases {
		apiVal := defaultEfficiency(tc.midTempC, tc.midSpeedKmh)
		mlVal, ok := mlrange.HeuristicWhPerKm(tc.tempBucket, tc.speedBucket)
		if !ok {
			t.Errorf("bucket %s/%s: mlrange.HeuristicWhPerKm ok=false (unknown bucket — wiring bug)", tc.tempBucket, tc.speedBucket)
			continue
		}
		if math.Abs(apiVal-mlVal) > 1e-9 {
			t.Errorf("bucket %s/%s @ (temp=%d°C, speed=%dkm/h): rangeproj defaultEfficiency=%v, mlrange.HeuristicWhPerKm=%v — formulas drifted; update BOTH copies in the same commit",
				tc.tempBucket, tc.speedBucket, tc.midTempC, tc.midSpeedKmh, apiVal, mlVal)
		}
	}
}

// TestRangeFallbackParity_TempBucketForAgrees proves the two
// tempBucketFor implementations agree at the bucket boundary edges.
// The rangeproj-side tempBucketFor takes int; mlrange.TempBucketFor takes
// float64 — but both partition the same domain.
func TestRangeFallbackParity_TempBucketForAgrees(t *testing.T) {
	t.Parallel()
	// Edge values just inside / outside each boundary.
	cases := []int{-50, -1, 0, 1, 9, 10, 11, 24, 25, 26, 50}
	for _, tc := range cases {
		apiBucket := tempBucketFor(tc)
		mlBucket := mlrange.TempBucketFor(float64(tc))
		if apiBucket != mlBucket {
			t.Errorf("tempC=%d: rangeproj tempBucketFor=%q, ml TempBucketFor=%q — bucket boundary drift", tc, apiBucket, mlBucket)
		}
	}
}
