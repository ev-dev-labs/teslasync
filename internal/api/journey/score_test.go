package journey

import (
	"math"
	"testing"
)

func f64(v float64) *float64 { return &v }

func TestRankStopsOrdersByBlend(t *testing.T) {
	cands := []Candidate{
		{Site: "cheap-near", Lat: 38.0, Lng: -121.0},
		{Site: "pricey-far", Lat: 38.5, Lng: -119.0},
	}
	sigs := []Signals{
		{WaitS: f64(0), PerKWh: f64(0.25), PeakKW: []float64{150, 150, 150, 150}, Available: true},
		{WaitS: f64(1800), PerKWh: f64(0.55), PeakKW: []float64{40, 150, 90, 150}, Available: true},
	}
	got := RankStops(37.0, -122.0, 39.0, -120.0, 40000, cands, sigs)
	if len(got) != 2 {
		t.Fatalf("stops = %d, want 2", len(got))
	}
	if got[0].Site != "cheap-near" || got[1].Site != "pricey-far" {
		t.Fatalf("order = %q, %q", got[0].Site, got[1].Site)
	}
	if got[0].Score <= got[1].Score {
		t.Fatalf("scores not ranked: %v vs %v", got[0].Score, got[1].Score)
	}
}

func TestRankStopsDegradesWithoutSignals(t *testing.T) {
	cands := []Candidate{{Site: "ghost", Lat: 38.0, Lng: -121.0}}
	got := RankStops(37.0, -122.0, 39.0, -120.0, 40000, cands, []Signals{{}})
	if len(got) != 1 {
		t.Fatalf("stops = %d, want 1", len(got))
	}
	if got[0].Score != 100 { // corridor-only still ranks
		t.Fatalf("score = %v, want 100", got[0].Score)
	}
	if len(got[0].Evidence) == 0 {
		t.Fatal("evidence is empty")
	}
}

func TestRankStopsDeterministic(t *testing.T) {
	cands := []Candidate{
		{Site: "a", Lat: 38.0, Lng: -121.0},
		{Site: "b", Lat: 38.1, Lng: -121.1},
	}
	sigs := []Signals{
		{WaitS: f64(300), PerKWh: f64(0.3), Available: true},
		{WaitS: f64(600), PerKWh: f64(0.4), Available: true},
	}
	a := RankStops(37.0, -122.0, 39.0, -120.0, 40000, cands, sigs)
	b := RankStops(37.0, -122.0, 39.0, -120.0, 40000, cands, sigs)
	if len(a) != 2 || a[0].Site != b[0].Site || a[0].Score != b[0].Score || a[1].Score != b[1].Score {
		t.Fatalf("nondeterministic:\n%+v\n%+v", a, b)
	}
}

func TestHealthScore(t *testing.T) {
	if h := healthScore(nil); h != nil {
		t.Fatalf("nil peaks = %v, want nil", *h)
	}
	if h := healthScore([]float64{150, 150}); h != nil {
		t.Fatalf("2 peaks = %v, want nil", *h)
	}
	steady := healthScore([]float64{150, 150, 150, 150, 150, 150})
	wild := healthScore([]float64{20, 200, 30, 190, 25, 195})
	if steady == nil || wild == nil {
		t.Fatal("expected non-nil health")
	}
	if *steady <= *wild {
		t.Fatalf("steady %v should beat wild %v", *steady, *wild)
	}
	if *steady < 0 || *steady > 100 || *wild < 0 || *wild > 100 {
		t.Fatalf("out of range: %v %v", *steady, *wild)
	}
}

func TestCorridorDeviationM(t *testing.T) {
	// Midpoint of the line deviates ~0.
	if d := corridorDeviationM(37.0, -122.0, 39.0, -120.0, 38.0, -121.0); d > 2000 {
		t.Fatalf("on-line deviation = %v m, want near 0", d)
	}
	// Two degrees of longitude off at lat 38 ≈ 175 km.
	if d := corridorDeviationM(37.0, -122.0, 39.0, -120.0, 38.0, -119.0); d < 100000 {
		t.Fatalf("off-line deviation = %v m, want large", d)
	}
	// Degenerate route measures from the origin point.
	d := corridorDeviationM(37.0, -122.0, 37.0, -122.0, 38.0, -122.0)
	if math.Abs(d-111195) > 2000 { // one degree of latitude
		t.Fatalf("degenerate = %v m, want ~111195", d)
	}
	if d := corridorDeviationM(37.0, -122.0, 37.0, -122.0, 37.0, -122.0); d != 0 {
		t.Fatalf("same point = %v, want 0", d)
	}
}

func TestScaledPrice(t *testing.T) {
	if got := scaledPrice(nil, 40000); got != nil {
		t.Fatalf("nil in = %v, want nil", *got)
	}
	if got := scaledPrice(f64(0.3), 0); *got != 0.3 {
		t.Fatalf("zero energy = %v, want passthrough", *got)
	}
	if got := scaledPrice(f64(0.3), 40000); *got != 12 {
		t.Fatalf("scaled = %v, want 12", *got)
	}
}
