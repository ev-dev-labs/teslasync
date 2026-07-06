package carbon

import (
	"math"
	"reflect"
	"testing"
)

// ---------------------------------------------------------------------------
// Shared fixture: the built-in diurnal curve seeded by
// migrations/000217_grid_carbon_intensity.up.sql. Kept in lock-step with the
// migration so a drift between the SQL seed and the Go tests fails loudly here.
// Reused by the handler tests (same package) to script the intensity read.
// ---------------------------------------------------------------------------

func builtInCurveValues() [hoursPerDay]float64 {
	return [hoursPerDay]float64{
		260, 250, 245, 245, 250, 265, 300, 340, 330, 280, 240, 215,
		200, 200, 205, 225, 270, 340, 430, 500, 490, 450, 370, 300,
	}
}

func builtInCurve() []HourIntensity {
	vals := builtInCurveValues()
	curve := make([]HourIntensity, 0, hoursPerDay)
	for h, v := range vals {
		curve = append(curve, HourIntensity{HourOfDay: h, GCO2PerKWh: v})
	}
	return curve
}

const eps = 1e-9

func approx(a, b float64) bool { return math.Abs(a-b) <= eps }

// ---------------------------------------------------------------------------
// SessionCO2Kg — energy(kWh) × intensity(gCO2/kWh) ÷ 1000 = kg CO2.
// ---------------------------------------------------------------------------

