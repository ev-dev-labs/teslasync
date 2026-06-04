// Charging-curve fingerprint clustering parity tests.
//
// This parity test pins ml/chargingcurves.ClassifyChargingPowerTier to the
// tool sibling classifier so their narrations cannot drift. The duplication
// is intentional because the packages have different dependency directions.

package api

import (
	"testing"

	mlchargingcurves "github.com/ev-dev-labs/teslasync/internal/ml/chargingcurves"
)

// TestChargingCurveClusterParity_MLvsTools covers nil/invalid inputs plus
// values around the L1/L2/DC tier boundaries. A failure means the ML classifier,
// the tool sibling classifier, or their boundary constants drifted; update both
// classifiers in the same commit.
func TestChargingCurveClusterParity_MLvsTools(t *testing.T) {
	t.Parallel()

	// Pin constants to the tool's unexported chargeCurvePower* boundaries.
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

// floatPtrParity avoids colliding with helpers in other api tests.
func floatPtrParity(v float64) *float64 { return &v }
