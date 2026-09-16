package science

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/physics"
)

func fp(v float64) *float64 { return &v }

func TestFindRestTable(t *testing.T) {
	start := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	mk := func(gear string, current float64, charge string, n int, step time.Duration) []physics.Sample {
		out := make([]physics.Sample, n)
		for i := range out {
			v, soc := 400.0+float64(i)*0.01, 60.0
			out[i] = physics.Sample{
				At: start.Add(time.Duration(i) * step), Gear: gear,
				PackVoltageV: &v, SocPct: &soc,
				PackCurrentA:        fp(current),
				DetailedChargeState: charge,
			}
		}
		return out
	}
	tests := []struct {
		name  string
		in    []physics.Sample
		wantN int
	}{
		{"synthetic rest yields OCV window", mk("P", 0.5, "", 15, time.Minute), 1},
		{"gear D rejected", mk("D", 0.5, "", 15, time.Minute), 0},
		{"noisy current rejected", mk("P", 8.0, "", 15, time.Minute), 0},
		{"charging overlap rejected", mk("P", 0.5, "Charging", 15, time.Minute), 0},
		{"short dwell rejected", mk("P", 0.5, "", 5, time.Minute), 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := FindRest(tt.in); len(got) != tt.wantN {
				t.Fatalf("windows = %d, want %d", len(got), tt.wantN)
			}
		})
	}
}

func TestDCIRTable(t *testing.T) {
	start := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	step := func(v0, i0, v1, i1 float64, dt time.Duration) []physics.Sample {
		return []physics.Sample{
			{At: start, PackVoltageV: fp(v0), PackCurrentA: fp(i0)},
			{At: start.Add(dt), PackVoltageV: fp(v1), PackCurrentA: fp(i1)},
		}
	}
	t.Run("synthetic step yields IR", func(t *testing.T) {
		got := DCIR(step(400, -50, 402, -30, 5*time.Second), "drive_step")
		if len(got) != 1 {
			t.Fatalf("points = %d, want 1", len(got))
		}
		if math.Abs(got[0].IRPackOhm-0.1) > 1e-9 {
			t.Fatalf("IR = %v, want 0.1", got[0].IRPackOhm)
		}
	})
	t.Run("missing V rejects pair", func(t *testing.T) {
		in := step(400, -50, 402, -30, 5*time.Second)
		in[1].PackVoltageV = nil
		if got := DCIR(in, "drive_step"); len(got) != 0 {
			t.Fatalf("points = %d, want 0", len(got))
		}
	})
	t.Run("slow dt rejected", func(t *testing.T) {
		if got := DCIR(step(400, -50, 402, -30, 30*time.Second), "drive_step"); len(got) != 0 {
			t.Fatalf("points = %d, want 0", len(got))
		}
	})
	t.Run("small step rejected", func(t *testing.T) {
		if got := DCIR(step(400, -50, 400.1, -49, 5*time.Second), "drive_step"); len(got) != 0 {
			t.Fatalf("points = %d, want 0", len(got))
		}
	})
}

func TestArrheniusGates(t *testing.T) {
	mk := func(temps []float64) []IRPoint {
		out := make([]IRPoint, len(temps))
		for i, tc := range temps {
			tk := tc + 273.15
			out[i] = IRPoint{IRPackOhm: 0.05 * math.Exp(3000/tk) / math.Exp(3000/298.15), TempC: fp(tc)}
		}
		return out
	}
	t.Run("two temp bins refused", func(t *testing.T) {
		if got := Arrhenius(mk([]float64{20, 21, 22, 23})); !got.Unknown {
			t.Fatal("two-bin fit must be unknown")
		}
	})
	t.Run("narrow span refused", func(t *testing.T) {
		if got := Arrhenius(mk([]float64{20, 21, 20, 21, 20, 21})); !got.Unknown {
			t.Fatal("narrow-span fit must be unknown")
		}
	})
	t.Run("wide span fits Ea", func(t *testing.T) {
		temps := []float64{}
		for _, b := range []float64{5, 15, 25, 35} {
			for k := 0; k < 4; k++ {
				temps = append(temps, b+float64(k)*0.5)
			}
		}
		got := Arrhenius(mk(temps))
		if got.Unknown || got.EaJPerMol == nil {
			t.Fatal("expected known Ea fit")
		}
		if math.Abs(*got.EaJPerMol-3000*GasConstantR) > 0.05*3000*GasConstantR {
			t.Fatalf("Ea = %v, want ~24942", *got.EaJPerMol)
		}
	})
}

