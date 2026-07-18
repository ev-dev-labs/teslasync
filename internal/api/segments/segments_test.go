package segments

import (
	"math"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Pure-core table tests. Everything here is a deterministic transform of its
// inputs (no DB, no clock, no network), so the haversine distance, the greedy
// seed-anchored clustering, the leaderboard ranking, and the ghost
// alignment/interpolation are locked down independently of the handler.
// ---------------------------------------------------------------------------

const eps = 1e-9

func approx(a, b float64) bool { return math.Abs(a-b) <= eps }

// approxT compares with an explicit tolerance (used for the haversine, whose
// spherical model is only accurate to well under a metre at this scale).
func approxT(a, b, tol float64) bool { return math.Abs(a-b) <= tol }

var baseTime = time.Date(2024, 1, 1, 8, 0, 0, 0, time.UTC)

// mkDrive is a terse DrivePoint builder for the table tests. hasEnergy is
// implied by energyWh > 0 (mirrors how the handler sets the flag).
func mkDrive(id int64, offsetH int, sLat, sLon, eLat, eLon, distM, durS, energyWh float64) DrivePoint {
	return DrivePoint{
		DriveID:   id,
		StartedAt: baseTime.Add(time.Duration(offsetH) * time.Hour),
		StartLat:  sLat,
		StartLon:  sLon,
		EndLat:    eLat,
		EndLon:    eLon,
		DistanceM: distM,
		DurationS: durS,
		EnergyWh:  energyWh,
		HasEnergy: energyWh > 0,
	}
}

// ---------------------------------------------------------------------------
// HaversineMeters — great-circle distance.
// ---------------------------------------------------------------------------

func TestHaversineMeters(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name                   string
		lat1, lon1, lat2, lon2 float64
		want                   float64
		tol                    float64
	}{
		{"identical point is zero", 51.5, -0.12, 51.5, -0.12, 0, eps},
		{"one degree of longitude at equator", 0, 0, 0, 1, 111194.93, 1.0},
		{"one degree of latitude", 0, 0, 1, 0, 111194.93, 1.0},
		{"one milli-degree of longitude at equator", 0, 0, 0, 0.001, 111.19, 0.1},
		{"symmetric (order independent)", 0, 0.001, 0, 0, 111.19, 0.1},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := HaversineMeters(tc.lat1, tc.lon1, tc.lat2, tc.lon2)
			if !approxT(got, tc.want, tc.tol) {
				t.Fatalf("HaversineMeters = %.4f, want %.4f (±%.4f)", got, tc.want, tc.tol)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// WithinRadius / SameSegment — the segment membership predicate.
// ---------------------------------------------------------------------------

func TestWithinRadius(t *testing.T) {
	t.Parallel()
	// ~222 m apart (0.002° of longitude at the equator).
	if !WithinRadius(0, 0, 0, 0.002, 250) {
		t.Fatal("expected 222 m to be within 250 m")
	}
	if WithinRadius(0, 0, 0, 0.002, 100) {
		t.Fatal("expected 222 m NOT to be within 100 m")
	}
	if !WithinRadius(1.2345, 6.789, 1.2345, 6.789, 0) {
		t.Fatal("expected an identical point to be within a zero radius")
	}
}

func TestSameSegment(t *testing.T) {
	t.Parallel()
	// Start and end both close.
	a := mkDrive(1, 0, 0, 0, 0, 1, 1000, 100, 0)
	near := mkDrive(2, 1, 0, 0.001, 0, 1.001, 1000, 100, 0) // ~111 m at both ends
	if !SameSegment(a, near, DefaultRadiusM) {
		t.Fatal("expected drives with close start AND end to share a segment")
	}
	// Same start, far end.
	farEnd := mkDrive(3, 2, 0, 0.001, 5, 5, 1000, 100, 0)
	if SameSegment(a, farEnd, DefaultRadiusM) {
		t.Fatal("expected a far END to break segment membership")
	}
	// Far start, same end.
	farStart := mkDrive(4, 3, 5, 5, 0, 1.001, 1000, 100, 0)
	if SameSegment(a, farStart, DefaultRadiusM) {
		t.Fatal("expected a far START to break segment membership")
	}
}

// ---------------------------------------------------------------------------
// ClusterDrives — greedy, seed-anchored, NON-transitive.
// ---------------------------------------------------------------------------

func TestClusterDrives_GroupsAndSplits(t *testing.T) {
	t.Parallel()
	// A and B share a segment; C is far away.
	a := mkDrive(1, 0, 0, 0, 0, 1, 1000, 300, 0)
	b := mkDrive(2, 1, 0.0001, 0.0001, 0, 1.0001, 1000, 200, 0)
	c := mkDrive(3, 2, 10, 10, 11, 11, 5000, 900, 0)

	clusters := ClusterDrives([]DrivePoint{a, b, c}, DefaultRadiusM)
	if len(clusters) != 2 {
		t.Fatalf("clusters = %d, want 2", len(clusters))
	}
	if len(clusters[0].Drives) != 2 || clusters[0].Seed.DriveID != 1 {
		t.Fatalf("first cluster: seed=%d size=%d, want seed=1 size=2",
			clusters[0].Seed.DriveID, len(clusters[0].Drives))
	}
	if len(clusters[1].Drives) != 1 || clusters[1].Seed.DriveID != 3 {
		t.Fatalf("second cluster: seed=%d size=%d, want seed=3 size=1",
			clusters[1].Seed.DriveID, len(clusters[1].Drives))
	}
}

func TestClusterDrives_SeedAnchoredNotTransitive(t *testing.T) {
	t.Parallel()
	// Ends are identical for all three; only the START varies along a line:
	//   A start lon 0.000, B start lon 0.002 (~222 m from A, within 250),
	//   C start lon 0.004 (~444 m from A -> NOT within 250, though ~222 m from B).
	// Because membership is anchored to the SEED (A), C does not chain onto B;
	// it seeds its own cluster. This locks the non-transitive behaviour.
	a := mkDrive(1, 0, 0, 0.000, 0, 1, 1000, 300, 0)
	b := mkDrive(2, 1, 0, 0.002, 0, 1, 1000, 200, 0)
	c := mkDrive(3, 2, 0, 0.004, 0, 1, 1000, 250, 0)

	clusters := ClusterDrives([]DrivePoint{a, b, c}, DefaultRadiusM)
	if len(clusters) != 2 {
		t.Fatalf("clusters = %d, want 2 (non-transitive seed anchoring)", len(clusters))
	}
	if len(clusters[0].Drives) != 2 {
		t.Fatalf("cluster A size = %d, want 2 (A,B)", len(clusters[0].Drives))
	}
	if len(clusters[1].Drives) != 1 || clusters[1].Seed.DriveID != 3 {
		t.Fatalf("cluster C = seed %d size %d, want seed 3 size 1",
			clusters[1].Seed.DriveID, len(clusters[1].Drives))
	}
}

func TestClusterDrives_Empty(t *testing.T) {
	t.Parallel()
	if got := ClusterDrives(nil, DefaultRadiusM); len(got) != 0 {
		t.Fatalf("clusters = %d, want 0", len(got))
	}
}

// ---------------------------------------------------------------------------
// MostCommon — deterministic mode with blank filtering + lexicographic tie-break.
// ---------------------------------------------------------------------------

func TestMostCommon(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		vals []string
		want string
	}{
		{"clear winner", []string{"x", "x", "y"}, "x"},
		{"blanks ignored", []string{"", "  ", "home", "home"}, "home"},
		{"all blank", []string{"", "  ", "\t"}, ""},
		{"tie breaks lexicographically", []string{"b", "a"}, "a"},
		{"empty", nil, ""},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := MostCommon(tc.vals); got != tc.want {
				t.Fatalf("MostCommon(%v) = %q, want %q", tc.vals, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// WhPerKm — SI energy efficiency, guarded division.
// ---------------------------------------------------------------------------

func TestWhPerKm(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name             string
		energyWh, distM  float64
		want             float64
	}{
		{"10 km at 2000 Wh", 2000, 10000, 200},
		{"1 km at 150 Wh", 150, 1000, 150},
		{"zero distance is undefined", 500, 0, 0},
		{"negative distance guarded", 500, -100, 0},
		{"zero energy", 0, 10000, 0},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := WhPerKm(tc.energyWh, tc.distM); !approx(got, tc.want) {
				t.Fatalf("WhPerKm(%v,%v) = %v, want %v", tc.energyWh, tc.distM, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// MedianDistanceM — odd/even/empty.
// ---------------------------------------------------------------------------

func TestMedianDistanceM(t *testing.T) {
	t.Parallel()
	mk := func(dists ...float64) []DrivePoint {
		out := make([]DrivePoint, len(dists))
		for i, d := range dists {
			out[i] = DrivePoint{DistanceM: d}
		}
		return out
	}
	tests := []struct {
		name   string
		drives []DrivePoint
		want   float64
	}{
		{"odd count", mk(30, 10, 20), 20},
		{"even count averages the middle two", mk(10, 20, 30, 40), 25},
		{"unsorted input", mk(40, 10, 30, 20), 25},
		{"single", mk(1234), 1234},
		{"empty", nil, 0},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := MedianDistanceM(tc.drives); !approx(got, tc.want) {
				t.Fatalf("MedianDistanceM = %v, want %v", got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Summarize / InterestingSegments — the per-segment display + PB reduction.
// ---------------------------------------------------------------------------

func TestSummarize(t *testing.T) {
	t.Parallel()
	// Three attempts of Home -> Work; one alternate end label; one drive with no
	// energy reading. d2 is both the fastest AND the most efficient; d3 is latest.
	d1 := mkDrive(1, 0, 0, 0, 0, 1, 10000, 300, 2000) // 200 Wh/km
	d1.StartPlace, d1.EndPlace = "Home", "Work"
	d2 := mkDrive(2, 1, 0, 0, 0, 1, 10000, 200, 1500) // 150 Wh/km (best)
	d2.StartPlace, d2.EndPlace = "Home", "Work"
	d3 := mkDrive(3, 2, 0, 0, 0, 1, 12000, 250, 0) // no energy
	d3.StartPlace, d3.EndPlace = "Home", "Office"

	got := Summarize(Cluster{Seed: d1, Drives: []DrivePoint{d1, d2, d3}})

	if got.AttemptCount != 3 {
		t.Fatalf("AttemptCount = %d, want 3", got.AttemptCount)
	}
	if got.StartAddress != "Home" || got.EndAddress != "Work" {
		t.Fatalf("addresses = %q -> %q, want Home -> Work", got.StartAddress, got.EndAddress)
	}
	if got.Name != "Home → Work" {
		t.Fatalf("Name = %q, want %q", got.Name, "Home → Work")
	}
	if !approx(got.DistanceM, 10000) {
		t.Fatalf("DistanceM (median) = %v, want 10000", got.DistanceM)
	}
	if got.BestTime.DriveID != 2 {
		t.Fatalf("BestTime drive = %d, want 2", got.BestTime.DriveID)
	}
	if got.Latest.DriveID != 3 {
		t.Fatalf("Latest drive = %d, want 3", got.Latest.DriveID)
	}
	if !got.HasBestEff || got.BestEff.DriveID != 2 || !approx(got.BestEffWhPerKm, 150) {
		t.Fatalf("BestEff = drive %d @ %v Wh/km (has=%v), want drive 2 @ 150",
			got.BestEff.DriveID, got.BestEffWhPerKm, got.HasBestEff)
	}
}

func TestSummarize_NoEnergyMeansNoBestEff(t *testing.T) {
	t.Parallel()
	d1 := mkDrive(1, 0, 0, 0, 0, 1, 10000, 300, 0)
	d2 := mkDrive(2, 1, 0, 0, 0, 1, 10000, 200, 0)
	got := Summarize(Cluster{Seed: d1, Drives: []DrivePoint{d1, d2}})
	if got.HasBestEff {
		t.Fatalf("HasBestEff = true, want false when no attempt has energy")
	}
	if got.BestTime.DriveID != 2 {
		t.Fatalf("BestTime = %d, want 2 (fastest still resolved)", got.BestTime.DriveID)
	}
}

func TestSummarize_FallbackNameFromCoords(t *testing.T) {
	t.Parallel()
	d1 := mkDrive(1, 0, 12.34567, 1.0, 76.54321, 2.0, 1000, 100, 0)
	d2 := mkDrive(2, 1, 12.34567, 1.0, 76.54321, 2.0, 1000, 90, 0)
	got := Summarize(Cluster{Seed: d1, Drives: []DrivePoint{d1, d2}})
	want := "12.3457, 1.0000 → 76.5432, 2.0000"
	if got.Name != want {
		t.Fatalf("Name = %q, want %q", got.Name, want)
	}
}

func TestInterestingSegments_FiltersByMinAttempts(t *testing.T) {
	t.Parallel()
	two := Cluster{Seed: mkDrive(1, 0, 0, 0, 0, 1, 1000, 100, 0),
		Drives: []DrivePoint{mkDrive(1, 0, 0, 0, 0, 1, 1000, 100, 0), mkDrive(2, 1, 0, 0, 0, 1, 1000, 90, 0)}}
	one := Cluster{Seed: mkDrive(3, 2, 5, 5, 6, 6, 1000, 100, 0),
		Drives: []DrivePoint{mkDrive(3, 2, 5, 5, 6, 6, 1000, 100, 0)}}
	three := Cluster{Seed: mkDrive(4, 3, 9, 9, 8, 8, 1000, 100, 0),
		Drives: []DrivePoint{
			mkDrive(4, 3, 9, 9, 8, 8, 1000, 100, 0),
			mkDrive(5, 4, 9, 9, 8, 8, 1000, 95, 0),
			mkDrive(6, 5, 9, 9, 8, 8, 1000, 92, 0),
		}}

	got := InterestingSegments([]Cluster{two, one, three}, MinAttempts)
	if len(got) != 2 {
		t.Fatalf("interesting segments = %d, want 2 (the >=2-attempt clusters)", len(got))
	}
	// Always non-nil even when nothing qualifies.
	if InterestingSegments([]Cluster{one}, MinAttempts) == nil {
		t.Fatal("expected a non-nil empty slice, got nil")
	}
}

// ---------------------------------------------------------------------------
// RankByTime — fastest first, delta-to-best, PR flag, deterministic ties.
// ---------------------------------------------------------------------------

func TestRankByTime(t *testing.T) {
	t.Parallel()
	d1 := mkDrive(1, 0, 0, 0, 0, 1, 10000, 300, 2000) // 200 Wh/km
	d2 := mkDrive(2, 1, 0, 0, 0, 1, 10000, 200, 1500) // 150 Wh/km, fastest
	d3 := mkDrive(3, 2, 0, 0, 0, 1, 10000, 250, 0)    // no energy

	got := RankByTime([]DrivePoint{d1, d2, d3})
	if len(got) != 3 {
		t.Fatalf("rows = %d, want 3", len(got))
	}
	// Order: d2 (200s), d3 (250s), d1 (300s).
	wantOrder := []int64{2, 3, 1}
	for i, w := range wantOrder {
		if got[i].Drive.DriveID != w || got[i].Rank != i+1 {
			t.Fatalf("row %d = drive %d rank %d, want drive %d rank %d",
				i, got[i].Drive.DriveID, got[i].Rank, w, i+1)
		}
	}
	if !got[0].IsPR || got[1].IsPR || got[2].IsPR {
		t.Fatal("expected only the rank-1 row to be flagged IsPR")
	}
	// Deltas relative to the 200 s best.
	if !approx(got[0].DeltaToBestS, 0) || !approx(got[1].DeltaToBestS, 50) || !approx(got[2].DeltaToBestS, 100) {
		t.Fatalf("deltas = %v/%v/%v, want 0/50/100",
			got[0].DeltaToBestS, got[1].DeltaToBestS, got[2].DeltaToBestS)
	}
	// Efficiency carried where present, absent for the energy-less drive.
	if !got[0].HasWhPerKm || !approx(got[0].WhPerKm, 150) {
		t.Fatalf("row0 Wh/km = %v (has=%v), want 150", got[0].WhPerKm, got[0].HasWhPerKm)
	}
	if got[1].HasWhPerKm {
		t.Fatal("expected the energy-less drive to have no Wh/km")
	}
}

func TestRankByTime_TieBreaksByEarlierStart(t *testing.T) {
	t.Parallel()
	early := mkDrive(1, 0, 0, 0, 0, 1, 10000, 200, 0)
	late := mkDrive(2, 5, 0, 0, 0, 1, 10000, 200, 0)
	got := RankByTime([]DrivePoint{late, early})
	if got[0].Drive.DriveID != 1 || got[1].Drive.DriveID != 2 {
		t.Fatalf("tie order = %d,%d, want 1,2 (earlier start first)",
			got[0].Drive.DriveID, got[1].Drive.DriveID)
	}
}

func TestRankByTime_Empty(t *testing.T) {
	t.Parallel()
	if got := RankByTime(nil); got == nil || len(got) != 0 {
		t.Fatalf("RankByTime(nil) = %v, want non-nil empty", got)
	}
}

// ---------------------------------------------------------------------------
// RankByEfficiency — most efficient first, omits energy-less attempts.
// ---------------------------------------------------------------------------

func TestRankByEfficiency(t *testing.T) {
	t.Parallel()
	d1 := mkDrive(1, 0, 0, 0, 0, 1, 10000, 300, 2000) // 200 Wh/km
	d2 := mkDrive(2, 1, 0, 0, 0, 1, 10000, 200, 1500) // 150 Wh/km (best eff)
	d3 := mkDrive(3, 2, 0, 0, 0, 1, 10000, 250, 0)    // no energy -> omitted

	got := RankByEfficiency([]DrivePoint{d1, d2, d3})
	if len(got) != 2 {
		t.Fatalf("rows = %d, want 2 (energy-less drive omitted)", len(got))
	}
	if got[0].Drive.DriveID != 2 || !got[0].IsPR {
		t.Fatalf("rank1 = drive %d (PR=%v), want drive 2 PR", got[0].Drive.DriveID, got[0].IsPR)
	}
	if got[1].Drive.DriveID != 1 || got[1].IsPR {
		t.Fatalf("rank2 = drive %d (PR=%v), want drive 1 non-PR", got[1].Drive.DriveID, got[1].IsPR)
	}
	// DeltaToBestS remains the gap to the fastest run overall (200 s):
	// d2=200s -> 0, d1=300s -> 100.
	if !approx(got[0].DeltaToBestS, 0) || !approx(got[1].DeltaToBestS, 100) {
		t.Fatalf("deltas = %v/%v, want 0/100", got[0].DeltaToBestS, got[1].DeltaToBestS)
	}
}

func TestRankByEfficiency_TieBreaksByEarlierStart(t *testing.T) {
	t.Parallel()
	early := mkDrive(1, 0, 0, 0, 0, 1, 10000, 200, 1500) // 150 Wh/km
	late := mkDrive(2, 5, 0, 0, 0, 1, 10000, 210, 1500)  // 150 Wh/km
	got := RankByEfficiency([]DrivePoint{late, early})
	if got[0].Drive.DriveID != 1 || got[1].Drive.DriveID != 2 {
		t.Fatalf("tie order = %d,%d, want 1,2 (earlier start first)",
			got[0].Drive.DriveID, got[1].Drive.DriveID)
	}
}

// ---------------------------------------------------------------------------
// BuildProgressSeries — trapezoidal speed integration -> monotonic fraction.
// ---------------------------------------------------------------------------

func TestBuildProgressSeries(t *testing.T) {
	t.Parallel()
	// Accelerate 0->10 m/s over 10 s, decelerate 10->0 over the next 10 s.
	// Distance: 50 m + 50 m = 100 m total -> fractions 0, 0.5, 1.0.
	samples := []TelemetrySample{
		{OffsetS: 0, SpeedMps: 0},
		{OffsetS: 10, SpeedMps: 10},
		{OffsetS: 20, SpeedMps: 0},
	}
	got := BuildProgressSeries(samples)
	if len(got) != 3 {
		t.Fatalf("points = %d, want 3", len(got))
	}
	wantFrac := []float64{0, 0.5, 1.0}
	wantElapsed := []float64{0, 10, 20}
	for i := range got {
		if !approx(got[i].FractionOfDistance, wantFrac[i]) {
			t.Fatalf("point %d fraction = %v, want %v", i, got[i].FractionOfDistance, wantFrac[i])
		}
		if !approx(got[i].ElapsedS, wantElapsed[i]) {
			t.Fatalf("point %d elapsed = %v, want %v", i, got[i].ElapsedS, wantElapsed[i])
		}
	}
}

func TestBuildProgressSeries_GuardsNegativeSpeedAndNonForwardTime(t *testing.T) {
	t.Parallel()
	samples := []TelemetrySample{
		{OffsetS: 0, SpeedMps: -5},  // clamped to 0
		{OffsetS: 10, SpeedMps: 10}, // seg1: (0+10)/2*10 = +50 m
		{OffsetS: 10, SpeedMps: 10}, // dt=0 -> no distance added
		{OffsetS: 20, SpeedMps: 0},  // seg3: (10+0)/2*10 = +50 m
	}
	got := BuildProgressSeries(samples)
	if !approx(got[0].SpeedMps, 0) {
		t.Fatalf("negative speed not clamped: %v", got[0].SpeedMps)
	}
	// cumulative: 0, 50, 50, 100 -> fractions 0, .5, .5, 1.0
	wantFrac := []float64{0, 0.5, 0.5, 1.0}
	for i, w := range wantFrac {
		if !approx(got[i].FractionOfDistance, w) {
			t.Fatalf("point %d fraction = %v, want %v", i, got[i].FractionOfDistance, w)
		}
	}
}

func TestBuildProgressSeries_EmptyAndAllZero(t *testing.T) {
	t.Parallel()
	if got := BuildProgressSeries(nil); got == nil || len(got) != 0 {
		t.Fatalf("empty input -> %v, want non-nil empty", got)
	}
	// All-zero speed -> zero total distance -> every fraction pinned to 0.
	got := BuildProgressSeries([]TelemetrySample{{OffsetS: 0}, {OffsetS: 5}, {OffsetS: 10}})
	for i, p := range got {
		if !approx(p.FractionOfDistance, 0) {
			t.Fatalf("point %d fraction = %v, want 0 (no distance travelled)", i, p.FractionOfDistance)
		}
	}
}

// ---------------------------------------------------------------------------
// ElapsedAtFraction — clamp at the ends, linear interpolation between.
// ---------------------------------------------------------------------------

func TestElapsedAtFraction(t *testing.T) {
	t.Parallel()
	series := []ProgressPoint{
		{FractionOfDistance: 0, ElapsedS: 0},
		{FractionOfDistance: 0.5, ElapsedS: 10},
		{FractionOfDistance: 1.0, ElapsedS: 20},
	}
	tests := []struct {
		frac, want float64
	}{
		{-0.5, 0},  // clamp low
		{0, 0},     // exact endpoint
		{0.25, 5},  // interpolate first half
		{0.5, 10},  // exact mid
		{0.75, 15}, // interpolate second half
		{1.0, 20},  // exact endpoint
		{1.5, 20},  // clamp high
	}
	for _, tc := range tests {
		if got := ElapsedAtFraction(series, tc.frac); !approx(got, tc.want) {
			t.Fatalf("ElapsedAtFraction(%v) = %v, want %v", tc.frac, got, tc.want)
		}
	}
	if got := ElapsedAtFraction(nil, 0.5); !approx(got, 0) {
		t.Fatalf("empty series -> %v, want 0", got)
	}
}

// ---------------------------------------------------------------------------
// SplitDeltas — A-vs-B time gap sampled across the shared fraction axis.
// ---------------------------------------------------------------------------

func TestSplitDeltas(t *testing.T) {
	t.Parallel()
	// A is uniformly twice as fast as B.
	a := []ProgressPoint{{FractionOfDistance: 0, ElapsedS: 0}, {FractionOfDistance: 1, ElapsedS: 10}}
	b := []ProgressPoint{{FractionOfDistance: 0, ElapsedS: 0}, {FractionOfDistance: 1, ElapsedS: 20}}

	got := SplitDeltas(a, b, 2)
	if len(got) != 3 {
		t.Fatalf("points = %d, want 3 (n+1)", len(got))
	}
	wantFrac := []float64{0, 0.5, 1.0}
	wantDelta := []float64{0, -5, -10} // A ahead -> negative
	for i := range got {
		if !approx(got[i].Fraction, wantFrac[i]) || !approx(got[i].DeltaS, wantDelta[i]) {
			t.Fatalf("point %d = {frac %v, delta %v}, want {frac %v, delta %v}",
				i, got[i].Fraction, got[i].DeltaS, wantFrac[i], wantDelta[i])
		}
	}
}

func TestSplitDeltas_ClampsN(t *testing.T) {
	t.Parallel()
	a := []ProgressPoint{{FractionOfDistance: 0, ElapsedS: 0}, {FractionOfDistance: 1, ElapsedS: 10}}
	b := []ProgressPoint{{FractionOfDistance: 0, ElapsedS: 0}, {FractionOfDistance: 1, ElapsedS: 10}}
	if got := SplitDeltas(a, b, 0); len(got) != 2 {
		t.Fatalf("n=0 clamped -> %d points, want 2", len(got))
	}
}

// ---------------------------------------------------------------------------
// DownsampleSeries — cap size, preserve first + last.
// ---------------------------------------------------------------------------

func TestDownsampleSeries(t *testing.T) {
	t.Parallel()
	mk := func(n int) []ProgressPoint {
		out := make([]ProgressPoint, n)
		for i := range out {
			out[i] = ProgressPoint{FractionOfDistance: float64(i) / float64(n-1), ElapsedS: float64(i)}
		}
		return out
	}
	five := mk(5)

	got := DownsampleSeries(five, 3)
	if len(got) != 3 {
		t.Fatalf("downsampled length = %d, want 3", len(got))
	}
	if !approx(got[0].FractionOfDistance, 0) || !approx(got[len(got)-1].FractionOfDistance, 1) {
		t.Fatalf("endpoints not preserved: first=%v last=%v",
			got[0].FractionOfDistance, got[len(got)-1].FractionOfDistance)
	}

	// Already within cap -> returned unchanged.
	if got := DownsampleSeries(five, 10); len(got) != 5 {
		t.Fatalf("under-cap length = %d, want 5 (unchanged)", len(got))
	}
	// max == 1 keeps only the last point.
	if got := DownsampleSeries(five, 1); len(got) != 1 || !approx(got[0].FractionOfDistance, 1) {
		t.Fatalf("max=1 -> %v, want single last point", got)
	}
	// max <= 0 disables downsampling.
	if got := DownsampleSeries(five, 0); len(got) != 5 {
		t.Fatalf("max=0 length = %d, want 5 (disabled)", len(got))
	}
}

// ---------------------------------------------------------------------------
// raceResult — head-to-head winner + margin.
// ---------------------------------------------------------------------------

func TestRaceResult(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		aDur, bDur float64
		wantWinner *int64
		wantMargin float64
	}{
		{"A faster", 200, 300, i64(10), 100},
		{"B faster", 300, 200, i64(20), 100},
		{"tie", 200, 200, nil, 0},
		{"B has no finish -> A wins", 200, 0, i64(10), 200},
		{"A has no finish -> B wins", 0, 200, i64(20), 200},
		{"neither finished", 0, 0, nil, 0},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			gotWinner, gotMargin := raceResult(10, tc.aDur, 20, tc.bDur)
			if !approx(gotMargin, tc.wantMargin) {
				t.Fatalf("margin = %v, want %v", gotMargin, tc.wantMargin)
			}
			switch {
			case tc.wantWinner == nil && gotWinner != nil:
				t.Fatalf("winner = %d, want nil (tie)", *gotWinner)
			case tc.wantWinner != nil && gotWinner == nil:
				t.Fatalf("winner = nil, want %d", *tc.wantWinner)
			case tc.wantWinner != nil && *gotWinner != *tc.wantWinner:
				t.Fatalf("winner = %d, want %d", *gotWinner, *tc.wantWinner)
			}
		})
	}
}

func i64(v int64) *int64 { return &v }

// ---------------------------------------------------------------------------
// Rounding + NaN/Inf guards at the JSON boundary.
// ---------------------------------------------------------------------------

func TestRoundingHelpers(t *testing.T) {
	t.Parallel()
	if !approx(round1(1.24), 1.2) || !approx(round1(1.25), 1.3) {
		t.Fatalf("round1 mismatch: %v %v", round1(1.24), round1(1.25))
	}
	if !approx(round2(1.005), 1.0) && !approx(round2(1.005), 1.01) {
		t.Fatalf("round2 unexpected: %v", round2(1.005))
	}
	if !approx(round4(0.12345), 0.1235) && !approx(round4(0.12345), 0.1234) {
		t.Fatalf("round4 unexpected: %v", round4(0.12345))
	}
}

func TestSafeF(t *testing.T) {
	t.Parallel()
	if got := safeF(math.NaN()); got != 0 {
		t.Fatalf("safeF(NaN) = %v, want 0", got)
	}
	if got := safeF(math.Inf(1)); got != 0 {
		t.Fatalf("safeF(+Inf) = %v, want 0", got)
	}
	if got := safeF(math.Inf(-1)); got != 0 {
		t.Fatalf("safeF(-Inf) = %v, want 0", got)
	}
	if got := safeF(3.14); !approx(got, 3.14) {
		t.Fatalf("safeF(3.14) = %v, want 3.14", got)
	}
}
