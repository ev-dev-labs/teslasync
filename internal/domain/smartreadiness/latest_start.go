package smartreadiness

import "time"

type LatestStartStatus string

const (
	LatestStartUnavailable  LatestStartStatus = "unavailable"
	LatestStartSufficient   LatestStartStatus = "sufficient"
	LatestStartUnachievable LatestStartStatus = "unachievable"
	LatestStartEstimate     LatestStartStatus = "estimate"
	LatestStartOverdue      LatestStartStatus = "overdue"
)

type LatestStartReason string

const (
	LatestStartReasonUnknownState    LatestStartReason = "unknown_state"
	LatestStartReasonNotCharging     LatestStartReason = "not_charging"
	LatestStartReasonUnknownLocation LatestStartReason = "unknown_location"
	LatestStartReasonOutsideSite     LatestStartReason = "outside_site"
)

type LatestStart struct {
	PlanID              int64                 `json:"plan_id"`
	PlanVersion         int64                 `json:"plan_version"`
	VehicleID           int64                 `json:"vehicle_id"`
	Status              LatestStartStatus     `json:"status"`
	Reason              LatestStartReason     `json:"reason,omitempty"`
	RequiredLowPct      float64               `json:"required_low_pct"`
	RequiredHighPct     float64               `json:"required_high_pct"`
	ChargingPowerW      float64               `json:"charging_power_w"`
	EarliestSafeStartAt *time.Time            `json:"earliest_safe_start_at,omitempty"`
	LatestSafeStartAt   *time.Time            `json:"latest_safe_start_at,omitempty"`
	EarlierCheckAt      *time.Time            `json:"earlier_check_at,omitempty"`
	ObservedAt          *time.Time            `json:"observed_at,omitempty"`
	ExpiresAt           *time.Time            `json:"expires_at,omitempty"`
	TripProjection      *TripProjection       `json:"trip_projection,omitempty"`
	CostComparison      *ChargeCostComparison `json:"cost_comparison,omitempty"`
}

type SiteRateWindow struct {
	PlaceID       int64
	RatePerWh     string
	Currency      string
	EffectiveFrom time.Time
	EffectiveTo   *time.Time
}

type ChargeCostComparison struct {
	LowerRateStartAt time.Time `json:"lower_rate_start_at"`
	RequiredEnergyWh float64   `json:"required_energy_wh"`
	CostNowDecimal   string    `json:"cost_now_decimal"`
	CostLaterDecimal string    `json:"cost_later_decimal"`
	SavingDecimal    string    `json:"saving_decimal"`
	Currency         string    `json:"currency"`
}
