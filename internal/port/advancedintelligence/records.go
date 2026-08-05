package advancedintelligence

import "time"

type FederatedModelCardRecord struct {
	ID                 int64
	Subject            string
	VehicleID          int64
	ModelName          string
	ModelVersion       string
	Task               string
	Version            int
	EpsilonBudget      float64
	EpsilonSpent       float64
	RoundCount         int
	LatestSampleCount  *int
	LatestMetricWhPerM *float64
	LatestStatus       *string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type FederatedRoundRecord struct {
	ID                int64
	ModelCardID       int64
	RoundNumber       int
	RequestedEpsilon  float64
	EpsilonSpent      float64
	SampleCount       int
	LocalMetricWhPerM *float64
	ClippedUpdatePct  *float64
	Status            string
	StartedAt         time.Time
	CompletedAt       *time.Time
}

type CausalExperimentRecord struct {
	ID               int64
	Subject          string
	VehicleID        int64
	InterventionKind string
	Metric           string
	BaselineStart    time.Time
	BaselineEnd      time.Time
	TreatmentStart   time.Time
	TreatmentEnd     time.Time
	State            string
	Version          int
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type CausalResultRecord struct {
	ExperimentID          int64
	BaselineSampleCount   int
	TreatmentSampleCount  int
	ConfounderCoveragePct *float64
	BaselineEnergyWhPerM  *float64
	TreatmentEnergyWhPerM *float64
	EffectEnergyWhPerM    *float64
	BaselineSuccessPct    *float64
	TreatmentSuccessPct   *float64
	EffectSuccessPct      *float64
	BaselineSpeedMps      *float64
	TreatmentSpeedMps     *float64
	EffectSpeedMps        *float64
	EstimatedAt           time.Time
}
