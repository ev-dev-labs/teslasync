// Package smartreadiness defines private charging-readiness plans and decisions.
package smartreadiness

import "time"

type Plan struct {
	ID               int64           `json:"id"`
	VehicleID        int64           `json:"vehicle_id"`
	ChargingPlaceID  *int64          `json:"charging_place_id"`
	Enabled          bool            `json:"enabled"`
	NotifyAt         time.Time       `json:"notify_at"`
	DepartureAt      time.Time       `json:"departure_at"`
	ScheduledStart   *ScheduledStart `json:"scheduled_start,omitempty"`
	TripUseLowPct    float64         `json:"trip_use_low_pct"`
	TripUseHighPct   float64         `json:"trip_use_high_pct"`
	TripLegs         *TripLegs       `json:"trip_legs,omitempty"`
	ReservePct       float64         `json:"reserve_pct"`
	CompareSiteRates bool            `json:"compare_site_rates"`
	SnoozedUntil     *time.Time      `json:"snoozed_until"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
	Subject          string          `json:"-"`
	Version          int64           `json:"version,omitempty"`
}

type ScheduledStart struct {
	At       time.Time `json:"at"`
	TimeZone string    `json:"time_zone"`
}

type TripLegs struct {
	OutboundUseLowPct    float64  `json:"outbound_use_low_pct"`
	OutboundUseHighPct   float64  `json:"outbound_use_high_pct"`
	ReturnUseLowPct      float64  `json:"return_use_low_pct"`
	ReturnUseHighPct     float64  `json:"return_use_high_pct"`
	DestinationChargePct *float64 `json:"destination_charge_pct"`
}

type TripProjection struct {
	StartingBatteryPct      float64  `json:"starting_battery_pct"`
	DestinationLowPct       float64  `json:"destination_low_pct"`
	DestinationHighPct      float64  `json:"destination_high_pct"`
	DestinationReachability string   `json:"destination_reachability"`
	ReturnLowPct            *float64 `json:"return_low_pct"`
	ReturnHighPct           *float64 `json:"return_high_pct"`
	ReturnReachability      string   `json:"return_reachability"`
	DestinationChargePct    *float64 `json:"destination_charge_pct"`
}

type ChargingCurrentLimit struct {
	RequestedA float64 `json:"requested_a"`
	MaximumA   float64 `json:"maximum_a"`
}

type Reason string

const (
	ReasonEligible     Reason = "eligible"
	ReasonDisabled     Reason = "disabled"
	ReasonNotDue       Reason = "not_due"
	ReasonExpired      Reason = "expired"
	ReasonInvalidPlan  Reason = "invalid_plan"
	ReasonUnknownState Reason = "unknown_state"
	ReasonNotParked    Reason = "not_parked"
	ReasonPlugged      Reason = "plugged"
	ReasonOutsideSite  Reason = "outside_site"
	ReasonEnoughCharge Reason = "enough_charge"
	ReasonUnachievable Reason = "unachievable"
)

type DecisionKind string

const (
	DecisionPlugIn           DecisionKind = "plug_in"
	DecisionSlowCharging     DecisionKind = "slow_charging"
	DecisionTripReview       DecisionKind = "trip_review"
	DecisionScheduleConflict DecisionKind = "schedule_conflict"
)

type Decision struct {
	Reason         Reason
	Kind           DecisionKind
	BatteryPct     float64
	ArrivalLowPct  float64
	ArrivalHighPct float64
	ChargingPowerW float64
	CurrentLimit   *ChargingCurrentLimit
	TripProjection *TripProjection
	ObservedAt     time.Time
	ExpiresAt      time.Time
}
