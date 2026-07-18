package batterypassport

import (
	"fmt"
	"regexp"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// GradeScore + Grade — the pure durability scoring.
// ---------------------------------------------------------------------------

func TestGradeScore(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		soh       float64
		fastRatio float64
		cycles    float64
		want      float64
	}{
		{"pristine, no penalties", 100, 0, 0, 100},
		{"soh clamps above 100", 200, 0, 0, 100},
		{"soh clamps below 0", -50, 0, 0, 0},
		{"full fast + full cycle penalty", 100, 1, 1500, 80},     // 100 - 8 - 12
		{"half fast + half cycle penalty", 100, 0.5, 750, 90},    // 100 - 4 - 6
		{"cycle penalty saturates past rated", 100, 0, 3000, 88}, // 100 - 12
		{"fast ratio clamps to 1", 100, 5, 0, 92},                // 100 - 8
		{"combined drags to 30", 50, 1, 3000, 30},                // 50 - 8 - 12
		{"already zero stays zero", 0, 1, 1500, 0},               // clamps at 0
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := GradeScore(tc.soh, tc.fastRatio, tc.cycles); got != tc.want {
				t.Errorf("GradeScore(%v,%v,%v) = %v, want %v", tc.soh, tc.fastRatio, tc.cycles, got, tc.want)
			}
		})
	}
}

func TestGrade_Bands(t *testing.T) {
	t.Parallel()
	// With no fast-charge/cycle penalty the score equals the clamped SoH, so
	// SoH alone pins every letter-grade boundary.
	tests := []struct {
		soh  float64
		want string
	}{
		{100, "A"}, {90, "A"},
		{89.999, "B"}, {80, "B"},
		{79.5, "C"}, {70, "C"},
		{69.9, "D"}, {60, "D"},
		{59.9, "E"}, {50, "E"},
		{49.9, "F"}, {0, "F"},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(fmt.Sprintf("%s@soh=%g", tc.want, tc.soh), func(t *testing.T) {
			t.Parallel()
			if got := Grade(tc.soh, 0, 0); got != tc.want {
				t.Errorf("Grade(%v,0,0) = %q, want %q", tc.soh, got, tc.want)
			}
		})
	}
}

func TestGrade_PenaltiesDropLetter(t *testing.T) {
	t.Parallel()
	// A pack at 92% SoH is an A with no penalties, but sustained DC
	// fast-charging + heavy cycling drags the score to 92-8-12=72 → C.
	if got := Grade(92, 0, 0); got != "A" {
		t.Fatalf("Grade(92,0,0) = %q, want A", got)
	}
	if got := Grade(92, 1, 1500); got != "C" {
		t.Fatalf("Grade(92,1,1500) = %q, want C (92-8-12=72)", got)
	}
}

// ---------------------------------------------------------------------------
// MaskVIN.
// ---------------------------------------------------------------------------

