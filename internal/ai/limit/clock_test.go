package limit

import (
	"testing"
	"time"
)

func TestSystemClockReturnsRecentUTCTime(t *testing.T) {
	t.Parallel()
	c := SystemClock{}
	now := c.Now()
	if now.Location() != time.UTC {
		t.Errorf("expected UTC location, got %s", now.Location())
	}
	if delta := time.Since(now); delta < 0 || delta > time.Second {
		t.Errorf("SystemClock returned implausible time: delta=%v", delta)
	}
}

func TestFakeClockAdvanceAndSet(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC)
	c := NewFakeClock(start)
	if !c.Now().Equal(start) {
		t.Errorf("expected %v, got %v", start, c.Now())
	}
	c.Advance(2 * time.Minute)
	want := start.Add(2 * time.Minute)
	if !c.Now().Equal(want) {
		t.Errorf("after advance: expected %v, got %v", want, c.Now())
	}
	new := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	c.Set(new)
	if !c.Now().Equal(new) {
		t.Errorf("after Set: expected %v, got %v", new, c.Now())
	}
}

func TestFakeClockSetCoercesToUTC(t *testing.T) {
	t.Parallel()
	loc := time.FixedZone("PST", -8*3600)
	in := time.Date(2026, 1, 1, 0, 0, 0, 0, loc)
	c := NewFakeClock(in)
	if c.Now().Location() != time.UTC {
		t.Errorf("expected UTC, got %s", c.Now().Location())
	}
}
