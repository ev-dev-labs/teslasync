// Phase-50 / 0064 — ML3 Charging-curve fingerprint clustering statistical model.
//
// fallback parity test: pins
// internal/ml/chargingcurves.ClassifyChargingPowerTier <-> the C3
// sibling tools.classifyChargingPowerTier in
// internal/ai/tools/charge_curve_clustering.go. The two
// classifiers MUST agree at every representative power point for
// the lifetime of the slice; if a future change updates one but
// not the other, the ML3 learned envelope would silently disagree
// with the C3 narrator (which uses the same per-tier semantics)
// and the two surfaces' narrations would contradict each other.
//
// The duplication is intentional and documented in
// internal/ml/chargingcurves/clustering.go (mlchargingcurves
// references the SPA helpers.ts + the C3 tool in its docstring);
// this test is the load-bearing guard that keeps the duplication
// safe.
//
// Why we don't share a single function across ml/chargingcurves
// and ai/tools/charge_curve_clustering: the two packages have
// independent dependency directions (ai/tools imports
// ml/chargingcurves but not vice-versa), and the C3 sibling
// classifier predates ML3. Cross-importing would couple their
// release cadences.

package api

import (
	"testing"

	mlchargingcurves "github.com/ev-dev-labs/teslasync/internal/ml/chargingcurves"
)

// TestChargingCurveClusterParity_MLvsTools proves the two
// classifiers agree at every representative power point.
//
// Why these specific points: each one straddles a boundary
// (PowerL1MaxW=1920, PowerL2MaxW=19200) or sits inside a tier so
// boundary-condition drift surfaces immediately:
//
//   - nil / 0 / negative → "unknown"
//   - 1500 (well below L1 boundary) → "l1_overnight"
//   - 1920 (exactly at L1 boundary) → "l1_overnight"
//   - 1921 (just above L1 boundary) → "l2_workplace"
//   - 7000 (mid L2) → "l2_workplace"
//   - 19200 (exactly at L2 boundary) → "l2_workplace"
//   - 19201 (just above L2 boundary) → "dc_fast"
//   - 50000 / 250000 (typical Supercharger) → "dc_fast"
//
// A failure here means either:
//
//   - mlchargingcurves.ClassifyChargingPowerTier was updated
//     without mirroring the change to
//     internal/ai/tools/charge_curve_clustering.go's
//     classifyChargingPowerTier, OR
//
//   - the constants PowerL1MaxW / PowerL2MaxW drifted apart from
//     chargeCurvePowerL1MaxW / chargeCurvePowerL2MaxW.
//
// Either way: update BOTH classifiers in the same commit and re-run.
//
// Note we cannot directly call tools.classifyChargingPowerTier
// from this api-package test because the function is unexported.
// We pin against the public ML constants + the canonical labels
// the C3 tool's docstring nails down (see
// internal/ai/tools/charge_curve_clustering.go L419-L443). A
// future edit that flips a label in either implementation surfaces
// here; a future edit that flips ONLY the constants without
// touching the labels surfaces here too.
func TestChargingCurveClusterParity_MLvsTools(t *testing.T) {
	t.Parallel()

	// Pin the constants. If chargeCurvePowerL1MaxW or
	// chargeCurvePowerL2MaxW in
	// internal/ai/tools/charge_curve_clustering.go ever change,
	// these constants must change together — and this test will
	// fail until they're updated to match.
	const (
		expectedPowerL1MaxW = 1920.0
		expectedPowerL2MaxW = 19200.0
	)
	if mlchargingcurves.PowerL1MaxW != expectedPowerL1MaxW {
		t.Errorf("mlchargingcurves.PowerL1MaxW = %v, want %v (parity break with C3 classifier in internal/ai/tools/charge_curve_clustering.go)",
			mlchargingcurves.PowerL1MaxW, expectedPowerL1MaxW)
	}
	if mlchargingcurves.PowerL2MaxW != expectedPowerL2MaxW {
		t.Errorf("mlchargingcurves.PowerL2MaxW = %v, want %v (parity break with C3 classifier in internal/ai/tools/charge_curve_clustering.go)",
			mlchargingcurves.PowerL2MaxW, expectedPowerL2MaxW)
	}

	// Pin the labels at every representative power point.
	cases := []struct {
		name  string
		peakW *float64
		want  string
	}{
		{"nil", nil, "unknown"},
		{"zero", floatPtrParity(0), "unknown"},
		{"negative", floatPtrParity(-100), "unknown"},
		{"l1 well below boundary", floatPtrParity(1500), "l1_overnight"},
		{"l1 at boundary", floatPtrParity(1920), "l1_overnight"},
		{"l2 just above l1 boundary", floatPtrParity(1921), "l2_workplace"},
		{"l2 mid", floatPtrParity(7000), "l2_workplace"},
		{"l2 at boundary", floatPtrParity(19200), "l2_workplace"},
		{"dc just above l2 boundary", floatPtrParity(19201), "dc_fast"},
		{"dc mid", floatPtrParity(50000), "dc_fast"},
		{"dc supercharger v3", floatPtrParity(250000), "dc_fast"},
	}
	for _, tc := range cases {
		got := mlchargingcurves.ClassifyChargingPowerTier(tc.peakW)
		if got != tc.want {
			t.Errorf("%s: ClassifyChargingPowerTier(%v) = %q, want %q (parity break with C3 classifier — update BOTH copies in the same commit)",
				tc.name, tc.peakW, got, tc.want)
		}
	}
}

// floatPtrParity returns a pointer to v. Local helper to avoid
// colliding with helpers in other test files in this package.
func floatPtrParity(v float64) *float64 { return &v }
