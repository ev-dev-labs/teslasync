package smartreadiness

import (
	"cmp"
	"slices"
	"time"
)

// SharedTripVehicleInput is caller-verified evidence for an authorized vehicle
// on an explicitly shared trip. Percentages are on a 0–100 scale; callers
// must omit candidates with unknown percentages or mark those values
// non-finite. The clearance flags are true only when confirmed for this trip.
type SharedTripVehicleInput struct {
	VehicleID         int64
	StartingLowPct    float64
	StartingHighPct   float64
	TripUseLowPct     float64
	TripUseHighPct    float64
	ReservePct        float64
	ScheduleClear     bool
	MaintenanceClear  bool
	ObservedAt        time.Time
	EvidenceExpiresAt time.Time
}

// SharedTripVehicleOption contains estimated return bounds, not a guarantee of
// readiness or availability. It does not disclose schedules or exclusion reasons.
type SharedTripVehicleOption struct {
	VehicleID     int64
	ReturnLowPct  float64
	ReturnHighPct float64
	ReservePct    float64
	ObservedAt    time.Time
	ExpiresAt     time.Time
}

// CompareSharedTripVehicles ranks authorized options by greatest headroom above
// reserve at the low return bound, breaking ties by ascending vehicle ID. It
// returns nil if fewer than two distinct vehicles qualify. Each option expires
// at departure or when its supporting evidence expires, whichever is earlier.
func CompareSharedTripVehicles(now, departure time.Time, candidates []SharedTripVehicleInput) []SharedTripVehicleOption {
	if now.IsZero() || departure.IsZero() || !now.Before(departure) || len(candidates) < 2 {
		return nil
	}

	// Discard all records for an ambiguous ID instead of choosing one of them.
	idCounts := make(map[int64]int, len(candidates))
	for _, candidate := range candidates {
		idCounts[candidate.VehicleID]++
	}

	options := make([]SharedTripVehicleOption, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.VehicleID <= 0 || idCounts[candidate.VehicleID] != 1 ||
			!candidate.ScheduleClear || !candidate.MaintenanceClear ||
			candidate.ObservedAt.IsZero() || candidate.ObservedAt.After(now) ||
			candidate.EvidenceExpiresAt.IsZero() || !now.Before(candidate.EvidenceExpiresAt) ||
			!validSharedTripRange(candidate.StartingLowPct, candidate.StartingHighPct) ||
			!validSharedTripRange(candidate.TripUseLowPct, candidate.TripUseHighPct) ||
			!(0 <= candidate.ReservePct && candidate.ReservePct <= 100) {
			continue
		}

		returnLow := candidate.StartingLowPct - candidate.TripUseHighPct
		if returnLow < candidate.ReservePct {
			continue
		}
		expiresAt := candidate.EvidenceExpiresAt
		if departure.Before(expiresAt) {
			expiresAt = departure
		}
		options = append(options, SharedTripVehicleOption{
			VehicleID:     candidate.VehicleID,
			ReturnLowPct:  returnLow,
			ReturnHighPct: candidate.StartingHighPct - candidate.TripUseLowPct,
			ReservePct:    candidate.ReservePct,
			ObservedAt:    candidate.ObservedAt.UTC(),
			ExpiresAt:     expiresAt.UTC(),
		})
	}
	if len(options) < 2 {
		return nil
	}
	slices.SortFunc(options, func(a, b SharedTripVehicleOption) int {
		aHeadroom, bHeadroom := a.ReturnLowPct-a.ReservePct, b.ReturnLowPct-b.ReservePct
		if order := cmp.Compare(bHeadroom, aHeadroom); order != 0 {
			return order
		}
		return cmp.Compare(a.VehicleID, b.VehicleID)
	})
	return options
}

func validSharedTripRange(low, high float64) bool {
	return 0 <= low && low <= high && high <= 100
}
