package advancedintelligence

import "time"

type LocalTrainingAggregate struct {
	SampleCount  int
	MetricWhPerM *float64
	ObservedAt   *time.Time
}

type FederatedModelCard struct {
	ID                 int64     `json:"id"`
	VehicleID          int64     `json:"vehicle_id"`
	ModelName          string    `json:"model_name"`
	ModelVersion       string    `json:"model_version"`
	Task               string    `json:"task"`
	Version            int       `json:"version"`
	EpsilonBudget      float64   `json:"epsilon_budget"`
	EpsilonSpent       float64   `json:"epsilon_spent"`
	RoundCount         int       `json:"round_count"`
	LatestSampleCount  *int      `json:"latest_sample_count"`
	LatestMetricWhPerM *float64  `json:"latest_metric_wh_per_m"`
	LatestStatus       *string   `json:"latest_status"`
	UpdatedAt          time.Time `json:"updated_at"`
	Limitations        []string  `json:"limitations"`
}

type FederatedRound struct {
	ID                int64      `json:"id"`
	ModelCardID       int64      `json:"model_card_id"`
	RoundNumber       int        `json:"round_number"`
	RequestedEpsilon  float64    `json:"requested_epsilon"`
	EpsilonSpent      float64    `json:"epsilon_spent"`
	SampleCount       int        `json:"sample_count"`
	LocalMetricWhPerM *float64   `json:"local_metric_wh_per_m"`
	ClippedUpdatePct  *float64   `json:"clipped_update_pct"`
	Status            string     `json:"status"`
	StartedAt         time.Time  `json:"started_at"`
	CompletedAt       *time.Time `json:"completed_at"`
}

type FederatedStatusPage struct {
	Page[FederatedModelCard]
	VehicleID          int64       `json:"vehicle_id"`
	TotalEpsilonBudget float64     `json:"total_epsilon_budget"`
	TotalEpsilonSpent  float64     `json:"total_epsilon_spent"`
	PrivacyStatement   string      `json:"privacy_statement"`
	DataQuality        DataQuality `json:"data_quality"`
	Evidence           []Evidence  `json:"evidence"`
	GeneratedAt        time.Time   `json:"generated_at"`
}

type StartFederatedRoundRequest struct {
	VehicleID       int64   `json:"vehicle_id"`
	ModelName       string  `json:"model_name"`
	ModelVersion    string  `json:"model_version"`
	Task            string  `json:"task"`
	Epsilon         float64 `json:"epsilon"`
	EpsilonBudget   float64 `json:"epsilon_budget"`
	ExpectedVersion int     `json:"expected_version"`
	Confirmed       bool    `json:"confirmed"`
}

type FederatedRoundResult struct {
	ModelCard   FederatedModelCard `json:"model_card"`
	Round       FederatedRound     `json:"round"`
	DataQuality DataQuality        `json:"data_quality"`
	Evidence    []Evidence         `json:"evidence"`
}

type CausalMetric string

const (
	CausalDriveEnergyWhPerM  CausalMetric = "drive_energy_wh_per_m"
	CausalChargingSuccessPct CausalMetric = "charging_success_pct"
	CausalAverageSpeedMps    CausalMetric = "average_speed_mps"
)

func (m CausalMetric) Valid() bool {
	switch m {
	case CausalDriveEnergyWhPerM, CausalChargingSuccessPct, CausalAverageSpeedMps:
		return true
	default:
		return false
	}
}

type MetricWindowEvidence struct {
	SampleCount           int
	MetricValue           *float64
	ConfounderCoveragePct *float64
	AmbientTempC          *float64
}

