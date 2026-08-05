package advancedintelligence

import "time"

type SurvivalEvidence struct {
	VehicleID                int64
	DriveSampleCount         int
	ExposureDistanceM        *float64
	ExposureS                *int64
	TireEventCount           int
	BrakeEventCount          int
	BatteryEventCount        int
	ChargingSystemEventCount int
	LatestObservedAt         *time.Time
}

type CompetingRisk struct {
	Risk           string   `json:"risk"`
	ProbabilityPct *float64 `json:"probability_pct"`
	EvidenceCount  int      `json:"evidence_count"`
}

type InterventionSensitivity struct {
	Intervention          string  `json:"intervention"`
	AssumedHazardDeltaPct float64 `json:"assumed_hazard_delta_pct"`
	AdjustedP50S          *int64  `json:"adjusted_p50_s"`
}

type ComponentSurvival struct {
	VehicleID              int64                   `json:"vehicle_id"`
	Component              string                  `json:"component"`
	SurvivalProbabilityPct *float64                `json:"survival_probability_pct"`
	HorizonP10S            *int64                  `json:"horizon_p10_s"`
	HorizonP50S            *int64                  `json:"horizon_p50_s"`
	HorizonP90S            *int64                  `json:"horizon_p90_s"`
	CompetingRisks         []CompetingRisk         `json:"competing_risks"`
	Intervention           InterventionSensitivity `json:"intervention_sensitivity"`
	DataQuality            DataQuality             `json:"data_quality"`
	Evidence               []Evidence              `json:"evidence"`
	Limitations            []string                `json:"limitations"`
	GeneratedAt            time.Time               `json:"generated_at"`
}

type HazardEvidence struct {
	HazardType       string
	Severity         string
	ObservationCount int
	LastSeen         time.Time
	CoarseCell       *string
}

type HazardCluster struct {
	HazardType       string     `json:"hazard_type"`
	Severity         string     `json:"severity"`
	ConfidencePct    float64    `json:"confidence_pct"`
	ObservationCount int        `json:"observation_count"`
	CoarseCell       string     `json:"coarse_cell"`
	LastSeen         time.Time  `json:"last_seen"`
	Evidence         []Evidence `json:"evidence"`
}

type HazardPage struct {
	Page[HazardCluster]
	DataQuality DataQuality `json:"data_quality"`
	Limitations []string    `json:"limitations"`
	GeneratedAt time.Time   `json:"generated_at"`
}

type SentinelEvidence struct {
	VehicleID            int64
	CommandSampleCount   int
	CommandFailureCount  int
	RecentCommandCount   int
	RecentFailureCount   int
	PriorCommandCount    int
	PriorFailureCount    int
	MaxCommandsPerMinute int
	RecentIdentityCount  int
	PriorIdentityCount   int
	TelemetrySampleCount int
	MaxTelemetryGapS     *int64
	LatestCommandAt      *time.Time
	LatestTelemetryAt    *time.Time
}

type SentinelFinding struct {
	FindingType   string     `json:"finding_type"`
	Severity      string     `json:"severity"`
	ConfidencePct float64    `json:"confidence_pct"`
	Explanation   string     `json:"explanation"`
	ObservedAt    *time.Time `json:"observed_at"`
	Evidence      []Evidence `json:"evidence"`
	Limitations   []string   `json:"limitations"`
}

type SentinelPage struct {
	Page[SentinelFinding]
	DataQuality DataQuality `json:"data_quality"`
	Limitations []string    `json:"limitations"`
	GeneratedAt time.Time   `json:"generated_at"`
}

type ChargingSessionEvidence struct {
	SessionID         int64
	StartedAt         time.Time
	EndedAt           *time.Time
	VehicleEnergyWh   *float64
	DeltaSocPct       *float64
	RecordedCostMinor *int64
	Currency          *string
}

type ChargingForensicsItem struct {
	SessionID            int64      `json:"session_id"`
	StartedAt            time.Time  `json:"started_at"`
	EndedAt              *time.Time `json:"ended_at"`
	VehicleEnergyWh      *float64   `json:"vehicle_energy_wh"`
	MeterEnergyWh        *float64   `json:"meter_energy_wh"`
	EstimatedLossWh      *float64   `json:"estimated_loss_wh"`
	EstimatedLossLowWh   *float64   `json:"estimated_loss_low_wh"`
	EstimatedLossHighWh  *float64   `json:"estimated_loss_high_wh"`
	RecordedCostMinor    *int64     `json:"recorded_cost_minor"`
	ExpectedCostMinor    *int64     `json:"expected_cost_minor"`
	CostDiscrepancyMinor *int64     `json:"cost_discrepancy_minor"`
	Currency             *string    `json:"currency"`
	Status               string     `json:"status"`
	Evidence             []Evidence `json:"evidence"`
	Limitations          []string   `json:"limitations"`
}

type ChargingForensicsPage struct {
	Page[ChargingForensicsItem]
	DataQuality DataQuality `json:"data_quality"`
	GeneratedAt time.Time   `json:"generated_at"`
}
