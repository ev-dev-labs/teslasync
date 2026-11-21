package smartreadinesssvc

import (
	"math"
	"slices"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
)

const (
	parkReserveMinStay      = 12 * time.Hour
	parkReserveMinRemaining = parkReserveMinStay - parkReserveActionWindow
	parkReserveMaxStay      = 7 * 24 * time.Hour
	parkReserveLookback     = 75 * 24 * time.Hour
	parkReserveMinEpisodes  = 3
	parkReserveMaxEpisodes  = 12
	parkReserveSoCBufferPct = 1
)

func EstimateParkReserve(episodes []domain.ParkReserveEpisode, live domain.ParkReserveConditions, now, returnAt time.Time, reservePct float64) (*domain.ParkReserveEstimate, domain.ParkReserveReason) {
	stay := returnAt.Sub(now)
	if stay < parkReserveMinRemaining || stay > parkReserveMaxStay || !finiteBetween(reservePct, 5, 90) {
		return nil, domain.ParkReserveInvalidPlan
	}
	if !parkObservationUsable(live, now) {
		return nil, domain.ParkReserveUnknownState
	}

	ordered := slices.Clone(episodes)
	slices.SortStableFunc(ordered, func(a, b domain.ParkReserveEpisode) int {
		return b.EndObservedAt.Compare(a.EndObservedAt)
	})
	lastStart := now
	lowDrop, highDrop := math.Inf(1), 0.0
	count := 0
	for _, row := range ordered {
		if row.EndObservedAt.After(lastStart) || !comparableParkReserveEpisode(row, live, now, stay) {
			continue
		}
		observedStay := row.EndObservedAt.Sub(row.StartObservedAt)
		drop := (row.StartBatteryPct - row.EndBatteryPct) * float64(stay) / float64(observedStay)
		lowDrop, highDrop = min(lowDrop, drop), max(highDrop, drop)
		lastStart = row.StartObservedAt
		count++
		if count == parkReserveMaxEpisodes {
			break
		}
	}
	if count < parkReserveMinEpisodes {
		return nil, domain.ParkReserveInsufficient
	}

	lower := max(0, math.Floor(live.BatteryPct-highDrop-parkReserveSoCBufferPct))
	upper := min(math.Ceil(live.BatteryPct), math.Ceil(live.BatteryPct-max(0, lowDrop-parkReserveSoCBufferPct)))
	estimate := &domain.ParkReserveEstimate{
		ObservedAt: live.ObservedAt.UTC(), ComparableEpisodes: count, StartBatteryPct: live.BatteryPct,
		ReturnLowPct: int(lower), ReturnHighPct: int(upper),
	}
	if live.BatteryPct <= reservePct {
		return estimate, domain.ParkReserveAlreadyLow
	}
	// Rounding and the display buffer alone cannot make a push eligible.
	estimate.ReserveRisk = highDrop >= 2 && live.BatteryPct-highDrop < reservePct
	if estimate.ReserveRisk {
		return estimate, domain.ParkReserveAtRisk
	}
	return estimate, domain.ParkReserveAbove
}

func parkObservationUsable(live domain.ParkReserveConditions, now time.Time) bool {
	return live.Parked && live.Unplugged && !live.ObservedAt.IsZero() && !live.ObservedAt.After(now) &&
		now.Sub(live.ObservedAt) <= 2*time.Minute && finiteBetween(live.BatteryPct, 0, 100) &&
		finiteBetween(live.OutsideC, -45, 60) && (live.SentryMode == enums.SentryOff || live.SentryMode == enums.SentryArmed)
}

func comparableParkReserveEpisode(row domain.ParkReserveEpisode, live domain.ParkReserveConditions, now time.Time, stay time.Duration) bool {
	d := row.EndObservedAt.Sub(row.StartObservedAt)
	return !row.StartObservedAt.Before(now.Add(-parkReserveLookback)) && d >= stay*4/5 && d <= stay*6/5 &&
		row.SentryMode == live.SentryMode && finiteBetween(row.StartBatteryPct, 0, 100) &&
		finiteBetween(row.EndBatteryPct, 0, row.StartBatteryPct) && math.Abs(row.StartBatteryPct-live.BatteryPct) <= 15 &&
		finiteBetween(row.StartOutsideC, -45, 60) && finiteBetween(row.EndOutsideC, -45, 60) &&
		math.Abs(row.StartOutsideC-live.OutsideC) <= 4 && math.Abs(row.EndOutsideC-live.OutsideC) <= 4
}
