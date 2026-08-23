package batterydegradation

import "time"

type batterySnapshotData struct {
	ID             int64     `json:"id"`
	HealthScore    float64   `json:"health_score"`
	CapacityWh     float64   `json:"capacity_wh"`
	DegradationPct float64   `json:"degradation_pct"`
	EstRangeKm     float64   `json:"est_range_km"`
	CycleCount     int       `json:"cycle_count"`
	AvgCellTempC   float64   `json:"avg_cell_temp_c"`
	CreatedAt      time.Time `json:"created_at"`
}

type degradationPrediction struct {
	SlopePerYear     float64 `json:"slope_per_year"`
	YearsTo80Pct     float64 `json:"years_to_80_pct"`
	PredictedDate    string  `json:"predicted_date"`
	HasEnoughData    bool    `json:"has_enough_data"`
	ProjectionPoints []struct {
		Month  string  `json:"month"`
		Health float64 `json:"health"`
	} `json:"projection_points"`
}

type predictiveProjection struct {
	Date           string  `json:"date"`
	HealthPct      float64 `json:"health_pct"`
	ConfidenceLow  float64 `json:"confidence_low"`
	ConfidenceHigh float64 `json:"confidence_high"`
}

type riskFactor struct {
	Name   string `json:"name"`
	Score  int    `json:"score"`
	Label  string `json:"label"`
	Detail string `json:"detail"`
}

type regressionResult struct {
	Prediction   degradationPrediction
	Projections  []predictiveProjection
	RatePerMonth float64
}

type chargingHabits struct {
	FastChargeCount     int     `json:"fast_charge_count"`
	SlowChargeCount     int     `json:"slow_charge_count"`
	DeepDischargeCount  int     `json:"deep_discharge_count"`
	ChargeToFullCount   int     `json:"charge_to_full_count"`
	HighSocCount        int     `json:"high_soc_count"`
	AvgEnergyPerSession float64 `json:"avg_energy_per_session"`
	TotalCount          int     `json:"total_count"`
}

type batteryHealthHistoryPoint struct {
	Date       string  `json:"date"`
	OdometerM  float64 `json:"odometer_m"`
	SohPct     float64 `json:"soh_pct"`
	CapacityWh float64 `json:"capacity_wh"`
	RangeM     float64 `json:"range_m"`
}

type chargeLevelBucket struct {
	MinSocPct  int `json:"min_soc_pct"`
	MaxSocPct  int `json:"max_soc_pct"`
	StartCount int `json:"start_count"`
	EndCount   int `json:"end_count"`
}

type batteryChargingAnalysis struct {
	ChargeLevelDistribution []chargeLevelBucket `json:"charge_level_distribution"`
	AvgStartSocPct          *float64            `json:"avg_start_soc_pct"`
	AvgEndSocPct            *float64            `json:"avg_end_soc_pct"`
	ACSessionCount          int                 `json:"ac_session_count"`
	DCSessionCount          int                 `json:"dc_session_count"`
	SuperchargerCount       int                 `json:"supercharger_count"`
	DCFastCount             int                 `json:"dc_fast_count"`
	DeepDischargeCount      int                 `json:"deep_discharge_count"`
	ACEnergyWh              float64             `json:"ac_energy_wh"`
	DCEnergyWh              float64             `json:"dc_energy_wh"`
	TotalSessions           int                 `json:"total_sessions"`
}

type batteryHealthResponse struct {
	VehicleID                 int64                       `json:"vehicle_id"`
	CurrentSoh                float64                     `json:"current_soh"`
	EstimatedCapacityWh       float64                     `json:"estimated_capacity_wh"`
	OriginalCapacityWh        float64                     `json:"original_capacity_wh"`
	DegradationRatePctPerYear float64                     `json:"degradation_rate_pct_per_year"`
	BatteryAgeMonths          int                         `json:"battery_age_months"`
	TotalCycles               int                         `json:"total_cycles"`
	AvgDepthOfDischargePct    float64                     `json:"avg_depth_of_discharge_pct"`
	FastChargePct             float64                     `json:"fast_charge_pct"`
	FullChargePct             float64                     `json:"full_charge_pct"`
	ChargeHabitsScore         float64                     `json:"charge_habits_score"`
	StressLevel               string                      `json:"stress_level"`
	TempExposureScore         *int                        `json:"temp_exposure_score"`
	TempExposureReason        *string                     `json:"temp_exposure_reason"`
	History                   []batteryHealthHistoryPoint `json:"history"`
	Prediction                degradationPrediction       `json:"prediction"`
	Projections               []predictiveProjection      `json:"projections"`
	ChargingHabits            chargingHabits              `json:"charging_habits"`
	RiskFactors               []riskFactor                `json:"risk_factors"`
	Recommendations           []string                    `json:"recommendations"`
	ChargingAnalysis          batteryChargingAnalysis     `json:"charging_analysis"`
	CapacitySource            string                      `json:"capacity_source"`
}

// monthlyTrend holds monthly aggregation of battery health data.
type monthlyTrend struct {
	Month          string  `json:"month"`
	AvgHealth      float64 `json:"avg_health"`
	AvgCapacity    float64 `json:"avg_capacity"`
	AvgDegradation float64 `json:"avg_degradation"`
	AvgRange       float64 `json:"avg_range"`
	MaxCycles      int     `json:"max_cycles"`
	AvgCellTemp    float64 `json:"avg_cell_temp"`
}
