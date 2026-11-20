// Package smartcommute defines private recurring-drive decisions.
package smartcommute

import "time"

type Point struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// DriveObservation is a completed drive with known endpoints.
type DriveObservation struct {
	StartedAt   time.Time
	Origin      Point
	Destination Point
}

type Evidence struct {
	MatchingDays    int       `json:"matching_days"`
	WindowStartS    int       `json:"window_start_s"`
	WindowEndS      int       `json:"window_end_s"`
	FirstObservedAt time.Time `json:"first_observed_at"`
	LastObservedAt  time.Time `json:"last_observed_at"`
}

type LearnedRoutine struct {
	Weekday     time.Weekday
	DepartureS  int
	Origin      Point
	Destination Point
	Evidence    Evidence
}

type Settings struct {
	VehicleID            int64  `json:"vehicle_id"`
	Enabled              bool   `json:"enabled"`
	LocalAnalysisEnabled bool   `json:"local_analysis_enabled"`
	Paused               bool   `json:"paused"`
	TimeZone             string `json:"time_zone"`
}

type RoutineStatus string

const (
	RoutineSuggested RoutineStatus = "suggested"
	RoutineConfirmed RoutineStatus = "confirmed"
	RoutineDeclined  RoutineStatus = "declined"
)

type Routine struct {
	ID           int64         `json:"id"`
	VehicleID    int64         `json:"vehicle_id"`
	Status       RoutineStatus `json:"status"`
	Name         string        `json:"name"`
	Weekday      time.Weekday  `json:"weekday"`
	DepartureS   int           `json:"departure_s"`
	TimeZone     string        `json:"time_zone"`
	Origin       Point         `json:"origin"`
	Destination  Point         `json:"destination"`
	Evidence     *Evidence     `json:"evidence"`
	SnoozedUntil *time.Time    `json:"snoozed_until"`
	CreatedAt    time.Time     `json:"created_at"`
	UpdatedAt    time.Time     `json:"updated_at"`
}

type Snapshot struct {
	Settings Settings  `json:"settings"`
	Routines []Routine `json:"routines"`
}

type RoutineInput struct {
	VehicleID   int64        `json:"vehicle_id"`
	Name        string       `json:"name"`
	Weekday     time.Weekday `json:"weekday"`
	DepartureS  int          `json:"departure_s"`
	TimeZone    string       `json:"time_zone"`
	Origin      Point        `json:"origin"`
	Destination Point        `json:"destination"`
}

type SuggestedRoutine struct {
	Routine
	VehicleName string
}
