package fsd

import (
	"sort"
	"time"
)

const (
	maxCommuteIdentities   = 8
	commuteIdentityHonesty = "Same route and time-of-day window. Month-over-month supervised share is a trip-meter correlation, not proof FSD improved."
)

type commuteMonthAcc struct {
	driveCount int
	highCount  int
	fsdM       float64
	driveM     float64
	measured   int
	unknownDay map[string]struct{}
}

func (a *commuteMonthAcc) add(summary DriveFSDInsight, loc *time.Location) {
	a.driveCount++
	day := summary.StartedAt.In(loc).Format("2006-01-02")
	switch summary.Confidence {
	case ConfidenceHigh:
		a.highCount++
		if summary.DistanceM != nil && *summary.DistanceM > 0 {
			a.driveM += *summary.DistanceM
		}
		if summary.FSDDistanceM != nil {
			a.fsdM += *summary.FSDDistanceM
			a.measured++
		}
	case ConfidenceEstimated, ConfidenceAmbiguous:
		// Share uses high-confidence drives only. These still prove the
		// commute happened, but they do not invent a month-over-month ratio.
	default:
		if a.unknownDay == nil {
			a.unknownDay = make(map[string]struct{})
		}
		a.unknownDay[day] = struct{}{}
	}
}

func (a commuteMonthAcc) share(month string) CommuteMonthShare {
	out := CommuteMonthShare{
		Month:            month,
		DriveCount:       a.driveCount,
		DrivingDistanceM: roundMeters(a.driveM),
		UnknownDays:      len(a.unknownDay),
		Confidence:       ConfidenceUnknown,
	}
	if a.measured > 0 {
		distance := roundMeters(a.fsdM)
		out.FSDDistanceM = &distance
		out.FSDSharePct, _ = sharePct(out.FSDDistanceM, &out.DrivingDistanceM)
	}
	switch {
	case a.driveCount == 0:
		out.Confidence = ConfidenceUnknown
	case a.highCount > 0 && a.measured > 0 && len(a.unknownDay) == 0 && a.highCount == a.driveCount:
		out.Confidence = ConfidenceHigh
	case a.highCount > 0 && a.measured > 0 && len(a.unknownDay) == 0:
		out.Confidence = ConfidenceEstimated
	case a.highCount > 0 && a.measured > 0:
		out.Confidence = ConfidenceAmbiguous
	default:
		out.Confidence = ConfidenceUnknown
	}
	return out
}

type commuteGroup struct {
	routeKey     string
	routeLabel   string
	windowKey    string
	windowLabel  string
	thisMonth    commuteMonthAcc
	lastMonth    commuteMonthAcc
}

// buildCommuteIdentities compares the same route and local time-of-day window
// in the calendar month of periodEnd versus the previous calendar month.
func buildCommuteIdentities(
	summaries []DriveFSDInsight,
	driveByID map[int64]DriveRecord,
	loc *time.Location,
	periodEnd time.Time,
) []CommuteIdentity {
	if loc == nil {
		loc = time.UTC
	}
	end := periodEnd.In(loc)
	thisStart := time.Date(end.Year(), end.Month(), 1, 0, 0, 0, 0, loc)
	lastStart := thisStart.AddDate(0, -1, 0)
	thisKey := thisStart.Format("2006-01")
	lastKey := lastStart.Format("2006-01")

	groups := make(map[string]*commuteGroup)
	for _, summary := range summaries {
		drive, ok := driveByID[summary.DriveID]
		if !ok {
			continue
		}
		routeKey, routeLabel, ok := routeIdentity(drive)
		if !ok {
			continue
		}
		local := summary.StartedAt.In(loc)
		windowKey, windowLabel := timeOfDayBucket(local.Hour())
		monthStart := time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, loc)
		var target *commuteMonthAcc
		id := routeKey + "|" + windowKey
		group := groups[id]
		if group == nil {
			group = &commuteGroup{
				routeKey:    routeKey,
				routeLabel:  routeLabel,
				windowKey:   windowKey,
				windowLabel: windowLabel,
			}
			groups[id] = group
		}
		switch {
		case monthStart.Equal(thisStart):
			target = &group.thisMonth
		case monthStart.Equal(lastStart):
			target = &group.lastMonth
		default:
			continue
		}
		target.add(summary, loc)
	}

	out := make([]CommuteIdentity, 0, len(groups))
	for _, group := range groups {
		if group.thisMonth.driveCount == 0 {
			continue
		}
		thisMonth := group.thisMonth.share(thisKey)
		lastMonth := group.lastMonth.share(lastKey)
		identity := CommuteIdentity{
			RouteKey:    group.routeKey,
			RouteLabel:  group.routeLabel,
			WindowKey:   group.windowKey,
			WindowLabel: group.windowLabel,
			ThisMonth:   thisMonth,
			LastMonth:   lastMonth,
			Honesty:     commuteIdentityHonesty,
		}
		if thisMonth.FSDSharePct != nil && lastMonth.FSDSharePct != nil {
			change := roundPct(*thisMonth.FSDSharePct - *lastMonth.FSDSharePct)
			identity.ShareChangePctPoints = &change
		}
		out = append(out, identity)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].ThisMonth.DriveCount == out[j].ThisMonth.DriveCount {
			if out[i].RouteLabel == out[j].RouteLabel {
				return out[i].WindowKey < out[j].WindowKey
			}
			return out[i].RouteLabel < out[j].RouteLabel
		}
		return out[i].ThisMonth.DriveCount > out[j].ThisMonth.DriveCount
	})
	if len(out) > maxCommuteIdentities {
		out = out[:maxCommuteIdentities]
	}
	return out
}
