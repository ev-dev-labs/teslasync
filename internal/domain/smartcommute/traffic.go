package smartcommute

import "time"

const MaxTrafficTracePoints = 200

type TrafficPreview struct {
	DriveID     int64   `json:"drive_id"`
	Trace       []Point `json:"trace"`
	Fingerprint string  `json:"fingerprint"`
}

type TrafficConsentInput struct {
	VehicleID     int64
	RoutineID     int64
	DriveID       int64
	Fingerprint   string
	ShareWithHERE bool
	LeadS         int
	MinSavingsS   int64
}

type TrafficConsent struct {
	Trace       []Point
	LeadS       int
	MinSavingsS int64
	CheckAt     time.Time
	DepartureAt time.Time
}

type TrafficConsentSummary struct {
	LeadS       int   `json:"lead_s"`
	MinSavingsS int64 `json:"min_savings_s"`
	CanSkip     bool  `json:"can_skip_today"`
}

type TrafficQuery struct {
	// Trace is the user-approved representative route, not automatically selected drive history.
	Trace       []Point
	DepartureAt time.Time
}

type TrafficEstimate struct {
	DurationS     int64
	FlowUpdatedAt time.Time
}

type TrafficComparison struct {
	Usual       TrafficEstimate
	Alternative TrafficEstimate
}

type TrafficDecision struct {
	RoutineID    int64     `json:"routine_id"`
	VehicleID    int64     `json:"vehicle_id"`
	RoutineName  string    `json:"routine_name"`
	VehicleName  string    `json:"vehicle_name"`
	DepartureAt  time.Time `json:"departure_at"`
	UsualS       int64     `json:"usual_s"`
	AlternativeS int64     `json:"alternative_s"`
	ObservedAt   time.Time `json:"observed_at"`
	ExpiresAt    time.Time `json:"expires_at"`
	Origin       Point     `json:"-"`
}
