package science

import (
	"math"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/physics"
)

func TestRestRejectsGapsAndEpochTransitions(t *testing.T) {
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, firmwareChange := range []bool{false, true} {
		samples := make([]physics.Sample, 12)
		for i := range samples {
			samples[i] = physics.Sample{At: at.Add(time.Duration(i) * time.Minute), Gear: "P",
				PackVoltageV: fp(400), PackCurrentA: fp(0), SocPct: fp(60), Firmware: "a"}
			if i >= 6 {
				if firmwareChange {
					samples[i].Firmware = "b"
				} else {
					samples[i].At = samples[i].At.Add(time.Hour)
				}
			}
		}
		if got := FindRest(samples); len(got) != 0 {
			t.Fatalf("split short rests became one observation: %+v", got)
		}
	}
}

func TestElectrochemRejectsUnsupportedEvidence(t *testing.T) {
	if bins := OCVBins([]OCVPoint{{SocPct: 60, OCVPackV: 400}}); len(bins) != 0 {
		t.Fatal("missing temperature must not become an assumed bin")
	}
	at := time.Now()
	samples := []physics.Sample{
		{At: at, PackVoltageV: fp(400), PackCurrentA: fp(-50)},
		{At: at.Add(5 * time.Second), PackVoltageV: fp(398), PackCurrentA: fp(-30)},
	}
	if len(DCIR(samples, "drive_step")) != 0 {
		t.Fatal("negative apparent resistance must not be made positive")
	}
	samples[1].PackVoltageV = fp(402)
	samples[1].ElectricalUnaligned = true
	if len(DCIR(samples, "drive_step")) != 0 {
		t.Fatal("asynchronous forward fill must not qualify as a current step")
	}
	points := make([]OCVPoint, 5)
	for i := range points {
		points[i] = OCVPoint{At: at.Add(time.Duration(i) * 24 * time.Hour), SocPct: 50, EnergyWh: fp(35000)}
	}
	if _, _, _, _, _, ok := CapacityProxy(points); ok {
		t.Fatal("insufficient holdout must not train on all samples")
	}
}

func TestThermalRejectsConfoundedAndInterruptedSeries(t *testing.T) {
	for _, kind := range []string{"sentry", "hvac", "unknown_hvac", "gap", "ambient", "missing"} {
		t.Run(kind, func(t *testing.T) {
			at := time.Now()
			samples := make([]TempSample, 10)
			for i := range samples {
				samples[i] = TempSample{At: at.Add(time.Duration(i) * 5 * time.Minute),
					PackC: fp(15 + 20*math.Exp(-float64(i)/6)), AmbientC: fp(15), HvacW: fp(0)}
			}
			switch kind {
			case "sentry":
				samples[4].SentryOn = true
			case "hvac":
				samples[4].HvacW = fp(2000)
			case "unknown_hvac":
				samples[4].HvacW = nil
			case "gap":
				for i := 4; i < len(samples); i++ {
					samples[i].At = samples[i].At.Add(time.Hour)
				}
			case "ambient":
				samples[4].AmbientC = fp(20)
			case "missing":
				samples[4].PackC = nil
			}
			if got := FitCooldown(samples, true); !got.Unknown {
				t.Fatalf("unsupported cooldown fit: %+v", got)
			}
		})
	}
}

func TestTireModelIsNotConfidenceInterval(t *testing.T) {
	if got := UnderinflationFrac(fp(310), fp(315), fp(312), fp(311), fp(300)); got == nil || *got != 0 {
		t.Fatal("all corners above placard should yield an observed zero deficit")
	}
	if got := UnderinflationFrac(fp(280), nil, fp(310), fp(310), fp(300)); got != nil {
		t.Fatal("missing corner must leave worst-corner model unknown")
	}
	est, lo, hi, ok := UnderinflationWh(fp(500), fp(0.1))
	if !ok || est != 5 || lo != 2.5 || hi != 7.5 {
		t.Fatalf("expected explicit +/-50%% sensitivity: %v %v %v", est, lo, hi)
	}
	if _, ok := LinReg([]float64{1, 2, math.NaN()}, []float64{1, 2, 3}); ok {
		t.Fatal("NaN cannot produce a successful fit")
	}
}
