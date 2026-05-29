package tripplanner

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
	TotalDistanceM    float64 `json:"total_distance_m"`
	TotalDurationS    float64 `json:"total_duration_s"`
	DrivingDurationS  float64 `json:"driving_duration_s"`
	ChargingDurationS float64 `json:"charging_duration_s"`
	TotalEnergyWh     float64 `json:"total_energy_wh"`
	EstimatedCost     float64 `json:"estimated_cost"`
	ArrivalSOC        float64 `json:"arrival_soc"`
	Feasible          bool    `json:"feasible"`
	IsEstimate        bool    `json:"is_estimate"`
}

type tripPlanLeg struct {
	From       tripPlanLocation `json:"from"`
	To         tripPlanLocation `json:"to"`
	DistanceM  float64          `json:"distance_m"`
	DurationS  float64          `json:"duration_s"`
	EnergyWh   float64          `json:"energy_wh"`
	StartSOC   float64          `json:"start_soc"`
	ArrivalSOC float64          `json:"arrival_soc"`
}

type tripChargeStop struct {
	Name            string           `json:"name"`
	Location        tripPlanLocation `json:"location"`
	ChargeFromSOC   float64          `json:"charge_from_soc"`
	ChargeToSOC     float64          `json:"charge_to_soc"`
	ChargeDurationS float64          `json:"charge_duration_s"`
	EnergyWh        float64          `json:"energy_wh"`
	Cost            float64          `json:"cost"`
	IsRecommended   bool             `json:"is_recommended"`
}

type tripWeatherImpact struct {
	AvgTempC         *float64 `json:"avg_temp_c"`
	EfficiencyFactor float64  `json:"efficiency_factor"`
	Note             string   `json:"note"`
}

type tripSOCPoint struct {
	DistanceM float64 `json:"distance_m"`
	SOC       float64 `json:"soc"`
}

type tripPlanResponse struct {
	Route         tripPlanRoute     `json:"route"`
	Legs          []tripPlanLeg     `json:"legs"`
	ChargeStops   []tripChargeStop  `json:"charge_stops"`
	WeatherImpact tripWeatherImpact `json:"weather_impact"`
	SOCCurve      []tripSOCPoint    `json:"soc_curve"`
}

// Exported aliases keep the deterministic planner's typed compute surface
// available to the parent api package while the HTTP handler lives here.
type TripPlanLocation = tripPlanLocation
type TripPlanPreferences = tripPlanPreferences
type TripPlanRequest = tripPlanRequest
type TripPlanRoute = tripPlanRoute
type TripPlanLeg = tripPlanLeg
type TripPlanResponse = tripPlanResponse
