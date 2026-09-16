package science

import (
	"math"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/physics"
)

func TestRegressionUsesSmallSampleStudentInterval(t *testing.T) {
	fit, ok := LinReg([]float64{1, 2, 3}, []float64{2, 3, 5})
	if !ok || fit.CIMethod != CIStudentT || fit.SESlope <= 0 ||
		math.Abs((fit.CI95High-fit.Slope)/fit.SESlope-12.706205) > 1e-6 {
		t.Fatalf("expected df=1 Student-t interval: %+v", fit)
	}
}

func TestHysteresisDoesNotPoolTemperatures(t *testing.T) {
	var points []OCVPoint
	for i := 0; i < 3; i++ {
		points = append(points,
			OCVPoint{SocPct: 50, TempC: fp(5), OCVPackV: 390, Direction: "charge_rest"},
			OCVPoint{SocPct: 50, TempC: fp(25), OCVPackV: 400, Direction: "discharge_rest"})
	}
	bins := Hysteresis(points)
	if len(bins) != 2 {
		t.Fatalf("temperature strata = %d", len(bins))
	}
	for _, bin := range bins {
		if !bin.Unknown || bin.DeltaV != nil {
			t.Fatalf("temperature difference became hysteresis: %+v", bin)
		}
	}
}

func TestPressureExposureUsesWholeDistanceHistory(t *testing.T) {
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	samples := make([]physics.Sample, 3)
	for i, pressure := range []float64{240, 300, 300} {
		samples[i] = physics.Sample{At: start.Add(time.Duration(i) * time.Minute),
			SpeedMps: fp(10), TpmsFLKpa: fp(pressure), TpmsFRKpa: fp(pressure),
			TpmsRLKpa: fp(pressure), TpmsRRKpa: fp(pressure)}
	}
	got := DistanceWeightedDeficit(samples, fp(300))
	if got == nil || math.Abs(*got-0.05) > 1e-12 {
		t.Fatalf("expected weighted 5%% deficit despite latest zero deficit: %v", got)
	}
	samples[1].SpeedMps = fp(math.NaN())
	if DistanceWeightedDeficit(samples, fp(300)) != nil {
		t.Fatal("nonfinite speed cannot produce a qualified exposure")
	}
}
