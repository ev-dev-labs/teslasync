package smartcommutesvc

import (
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

const (
	minTrafficLeadS         = 5 * 60
	maxTrafficLeadS         = 60 * 60
	minTrafficSavingsS      = 60
	maxTrafficSavingsS      = 60 * 60
	trafficEvidenceLifetime = 5 * time.Minute
)

type trafficWindow struct {
	departureAt time.Time
	checkAt     time.Time
}

func nextTrafficWindow(settings domain.Settings, routine domain.Routine, leadS int, after time.Time) (trafficWindow, bool) {
	if after.IsZero() || !settings.Enabled || settings.Paused || settings.VehicleID != routine.VehicleID ||
		routine.Status != domain.RoutineConfirmed ||
		leadS < minTrafficLeadS || leadS > maxTrafficLeadS ||
		routine.Weekday < time.Sunday || routine.Weekday > time.Saturday ||
		routine.DepartureS < 0 || routine.DepartureS >= 24*3600 || !validTimeZone(routine.TimeZone) {
		return trafficWindow{}, false
	}
	loc, err := time.LoadLocation(routine.TimeZone)
	if err != nil {
		return trafficWindow{}, false
	}
	lead := time.Duration(leadS) * time.Second
	if routine.SnoozedUntil != nil {
		firstAllowed := routine.SnoozedUntil.Add(lead - time.Nanosecond)
		if firstAllowed.After(after) {
			after = firstAllowed
		}
	}
	local := after.In(loc)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	weekdayOffset := (int(routine.Weekday) - int(day.Weekday()) + 7) % 7
	for week := range 3 {
		date := day.AddDate(0, 0, weekdayOffset+7*week)
		departure := resolveTrafficWallTime(date.Add(time.Duration(routine.DepartureS)*time.Second), loc)
		if !departure.After(after) {
			continue
		}
		check := departure.Add(-lead)
		if routine.SnoozedUntil == nil || !check.Before(*routine.SnoozedUntil) {
			return trafficWindow{departureAt: departure, checkAt: check}, true
		}
	}
	return trafficWindow{}, false
}

func resolveTrafficWallTime(wallUTC time.Time, loc *time.Location) time.Time {
	var earliest time.Time
	// Try both offsets around an IANA transition; a gap has no round trip.
	for _, around := range [...]time.Duration{-36 * time.Hour, 0, 36 * time.Hour} {
		_, offset := wallUTC.Add(around).In(loc).Zone()
		candidate := wallUTC.Add(-time.Duration(offset) * time.Second)
		local := candidate.In(loc)
		if local.Year() == wallUTC.Year() && local.YearDay() == wallUTC.YearDay() &&
			local.Hour() == wallUTC.Hour() && local.Minute() == wallUTC.Minute() && local.Second() == wallUTC.Second() &&
			(earliest.IsZero() || candidate.Before(earliest)) {
			earliest = candidate
		}
	}
	return earliest
}

func trafficOpportunity(window trafficWindow, comparison domain.TrafficComparison, minSavingsS int64, now time.Time) (time.Time, bool) {
	if minSavingsS < minTrafficSavingsS || minSavingsS > maxTrafficSavingsS ||
		now.Before(window.checkAt) || !now.Before(window.departureAt) {
		return time.Time{}, false
	}
	usual, alternative := comparison.Usual, comparison.Alternative
	if usual.DurationS <= 0 || usual.DurationS > 3*3600 || alternative.DurationS <= 0 ||
		usual.DurationS-alternative.DurationS < minSavingsS ||
		usual.FlowUpdatedAt.After(now) || alternative.FlowUpdatedAt.After(now) {
		return time.Time{}, false
	}
	expires := minInstant(window.departureAt, usual.FlowUpdatedAt.Add(trafficEvidenceLifetime), alternative.FlowUpdatedAt.Add(trafficEvidenceLifetime))
	return expires, expires.After(now)
}

func minInstant(first time.Time, times ...time.Time) time.Time {
	for _, candidate := range times {
		if candidate.Before(first) {
			first = candidate
		}
	}
	return first
}
