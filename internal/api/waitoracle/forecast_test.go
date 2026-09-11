package waitoracle

import (
	"errors"
	"testing"
	"time"
)

func TestErlangCWaitKnownValues(t *testing.T) {
	// M/M/1 with ρ=0.5: P(wait) = ρ, Wq = ρ·S/(1−ρ) = 30.
	w, p := erlangCWait(0.5, 30, 1)
	if !close(w, 30) || !close(p, 0.5) {
		t.Fatalf("M/M/1: got wait=%.4f p=%.4f, want 30 / 0.5", w, p)
	}
	// M/M/2 with a=1: C(2,1) = 1/3, Wq = 60/3 = 20.
	w, p = erlangCWait(1.0, 60, 2)
	if !close(w, 20) || !close(p, 1.0/3.0) {
		t.Fatalf("M/M/2: got wait=%.4f p=%.4f, want 20 / 0.333", w, p)
	}
}

func TestErlangCWaitEdges(t *testing.T) {
	if w, p := erlangCWait(0, 30, 4); w != 0 || p != 0 {
		t.Fatalf("zero load: got %v %v, want 0 0", w, p)
	}
	// Saturated: documented floor of one service time, P=1.
	if w, p := erlangCWait(4.0, 30, 4); w != 30 || p != 1 {
		t.Fatalf("saturated: got %v %v, want 30 1", w, p)
	}
	if w, p := erlangCWait(9.9, 30, 4); w != 30 || p != 1 {
		t.Fatalf("overloaded: got %v %v, want 30 1", w, p)
	}
}

// fridayPeakHistory builds 10 weeks of history with a Friday 18:00 UTC
// crush (60 starts), light background elsewhere, 30-min median
// sessions and 4-stall peak overlap.
func fridayPeakHistory() SiteHistory {
	h := SiteHistory{Site: "Kettleman City", Sessions: 2000, Weeks: 10}
	for d := 0; d < 7; d++ {
		for hr := 0; hr < 24; hr++ {
			h.Buckets = append(h.Buckets, Bucket{Weekday: d, Hour: hr, Starts: 10})
		}
	}
	h.Buckets = append(h.Buckets, Bucket{Weekday: 5, Hour: 18, Starts: 60, Congested: 12})
	base := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC) // a Friday
	for i := 0; i < 4; i++ {                             // the 4-stall overlap
		h.Spans = append(h.Spans, Session{Start: base, Stop: base.Add(30 * time.Minute)})
	}
	for i := 0; i < 196; i++ {
		s := base.AddDate(0, 0, 1).Add(time.Duration(i) * time.Hour)
		h.Spans = append(h.Spans, Session{Start: s, Stop: s.Add(30 * time.Minute)})
	}
	return h
}

func friday18UTC() time.Time {
	arr := time.Date(2026, 9, 11, 18, 0, 0, 0, time.UTC)
	if arr.Weekday() != time.Friday {
		panic("test date is not a Friday")
	}
	return arr
}

func TestForecastPeakVerdict(t *testing.T) {
	f, err := Predict(fridayPeakHistory(), friday18UTC())
	if err != nil {
		t.Fatal(err)
	}
	// Load = 7/hr × 0.5h = 3.5 Erlangs on 4 stalls → packed.
	if f.Verdict != VerdictPacked {
		t.Fatalf("verdict = %q, want packed", f.Verdict)
	}
	if f.ExpectedMin <= 0 {
		t.Fatalf("expected wait = %v, want positive", f.ExpectedMin)
	}
	if f.WaitProbPct <= 0 || f.WaitProbPct > 100 {
		t.Fatalf("wait prob = %v, want (0, 100]", f.WaitProbPct)
	}
	if f.Busyness != 100 {
		t.Fatalf("busyness = %v, want 100 at the peak cell", f.Busyness)
	}
	if f.StallsEstimate != 4 {
		t.Fatalf("stalls = %d, want 4", f.StallsEstimate)
	}
	if f.Confidence != ConfidenceHigh {
		t.Fatalf("confidence = %q, want high", f.Confidence)
	}
	if len(f.Hours) != 24 {
		t.Fatalf("hours = %d, want 24", len(f.Hours))
	}
	if len(f.Evidence) == 0 {
		t.Fatal("evidence is empty")
	}
}

