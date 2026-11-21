package trippacket

import (
	"slices"
	"testing"
	"time"
)

func TestPrepareUsesOnlyExplicitBusinessAndUniqueMatchedReceipts(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, 3, 1, 0, 0, 0, 0, loc)
	through := from.AddDate(0, 1, 0)
	date := time.Date(2026, 3, 9, 23, 45, 0, 0, loc).UTC()
	measured := 11_250.0
	drives := []Drive{
		{ID: 1, StartedAt: date.Add(-time.Minute), EndedAt: date, DistanceM: &measured, Purpose: Business},
		{ID: 2, StartedAt: date.Add(-time.Minute), EndedAt: date, DistanceM: &measured},
		{ID: 3, StartedAt: date.Add(-time.Minute), EndedAt: date, DistanceM: &measured, Purpose: Commute},
		{ID: 4, StartedAt: date.Add(-time.Hour), EndedAt: date, Purpose: Business},
	}
	receipts := []Receipt{
		{DriveID: 4, Day: "2026-03-09", Reference: "Synthetic CAD parking", Currency: "CAD", AmountMinor: 605},
		{DriveID: 1, Day: "2026-03-09", Reference: "Synthetic gate", Currency: "USD", AmountMinor: 425},
		{DriveID: 1, Day: "2026-03-09", Reference: "Synthetic repeat", Currency: "USD", AmountMinor: 475},
		{DriveID: 4, Day: "2026-03-09", Reference: "synthetic repeat", Currency: "USD", AmountMinor: 475},
		{DriveID: 3, Day: "2026-03-09", Reference: "Commute toll", Currency: "USD", AmountMinor: 300},
		{DriveID: 1, Day: "2026-03-10", Reference: "Wrong date", Currency: "USD", AmountMinor: 200},
	}
	result, outcome := Prepare(from, through, drives, receipts)
	if result == nil || outcome != Ready {
		t.Fatalf("no packet for explicitly confirmed business drives: %s", outcome)
	}
	if result.Through.Sub(result.From) != 743*time.Hour || len(result.BusinessDrives) != 2 ||
		result.BusinessDrives[0].ID != 4 || result.BusinessDrives[0].DistanceM != nil ||
		result.ObservedBusinessDistanceM != measured || result.MissingDistanceCount != 1 ||
		!slices.Equal(result.UnclassifiedDriveIDs, []int64{2}) {
		t.Fatalf("the month or drive evidence was misrepresented: %+v", result)
	}
	if !slices.Equal(result.MatchedReceipts, []Receipt{receipts[1], receipts[0]}) || result.UnmatchedReceipts != 4 {
		t.Fatalf("an undated, nonbusiness or duplicate reference entered the packet: %+v", result)
	}
}

func TestPrepareSuppressesUnqualifiedMonths(t *testing.T) {
	from := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	through := from.AddDate(0, 1, 0)
	within := from.Add(time.Hour)
	later := within.Add(time.Hour)
	for _, tt := range []struct {
		name   string
		drives []Drive
		want   Outcome
	}{
		{"unconfirmed business-like drives", []Drive{{ID: 1, StartedAt: within, EndedAt: later}, {ID: 2, StartedAt: within, EndedAt: later, Purpose: Commute}}, NoBusiness},
		{"confirmed purpose but missing mileage and receipts", []Drive{{ID: 1, StartedAt: within, EndedAt: later, Purpose: Business}}, Partial},
		{"duplicate returned drive", []Drive{{ID: 1, StartedAt: within, EndedAt: later, Purpose: Business}, {ID: 1, StartedAt: within, EndedAt: later}}, Uncertain},
		{"drive at exclusive end", []Drive{{ID: 1, StartedAt: through, EndedAt: through.Add(time.Hour), Purpose: Business}}, Uncertain},
		{"history cap reached", make([]Drive, MaxDrives+1), Uncertain},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got, outcome := Prepare(from, through, tt.drives, nil)
			if got != nil || outcome != tt.want {
				t.Fatalf("got %+v (%s), want no packet (%s)", got, outcome, tt.want)
			}
		})
	}
}