type CausalExperiment struct {
	ID                    int64        `json:"id"`
	VehicleID             int64        `json:"vehicle_id"`
	InterventionKind      string       `json:"intervention_kind"`
	Metric                CausalMetric `json:"metric"`
	BaselineStart         time.Time    `json:"baseline_start"`
	BaselineEnd           time.Time    `json:"baseline_end"`
	TreatmentStart        time.Time    `json:"treatment_start"`
	TreatmentEnd          time.Time    `json:"treatment_end"`
	State                 string       `json:"state"`
	Version               int          `json:"version"`
	BaselineSampleCount   int          `json:"baseline_sample_count"`
	TreatmentSampleCount  int          `json:"treatment_sample_count"`
	ConfounderCoveragePct *float64     `json:"confounder_coverage_pct"`
	BaselineEnergyWhPerM  *float64     `json:"baseline_energy_wh_per_m"`
	TreatmentEnergyWhPerM *float64     `json:"treatment_energy_wh_per_m"`
	EffectEnergyWhPerM    *float64     `json:"effect_energy_wh_per_m"`
	BaselineSuccessPct    *float64     `json:"baseline_success_pct"`
	TreatmentSuccessPct   *float64     `json:"treatment_success_pct"`
	EffectSuccessPct      *float64     `json:"effect_success_pct"`
	BaselineSpeedMps      *float64     `json:"baseline_speed_mps"`
	TreatmentSpeedMps     *float64     `json:"treatment_speed_mps"`
	EffectSpeedMps        *float64     `json:"effect_speed_mps"`
	CreatedAt             time.Time    `json:"created_at"`
	UpdatedAt             time.Time    `json:"updated_at"`
	DataQuality           DataQuality  `json:"data_quality"`
	Evidence              []Evidence   `json:"evidence"`
	Limitations           []string     `json:"limitations"`
}

type CreateCausalExperimentRequest struct {
	VehicleID        int64        `json:"vehicle_id"`
	InterventionKind string       `json:"intervention_kind"`
	Metric           CausalMetric `json:"metric"`
	BaselineStart    time.Time    `json:"baseline_start"`
	BaselineEnd      time.Time    `json:"baseline_end"`
	TreatmentStart   time.Time    `json:"treatment_start"`
	TreatmentEnd     time.Time    `json:"treatment_end"`
	Confirmed        bool         `json:"confirmed"`
}

type TCOEvidence struct {
	DriveSampleCount        int
	DistanceM               *float64
	HomeChargeSampleCount   int
	PublicChargeSampleCount int
	HomeEnergyWh            *float64
	PublicEnergyWh          *float64
	HomeCostMinor           *int64
	PublicCostMinor         *int64
	MaintenanceCostMinor    *int64
	ChargingSampleCount     int
	ChargingSuccessCount    int
	ObservedAt              *time.Time
}

type TCOOptimizerRequest struct {
	VehicleID         int64   `json:"vehicle_id"`
	HorizonS          int64   `json:"horizon_s"`
	AnnualDistanceM   float64 `json:"annual_distance_m"`
	HomeChargingPct   float64 `json:"home_charging_pct"`
	PublicChargingPct float64 `json:"public_charging_pct"`
	RiskTolerancePct  float64 `json:"risk_tolerance_pct"`
	BudgetMinor       int64   `json:"budget_minor"`
	Currency          string  `json:"currency"`
	Confirmed         bool    `json:"confirmed"`
}

type TCOStrategy struct {
	Name                string   `json:"name"`
	HomeChargingPct     float64  `json:"home_charging_pct"`
	PublicChargingPct   float64  `json:"public_charging_pct"`
	ProjectedCostMinor  *int64   `json:"projected_cost_minor"`
	RiskScorePct        *float64 `json:"risk_score_pct"`
	ConvenienceScorePct float64  `json:"convenience_score_pct"`
	WithinBudget        *bool    `json:"within_budget"`
	ParetoEfficient     bool     `json:"pareto_efficient"`
	Constraints         []string `json:"constraints"`
}

type TCOOptimizerResponse struct {
	VehicleID   int64         `json:"vehicle_id"`
	HorizonS    int64         `json:"horizon_s"`
	Currency    string        `json:"currency"`
	Strategies  []TCOStrategy `json:"strategies"`
	DataQuality DataQuality   `json:"data_quality"`
	Evidence    []Evidence    `json:"evidence"`
	Limitations []string      `json:"limitations"`
	GeneratedAt time.Time     `json:"generated_at"`
}
