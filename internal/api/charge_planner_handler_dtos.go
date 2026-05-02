package api

import (
	"time"
)

// ── Request/Response types ───────────────────────────────────

type optimizeRequest struct {
	VehicleID       int64   `json:"vehicle_id"`
	TargetSOC       int     `json:"target_soc"`
	DepartBy        string  `json:"depart_by"` // RFC3339
	RatePlanID      string  `json:"rate_plan_id"`
	MaxAmps         int     `json:"max_amps"`
	BatteryCapacity float64 `json:"battery_capacity_kwh"` // optional, default 75
	ChargerVoltage  int     `json:"charger_voltage"`      // optional, default 240
	PreferOffPeak   bool    `json:"prefer_off_peak"`
}

type chargeWindow struct {
	StartTime    time.Time `json:"start_time"`
	EndTime      time.Time `json:"end_time"`
	RateCentsKWh float64   `json:"rate_cents_kwh"`
	EstCost      float64   `json:"estimated_cost"`
	RateTier     string    `json:"rate_tier"`
}

type costComparison struct {
	ChargeNowCost float64 `json:"charge_now_cost"`
	OptimizedCost float64 `json:"optimized_cost"`
	Savings       float64 `json:"savings"`
	SavingsPct    float64 `json:"savings_percent"`
}

type optimizeResponse struct {
	PlanID           int64          `json:"plan_id"`
	CurrentSOC       int            `json:"current_soc"`
	TargetSOC        int            `json:"target_soc"`
	KWhNeeded        float64        `json:"kwh_needed"`
	EstDurationHours float64        `json:"estimated_duration_hours"`
	Schedule         chargeWindow   `json:"schedule"`
	Comparison       costComparison `json:"comparison"`
	Alternatives     []chargeWindow `json:"alternative_windows"`
	HourlyRates      []hourlyRate   `json:"hourly_rates"`
}

type hourlyRate struct {
	Hour      int     `json:"hour"`
	RateCents float64 `json:"rate_cents"`
	Tier      string  `json:"tier"`
}

type applyRequest struct {
	PlanID int64 `json:"plan_id"`
}
