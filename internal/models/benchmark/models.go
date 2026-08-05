package benchmark

import "time"

type PrivacyBenchmarkMetricName string

const (
	PrivacyBenchmarkDegradation          PrivacyBenchmarkMetricName = "degradation_pct"
	PrivacyBenchmarkEfficiency           PrivacyBenchmarkMetricName = "efficiency_wh_per_km"
	PrivacyBenchmarkChargingReliability  PrivacyBenchmarkMetricName = "charging_reliability_pct"
	PrivacyBenchmarkOperationReliability PrivacyBenchmarkMetricName = "operation_reliability_pct"
)

type PrivacyBenchmarkConsent struct {
	ID            int64      `db:"id" json:"id"`
	Subject       string     `db:"subject" json:"-"`
	VehicleID     int64      `db:"vehicle_id" json:"vehicle_id"`
	Status        string     `db:"status" json:"status"`
	EpsilonBudget float64    `db:"epsilon_budget" json:"epsilon_budget"`
	OptedInAt     time.Time  `db:"opted_in_at" json:"opted_in_at"`
	RevokedAt     *time.Time `db:"revoked_at" json:"revoked_at"`
	UpdatedAt     time.Time  `db:"updated_at" json:"updated_at"`
}

type PrivacyBenchmarkStatus struct {
	VehicleID         int64      `db:"vehicle_id" json:"vehicle_id"`
	OptedIn           bool       `db:"opted_in" json:"opted_in"`
	OptedInAt         *time.Time `db:"opted_in_at" json:"opted_in_at"`
	RevokedAt         *time.Time `db:"revoked_at" json:"revoked_at"`
	EpsilonBudget     float64    `db:"epsilon_budget" json:"epsilon_budget"`
	EpsilonSpent      float64    `db:"epsilon_spent" json:"epsilon_spent"`
	EpsilonRemaining  float64    `db:"epsilon_remaining" json:"epsilon_remaining"`
	MinimumCohortSize int        `db:"minimum_cohort_size" json:"minimum_cohort_size"`
	MechanismVersion  int16      `db:"mechanism_version" json:"mechanism_version"`
}

type PrivacyBenchmarkContribution struct {
	ID                      int64     `db:"id" json:"id"`
	ConsentID               int64     `db:"consent_id" json:"-"`
	PeriodStart             time.Time `db:"period_start" json:"period_start"`
	PeriodEnd               time.Time `db:"period_end" json:"period_end"`
	ModelFamily             string    `db:"model_family" json:"model_family"`
	ModelYearBucket         int16     `db:"model_year_bucket" json:"model_year_bucket"`
	DegradationPct          *float64  `db:"degradation_pct" json:"degradation_pct"`
	EfficiencyWhPerKm       *float64  `db:"efficiency_wh_per_km" json:"efficiency_wh_per_km"`
	ChargingReliabilityPct  *float64  `db:"charging_reliability_pct" json:"charging_reliability_pct"`
	OperationReliabilityPct *float64  `db:"operation_reliability_pct" json:"operation_reliability_pct"`
	DegradationSampleCount  int       `db:"degradation_sample_count" json:"degradation_sample_count"`
	EfficiencySampleCount   int       `db:"efficiency_sample_count" json:"efficiency_sample_count"`
	ChargingSampleCount     int       `db:"charging_sample_count" json:"charging_sample_count"`
	OperationSampleCount    int       `db:"operation_sample_count" json:"operation_sample_count"`
	MechanismVersion        int16     `db:"mechanism_version" json:"mechanism_version"`
	CreatedAt               time.Time `db:"created_at" json:"created_at"`
}

type PrivacyBenchmarkRelease struct {
	ID                int64                    `db:"id" json:"release_id"`
	PeriodStart       time.Time                `db:"period_start" json:"period_start"`
	PeriodEnd         time.Time                `db:"period_end" json:"period_end"`
	ModelFamily       string                   `db:"model_family" json:"model_family"`
	ModelYearBucket   int16                    `db:"model_year_bucket" json:"model_year_bucket"`
	SourceVersionHash []byte                   `db:"source_version_hash" json:"-"`
	MechanismVersion  int16                    `db:"mechanism_version" json:"mechanism_version"`
	MinimumCohortSize int16                    `db:"minimum_cohort_size" json:"minimum_cohort_size"`
	EpsilonSpent      float64                  `db:"epsilon_spent" json:"epsilon_spent"`
	Suppressed        bool                     `db:"suppressed" json:"suppressed"`
	SuppressionReason *string                  `db:"suppression_reason" json:"suppression_reason"`
	CreatedAt         time.Time                `db:"created_at" json:"created_at"`
	Metrics           []PrivacyBenchmarkMetric `db:"-" json:"metrics"`
}

type PrivacyBenchmarkMetric struct {
	ReleaseID       int64                      `db:"release_id" json:"-"`
	Name            PrivacyBenchmarkMetricName `db:"metric_name" json:"metric_name"`
	Unit            string                     `db:"unit" json:"unit"`
	LowerBound      float64                    `db:"lower_bound" json:"lower_bound"`
	UpperBound      float64                    `db:"upper_bound" json:"upper_bound"`
	EpsilonSpent    float64                    `db:"epsilon_spent" json:"epsilon_spent"`
	NoisyCohortSize *int                       `db:"noisy_cohort_size" json:"noisy_cohort_size"`
	NoisyMean       *float64                   `db:"noisy_mean" json:"noisy_mean"`
	NoisyP25        *float64                   `db:"noisy_p25" json:"noisy_p25"`
	NoisyP75        *float64                   `db:"noisy_p75" json:"noisy_p75"`
	NoiseScale      *float64                   `db:"noise_scale" json:"noise_scale"`
	Suppressed      bool                       `db:"suppressed" json:"suppressed"`
	Quality         string                     `db:"quality" json:"quality"`
	TargetValue     *float64                   `db:"-" json:"target_value"`
	Percentile      *float64                   `db:"-" json:"percentile"`
	HigherIsBetter  bool                       `db:"-" json:"higher_is_better"`
}

type PrivacyBenchmarkReleaseBin struct {
	ReleaseID  int64                      `db:"release_id" json:"-"`
	MetricName PrivacyBenchmarkMetricName `db:"metric_name" json:"-"`
	BinIndex   int16                      `db:"bin_index" json:"-"`
	NoisyCount float64                    `db:"noisy_count" json:"-"`
}

type PrivacyBenchmarkPrivacyLedger struct {
	ID            int64     `db:"id" json:"id"`
	ConsentID     int64     `db:"consent_id" json:"-"`
	ReleaseID     int64     `db:"release_id" json:"release_id"`
	EpsilonSpent  float64   `db:"epsilon_spent" json:"epsilon_spent"`
	L1Sensitivity float64   `db:"l1_sensitivity" json:"l1_sensitivity"`
	Mechanism     string    `db:"mechanism" json:"mechanism"`
	CreatedAt     time.Time `db:"created_at" json:"created_at"`
}

type PrivacyBenchmarkReleasePage struct {
	Items  []PrivacyBenchmarkRelease `db:"-" json:"items"`
	Limit  int                       `db:"-" json:"limit"`
	Offset int                       `db:"-" json:"offset"`
}
