package smartcommutesvc

import (
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

const (
	deadlineBuffer            = 3 * time.Minute
	minDeadlineActionTime     = 2 * time.Minute
	maxDeadlineAfterDeparture = 6 * time.Hour
)

type deadlineOpportunity struct {
	deadlineAt time.Time
	latestAt   time.Time
	expiresAt  time.Time
}

func deadlineOffset(departureS, deadlineS int) (time.Duration, bool) {
	const dayS = 24 * 3600
	if deadlineS < 0 || deadlineS >= dayS || departureS < 0 || departureS >= dayS || deadlineS == departureS {
		return 0, false
	}
	offset := time.Duration((deadlineS-departureS+dayS)%dayS) * time.Second
	return offset, offset <= maxDeadlineAfterDeparture
}

func arrivalDeadlineAt(departure time.Time, routine domain.Routine, deadlineS int) time.Time {
	offset, ok := deadlineOffset(routine.DepartureS, deadlineS)
	if !ok {
		return time.Time{}
	}
	loc, err := time.LoadLocation(routine.TimeZone)
	if err != nil {
		return time.Time{}
	}
	day := departure.In(loc)
	localWall := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC)
	localWall = localWall.Add(time.Duration(routine.DepartureS)*time.Second + offset)
	return resolveTrafficWallTime(localWall, loc)
}

func evaluateArrivalDeadline(
	window trafficWindow, deadlineAt time.Time, comparison domain.TrafficComparison, now time.Time,
) (deadlineOpportunity, bool) {
	if !deadlineAt.After(window.departureAt) || now.Before(window.checkAt) || !now.Before(window.departureAt) {
		return deadlineOpportunity{}, false
	}
	best, observed, ok := freshFastestRoute(comparison, now)
	if !ok {
		return deadlineOpportunity{}, false
	}
	if window.departureAt.Add(best).Sub(deadlineAt) < minDeadlineActionTime {
		return deadlineOpportunity{}, false
	}
	latest := deadlineAt.Add(-best - deadlineBuffer)
	if latest.Sub(now) < minDeadlineActionTime {
		return deadlineOpportunity{}, false
	}
	expires := minInstant(latest, observed.Add(trafficEvidenceLifetime))
	return deadlineOpportunity{deadlineAt: deadlineAt, latestAt: latest, expiresAt: expires}, true
}

func confirmEarlierDeparture(opportunity deadlineOpportunity, earlier domain.TrafficComparison, now time.Time) (time.Time, time.Time, bool) {
	best, observed, ok := freshFastestRoute(earlier, now)
	expires := minInstant(opportunity.expiresAt, observed.Add(trafficEvidenceLifetime))
	if !ok || !expires.After(now) || opportunity.latestAt.Sub(now) < minDeadlineActionTime ||
		opportunity.latestAt.Add(best+deadlineBuffer).After(opportunity.deadlineAt) {
		return time.Time{}, time.Time{}, false
	}
	return observed, expires, true
}

func freshFastestRoute(comparison domain.TrafficComparison, now time.Time) (time.Duration, time.Time, bool) {
	for _, estimate := range []domain.TrafficEstimate{comparison.Usual, comparison.Alternative} {
		if estimate.DurationS <= 0 || estimate.DurationS > 3*3600 ||
			estimate.FlowUpdatedAt.After(now) || !estimate.FlowUpdatedAt.Add(trafficEvidenceLifetime).After(now) {
			return 0, time.Time{}, false
		}
	}
	return time.Duration(min(comparison.Usual.DurationS, comparison.Alternative.DurationS)) * time.Second,
		minInstant(comparison.Usual.FlowUpdatedAt, comparison.Alternative.FlowUpdatedAt), true
}
