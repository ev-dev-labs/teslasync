package advancedintelligence

import "time"

type ReadinessEvidence struct {
	VehicleID                int64
	ChargingSampleCount      int
	ChargingSuccessCount     int
	ChargingLatestAt         *time.Time
	MaintenanceSampleCount   int
	ActiveMaintenanceCount   int
	CriticalMaintenanceCount int
	MaintenanceLatestAt      *time.Time
	LatestTelemetryAt        *time.Time
}

type JourneyAssuranceRequest struct {
	VehicleID        int64     `json:"vehicle_id"`
	RouteDistanceM   float64   `json:"route_distance_m"`
	DepartureAt      time.Time `json:"departure_at"`
	ReserveTargetPct float64   `json:"reserve_target_pct"`
	OutsideTempC     *float64  `json:"outside_temp_c"`
	AverageSpeedMps  *float64  `json:"average_speed_mps"`
	AuxiliaryLoadW   *float64  `json:"auxiliary_load_w"`
	Confirmed        bool      `json:"confirmed"`
}

type ReadinessFactor struct {
	Factor      string   `json:"factor"`
	Status      string   `json:"status"`
	ScorePct    *float64 `json:"score_pct"`
	Explanation string   `json:"explanation"`
}

type JourneyAssuranceResponse struct {
	VehicleID         int64             `json:"vehicle_id"`
	ReadinessScorePct *float64          `json:"readiness_score_pct"`
	ArrivalSocLowPct  *float64          `json:"arrival_soc_low_pct"`
	ArrivalSocHighPct *float64          `json:"arrival_soc_high_pct"`
	EnergyRequiredWh  *float64          `json:"energy_required_wh"`
	Factors           []ReadinessFactor `json:"factors"`
	DataQuality       DataQuality       `json:"data_quality"`
	Evidence          []Evidence        `json:"evidence"`
	Limitations       []string          `json:"limitations"`
	GeneratedAt       time.Time         `json:"generated_at"`
}

type ChargingSiteTwinRequest struct {
	VehicleID           int64    `json:"vehicle_id"`
	ChargerCount        int      `json:"charger_count"`
	ChargerPowerW       float64  `json:"charger_power_w"`
	PanelLimitW         float64  `json:"panel_limit_w"`
	ArrivalRatePerS     float64  `json:"arrival_rate_per_s"`
	MeanServiceS        float64  `json:"mean_service_s"`
	ArrivalDistribution string   `json:"arrival_distribution"`
	ServiceDistribution string   `json:"service_distribution"`
	SolarPowerW         *float64 `json:"solar_power_w"`
	StorageEnergyWh     *float64 `json:"storage_energy_wh"`
	FleetGrowthPct      float64  `json:"fleet_growth_pct"`
	Confirmed           bool     `json:"confirmed"`
}

type RankedMitigation struct {
	Rank          int     `json:"rank"`
	Mitigation    string  `json:"mitigation"`
	QueueDeltaPct float64 `json:"queue_delta_pct"`
	PeakDeltaW    float64 `json:"peak_delta_w"`
	Assumption    string  `json:"assumption"`
}

type ChargingSiteTwinResponse struct {
	VehicleID          int64              `json:"vehicle_id"`
	UtilizationPct     float64            `json:"utilization_pct"`
	QueueWaitP50S      *int64             `json:"queue_wait_p50_s"`
	QueueWaitP90S      *int64             `json:"queue_wait_p90_s"`
	PeakDemandW        float64            `json:"peak_demand_w"`
	PanelConstraintPct float64            `json:"panel_constraint_pct"`
	ProjectedUnstable  bool               `json:"projected_unstable"`
	Mitigations        []RankedMitigation `json:"mitigations"`
	Assumptions        []string           `json:"assumptions"`
	DataQuality        DataQuality        `json:"data_quality"`
	Evidence           []Evidence         `json:"evidence"`
	Limitations        []string           `json:"limitations"`
	GeneratedAt        time.Time          `json:"generated_at"`
}

type ResiliencePlanRequest struct {
	VehicleID                 int64   `json:"vehicle_id"`
	VehicleEnergyWh           float64 `json:"vehicle_energy_wh"`
	StationaryStorageWh       float64 `json:"stationary_storage_wh"`
	ExpectedSolarWh           float64 `json:"expected_solar_wh"`
	EssentialLoadW            float64 `json:"essential_load_w"`
	OutageDurationS           int64   `json:"outage_duration_s"`
	EvacuationReserveWh       float64 `json:"evacuation_reserve_wh"`
	RestorationUncertaintyPct float64 `json:"restoration_uncertainty_pct"`
	Confirmed                 bool    `json:"confirmed"`
}

type ResilienceTimelinePoint struct {
	TimeS             int64   `json:"time_s"`
	RemainingEnergyWh float64 `json:"remaining_energy_wh"`
	Risk              string  `json:"risk"`
}

type LoadPriority struct {
	Priority int    `json:"priority"`
	Load     string `json:"load"`
	Action   string `json:"action"`
}

type ResiliencePlanResponse struct {
	VehicleID        int64                     `json:"vehicle_id"`
	SurvivalHorizonS int64                     `json:"survival_horizon_s"`
	RiskTimeline     []ResilienceTimelinePoint `json:"risk_timeline"`
	LoadPriorities   []LoadPriority            `json:"load_priorities"`
	Recommendations  []string                  `json:"recommendations"`
	DataQuality      DataQuality               `json:"data_quality"`
	Evidence         []Evidence                `json:"evidence"`
	Limitations      []string                  `json:"limitations"`
	GeneratedAt      time.Time                 `json:"generated_at"`
}
