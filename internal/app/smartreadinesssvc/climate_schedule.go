package smartreadinesssvc

import (
	"math"
	"slices"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	climateScheduleWatch      = 90 * time.Minute
	climateScheduleMinRuns    = 3
	climateScheduleSampleGap  = 5 * time.Minute
	climateScheduleCoverage   = 15 * time.Minute
	climateScheduleMaxTravelM = 5
	climateScheduleLookback   = 42 * 24 * time.Hour
	climateScheduleOdometer   = "Odometer"
	climateScheduleBattery    = "BatteryLevel"
)

func climateScheduleRunValid(run domain.ClimateScheduleRun, now time.Time) bool {
	return !run.FiredAt.IsZero() && !run.TriggeredAt.Before(run.FiredAt) &&
		run.TriggeredAt.Sub(run.FiredAt) <= 5*time.Second &&
		!run.CompletedAt.Before(run.TriggeredAt) && run.CompletedAt.Sub(run.FiredAt) <= 3*time.Minute &&
		!run.FiredAt.Add(climateScheduleWatch).After(now)
}

func observedClimateScheduleRun(rows []signal.TimelineRow, run domain.ClimateScheduleRun, now time.Time) *domain.ClimateScheduleObservation {
	if !climateScheduleRunValid(run, now) {
		return nil
	}
	start, until := run.FiredAt, run.FiredAt.Add(climateScheduleWatch)
	earliest, latestStart := start.Add(-climateScheduleSampleGap), run.CompletedAt.Add(2*time.Minute)
	var on, activity time.Time
	off := false
	baselineOdometer := -1.0
	for _, row := range rows {
		at := row.Timestamp
		if at.Before(earliest) || at.After(until) {
			continue
		}
		meters, ok := signal.Float64(row.Fields[climateScheduleOdometer])
		if !cabinParked(row.Fields[cabinGear]) || !ok || !finiteBetween(meters, 0, 3e7) ||
			(baselineOdometer >= 0 && math.Abs(meters-baselineOdometer) > climateScheduleMaxTravelM) {
			return nil
		}
		running, known := row.Fields[cabinHVAC].(bool)
		if at.Before(start) {
			offAt := sourceObservedAt(row, cabinHVAC)
			off = known && !running && !offAt.Before(start.Add(-cabinMaxContinuousAge)) && !offAt.After(at)
			if baselineOdometer < 0 {
				baselineOdometer = meters
			}
		}
		if !at.Before(start) && on.IsZero() && running {
			if !off || !at.Equal(sourceObservedAt(row, cabinHVAC)) || at.After(latestStart) || !cabinOverheatOff(row) {
				return nil
			}
			on = at
		}
		// Park and odometer are change-only; actual cabin/charge emissions establish coverage.
		if at.Equal(sourceObservedAt(row, cabinInterior)) || at.Equal(sourceObservedAt(row, climateScheduleBattery)) {
			if (activity.IsZero() && at.After(start.Add(climateScheduleSampleGap))) ||
				(!activity.IsZero() && at.Sub(activity) > climateScheduleCoverage) {
				return nil
			}
			activity = at
		}
	}
	if on.IsZero() || activity.Before(until.Add(-climateScheduleSampleGap)) || baselineOdometer < 0 {
		return nil
	}
	return &domain.ClimateScheduleObservation{FiredAt: start, ClimateOn: on, VerifiedTo: activity}
}

func summarizeClimateSchedule(source []domain.ClimateScheduleObservation, now time.Time, loc *time.Location) *domain.ClimateScheduleReview {
	if loc == nil {
		return nil
	}
	local := now.In(loc)
	year, month, day := local.Date()
	today := time.Date(year, month, day, 0, 0, 0, 0, loc)
	monday := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7))
	earliestHistory := today.AddDate(0, 0, -41)
	expires := monday.AddDate(0, 0, 7)
	type scheduleSlot struct {
		weekday time.Weekday
		minute  int
	}
	groups := make(map[scheduleSlot][]domain.ClimateScheduleObservation)
	days := make(map[scheduleSlot]map[string]bool)
	ordered := slices.Clone(source)
	slices.SortFunc(ordered, func(a, b domain.ClimateScheduleObservation) int { return b.FiredAt.Compare(a.FiredAt) })
	for _, observation := range ordered {
		at := observation.FiredAt.In(loc)
		if at.Before(earliestHistory) || observation.VerifiedTo.After(now) {
			continue
		}
		key := scheduleSlot{weekday: at.Weekday(), minute: at.Hour()*60 + at.Minute()}
		date := at.Format(time.DateOnly)
		if days[key] == nil {
			days[key] = make(map[string]bool)
		}
		if !days[key][date] {
			days[key][date] = true
			groups[key] = append(groups[key], observation)
		}
	}
	var selected []domain.ClimateScheduleObservation
	for _, group := range groups {
		if len(group) < climateScheduleMinRuns || group[0].VerifiedTo.Before(monday) || !group[0].VerifiedTo.Before(expires) {
			continue
		}
		if len(selected) == 0 || group[0].FiredAt.After(selected[0].FiredAt) {
			selected = group
		}
	}
	if len(selected) == 0 {
		return nil
	}
	return &domain.ClimateScheduleReview{WeekOf: monday, ExpiresAt: expires, Observations: selected[:min(len(selected), 6)]}
}
