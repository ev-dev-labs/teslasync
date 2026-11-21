package driveefficiencysvc

import (
	"math"
	"slices"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/driveefficiency"
	"github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

func TestWeeklyEfficiencyRequiresMatchedDrivesAcrossTheWeek(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	w := domain.Week(time.Date(2026, 3, 9, 9, 0, 0, 0, loc))
	if w.Release.UTC().Format(time.RFC3339) != "2026-03-09T13:00:00Z" || w.RecentUntil.Sub(w.RecentFrom) != 167*time.Hour {
		t.Fatalf("week does not follow local DST calendar: %+v", w)
	}
	var rows []observation
	for i := range 12 {
		day := w.RecentFrom.AddDate(0, 0, -31+i*3)
		wh := 750.0 + float64(i%2)*5
		if i >= 8 {
			day = w.RecentFrom.AddDate(0, 0, []int{0, 1, 4, 6}[i-8])
			wh += 330
		}
		path := make([]smartcommute.Point, 6)
		for p := range path {
			path[p] = smartcommute.Point{Latitude: 47.11 + 0.009*float64(p), Longitude: -122.3}
		}
		start := day.Add(10 * time.Hour)
		rows = append(rows, observation{
			id: int64(i + 1), start: start, end: start.Add(600 * time.Second), coveredS: 600,
			distanceM: 5005, ambientC: 11 + float64(i%2), progressMps: 8.34, netWh: wh, path: path,
		})
	}
	got, reason := evaluate(w, rows)
	if reason != domain.Changed || got == nil || !got.Higher || got.RecentDays != 4 || got.BaselineDays != 8 ||
		got.ReferenceDriveID != 12 || math.Abs(got.Recent.LowWhPerM-1080.0/5005.0) > 1e-12 ||
		!got.ExpiresAt.Equal(time.Date(2026, 3, 16, 13, 0, 0, 0, time.UTC)) {
		t.Fatalf("incorrect measured cohort or period: %+v reason=%s", got, reason)
	}
	for _, tt := range []struct {
		name   string
		change func([]observation) []observation
		reason domain.Reason
	}{
		{"unmatched speed", changeLast(func(r *observation) { r.progressMps += 3 }), domain.Insufficient},
		{"unmatched temperature", changeLast(func(r *observation) { r.ambientC -= 7 }), domain.Insufficient},
		{"same endpoints but alternate road", changeLast(func(r *observation) { r.path = slices.Clone(r.path); r.path[3].Longitude += 0.003 }), domain.Insufficient},
		{"incomplete power coverage", changeLast(func(r *observation) { r.coveredS-- }), domain.Insufficient},
		{"overlapping energy ranges", changeLast(func(r *observation) { r.netWh = 755 }), domain.WithinRange},
		{"one hot drive does not establish a trend", func(r []observation) []observation { r[8].netWh, r[9].netWh = 750, 755; return r }, domain.WithinRange},
		{"repeated drives on one local day", func(r []observation) []observation {
			r[11].start, r[11].end = r[10].start.Add(time.Hour), r[10].end.Add(time.Hour)
			return r
		}, domain.Insufficient},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if result, reason := evaluate(w, tt.change(slices.Clone(rows))); result != nil || reason != tt.reason {
				t.Fatalf("result=%+v reason=%s want %s", result, reason, tt.reason)
			}
		})
	}
}

func changeLast(update func(*observation)) func([]observation) []observation {
	return func(rows []observation) []observation {
		update(&rows[len(rows)-1])
		return rows
	}
}