func TestForecastQuietBucket(t *testing.T) {
	arr := time.Date(2026, 9, 8, 3, 0, 0, 0, time.UTC) // Tuesday 03:00
	if arr.Weekday() != time.Tuesday {
		t.Fatal("test date is not a Tuesday")
	}
	f, err := Predict(fridayPeakHistory(), arr)
	if err != nil {
		t.Fatal(err)
	}
	if f.Verdict != VerdictQuiet {
		t.Fatalf("verdict = %q, want quiet", f.Verdict)
	}
	if f.ExpectedMin != 0 {
		t.Fatalf("expected wait = %v, want 0", f.ExpectedMin)
	}
}

func TestForecastArrivalTimezone(t *testing.T) {
	// Friday 20:00 +02:00 is Friday 18:00 UTC — the peak cell.
	arr := time.Date(2026, 9, 11, 20, 0, 0, 0, time.FixedZone("CEST", 2*3600))
	f, err := Predict(fridayPeakHistory(), arr)
	if err != nil {
		t.Fatal(err)
	}
	if f.Verdict != VerdictPacked || f.Busyness != 100 {
		t.Fatalf("tz arrival missed the peak cell: %+v", f)
	}
}

func TestForecastBestHour(t *testing.T) {
	f, err := Predict(fridayPeakHistory(), friday18UTC())
	if err != nil {
		t.Fatal(err)
	}
	// ±3h of 18:00, background hours are all empty of the crush; the
	// first strictly better hour (15:00) wins.
	if f.BestHour != 15 {
		t.Fatalf("best hour = %d, want 15", f.BestHour)
	}
	if f.SaveMin <= 0 {
		t.Fatalf("save = %v, want positive", f.SaveMin)
	}
	if !close(f.SaveMin, f.ExpectedMin-f.BestWaitMin) {
		t.Fatalf("save %v != expected-best %v", f.SaveMin, f.ExpectedMin-f.BestWaitMin)
	}
}

func TestForecastNoHistory(t *testing.T) {
	h := fridayPeakHistory()
	h.Sessions = 9
	if _, err := Predict(h, friday18UTC()); !errors.Is(err, ErrNoHistory) {
		t.Fatalf("few sessions: err = %v, want ErrNoHistory", err)
	}
	h = fridayPeakHistory()
	h.Spans = nil
	if _, err := Predict(h, friday18UTC()); !errors.Is(err, ErrNoHistory) {
		t.Fatalf("no spans: err = %v, want ErrNoHistory", err)
	}
	h = fridayPeakHistory()
	stamp := time.Now()
	h.Spans = []Session{{Start: stamp, Stop: stamp}} // zero duration
	if _, err := Predict(h, friday18UTC()); !errors.Is(err, ErrNoHistory) {
		t.Fatalf("zero durations: err = %v, want ErrNoHistory", err)
	}
}

func TestForecastIgnoresBadCells(t *testing.T) {
	h := fridayPeakHistory()
	h.Buckets = append(h.Buckets,
		Bucket{Weekday: 9, Hour: 3, Starts: 100000},
		Bucket{Weekday: 2, Hour: 99, Starts: 100000},
	)
	f, err := Predict(h, friday18UTC())
	if err != nil {
		t.Fatal(err)
	}
	if f.Busyness != 100 {
		t.Fatalf("bad cells leaked into the peak: busyness=%v", f.Busyness)
	}
}

func TestForecastDeterministic(t *testing.T) {
	h := fridayPeakHistory()
	a, err := Predict(h, friday18UTC())
	if err != nil {
		t.Fatal(err)
	}
	b, err := Predict(h, friday18UTC())
	if err != nil {
		t.Fatal(err)
	}
	if a.ExpectedMin != b.ExpectedMin || a.BestHour != b.BestHour || a.Verdict != b.Verdict {
		t.Fatalf("nondeterministic:\n%+v\n%+v", a, b)
	}
}

func close(a, b float64) bool {
	d := a - b
	if d < 0 {
		d = -d
	}
	return d < 1e-9
}
