package ownershipintelsvc

import (
	"math"
	"sort"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

const (
	warrantyDistanceLookback  = 90 * 24 * time.Hour
	warrantyDistanceMinSpan   = 28 * 24 * time.Hour
	warrantyDistanceFreshness = 7 * 24 * time.Hour
	warrantyDistanceMaxGap    = 21 * 24 * time.Hour
	warrantyDistanceMinDays   = 8
	warrantyDistanceMaxPace   = 2_000_000.0 / (24 * 60 * 60)
)

// EvaluateWarrantyDistanceReminder projects a documented mileage limit without
// assuming that a sum of recorded drives is the car's current odometer.
func EvaluateWarrantyDistanceReminder(
	warranty port.WarrantyRecord, drives []port.DriveRecord, now time.Time,
) (*domain.WarrantyDistanceReminder, domain.WarrantyReminderOutcome) {
	if warranty.ID <= 0 || warranty.VehicleID <= 0 || warranty.StartAt.IsZero() || warranty.StartAt.After(now) ||
		warranty.TermS <= 0 || warranty.TermS > 30*365*24*3600 ||
		!warranty.HasStartOdometer() || !requireNonNegF(warranty.StartOdometerM) ||
		!requireNonNegF(warranty.TermDistanceM) || warranty.TermDistanceM <= 0 {
		return nil, domain.WarrantyInvalidTerm
	}
	termEnd := warranty.StartAt.Add(time.Duration(warranty.TermS) * time.Second)
	if !termEnd.After(now.Add(7 * 24 * time.Hour)) {
		return nil, domain.WarrantyCalendarFirst
	}
	type observation struct {
		at   time.Time
		odoM float64
	}
	cutoff := now.Add(-warrantyDistanceLookback)
	if warranty.StartAt.After(cutoff) {
		cutoff = warranty.StartAt
	}
	observed := make([]observation, 0, len(drives))
	for _, drive := range drives {
		if drive.EndedAt == nil || !drive.EndedAt.After(drive.StartedAt) || drive.EndedAt.Before(cutoff) || drive.EndedAt.After(now) ||
			drive.EndOdometerM == nil || !requireNonNegF(*drive.EndOdometerM) || *drive.EndOdometerM == 0 {
			continue
		}
		observed = append(observed, observation{at: drive.EndedAt.UTC(), odoM: *drive.EndOdometerM})
	}
	if len(observed) < warrantyDistanceMinDays {
		return nil, domain.WarrantyInsufficientEvidence
	}
	sort.Slice(observed, func(i, j int) bool { return observed[i].at.Before(observed[j].at) })
	first, last := observed[0], observed[len(observed)-1]
	span := last.at.Sub(first.at)
	if now.Sub(last.at) >= warrantyDistanceFreshness {
		return nil, domain.WarrantyStaleEvidence
	}
	if span < warrantyDistanceMinSpan {
		return nil, domain.WarrantyInsufficientEvidence
	}
	days := 1
	for i := 1; i < len(observed); i++ {
		prev, next := observed[i-1], observed[i]
		gap := next.at.Sub(prev.at)
		if next.odoM < prev.odoM || (gap == 0 && next.odoM != prev.odoM) {
			return nil, domain.WarrantyInconsistentEvidence
		}
		if gap > warrantyDistanceMaxGap {
			return nil, domain.WarrantyInsufficientEvidence
		}
		if prev.at.Year() != next.at.Year() || prev.at.YearDay() != next.at.YearDay() {
			days++
		}
	}
	pace := (last.odoM - first.odoM) / span.Seconds()
	remainingM := warranty.TermDistanceM - (last.odoM - warranty.StartOdometerM)
	if days < warrantyDistanceMinDays {
		return nil, domain.WarrantyInsufficientEvidence
	}
	if pace < 0 || pace > warrantyDistanceMaxPace || first.odoM < warranty.StartOdometerM {
		return nil, domain.WarrantyInconsistentEvidence
	}
	if remainingM <= 0 {
		return nil, domain.WarrantyLimitReached
	}
	if pace == 0 {
		return nil, domain.WarrantyNotActionable
	}
	// Use both halves of the observed window and allow at least 20% variation
	// around the overall pace, even if the historical segments were identical.
	middle := observed[sort.Search(len(observed), func(i int) bool {
		return !observed[i].at.Before(first.at.Add(span / 2))
	})]
	earlySpan, lateSpan := middle.at.Sub(first.at), last.at.Sub(middle.at)
	if earlySpan < 10*24*time.Hour || lateSpan < 10*24*time.Hour {
		return nil, domain.WarrantyInsufficientEvidence
	}
	earlyPace := (middle.odoM - first.odoM) / earlySpan.Seconds()
	latePace := (last.odoM - middle.odoM) / lateSpan.Seconds()
	lowPace, highPace := min(earlyPace, latePace, pace*0.8), max(earlyPace, latePace, pace*1.2)
	if highPace > warrantyDistanceMaxPace {
		return nil, domain.WarrantyInconsistentEvidence
	}
	if lowPace <= 0 {
		return nil, domain.WarrantyNotActionable
	}
	longSeconds := remainingM / lowPace
	if math.IsNaN(longSeconds) || longSeconds > warrantyDistanceLookback.Seconds() {
		return nil, domain.WarrantyNotActionable
	}
	earliest := last.at.Add(time.Duration(math.Floor(remainingM/highPace)) * time.Second)
	latest := last.at.Add(time.Duration(math.Ceil(longSeconds)) * time.Second)
	if !earliest.After(now.Add(24 * time.Hour)) {
		return nil, domain.WarrantyNotActionable
	}
	if !latest.Before(termEnd.Add(-7 * 24 * time.Hour)) {
		return nil, domain.WarrantyCalendarFirst
	}
	expires := last.at.Add(warrantyDistanceFreshness)
	if actionableUntil := earliest.Add(-24 * time.Hour); actionableUntil.Before(expires) {
		expires = actionableUntil
	}
	return &domain.WarrantyDistanceReminder{
		WarrantyID: warranty.ID, VehicleID: warranty.VehicleID, RecordedAt: last.at, EvidenceFrom: first.at,
		ObservedDays: days, RemainingM: remainingM, PaceMps: pace,
		EarliestLimitAt: earliest, LatestLimitAt: latest, DocumentedTermEnd: termEnd, ExpiresAt: expires,
	}, domain.WarrantyEligible
}
