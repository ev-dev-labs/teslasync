package fsddigest

import (
	"testing"
	"time"
)

func ptr[T any](v T) *T { return &v }

func TestShouldSend_RequiresMeasuredDistance(t *testing.T) {
	if ShouldSend(Snapshot{}) {
		t.Fatal("unmeasured snapshot must not send")
	}
	if !ShouldSend(Snapshot{FSDDistanceM: ptr(0.0)}) {
		t.Fatal("measured zero is a real measurement and may send")
	}
	if !ShouldSend(Snapshot{FSDDistanceM: ptr(16000.0)}) {
		t.Fatal("measured distance must send")
	}
}

func TestTitleAndTag_IncludeVehicleAndLocalMonday(t *testing.T) {
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}
	weekStart := time.Date(2026, 3, 2, 0, 0, 0, 0, loc)
	if got, want := Title(7, weekStart, loc), "Weekly FSD digest (#7 · 2026-03-02)"; got != want {
		t.Fatalf("title = %q, want %q", got, want)
	}
	if got, want := AlertTag(7, weekStart, loc), "fsd-weekly:7:2026-03-02"; got != want {
		t.Fatalf("tag = %q, want %q", got, want)
	}
}

func TestBody_FormatsKmAndOmitsMissingShare(t *testing.T) {
	got := Body(Snapshot{FSDDistanceM: ptr(16000.0)})
	want := "Reported FSD 16.0 km this week."
	if got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}

	got = Body(Snapshot{
		FSDDistanceM:   ptr(16000.0),
		SharePct:       ptr(40.0),
		ShareChangePts: ptr(3.0),
	})
	want = "Reported FSD 16.0 km this week (40.0% of observed driving), +3.0 pts vs last week."
	if got != want {
		t.Fatalf("body = %q, want %q", got, want)
	}

	if Body(Snapshot{}) != "" {
		t.Fatal("unmeasured body must be empty")
	}
}
