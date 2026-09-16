package sciencesvc

import (
	"context"
	"testing"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	"github.com/ev-dev-labs/teslasync/internal/physics"
	apiscience "github.com/ev-dev-labs/teslasync/internal/science"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestQuietThresholdNoDrift(t *testing.T) {
	if apiscience.RestQuietA != physics.PackCurrentQuietA {
		t.Fatalf("science RestQuietA (%v) drifted from physics (%v)",
			apiscience.RestQuietA, physics.PackCurrentQuietA)
	}
}

func TestSamplesCarryBricks(t *testing.T) {
	rows := []signal.TimelineRow{{
		Timestamp: time.Now(),
		Fields: map[string]signal.SignalValue{
			"pack_voltage_v": 400.0, "pack_current_a": -10.0,
			"brick_min_v": 3.95, "brick_max_v": 4.02,
			"gear": "P", "soc_pct": 62.0,
		},
	}}
	got := samplesFromTimeline(rows)
	if len(got) != 1 {
		t.Fatalf("samples = %d, want 1", len(got))
	}
	if got[0].BrickMinV == nil || got[0].BrickMaxV == nil {
		t.Fatal("brick extremes must survive mapping")
	}
	if got[0].Gear != "P" {
		t.Fatalf("gear = %q, want P", got[0].Gear)
	}
}

func TestBuildWeatherUnknownWithoutFetcher(t *testing.T) {
	now := time.Now().UTC
	end := now()
	rep := buildWeather(context.Background(), 1, end.Add(-time.Hour), end, nil, nil, physics.DefaultParams(), nil)
	if !rep.WeatherUnk {
		t.Fatal("no drives and no fetcher must be weather_unknown")
	}
	if len(rep.Missing) == 0 {
		t.Fatal("expected missing signals")
	}
}

func TestBuildWeatherSkipsCoordlessDrives(t *testing.T) {
	end := time.Now().UTC()
	start := end.Add(-time.Hour)
	d := &drivemodel.Drive{ID: 3, VehicleID: 1, StartTs: start, EndTs: &end, DistanceM: 10000}
	v := 20.0
	volt, curr := 400.0, -20.0
	samples := []physics.Sample{
		{At: start, SpeedMps: &v, PackVoltageV: &volt, PackCurrentA: &curr},
		{At: end, SpeedMps: &v, PackVoltageV: &volt, PackCurrentA: &curr},
	}
	rep := buildWeather(context.Background(), 1, start, end, samples, []*drivemodel.Drive{d}, physics.DefaultParams(), nil)
	if !rep.WeatherUnk {
		t.Fatal("coordless drives cannot join weather")
	}
}

func TestBuildTiresUnknownWithoutTPMS(t *testing.T) {
	end := time.Now().UTC()
	rep := buildTires(1, end.Add(-time.Hour), end, nil, nil, nil, false)
	if !rep.Unknown {
		t.Fatal("no TPMS must be unknown")
	}
}

func TestBuildNotebookCoversAllDomains(t *testing.T) {
	end := time.Now().UTC()
	start := end.Add(-24 * time.Hour)
	nb := buildNotebook(1, "VIN1", start, end, notebookInputs{
		Electrochem: apiscience.ElectrochemReport{FirmwareEpoch: "fw"},
		Thermal:     apiscience.ThermalReport{},
		Weather:     apiscience.WeatherReport{},
		Tires:       apiscience.TireReport{},
	})
	domains := map[string]bool{}
	for _, e := range nb.Entries {
		domains[e.Domain] = true
		if e.N < 0 || e.Honesty == "" || e.Method == "" {
			t.Fatalf("entry %s missing n/honesty/method", e.ID)
		}
	}
	for _, d := range []string{"electrochem", "thermal", "weather", "tires"} {
		if !domains[d] {
			t.Fatalf("notebook missing domain %s", d)
		}
	}
}

func TestScienceFieldCoverage(t *testing.T) {
	need := map[string]bool{}
	for _, m := range append(append(append(electrochemFields(), thermalFields()...), tireFields()...), driveResidualFields()...) {
		need[m.Signal] = true
	}
	for _, s := range []string{
		"PackVoltage", "PackCurrent", "Soc", "EnergyRemaining",
		"ModuleTempMax", "BrickVoltageMin", "Gear", "DetailedChargeState",
		"InsideTemp", "OutsideTemp", "SentryMode",
		"TpmsPressureFl", "Odometer", "VehicleSpeed", "Version",
	} {
		if !need[s] {
			t.Fatalf("science fields missing %s", s)
		}
	}
	// R2: ChargeRateMilePerHour is range-rate, never speed — science must
	// not project it as motion.
	for _, m := range driveResidualFields() {
		if m.Signal == "ChargeRateMilePerHour" {
			t.Fatal("charge-rate must never feed motion inputs")
		}
	}
}
