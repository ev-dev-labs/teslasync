package smartreadiness

import "time"

type ClimateScheduleVersion struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Cron      string    `json:"cron"`
	TimeZone  string    `json:"time_zone"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ClimateScheduleRun struct {
	FiredAt     time.Time
	TriggeredAt time.Time
	CompletedAt time.Time
}

type ClimateScheduleObservation struct {
	FiredAt    time.Time `json:"fired_at"`
	ClimateOn  time.Time `json:"climate_on_at"`
	VerifiedTo time.Time `json:"verified_to"`
}

type ClimateScheduleReview struct {
	WeekOf       time.Time                    `json:"week_of"`
	ExpiresAt    time.Time                    `json:"expires_at"`
	Observations []ClimateScheduleObservation `json:"-"`
}

type ClimateScheduleEvidence struct {
	WeekOf          time.Time   `json:"week_of"`
	ExpiresAt       time.Time   `json:"expires_at"`
	ObservedThrough time.Time   `json:"observed_through"`
	RunTimes        []time.Time `json:"run_times"`
}

type ClimateSchedulePlan struct {
	ID           int64                    `json:"id"`
	AutomationID int64                    `json:"automation_id"`
	Current      bool                     `json:"current"`
	Evidence     *ClimateScheduleEvidence `json:"evidence,omitempty"`
}

type ClimateScheduleSettings struct {
	Options []ClimateScheduleVersion `json:"options"`
	Plan    *ClimateSchedulePlan     `json:"plan,omitempty"`
}
