package ownershipintelsvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

func TestWarrantyCoverageRequiresDistanceEvidenceBeforeClaimCountdown(t *testing.T) {
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	record := port.WarrantyRecord{Label: "Synthetic policy", StartAt: now.AddDate(-1, 0, 0),
		TermS: 455 * 24 * 3600, TermDistanceM: 81_000_000}
	snapshot := &port.VehicleSnapshot{OdometerM: pointer(100_000_000.0)}
	for _, tt := range []struct {
		name               string
		baseline           float64
		current            *port.VehicleSnapshot
		now                time.Time
		status             string
		distanceDetermined bool
	}{
		{"missing baseline", 0, snapshot, now, "undetermined", false},
		{"missing current reading", 30_000_000, nil, now, "undetermined", false},
		{"reversed readings", 105_000_000, snapshot, now, "undetermined", false},
		{"distance already exceeded", 10_000_000, snapshot, now, "expired", true},
		{"distance available", 30_000_000, snapshot, now, "expiring", true},
		{"calendar elapsed", 0, snapshot, now.AddDate(0, 0, 91), "expired", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			terms := record
			terms.StartOdometerM = tt.baseline
			got := projectCoverage(terms, tt.current, nil, nil, nil, tt.now, 0)
			if got.Status != tt.status || (got.ProjectedExpiryAt != nil) != tt.distanceDetermined ||
				(got.ClaimWindowClosingS != nil) != (tt.status == "expiring") || got.TimeExpiryAt.IsZero() {
				t.Fatalf("wrong status or countdown: %+v", got)
			}
		})
	}
}

func TestWarrantyDistanceReminderUsesRecentOdometerEvidence(t *testing.T) {
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	record := port.WarrantyRecord{
		ID: 19, VehicleID: 7, StartAt: now.AddDate(-2, 0, 0), TermS: 4 * 365 * 24 * 3600,
		StartOdometerM: 2_000_000, TermDistanceM: 80_000_000,
	}
	const day = 24 * time.Hour
	first := now.Add(-42 * day)
	fixture := func() []port.DriveRecord {
		var drives []port.DriveRecord
		for i := range 11 {
			at := first.Add(time.Duration(i*4) * day)
			drives = append(drives, port.DriveRecord{
				StartedAt: at.Add(-time.Hour), EndedAt: pointer(at), EndOdometerM: pointer(float64(70_000_000 + i*800_000)),
			})
		}
		return drives
	}

	got, outcome := EvaluateWarrantyDistanceReminder(record, fixture(), now)
	if outcome != domain.WarrantyEligible || got == nil || got.WarrantyID != record.ID || got.ObservedDays != 11 || got.RemainingM != 4_000_000 ||
		!got.RecordedAt.Equal(now.Add(-2*day)) || !got.EarliestLimitAt.Equal(now.Add(14*day+16*time.Hour)) ||
		got.LatestLimitAt.Sub(now.Add(23*day)).Abs() > time.Second {
		t.Fatalf("unexpected mileage projection: %+v", got)
	}

	for _, tc := range []struct {
		name   string
		reason domain.WarrantyReminderOutcome
		change func(*port.WarrantyRecord, []port.DriveRecord) []port.DriveRecord
	}{
		{"calendar ends first", domain.WarrantyCalendarFirst, func(w *port.WarrantyRecord, drives []port.DriveRecord) []port.DriveRecord {
			w.TermS = int64(now.Add(14*day).Sub(w.StartAt) / time.Second)
			return drives
		}},
		{"calendar falls inside the estimated range", domain.WarrantyCalendarFirst, func(w *port.WarrantyRecord, drives []port.DriveRecord) []port.DriveRecord {
			w.TermS = int64(now.Add(21*day).Sub(w.StartAt) / time.Second)
			return drives
		}},
		{"already exceeded recorded allowance", domain.WarrantyLimitReached, func(w *port.WarrantyRecord, drives []port.DriveRecord) []port.DriveRecord {
			w.TermDistanceM = 75_000_000
			return drives
		}},
		{"outside action horizon", domain.WarrantyNotActionable, func(w *port.WarrantyRecord, drives []port.DriveRecord) []port.DriveRecord {
			w.TermDistanceM = 120_000_000
			return drives
		}},
		{"stale last sample", domain.WarrantyStaleEvidence, func(_ *port.WarrantyRecord, drives []port.DriveRecord) []port.DriveRecord {
			return drives[:9]
		}},
		{"duplicated observations", domain.WarrantyInsufficientEvidence, func(_ *port.WarrantyRecord, drives []port.DriveRecord) []port.DriveRecord {
			for i := 1; i < len(drives)-1; i++ {
				drives[i] = drives[0]
			}
			return drives
		}},
		{"recorded odometer moved backwards", domain.WarrantyInconsistentEvidence, func(_ *port.WarrantyRecord, drives []port.DriveRecord) []port.DriveRecord {
			drives[6].EndOdometerM = pointer(10_000_000.0)
			return drives
		}},
		{"ongoing records do not make a recent observation", domain.WarrantyStaleEvidence, func(_ *port.WarrantyRecord, drives []port.DriveRecord) []port.DriveRecord {
			drives[9].EndedAt, drives[10].EndedAt = nil, nil
			return drives
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			warranty := record
			if got, reason := EvaluateWarrantyDistanceReminder(warranty, tc.change(&warranty, fixture()), now); got != nil || reason != tc.reason {
				t.Fatalf("unexpected mileage result: %+v, %s; want suppression %s", got, reason, tc.reason)
			}
		})
	}
}
