package fsd

import (
	"testing"
	"time"
)

func TestCurrentWeekBounds_MondayToNextMondayUTC(t *testing.T) {
	loc := time.UTC
	// 2026-03-02 is a Monday.
	now := time.Date(2026, 3, 4, 15, 0, 0, 0, loc)
	start, end := CurrentWeekBounds(now, loc)
	wantStart := time.Date(2026, 3, 2, 0, 0, 0, 0, loc)
	wantEnd := time.Date(2026, 3, 9, 0, 0, 0, 0, loc)
	if !start.Equal(wantStart) || !end.Equal(wantEnd) {
		t.Fatalf("week bounds = [%s, %s), want [%s, %s)", start, end, wantStart, wantEnd)
	}
}

func TestCurrentWeekBounds_SundayStaysInContainingWeek(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, 3, 8, 23, 0, 0, 0, loc)
	start, end := CurrentWeekBounds(now, loc)
	if got := start.Format("2006-01-02"); got != "2026-03-02" {
		t.Fatalf("Sunday week start = %s, want 2026-03-02", got)
	}
	if got := end.Format("2006-01-02"); got != "2026-03-09" {
		t.Fatalf("Sunday week end = %s, want 2026-03-09", got)
	}
}

func TestCurrentWeekBounds_UsesVehicleTimezone(t *testing.T) {
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}
	// 2026-03-02 07:00 UTC is still Sunday 2026-03-01 23:00 PST.
	now := time.Date(2026, 3, 2, 7, 0, 0, 0, time.UTC)
	start, _ := CurrentWeekBounds(now, loc)
	if got := start.In(loc).Format("2006-01-02"); got != "2026-02-23" {
		t.Fatalf("LA week start local date = %s, want 2026-02-23", got)
	}
}

func TestPreviousWeekStart_CivilDaysNotFixedDuration(t *testing.T) {
	loc := time.UTC
	weekStart := time.Date(2026, 3, 9, 0, 0, 0, 0, loc)
	got := PreviousWeekStart(weekStart, loc)
	want := time.Date(2026, 3, 2, 0, 0, 0, 0, loc)
	if !got.Equal(want) {
		t.Fatalf("previous week start = %s, want %s", got, want)
	}
}

func TestLoadLocationOrUTC(t *testing.T) {
	if LoadLocationOrUTC("") != time.UTC || LoadLocationOrUTC("UTC") != time.UTC {
		t.Fatal("empty/UTC must fall back to UTC")
	}
	if LoadLocationOrUTC("Not/AZone") != time.UTC {
		t.Fatal("unknown zone must fall back to UTC")
	}
	loc := LoadLocationOrUTC("America/Los_Angeles")
	if loc == nil || loc.String() != "America/Los_Angeles" {
		t.Fatalf("got %v", loc)
	}
}
