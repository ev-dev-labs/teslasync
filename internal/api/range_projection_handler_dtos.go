package api

type rangeFactor struct {
	Name        string  `json:"name"`
	ImpactPct   float64 `json:"impact_pct"`
	Description string  `json:"description"`
}

type curvePoint struct {
	BatteryPct     int     `json:"battery_pct"`
	RatedRange     float64 `json:"rated_range"`
	ProjectedRange float64 `json:"projected_range"`
}

type efficiencyBucket struct {
	TempBucket  string  `json:"temp_bucket"`
	SpeedBucket string  `json:"speed_bucket"`
	WhKm        float64 `json:"wh_km"`
	Samples     int     `json:"samples"`
}

type rangeScenario struct {
	Name        string   `json:"name"`
	SpeedKmh    int      `json:"speed_kmh"`
	TempC       int      `json:"temp_c"`
	EffWhKm     float64  `json:"efficiency_wh_km"`
	RangeKm     float64  `json:"range_km"`
	RangeMi     float64  `json:"range_mi"`
	SampleCount int      `json:"sample_count"`
	Extras      []string `json:"extras"`
	IsCurrent   bool     `json:"is_current,omitempty"`
}
