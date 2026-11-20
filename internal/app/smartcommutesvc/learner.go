// Package smartcommutesvc implements opt-in recurring-drive decisions.
package smartcommutesvc

import (
	"math"
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	modeldrive "github.com/ev-dev-labs/teslasync/internal/models/drive"
)

const (
	learningDays         = 56
	learningMinimumDays  = 7
	learningWindowS      = 60 * 60
	learningEndpointGapM = 300
)

type learningGroup struct {
	weekday    time.Weekday
	origin     smartcommute.Point
	dest       smartcommute.Point
	days       map[string]struct{}
	departures []int
	first      time.Time
	last       time.Time
	minS       int
	maxS       int
}

// Learn returns suggestions, not confirmed routines. The caller must enforce
// consent and authorization before reading observations or invoking Learn.
func Learn(observations []smartcommute.DriveObservation, now time.Time, loc *time.Location) []smartcommute.LearnedRoutine {
	if loc == nil || now.IsZero() {
		return []smartcommute.LearnedRoutine{}
	}
	localNow := now.In(loc)
	today := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, loc)
	start := today.AddDate(0, 0, -learningDays)
	ordered := append([]smartcommute.DriveObservation(nil), observations...)
	sort.SliceStable(ordered, func(i, j int) bool {
		return ordered[i].StartedAt.After(ordered[j].StartedAt)
	})

	groups := make([]learningGroup, 0)
	for _, observation := range ordered {
		at := observation.StartedAt.In(loc)
		if at.Before(start) || !at.Before(today) ||
			!validPoint(observation.Origin) || !validPoint(observation.Destination) {
			continue
		}
		seconds := at.Hour()*3600 + at.Minute()*60 + at.Second()
		day := at.Format("2006-01-02")
		index := -1
		for i := range groups {
			group := &groups[i]
			if group.weekday != at.Weekday() ||
				max(group.maxS, seconds)-min(group.minS, seconds) > learningWindowS ||
				!near(group.origin, observation.Origin) ||
				!near(group.dest, observation.Destination) {
				continue
			}
			index = i
			break
		}
		if index < 0 {
			groups = append(groups, learningGroup{
				weekday: at.Weekday(), origin: observation.Origin, dest: observation.Destination,
				days: make(map[string]struct{}), minS: seconds, maxS: seconds,
				first: observation.StartedAt, last: observation.StartedAt,
			})
			index = len(groups) - 1
		}
		group := &groups[index]
		if _, exists := group.days[day]; exists {
			continue
		}
		group.days[day] = struct{}{}
		group.departures = append(group.departures, seconds)
		group.minS = min(group.minS, seconds)
		group.maxS = max(group.maxS, seconds)
		if observation.StartedAt.Before(group.first) {
			group.first = observation.StartedAt
		}
	}

	result := make([]smartcommute.LearnedRoutine, 0)
	for _, group := range groups {
		if len(group.days) < learningMinimumDays {
			continue
		}
		sort.Ints(group.departures)
		result = append(result, smartcommute.LearnedRoutine{
			Weekday: group.weekday, DepartureS: group.departures[len(group.departures)/2],
			Origin: group.origin, Destination: group.dest,
			Evidence: smartcommute.Evidence{
				MatchingDays: len(group.days), WindowStartS: group.minS, WindowEndS: group.maxS,
				FirstObservedAt: group.first.UTC(), LastObservedAt: group.last.UTC(),
			},
		})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Weekday != result[j].Weekday {
			return result[i].Weekday < result[j].Weekday
		}
		if result[i].DepartureS != result[j].DepartureS {
			return result[i].DepartureS < result[j].DepartureS
		}
		if result[i].Origin.Latitude != result[j].Origin.Latitude {
			return result[i].Origin.Latitude < result[j].Origin.Latitude
		}
		return result[i].Origin.Longitude < result[j].Origin.Longitude
	})
	return result
}

func validPoint(point smartcommute.Point) bool {
	return !math.IsNaN(point.Latitude) && !math.IsNaN(point.Longitude) &&
		!math.IsInf(point.Latitude, 0) && !math.IsInf(point.Longitude, 0) &&
		point.Latitude >= -90 && point.Latitude <= 90 &&
		point.Longitude >= -180 && point.Longitude <= 180
}

func near(a, b smartcommute.Point) bool {
	return modeldrive.HaversineMeters(a.Latitude, a.Longitude, b.Latitude, b.Longitude) <= learningEndpointGapM
}
