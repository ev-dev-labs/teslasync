package smartreadiness

import "time"

type ParkReserveEpisode struct {
	StartObservedAt time.Time
	EndObservedAt   time.Time
	StartBatteryPct float64
	EndBatteryPct   float64
	StartOutsideC   float64
	EndOutsideC     float64
	SentryMode      string
}

type ParkReserveConditions struct {
	ObservedAt time.Time
	BatteryPct float64
	OutsideC   float64
	SentryMode string
	Parked     bool
	Unplugged  bool
}

type ParkReserveEstimate struct {
	ObservedAt         time.Time `json:"observed_at"`
	ComparableEpisodes int       `json:"comparable_episodes"`
	StartBatteryPct    float64   `json:"start_battery_pct"`
	ReturnLowPct       int       `json:"return_low_pct"`
	ReturnHighPct      int       `json:"return_high_pct"`
	ReserveRisk        bool      `json:"reserve_risk"`
}

type ParkReserveSetup struct {
	ReturnAt   time.Time `json:"return_at"`
	ReservePct float64   `json:"reserve_pct"`
	DeviceID   *int64    `json:"push_device_id,omitempty"`
	PushTitle  string    `json:"push_title,omitempty"`
	PushBody   string    `json:"push_body,omitempty"`
}

type ParkReservePlan struct {
	ID          int64                `json:"id"`
	VehicleID   int64                `json:"vehicle_id"`
	CreatedAt   time.Time            `json:"created_at"`
	ReturnAt    time.Time            `json:"return_at"`
	ActionUntil time.Time            `json:"action_until"`
	ReservePct  float64              `json:"reserve_pct"`
	DeviceID    *int64               `json:"push_device_id,omitempty"`
	DeviceReady bool                 `json:"push_device_ready"`
	Reason      ParkReserveReason    `json:"reason,omitempty"`
	Estimate    *ParkReserveEstimate `json:"estimate,omitempty"`
	Forecast    *ParkReserveForecast `json:"-"`
}

type ParkReserveForecast struct {
	ParkReserveEstimate
	OutsideC   float64
	SentryMode string
}

type ParkReserveReason string

const (
	ParkReserveInvalidPlan  ParkReserveReason = "invalid_plan"
	ParkReserveUnknownState ParkReserveReason = "unknown_state"
	ParkReserveInsufficient ParkReserveReason = "insufficient_comparable_parks"
	ParkReserveAbove        ParkReserveReason = "reserve_not_crossed"
	ParkReserveAlreadyLow   ParkReserveReason = "already_below_reserve"
	ParkReserveAtRisk       ParkReserveReason = "estimated_reserve_crossing"
	ParkReserveChanged      ParkReserveReason = "park_conditions_changed"
	ParkReserveExpired      ParkReserveReason = "expired"
)
