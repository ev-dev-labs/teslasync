package smartreadiness

import (
	"math"
	"slices"
	"testing"
	"time"
)

func sharedTripVehicleFixture(id int64, now time.Time) SharedTripVehicleInput {
	return SharedTripVehicleInput{
		VehicleID: id, StartingLowPct: 76, StartingHighPct: 82,
		TripUseLowPct: 26, TripUseHighPct: 38, ReservePct: 15,
		ScheduleClear: true, MaintenanceClear: true,
		ObservedAt: now.Add(-time.Minute), EvidenceExpiresAt: now.Add(5 * time.Minute),
	}
}

func TestCompareSharedTripVehiclesRanksConservativeReturnAndPreservesEvidence(t *testing.T) {
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	departure := now.Add(time.Hour)

	wide, tie, best, atReserve := sharedTripVehicleFixture(22, now), sharedTripVehicleFixture(11, now),
		sharedTripVehicleFixture(33, now), sharedTripVehicleFixture(44, now)
	wide.StartingLowPct, wide.StartingHighPct, wide.TripUseLowPct, wide.ReservePct = 83, 95, 20, 30
	tie.StartingLowPct, tie.StartingHighPct = 68, 70
	best.ObservedAt = now
	best.EvidenceExpiresAt = departure.Add(time.Minute)
	atReserve.StartingLowPct, atReserve.StartingHighPct = 53, 55
	duplicate := sharedTripVehicleFixture(55, now)

	observedAt, expiry := wide.ObservedAt, wide.EvidenceExpiresAt
	want := []SharedTripVehicleOption{
		{VehicleID: 33, ReturnLowPct: 38, ReturnHighPct: 56, ReservePct: 15, ObservedAt: now, ExpiresAt: departure},
		{VehicleID: 11, ReturnLowPct: 30, ReturnHighPct: 44, ReservePct: 15, ObservedAt: observedAt, ExpiresAt: expiry},
		{VehicleID: 22, ReturnLowPct: 45, ReturnHighPct: 75, ReservePct: 30, ObservedAt: observedAt, ExpiresAt: expiry},
		{VehicleID: 44, ReturnLowPct: 15, ReturnHighPct: 29, ReservePct: 15, ObservedAt: observedAt, ExpiresAt: expiry},
	}
	for _, candidates := range [][]SharedTripVehicleInput{
		{wide, atReserve, duplicate, best, tie, duplicate},
		{tie, best, atReserve, wide},
	} {
		if got := CompareSharedTripVehicles(now, departure, candidates); !slices.Equal(got, want) {
			t.Errorf("options = %+v, want %+v", got, want)
		}
	}
}

func TestCompareSharedTripVehiclesExcludesIneligibleEvidence(t *testing.T) {
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	departure := now.Add(time.Hour)
	first, second := sharedTripVehicleFixture(1, now), sharedTripVehicleFixture(2, now)

	tests := []struct {
		name   string
		change func(*SharedTripVehicleInput)
	}{
		{"missing vehicle ID", func(v *SharedTripVehicleInput) { v.VehicleID = 0 }},
		{"schedule not clear", func(v *SharedTripVehicleInput) { v.ScheduleClear = false }},
		{"maintenance not clear", func(v *SharedTripVehicleInput) { v.MaintenanceClear = false }},
		{"unknown observation time", func(v *SharedTripVehicleInput) { v.ObservedAt = time.Time{} }},
		{"future observation", func(v *SharedTripVehicleInput) { v.ObservedAt = now.Add(time.Nanosecond) }},
		{"unknown expiry", func(v *SharedTripVehicleInput) { v.EvidenceExpiresAt = time.Time{} }},
		{"stale evidence", func(v *SharedTripVehicleInput) { v.EvidenceExpiresAt = now }},
		{"unknown trip use", func(v *SharedTripVehicleInput) { v.TripUseHighPct = math.NaN() }},
		{"non-finite starting charge", func(v *SharedTripVehicleInput) { v.StartingHighPct = math.Inf(1) }},
		{"invalid reserve", func(v *SharedTripVehicleInput) { v.ReservePct = -1 }},
		{"reversed starting bounds", func(v *SharedTripVehicleInput) { v.StartingLowPct = 90 }},
		{"reversed trip use bounds", func(v *SharedTripVehicleInput) { v.TripUseLowPct = 40 }},
		{"optimistic bound alone meets reserve", func(v *SharedTripVehicleInput) { v.ReservePct = 40 }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ineligible := sharedTripVehicleFixture(3, now)
			tt.change(&ineligible)
			got := CompareSharedTripVehicles(now, departure, []SharedTripVehicleInput{first, ineligible, second})
			if len(got) != 2 || got[0].VehicleID != first.VehicleID || got[1].VehicleID != second.VehicleID {
				t.Errorf("options = %+v, want only vehicles %d and %d", got, first.VehicleID, second.VehicleID)
			}
		})
	}
}

func TestCompareSharedTripVehiclesSuppressesInsufficientOrExpiredComparison(t *testing.T) {
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	future := now.Add(time.Hour)
	first, second := sharedTripVehicleFixture(1, now), sharedTripVehicleFixture(2, now)
	contradictory := second
	contradictory.ScheduleClear = false

	tests := []struct {
		name       string
		departure  time.Time
		candidates []SharedTripVehicleInput
	}{
		{"single vehicle", future, []SharedTripVehicleInput{first}},
		{"single eligible vehicle", future, []SharedTripVehicleInput{first, contradictory}},
		{"identical duplicates", future, []SharedTripVehicleInput{first, second, second}},
		{"contradictory duplicate after eligible evidence", future, []SharedTripVehicleInput{first, second, contradictory}},
		{"contradictory duplicate before eligible evidence", future, []SharedTripVehicleInput{first, contradictory, second}},
		{"departure reached", now, []SharedTripVehicleInput{first, second}},
		{"departure unknown", time.Time{}, []SharedTripVehicleInput{first, second}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := CompareSharedTripVehicles(now, tt.departure, tt.candidates); len(got) != 0 {
				t.Errorf("options = %+v, want no comparison", got)
			}
		})
	}
}
