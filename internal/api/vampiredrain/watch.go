package vampiredrain

import (
	"fmt"
	"math"
	"time"

	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
)

// Watchdog status levels. Thresholds mirror the frontend severity ramp
// (VampireDrainWidget drainColor): <1%/day green, 1–3 amber, >=3 red.
const (
	WatchStatusOK    = "ok"
	WatchStatusWatch = "watch"
	WatchStatusAlert = "alert"
)

// DefaultWatchThresholdPctPerDay is the breach line when the caller omits
// threshold_pct_per_day: 3%/day, the "red" boundary owners complain about.
const DefaultWatchThresholdPctPerDay = 3.0

// WatchReport is the GET /vampire-drain/watch response: threshold
// evaluation over recent parked windows plus a human-readable diagnosis.
type WatchReport struct {
	Status             string                     `json:"status"`
	ThresholdPctPerDay float64                    `json:"threshold_pct_per_day"`
	AvgDrainPctPerDay  *float64                   `json:"avg_drain_pct_per_day"`
	EventsEvaluated    int                        `json:"events_evaluated"`
	BreachStreak       int                        `json:"breach_streak"`
	BreachesLast7Days  int                        `json:"breaches_last_7_days"`
	Worst              *drivedb.VampireDrainEvent `json:"worst_event"`
	ColdNote           string                     `json:"cold_note,omitempty"`
	Recommendation     string                     `json:"recommendation"`
}

// EvaluateWatch is the pure watchdog computation over most-recent-first
// events. now pins "last 7 days" so tests are deterministic.
func EvaluateWatch(events []drivedb.VampireDrainEvent, avg *float64, threshold float64, now time.Time) WatchReport {
	rep := WatchReport{
		Status:             WatchStatusOK,
		ThresholdPctPerDay: threshold,
		AvgDrainPctPerDay:  avg,
		EventsEvaluated:    len(events),
	}
	if len(events) == 0 {
		rep.Recommendation = "No parked windows observed yet — park unplugged for a few hours to seed the watchdog."
		return rep
	}

	weekAgo := now.Add(-7 * 24 * time.Hour)
	var worst *drivedb.VampireDrainEvent
	for i := range events {
		ev := &events[i]
		if worst == nil || ev.DrainPctPerDay > worst.DrainPctPerDay {
			worst = ev
		}
		if ev.DrainPctPerDay >= threshold && !ev.StartedAt.Before(weekAgo) {
			rep.BreachesLast7Days++
		}
	}
	rep.Worst = worst

	// Breach streak: consecutive most-recent events over the line.
	for i := range events {
		if events[i].DrainPctPerDay < threshold {
			break
		}
		rep.BreachStreak++
	}

	avgVal := 0.0
	if avg != nil && !math.IsNaN(*avg) {
		avgVal = *avg
	}
	switch {
	case avgVal >= threshold || rep.BreachStreak >= 3:
		rep.Status = WatchStatusAlert
	case avgVal >= threshold*2/3 || rep.BreachesLast7Days > 0:
		rep.Status = WatchStatusWatch
	}

	// Cold correlation: compare sub-5°C windows against milder ones.
	var coldSum, mildSum float64
	var coldN, mildN int
	for i := range events {
		t := events[i].AmbientTempCAvg
		if t == nil {
			continue
		}
		if *t < 5 {
			coldSum += events[i].DrainPctPerDay
			coldN++
		} else {
			mildSum += events[i].DrainPctPerDay
			mildN++
		}
	}
	if coldN > 0 && mildN > 0 && coldSum/float64(coldN) > 1.5*mildSum/float64(mildN) {
		rep.ColdNote = fmt.Sprintf(
			"Cold-parked windows average %.1f%%/day vs %.1f%%/day in mild weather — battery heating is a likely driver.",
			round1(coldSum/float64(coldN)), round1(mildSum/float64(mildN)),
		)
	}

	switch rep.Status {
	case WatchStatusAlert:
		rep.Recommendation = fmt.Sprintf(
			"Drain is breaching %.1f%%/day (%d in a row). Check Sentry Mode, Cabin Overheat Protection, and third-party polling apps keeping the car awake.",
			threshold, max1(rep.BreachStreak),
		)
	case WatchStatusWatch:
		rep.Recommendation = "Drain is elevated but not critical. Watch the next few parked nights; disable Sentry at home first if the streak grows."
	default:
		rep.Recommendation = "Parked drain looks healthy. No action needed."
	}
	return rep
}

func round1(f float64) float64 { return math.Round(f*10) / 10 }

func max1(n int) int {
	if n < 1 {
		return 1
	}
	return n
}
