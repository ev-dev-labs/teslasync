// Package driveefficiencysvc prepares private reviews of like-for-like drives.
package driveefficiencysvc

import (
	"cmp"
	"math"
	"slices"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/driveevidence"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/driveefficiency"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

const maxDriveObservations = 96

type observation struct {
	start, end                   time.Time
	id                           int64
	distanceM, ambientC          float64
	progressMps, netWh, coveredS float64
	path                         []smartcommute.Point
}

type matchedDay struct {
	bounds    domain.Interval
	endedAt   time.Time
	lastDrive int64
}

type cohort struct {
	baseline, early, late int
	members               []int
	days                  map[string]matchedDay
}

func evaluate(window domain.Window, rows []observation) (*domain.Digest, domain.Reason) {
	if len(rows) > maxDriveObservations {
		return nil, domain.Insufficient
	}
	counts := make(map[int64]int, len(rows))
	for _, row := range rows {
		counts[row.id]++
	}
	valid := make([]observation, 0, len(rows))
	for _, row := range rows {
		if counts[row.id] == 1 && qualifies(window, row) {
			valid = append(valid, row)
		}
	}
	slices.SortFunc(valid, func(a, b observation) int {
		if n := a.end.Compare(b.end); n != 0 {
			return n
		}
		return cmp.Compare(a.id, b.id)
	})
	matched := comparisonMatrix(valid)
	var best cohort
	location := window.RecentFrom.Location()
	for i, anchor := range valid {
		if anchor.end.Before(window.RecentFrom) {
			continue
		}
		candidate := matchCohort(i, window, location, valid, matched)
		if candidate.baseline < 4 || candidate.early < 2 || candidate.late < 2 {
			continue
		}
		if best.coverage() < candidate.coverage() ||
			best.coverage() == candidate.coverage() && len(best.days) < len(candidate.days) {
			best = candidate
		}
	}
	if best.coverage() == 0 {
		return nil, domain.Insufficient
	}
	return evaluateCohort(window, best)
}

func qualifies(window domain.Window, r observation) bool {
	durationS := r.end.Sub(r.start).Seconds()
	return r.id > 0 && !r.start.Before(window.BaselineFrom) && r.end.Before(window.RecentUntil) &&
		(!r.start.Before(window.RecentFrom) || r.end.Before(window.RecentFrom)) &&
		durationS >= 180 && durationS <= 7200 && math.Abs(r.coveredS-durationS) < 1e-6 &&
		r.distanceM >= 5000 && r.distanceM <= driveevidence.MaxPathM &&
		r.ambientC >= -40 && r.ambientC <= 55 && r.progressMps >= 3 && r.progressMps <= 50 &&
		r.netWh/r.distanceM >= 0.035 && r.netWh/r.distanceM <= 1 &&
		driveevidence.ValidPath(r.path) && math.Abs(driveevidence.PathLengthM(r.path)-r.distanceM) <= 0.15*r.distanceM
}

func comparisonMatrix(rows []observation) [][]bool {
	matches := make([][]bool, len(rows))
	for i, a := range rows {
		matches[i] = make([]bool, i+1)
		matches[i][i] = true
		for j := range i {
			b := rows[j]
			matches[i][j] = math.Abs(a.ambientC-b.ambientC) <= 5 && math.Abs(a.progressMps-b.progressMps) <= 2 &&
				math.Abs(a.distanceM-b.distanceM) <= 0.03*min(a.distanceM, b.distanceM) &&
				!a.start.Before(b.end) &&
				driveevidence.PathsMatch(a.path, b.path)
		}
	}
	return matches
}

func matchCohort(anchor int, window domain.Window, location *time.Location, rows []observation, matches [][]bool) cohort {
	group := cohort{days: make(map[string]matchedDay), members: []int{anchor}}
	for i, row := range rows {
		coherent := true
		for _, member := range group.members {
			if !matches[max(i, member)][min(i, member)] {
				coherent = false
				break
			}
		}
		if !coherent {
			continue
		}
		if i != anchor {
			group.members = append(group.members, i)
		}
		localDay := row.end.In(location).Format(time.DateOnly)
		intensity := row.netWh / row.distanceM
		day, exists := group.days[localDay]
		if !exists {
			day.bounds = domain.Interval{LowWhPerM: intensity, HighWhPerM: intensity}
			switch {
			case row.end.Before(window.RecentFrom):
				group.baseline++
			case row.end.Before(window.RecentMiddle):
				group.early++
			default:
				group.late++
			}
		} else {
			day.bounds.LowWhPerM = min(day.bounds.LowWhPerM, intensity)
			day.bounds.HighWhPerM = max(day.bounds.HighWhPerM, intensity)
		}
		day.endedAt, day.lastDrive = row.end, row.id
		group.days[localDay] = day
	}
	return group
}

func (c cohort) coverage() int {
	return min(c.baseline, 2*c.early, 2*c.late)
}

func evaluateCohort(w domain.Window, c cohort) (*domain.Digest, domain.Reason) {
	baseline := domain.Interval{LowWhPerM: math.Inf(1)}
	recent := domain.Interval{LowWhPerM: math.Inf(1)}
	var latest matchedDay
	for _, day := range c.days {
		bounds := &recent
		if day.endedAt.Before(w.RecentFrom) {
			bounds = &baseline
		}
		bounds.LowWhPerM = min(bounds.LowWhPerM, day.bounds.LowWhPerM)
		bounds.HighWhPerM = max(bounds.HighWhPerM, day.bounds.HighWhPerM)
		if day.endedAt.After(latest.endedAt) {
			latest = day
		}
	}
	up := recent.LowWhPerM-baseline.HighWhPerM >= max(0.025, 0.20*baseline.HighWhPerM)
	down := baseline.LowWhPerM-recent.HighWhPerM >= max(0.025, 0.20*baseline.LowWhPerM)
	if !up && !down {
		return nil, domain.WithinRange
	}
	return &domain.Digest{
		ReferenceDriveID: latest.lastDrive, ObservedUntil: latest.endedAt.UTC(),
		BaselineFrom: w.BaselineFrom.UTC(), RecentFrom: w.RecentFrom.UTC(), RecentUntil: w.RecentUntil.UTC(), ExpiresAt: w.NextRelease.UTC(),
		BaselineDays: c.baseline, RecentDays: c.early + c.late, Baseline: baseline, Recent: recent, Higher: up,
	}, domain.Changed
}
