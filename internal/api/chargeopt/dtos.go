package chargeopt

type optimizerResponse struct {
	CurrentSchedule    currentSchedule `json:"current_schedule"`
	CostAnalysis       costAnalysis    `json:"cost_analysis"`
	BatteryHealthScore int             `json:"battery_health_score"`
	Recommendations    []optimizerRec  `json:"recommendations"`
	WeeklyHeatmap      []heatmapEntry  `json:"weekly_heatmap"`
}

type currentSchedule struct {
	MostCommonStartHour int     `json:"most_common_start_hour"`
	MostCommonDay       string  `json:"most_common_day"`
	AvgSessionsPerWeek  float64 `json:"avg_sessions_per_week"`
	HomeChargingPct     float64 `json:"home_charging_pct"`
	AvgChargeToPct      float64 `json:"avg_charge_to_pct"`
}

type costAnalysis struct {
	PeakHours               []int   `json:"peak_hours"`
	OffpeakHours            []int   `json:"offpeak_hours"`
	PeakCostPerKWh          float64 `json:"peak_cost_per_kwh"`
	OffpeakCostPerKWh       float64 `json:"offpeak_cost_per_kwh"`
	SessionsDuringPeakPct   float64 `json:"sessions_during_peak_pct"`
	PotentialMonthlySavings float64 `json:"potential_monthly_savings"`
}

type optimizerRec struct {
	Type             string  `json:"type"`
	Priority         string  `json:"priority"`
	Title            string  `json:"title"`
	Detail           string  `json:"detail"`
	EstimatedSavings float64 `json:"estimated_savings,omitempty"`
}

type heatmapEntry struct {
	Day           int     `json:"day"`
	Hour          int     `json:"hour"`
	Sessions      int     `json:"sessions"`
	AvgCostPerKWh float64 `json:"avg_cost_per_kwh"`
}
