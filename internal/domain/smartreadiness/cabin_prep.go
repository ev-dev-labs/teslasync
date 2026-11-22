package smartreadiness

import "time"

type CabinPrepEpisode struct {
	LastOffAt       time.Time
	FirstOnAt       time.Time
	LastOutOfBandAt time.Time
	FirstInBandAt   time.Time
	InitialCabinC   float64
	OutsideC        float64
	TargetC         float64
}

type CabinPrepConditions struct {
	ObservedAt time.Time
	CabinC     float64
	OutsideC   float64
	HVACOn     bool
	Parked     bool
}

type CabinPrepEstimate struct {
	ComparableMornings int       `json:"comparable_mornings"`
	LeadLowS           int       `json:"lead_low_s"`
	LeadHighS          int       `json:"lead_high_s"`
	TargetC            float64   `json:"target_c"`
	ObservedAt         time.Time `json:"observed_at"`
}

type CabinPrepPlan struct {
	ID          int64              `json:"id"`
	VehicleID   int64              `json:"vehicle_id"`
	DepartureAt time.Time          `json:"departure_at"`
	TimeZone    string             `json:"time_zone"`
	TargetC     float64            `json:"target_c"`
	DeviceID    int64              `json:"push_device_id"`
	DeviceReady bool               `json:"push_device_ready"`
	Reason      CabinPrepReason    `json:"reason,omitempty"`
	Estimate    *CabinPrepEstimate `json:"estimate,omitempty"`
	ExpiresAt   *time.Time         `json:"expires_at,omitempty"`
	Forecast    *CabinPrepForecast `json:"-"`
}

type CabinPrepSetup struct {
	DepartureAt time.Time `json:"departure_at"`
	TimeZone    string    `json:"time_zone"`
	TargetC     float64   `json:"target_c"`
	DeviceID    int64     `json:"push_device_id"`
	PushTitle   string    `json:"push_title"`
	PushBody    string    `json:"push_body"`
}

type CabinPrepForecast struct {
	CabinPrepEstimate
	CabinC   float64
	OutsideC float64
}

type CabinPrepReason string

const (
	CabinPrepEligible      CabinPrepReason = "eligible"
	CabinPrepInvalidPlan   CabinPrepReason = "invalid_plan"
	CabinPrepUnknownState  CabinPrepReason = "unknown_state"
	CabinPrepAlreadyActive CabinPrepReason = "already_active"
	CabinPrepComfortable   CabinPrepReason = "within_comfort_band"
	CabinPrepInsufficient  CabinPrepReason = "insufficient_comparable_mornings"
	CabinPrepVariable      CabinPrepReason = "variable_prep_time"
	CabinPrepDeparted      CabinPrepReason = "departure_observed"
	CabinPrepChanged       CabinPrepReason = "changed_conditions"
	CabinPrepExpired       CabinPrepReason = "expired"
)