func TestMaskVIN(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"full 17-char VIN", "5YJ3E1EA7KF123456", "5YJ**********3456"},
		{"lowercased is upper-normalised", "5yj3e1ea7kf123456", "5YJ**********3456"},
		{"surrounding whitespace trimmed", "  5YJ3E1EA7KF123456  ", "5YJ**********3456"},
		{"eight chars reveals wmi + last4", "ABCDEFGH", "ABC*EFGH"},
		{"exactly seven fully masked", "ABCDEFG", "*******"},
		{"short fully masked", "SHORT", "*****"},
		{"empty stays empty", "", ""},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := MaskVIN(tc.in); got != tc.want {
				t.Errorf("MaskVIN(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// ThermalExposureFrom.
// ---------------------------------------------------------------------------

func TestThermalExposureFrom(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name                  string
		cold, nominal, hot    int64
		wantCold, wantNominal float64
		wantHot               float64
	}{
		{"no data is all zero", 0, 0, 0, 0, 0, 0},
		{"even split", 1, 2, 1, 25, 50, 25},
		{"all nominal", 0, 10, 0, 0, 100, 0},
		{"all hot", 0, 0, 3, 0, 0, 100},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := ThermalExposureFrom(tc.cold, tc.nominal, tc.hot)
			if got.ColdPct != tc.wantCold || got.NominalPct != tc.wantNominal || got.HotPct != tc.wantHot {
				t.Errorf("ThermalExposureFrom(%d,%d,%d) = %+v, want {%v %v %v}",
					tc.cold, tc.nominal, tc.hot, got, tc.wantCold, tc.wantNominal, tc.wantHot)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// EstimateOriginalCapacityWh + medianWh.
// ---------------------------------------------------------------------------

func TestEstimateOriginalCapacityWh(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		vin   string
		model string
		want  float64
	}{
		{"vin code E → 60kWh", "1234567E", "", 60000},
		{"vin code F → 60kWh", "1234567F", "", 60000},
		{"vin code K → 75kWh", "1234567K", "", 75000},
		{"vin code S → 100kWh", "1234567S", "", 100000},
		{"vin code P → 100kWh", "1234567P", "", 100000},
		{"short vin, model X → 100kWh", "SHORT", "Model X", 100000},
		{"short vin, model S → 100kWh", "SHORT", "Model S", 100000},
		{"short vin, model 3 → default", "SHORT", "Model 3", 75000},
		{"unknown → default", "", "", 75000},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := EstimateOriginalCapacityWh(tc.vin, tc.model); got != tc.want {
				t.Errorf("EstimateOriginalCapacityWh(%q,%q) = %v, want %v", tc.vin, tc.model, got, tc.want)
			}
		})
	}
}

func TestMedianWh(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   []float64
		want float64
	}{
		{"empty is zero", nil, 0},
		{"single", []float64{100}, 100},
		{"odd count", []float64{100, 200, 300}, 200},
		{"even count averages middle two", []float64{100, 200, 300, 400}, 250},
		{"unsorted input is sorted", []float64{300, 100, 200}, 200},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := medianWh(tc.in); got != tc.want {
				t.Errorf("medianWh(%v) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

func TestMedianWh_DoesNotMutateInput(t *testing.T) {
	t.Parallel()
	in := []float64{300, 100, 200}
	_ = medianWh(in)
	if in[0] != 300 || in[1] != 100 || in[2] != 200 {
		t.Errorf("medianWh mutated its input: %v", in)
	}
}

// ---------------------------------------------------------------------------
// Recommendations.
// ---------------------------------------------------------------------------

func TestRecommendations(t *testing.T) {
	t.Parallel()

	t.Run("healthy pack gets a single positive note", func(t *testing.T) {
		t.Parallel()
		recs := Recommendations(95, 0.1, 80, 5, 100)
		if len(recs) != 1 {
			t.Fatalf("len = %d, want 1 (%v)", len(recs), recs)
		}
		if !strings.Contains(recs[0], "within healthy bounds") {
			t.Errorf("unexpected healthy rec: %q", recs[0])
		}
	})

	t.Run("each risk raises its own recommendation", func(t *testing.T) {
		t.Parallel()
		recs := Recommendations(75, 0.6, 95, 40, 2000)
		joined := strings.Join(recs, " || ")
		for _, want := range []string{
			"80% warranty threshold",
			"DC fast-charging dominates",
			"charge limit is high",
			"high-temperature operation",
			"rated cycle life",
		} {
			if !strings.Contains(joined, want) {
				t.Errorf("recommendations missing %q; got %v", want, recs)
			}
		}
	})

	t.Run("unknown soh does not trigger the warranty note", func(t *testing.T) {
		t.Parallel()
		recs := Recommendations(0, 0.1, 80, 5, 100)
		for _, r := range recs {
			if strings.Contains(r, "warranty threshold") {
				t.Errorf("warranty note raised for soh=0: %q", r)
			}
		}
	})

	t.Run("never returns nil", func(t *testing.T) {
		t.Parallel()
		if Recommendations(0, 0, 0, 0, 0) == nil {
			t.Error("Recommendations returned nil")
		}
	})
}

// ---------------------------------------------------------------------------
// CanonicalString + ProvenanceHash — determinism, format, tamper sensitivity.
// ---------------------------------------------------------------------------

// goldenFacts is a fixed input whose canonical form + digest are pinned below.
var goldenFacts = PassportCoreFacts{
	VehicleID:            42,
	FirstObservedAt:      time.Date(2023, 1, 15, 0, 0, 0, 0, time.UTC),
	SohPct:               93.2,
	CapacityKwh:          69.9,
	EquivalentFullCycles: 210.0,
	FastChargeRatio:      0.35,
	IssuedAt:             time.Date(2026, 7, 6, 11, 3, 21, 0, time.UTC),
}

const (
	goldenCanonical = "tsbp-v1|vehicle_id=42|first_observed_at=2023-01-15|soh_pct=93.2000|capacity_kwh=69.9000|equivalent_full_cycles=210.0000|fast_charge_ratio=0.3500|issued_at=2026-07-06"
	goldenHash      = "ef1f4c87480f80848800fcb5937c3cad2aa5ab41195876ab7d4a20357c29196f"
)

func TestCanonicalString_PinnedFormat(t *testing.T) {
	t.Parallel()
	if got := CanonicalString(goldenFacts); got != goldenCanonical {
		t.Errorf("CanonicalString mismatch:\n got %q\nwant %q", got, goldenCanonical)
	}
}

func TestCanonicalString_IssuedAtRoundedToDay(t *testing.T) {
	t.Parallel()
	// Two issuance instants on the same UTC day must canonicalize identically.
	a := goldenFacts
	a.IssuedAt = time.Date(2026, 7, 6, 0, 0, 1, 0, time.UTC)
	b := goldenFacts
	b.IssuedAt = time.Date(2026, 7, 6, 23, 59, 59, 0, time.UTC)
	if CanonicalString(a) != CanonicalString(b) {
		t.Error("same-day issuance produced different canonical strings")
	}
}

func TestProvenanceHash_GoldenAndDeterministic(t *testing.T) {
	t.Parallel()

	if got := ProvenanceHash(goldenFacts); got != goldenHash {
		t.Errorf("ProvenanceHash = %q, want golden %q", got, goldenHash)
	}

	hexRe := regexp.MustCompile(`^[0-9a-f]{64}$`)
	if !hexRe.MatchString(ProvenanceHash(goldenFacts)) {
		t.Error("hash is not 64 lowercase hex chars")
	}

	// Stable across many runs for identical input.
	first := ProvenanceHash(goldenFacts)
	for i := 0; i < 1000; i++ {
		if got := ProvenanceHash(goldenFacts); got != first {
			t.Fatalf("hash unstable on run %d: %q != %q", i, got, first)
		}
	}
}

func TestProvenanceHash_TamperSensitivity(t *testing.T) {
	t.Parallel()
	base := ProvenanceHash(goldenFacts)

	mutations := map[string]func(f *PassportCoreFacts){
		"vehicle_id":             func(f *PassportCoreFacts) { f.VehicleID = 43 },
		"first_observed_at day":  func(f *PassportCoreFacts) { f.FirstObservedAt = f.FirstObservedAt.AddDate(0, 0, 1) },
		"soh_pct":                func(f *PassportCoreFacts) { f.SohPct = 93.3 },
		"capacity_kwh":           func(f *PassportCoreFacts) { f.CapacityKwh = 70.0 },
		"equivalent_full_cycles": func(f *PassportCoreFacts) { f.EquivalentFullCycles = 211 },
		"fast_charge_ratio":      func(f *PassportCoreFacts) { f.FastChargeRatio = 0.36 },
		"issued_at day":          func(f *PassportCoreFacts) { f.IssuedAt = f.IssuedAt.AddDate(0, 0, 1) },
	}
	for name, mutate := range mutations {
		name, mutate := name, mutate
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			f := goldenFacts
			mutate(&f)
			if got := ProvenanceHash(f); got == base {
				t.Errorf("mutating %s did not change the hash", name)
			}
		})
	}
}

func TestProvenanceHash_SubSecondIssuedIrrelevant(t *testing.T) {
	t.Parallel()
	// Because issued_at is day-rounded, sub-second jitter within a day must
	// not perturb the digest — the reproducibility guarantee the verify
	// endpoint relies on.
	a := goldenFacts
	b := goldenFacts
	b.IssuedAt = b.IssuedAt.Add(37 * time.Second)
	if ProvenanceHash(a) != ProvenanceHash(b) {
		t.Error("sub-day issuance jitter changed the provenance hash")
	}
}
