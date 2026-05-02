package api

// ── Request / Response types ────────────────────────────────────────────

type tripPlanLocation struct {
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
	Name string  `json:"name"`
}

type tripPlanPreferences struct {
	MaxChargeStops     int     `json:"max_charge_stops"`
	SpeedFactor        float64 `json:"speed_factor"` // 1.0 = normal, >1 faster, <1 slower
	IncludeWeather     bool    `json:"include_weather"`
	PreferSupercharger bool    `json:"prefer_superchargers"`
}

type tripPlanRequest struct {
	VehicleID      int64               `json:"vehicle_id"`
	Origin         tripPlanLocation    `json:"origin"`
	Destination    tripPlanLocation    `json:"destination"`
	Waypoints      []tripPlanLocation  `json:"waypoints"`
	CurrentSOC     float64             `json:"current_soc"`
	ChargeLimitSOC float64             `json:"charge_limit_soc"`
	MinArrivalSOC  float64             `json:"min_arrival_soc"`
	DepartureTime  string              `json:"departure_time"`
	Preferences    tripPlanPreferences `json:"preferences"`
}

type tripPlanRoute struct {
	TotalDistanceKm     float64 `json:"total_distance_km"`
	TotalDurationMin    float64 `json:"total_duration_min"`
	DrivingDurationMin  float64 `json:"driving_duration_min"`
	ChargingDurationMin float64 `json:"charging_duration_min"`
	TotalEnergyKWh      float64 `json:"total_energy_kwh"`
	EstimatedCost       float64 `json:"estimated_cost"`
	ArrivalSOC          float64 `json:"arrival_soc"`
	Feasible            bool    `json:"feasible"`
	IsEstimate          bool    `json:"is_estimate"`
}

type tripPlanLeg struct {
	From        tripPlanLocation `json:"from"`
	To          tripPlanLocation `json:"to"`
	DistanceKm  float64          `json:"distance_km"`
	DurationMin float64          `json:"duration_min"`
	EnergyKWh   float64          `json:"energy_kwh"`
	StartSOC    float64          `json:"start_soc"`
	ArrivalSOC  float64          `json:"arrival_soc"`
}

type tripChargeStop struct {
	Name              string           `json:"name"`
	Location          tripPlanLocation `json:"location"`
	ChargeFromSOC     float64          `json:"charge_from_soc"`
	ChargeToSOC       float64          `json:"charge_to_soc"`
	ChargeDurationMin float64          `json:"charge_duration_min"`
	EnergyKWh         float64          `json:"energy_kwh"`
	Cost              float64          `json:"cost"`
	IsRecommended     bool             `json:"is_recommended"`
}

type tripWeatherImpact struct {
	AvgTempC         *float64 `json:"avg_temp_c"`
	EfficiencyFactor float64  `json:"efficiency_factor"`
	Note             string   `json:"note"`
}

type tripSOCPoint struct {
	DistanceKm float64 `json:"distance_km"`
	SOC        float64 `json:"soc"`
}

type tripPlanResponse struct {
	Route         tripPlanRoute     `json:"route"`
	Legs          []tripPlanLeg     `json:"legs"`
	ChargeStops   []tripChargeStop  `json:"charge_stops"`
	WeatherImpact tripWeatherImpact `json:"weather_impact"`
	SOCCurve      []tripSOCPoint    `json:"soc_curve"`
}