func TestThermalTauRecovered(t *testing.T) {
	start := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	tau, tinf, t0 := 1800.0, 15.0, 35.0
	samples := make([]TempSample, 25)
	for i := range samples {
		ts := float64(i) * 300
		samples[i] = TempSample{
			At:    start.Add(time.Duration(ts) * time.Second),
			PackC: fp(tinf + (t0-tinf)*math.Exp(-ts/tau)), AmbientC: fp(tinf), HvacW: fp(0),
		}
	}
	got := FitCooldown(samples, true)
	if got.Unknown || got.TauS == nil {
		t.Fatal("expected known tau")
	}
	if math.Abs(*got.TauS-tau) > 0.05*tau {
		t.Fatalf("tau = %v, want %v", *got.TauS, tau)
	}
}

func TestWeatherAndTiresUnknown(t *testing.T) {
	if d := AirDensityKgM3(15, 1013.25); math.Abs(d-1.225) > 0.01 {
		t.Fatalf("density = %v, want ~1.225", d)
	}
	if dr, wr := WeatherCorrelations([]float64{1, 2}, []float64{1, 2}, []float64{1, 2}); dr != nil || wr != nil {
		t.Fatal("n<5 correlations must stay nil")
	}
	if f := UnderinflationFrac(fp(290), fp(292), nil, nil, nil); f != nil {
		t.Fatal("missing recommended kPa must stay nil")
	}
	if f := UnderinflationFrac(nil, nil, nil, nil, fp(290)); f != nil {
		t.Fatal("missing TPMS must stay nil")
	}
	est, lo, hi, ok := UnderinflationWh(fp(500), fp(0.1))
	if !ok || est <= 0 || lo >= est || hi <= est {
		t.Fatalf("model band broken: %v %v %v %v", est, lo, hi, ok)
	}
}

func TestNotebookEntryContract(t *testing.T) {
	e := NewEntry(EntryID("electrochem", 1, time.Now()), "electrochem", "H", 1, "VIN", time.Now().Add(-time.Hour), time.Now(), "2026.24", 12, "rest_ocv")
	if e.N != 12 || e.Honesty == "" {
		t.Fatal("entry must carry n + honesty")
	}
	if e.Unknown {
		t.Fatal("n=12 entry must not be unknown")
	}
	z := NewEntry("x", "d", "h", 1, "", time.Now(), time.Now(), "", 0, "m")
	if !z.Unknown {
		t.Fatal("n=0 entry must be unknown")
	}
}

func TestScienceJSONTagsSI(t *testing.T) {
	now := time.Now().UTC()
	payloads := []any{
		ElectrochemReport{VehicleID: 1, Start: now, End: now, Arrhenius: ArrheniusFit{Unknown: true},
			OCVPoints: []OCVPoint{{At: now, OCVPackV: 400, SocPct: 60}},
			IRPoints:  []IRPoint{{At: now, IRPackOhm: 0.05}}},
		ThermalReport{VehicleID: 1, Start: now, End: now, Fits: []ThermalFit{{Start: now, End: now}}},
		WeatherReport{VehicleID: 1, Start: now, End: now},
		TireReport{VehicleID: 1, Start: now, End: now, FLKpa: fp(290)},
		Notebook{VehicleID: 1, Start: now, End: now},
		ChargeIRReport{SessionID: 1, VehicleID: 1},
	}
	for i, p := range payloads {
		raw, err := json.Marshal(p)
		if err != nil {
			t.Fatal(err)
		}
		s := string(raw)
		for _, banned := range []string{"_kwh", "_psi", "_mi\"", "_mph", "true_range", "soh_pct", "current_soh"} {
			if strings.Contains(s, banned) {
				t.Fatalf("payload %d contains banned token %q", i, banned)
			}
		}
	}
	for _, want := range []string{"ocv_pack_v", "ir_pack_ohm", "ea_j_per_mol", "tau_s", "fl_kpa", "honesty"} {
		found := false
		for _, p := range payloads {
			raw, _ := json.Marshal(p)
			if strings.Contains(string(raw), want) {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("no payload carries SI key %q", want)
		}
	}
}

func TestLinRegGates(t *testing.T) {
	if _, ok := LinReg([]float64{1, 2}, []float64{1, 2}); ok {
		t.Fatal("two-point fit must be refused")
	}
	if _, ok := LinReg([]float64{1, 1, 1}, []float64{1, 2, 3}); ok {
		t.Fatal("constant-x fit must be refused")
	}
	f, ok := LinReg([]float64{1, 2, 3, 4}, []float64{2, 4, 6, 8})
	if !ok || math.Abs(f.Slope-2) > 1e-9 || math.Abs(f.R2-1) > 1e-9 {
		t.Fatalf("exact fit broken: %+v %v", f, ok)
	}
}
