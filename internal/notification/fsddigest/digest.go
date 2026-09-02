// Package fsddigest formats the weekly FSD Web Push without talking to the
// database. The notification-worker tick decides whether to send; this
// package only names the notice and writes the body.
package fsddigest

import (
	"fmt"
	"time"
)

const (
	// DrillURL is the in-app destination opened from the push payload.
	DrillURL = "/weekly-digest"
	// Severity is informational — a recap, not an alert.
	Severity = "info"
)

// Snapshot is the measured current-week FSD rollup used to write one notice.
type Snapshot struct {
	VehicleID      int64
	WeekStart      time.Time
	Location       *time.Location
	FSDDistanceM   *float64
	SharePct       *float64
	ShareChangePts *float64
}

// ShouldSend reports whether the week has a measured FSD distance. Null is
// not zero and must not produce a digest claiming 0 km.
func ShouldSend(s Snapshot) bool {
	return s.FSDDistanceM != nil
}

// WeekDate is the local Monday YYYY-MM-DD used in titles and tags.
func WeekDate(weekStart time.Time, loc *time.Location) string {
	if loc == nil {
		loc = time.UTC
	}
	return weekStart.In(loc).Format("2006-01-02")
}

// Title is unique per vehicle and local week so notification_logs can
// dedupe without a new column.
func Title(vehicleID int64, weekStart time.Time, loc *time.Location) string {
	return fmt.Sprintf("Weekly FSD digest (#%d · %s)", vehicleID, WeekDate(weekStart, loc))
}

// AlertTag collapses repeated deliveries in the browser notification tray.
func AlertTag(vehicleID int64, weekStart time.Time, loc *time.Location) string {
	return fmt.Sprintf("fsd-weekly:%d:%s", vehicleID, WeekDate(weekStart, loc))
}

// Body is a short km-based recap. Push payloads have no operator unit
// preference; the in-app digest still converts at the render boundary.
func Body(s Snapshot) string {
	if s.FSDDistanceM == nil {
		return ""
	}
	body := fmt.Sprintf("Reported FSD %.1f km this week", *s.FSDDistanceM/1000)
	if s.SharePct != nil {
		body += fmt.Sprintf(" (%.1f%% of observed driving)", *s.SharePct)
	}
	if s.ShareChangePts != nil {
		body += fmt.Sprintf(", %+.1f pts vs last week", *s.ShareChangePts)
	}
	return body + "."
}
