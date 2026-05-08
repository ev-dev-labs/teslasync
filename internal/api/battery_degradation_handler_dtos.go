package api

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
