// Package driveefficiency describes a private matched-drive efficiency digest.
package driveefficiency

import "time"

type Settings struct {
	Revision    int64      `json:"revision"`
	TimeZone    string     `json:"time_zone"`
	Paused      bool       `json:"paused"`
	NextCheckAt *time.Time `json:"next_check_at"`
}

type Interval struct {
	LowWhPerM  float64 `json:"low_wh_per_m"`
	HighWhPerM float64 `json:"high_wh_per_m"`
}

type Digest struct {
	ReferenceDriveID int64     `json:"reference_drive_id"`
	BaselineFrom     time.Time `json:"baseline_from"`
	RecentFrom       time.Time `json:"recent_from"`
	RecentUntil      time.Time `json:"recent_until"`
	ObservedUntil    time.Time `json:"observed_until"`
	ExpiresAt        time.Time `json:"expires_at"`
	BaselineDays     int       `json:"baseline_days"`
	RecentDays       int       `json:"recent_days"`
	Baseline         Interval  `json:"baseline"`
	Recent           Interval  `json:"recent"`
	Higher           bool      `json:"higher"`
}

type Reason string

const (
	Insufficient Reason = "insufficient_comparable_coverage"
	WithinRange  Reason = "within_observed_variation"
	Changed      Reason = "material_sustained_change"
	StaleWeek    Reason = "review_window_passed"
	Revoked      Reason = "lease_revoked"
)

type Window struct {
	BaselineFrom time.Time
	RecentFrom   time.Time
	RecentUntil  time.Time
	RecentMiddle time.Time
	Release      time.Time
	NextRelease  time.Time
}

func Week(local time.Time) Window {
	daysSinceMonday := (int(local.Weekday()) + 6) % 7
	monday := time.Date(local.Year(), local.Month(), local.Day()-daysSinceMonday, 0, 0, 0, 0, local.Location())
	return Window{
		BaselineFrom: monday.AddDate(0, 0, -49),
		RecentFrom:   monday.AddDate(0, 0, -7),
		RecentUntil:  monday,
		RecentMiddle: monday.AddDate(0, 0, -4),
		Release:      weeklyRelease(monday),
		NextRelease:  weeklyRelease(monday.AddDate(0, 0, 7)),
	}
}

func weeklyRelease(day time.Time) time.Time {
	return time.Date(day.Year(), day.Month(), day.Day(), 9, 0, 0, 0, day.Location())
}
