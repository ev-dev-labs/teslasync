package fsd

import (
	"testing"
	"time"
)

func TestBuildCommuteIdentities_MonthOverMonthShare(t *testing.T) {
	loc := time.UTC
	end := time.Date(2026, 3, 15, 18, 0, 0, 0, loc)
	home := "Home"
	office := "Office"
	thisStart := time.Date(2026, 3, 2, 17, 0, 0, 0, loc)
	lastStart := time.Date(2026, 2, 2, 17, 0, 0, 0, loc)
	driveM := 10000.0
	thisFSD := 7100.0
	lastFSD := 5400.0

	summaries := []DriveFSDInsight{
		{
			DriveID: 1, StartedAt: thisStart, DistanceM: &driveM, FSDDistanceM: &thisFSD,
			FSDSharePct: fp(71), Confidence: ConfidenceHigh,
		},
		{
			DriveID: 2, StartedAt: lastStart, DistanceM: &driveM, FSDDistanceM: &lastFSD,
			FSDSharePct: fp(54), Confidence: ConfidenceHigh,
		},
		{
			DriveID: 3, StartedAt: thisStart.AddDate(0, 0, 1), DistanceM: &driveM,
			Confidence: ConfidenceUnknown,
		},
	}
	driveByID := map[int64]DriveRecord{
		1: {ID: 1, StartedAt: thisStart, StartPlace: &home, EndPlace: &office, DistanceM: &driveM},
		2: {ID: 2, StartedAt: lastStart, StartPlace: &home, EndPlace: &office, DistanceM: &driveM},
		3: {ID: 3, StartedAt: thisStart.AddDate(0, 0, 1), StartPlace: &home, EndPlace: &office, DistanceM: &driveM},
	}

	got := buildCommuteIdentities(summaries, driveByID, loc, end)
	if len(got) != 1 {
		t.Fatalf("identities = %d, want 1: %+v", len(got), got)
	}
	identity := got[0]
	if identity.ThisMonth.FSDSharePct == nil || *identity.ThisMonth.FSDSharePct != 71 {
		t.Fatalf("this month share = %+v", identity.ThisMonth)
	}
	if identity.LastMonth.FSDSharePct == nil || *identity.LastMonth.FSDSharePct != 54 {
		t.Fatalf("last month share = %+v", identity.LastMonth)
	}
	if identity.ShareChangePctPoints == nil || *identity.ShareChangePctPoints != 17 {
		t.Fatalf("share change = %v", identity.ShareChangePctPoints)
	}
	if identity.ThisMonth.UnknownDays != 1 {
		t.Fatalf("unknown days = %d", identity.ThisMonth.UnknownDays)
	}
	if identity.Honesty == "" {
		t.Fatal("honesty label required")
	}
}