func TestSessionCO2Kg(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		energy  float64
		gPerKWh float64
		want    float64
	}{
		{"clean midday kWh", 10, 200, 2.0},
		{"dirty evening kWh", 10, 500, 5.0},
		{"partial energy", 2.5, 400, 1.0},
		{"zero energy", 0, 500, 0},
		{"zero intensity", 10, 0, 0},
		{"negative energy guarded", -5, 200, 0},
		{"negative intensity guarded", 10, -200, 0},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := SessionCO2Kg(tc.energy, tc.gPerKWh); !approx(got, tc.want) {
				t.Errorf("SessionCO2Kg(%v,%v) = %v, want %v", tc.energy, tc.gPerKWh, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// GasEquivCO2Kg — distance(km) × 0.192 kg/km.
// ---------------------------------------------------------------------------

func TestGasEquivCO2Kg(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		km   float64
		want float64
	}{
		{"100 km", 100, 19.2},
		{"1000 km", 1000, 192.0},
		{"zero", 0, 0},
		{"negative guarded", -50, 0},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := GasEquivCO2Kg(tc.km); !approx(got, tc.want) {
				t.Errorf("GasEquivCO2Kg(%v) = %v, want %v", tc.km, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// GreenScore — how close the realized intensity is to the greenest hour.
// ---------------------------------------------------------------------------

func TestGreenScore(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name              string
		realized, lo, hi  float64
		want              float64
	}{
		{"always greenest ⇒ 100", 200, 200, 500, 100},
		{"always dirtiest ⇒ 0", 500, 200, 500, 0},
		{"exact midpoint ⇒ 50", 350, 200, 500, 50},
		{"one third up ⇒ ~66.67", 300, 200, 500, (500.0 - 300.0) / 300.0 * 100},
		{"flat curve ⇒ 100", 250, 250, 250, 100},
		{"cleaner than min clamps to 100", 100, 200, 500, 100},
		{"dirtier than max clamps to 0", 600, 200, 500, 0},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := GreenScore(tc.realized, tc.lo, tc.hi); !approx(got, tc.want) {
				t.Errorf("GreenScore(%v,%v,%v) = %v, want %v", tc.realized, tc.lo, tc.hi, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// CurveStats — min/max + the sets of hours achieving each.
// ---------------------------------------------------------------------------

func TestCurveStats(t *testing.T) {
	t.Parallel()

	t.Run("built-in curve", func(t *testing.T) {
		t.Parallel()
		minV, maxV, greenest, dirtiest := CurveStats(builtInCurve())
		if !approx(minV, 200) || !approx(maxV, 500) {
			t.Fatalf("min/max = %v/%v, want 200/500", minV, maxV)
		}
		if !reflect.DeepEqual(greenest, []int{12, 13}) {
			t.Errorf("greenest = %v, want [12 13]", greenest)
		}
		if !reflect.DeepEqual(dirtiest, []int{19}) {
			t.Errorf("dirtiest = %v, want [19]", dirtiest)
		}
	})

	t.Run("ties collect every matching hour, sorted", func(t *testing.T) {
		t.Parallel()
		curve := []HourIntensity{
			{HourOfDay: 3, GCO2PerKWh: 500},
			{HourOfDay: 1, GCO2PerKWh: 200},
			{HourOfDay: 4, GCO2PerKWh: 500},
			{HourOfDay: 2, GCO2PerKWh: 200},
		}
		minV, maxV, greenest, dirtiest := CurveStats(curve)
		if !approx(minV, 200) || !approx(maxV, 500) {
			t.Fatalf("min/max = %v/%v, want 200/500", minV, maxV)
		}
		if !reflect.DeepEqual(greenest, []int{1, 2}) {
			t.Errorf("greenest = %v, want [1 2]", greenest)
		}
		if !reflect.DeepEqual(dirtiest, []int{3, 4}) {
			t.Errorf("dirtiest = %v, want [3 4]", dirtiest)
		}
	})

	t.Run("empty curve yields non-nil empty slices", func(t *testing.T) {
		t.Parallel()
		minV, maxV, greenest, dirtiest := CurveStats(nil)
		if minV != 0 || maxV != 0 {
			t.Errorf("min/max = %v/%v, want 0/0", minV, maxV)
		}
		if greenest == nil || dirtiest == nil {
			t.Fatal("greenest/dirtiest must be non-nil (JSON must not carry null arrays)")
		}
		if len(greenest) != 0 || len(dirtiest) != 0 {
			t.Errorf("greenest/dirtiest = %v/%v, want empty", greenest, dirtiest)
		}
	})
}

// ---------------------------------------------------------------------------
// EnergyWeightedIntensity — realized intensity a driver actually incurred.
// ---------------------------------------------------------------------------

func TestEnergyWeightedIntensity(t *testing.T) {
	t.Parallel()
	lookup := map[int]float64{0: 300, 1: 200, 2: 500}
	tests := []struct {
		name   string
		energy map[int]float64
		want   float64
	}{
		{"single hour", map[int]float64{2: 5}, 500},
		{"even split", map[int]float64{0: 10, 1: 10}, 250},
		{"weighted split", map[int]float64{0: 30, 2: 10}, (30*300 + 10*500) / 40.0},
		{"hour missing from lookup skipped", map[int]float64{5: 100}, 0},
		{"zero energy skipped", map[int]float64{0: 0}, 0},
		{"empty", map[int]float64{}, 0},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := EnergyWeightedIntensity(tc.energy, lookup); !approx(got, tc.want) {
				t.Errorf("EnergyWeightedIntensity(%v) = %v, want %v", tc.energy, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// GreenestWindow — lowest-mean contiguous window, wrapping past midnight.
// ---------------------------------------------------------------------------

func TestGreenestWindow(t *testing.T) {
	t.Parallel()

	t.Run("built-in curve picks midday solar trough", func(t *testing.T) {
		t.Parallel()
		start, end, avg := GreenestWindow(builtInCurve(), 3)
		if start != 12 || end != 15 {
			t.Fatalf("window = [%d,%d), want [12,15)", start, end)
		}
		if !approx(avg, (200+200+205)/3.0) {
			t.Errorf("avg = %v, want %v", avg, (200+200+205)/3.0)
		}
	})

	t.Run("window wraps across midnight", func(t *testing.T) {
		t.Parallel()
		// All 500 except a clean trough at 23,0,1 = 100 each.
		curve := make([]HourIntensity, hoursPerDay)
		for h := range curve {
			curve[h] = HourIntensity{HourOfDay: h, GCO2PerKWh: 500}
		}
		curve[23].GCO2PerKWh = 100
		curve[0].GCO2PerKWh = 100
		curve[1].GCO2PerKWh = 100
		start, end, avg := GreenestWindow(curve, 3)
		if start != 23 || end != 2 {
			t.Fatalf("window = [%d,%d), want [23,2)", start, end)
		}
		if !approx(avg, 100) {
			t.Errorf("avg = %v, want 100", avg)
		}
	})

	t.Run("ties break toward the earliest start hour", func(t *testing.T) {
		t.Parallel()
		curve := make([]HourIntensity, hoursPerDay)
		for h := range curve {
			curve[h] = HourIntensity{HourOfDay: h, GCO2PerKWh: 500}
		}
		// Two equal-minimum troughs; earliest (start=2) must win.
		for _, h := range []int{2, 3, 4, 14, 15, 16} {
			curve[h].GCO2PerKWh = 100
		}
		start, _, avg := GreenestWindow(curve, 3)
		if start != 2 {
			t.Fatalf("start = %d, want 2 (earliest of the tied troughs)", start)
		}
		if !approx(avg, 100) {
			t.Errorf("avg = %v, want 100", avg)
		}
	})

	t.Run("length over 24 clamps to the whole day", func(t *testing.T) {
		t.Parallel()
		start, end, avg := GreenestWindow(builtInCurve(), 48)
		if start != 0 || end != 0 {
			t.Fatalf("window = [%d,%d), want [0,0) (whole-day wrap)", start, end)
		}
		var sum float64
		for _, v := range builtInCurveValues() {
			sum += v
		}
		if !approx(avg, sum/hoursPerDay) {
			t.Errorf("avg = %v, want %v", avg, sum/hoursPerDay)
		}
	})

	t.Run("degenerate inputs yield zeros", func(t *testing.T) {
		t.Parallel()
		if s, e, a := GreenestWindow(nil, 3); s != 0 || e != 0 || a != 0 {
			t.Errorf("empty curve = (%d,%d,%v), want (0,0,0)", s, e, a)
		}
		if s, e, a := GreenestWindow(builtInCurve(), 0); s != 0 || e != 0 || a != 0 {
			t.Errorf("zero length = (%d,%d,%v), want (0,0,0)", s, e, a)
		}
	})

	t.Run("incomplete window is never chosen", func(t *testing.T) {
		t.Parallel()
		// Only hours 10,11 present (a low pair) plus a full high triple at
		// 20,21,22. A 3-hour window needs three present hours, so the low
		// pair cannot form a window and 20-23 must win.
		curve := []HourIntensity{
			{HourOfDay: 10, GCO2PerKWh: 50},
			{HourOfDay: 11, GCO2PerKWh: 50},
			{HourOfDay: 20, GCO2PerKWh: 300},
			{HourOfDay: 21, GCO2PerKWh: 300},
			{HourOfDay: 22, GCO2PerKWh: 300},
		}
		start, end, avg := GreenestWindow(curve, 3)
		if start != 20 || end != 23 {
			t.Fatalf("window = [%d,%d), want [20,23)", start, end)
		}
		if !approx(avg, 300) {
			t.Errorf("avg = %v, want 300", avg)
		}
	})
}

// ---------------------------------------------------------------------------
// PotentialSaving — shifting all charging into the greenest window.
// ---------------------------------------------------------------------------

func TestPotentialSaving(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name                     string
		energy, current, window  float64
		wantKg, wantPct          float64
	}{
		{"clear saving", 100, 300, 200, 10, (100.0 / 300.0) * 100},
		{"large saving", 50, 500, 200, 15, 60},
		{"already at window ⇒ none", 100, 200, 200, 0, 0},
		{"already cleaner ⇒ none", 100, 150, 200, 0, 0},
		{"no energy ⇒ none", 0, 300, 200, 0, 0},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			gotKg, gotPct := PotentialSaving(tc.energy, tc.current, tc.window)
			if !approx(gotKg, tc.wantKg) {
				t.Errorf("savingKg = %v, want %v", gotKg, tc.wantKg)
			}
			if !approx(gotPct, tc.wantPct) {
				t.Errorf("savingPct = %v, want %v", gotPct, tc.wantPct)
			}
		})
	}
}
