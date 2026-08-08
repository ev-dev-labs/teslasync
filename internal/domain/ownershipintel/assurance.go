package ownershipintel

import "time"

// ---------------------------------------------------------------------------
// 5. Warranty coverage and claim readiness
// ---------------------------------------------------------------------------

// WarrantyKind enumerates the coverage families a vehicle can carry.
type WarrantyKind string

const (
	WarrantyBasic       WarrantyKind = "basic"
	WarrantyDrivetrain  WarrantyKind = "drivetrain"
	WarrantyBattery     WarrantyKind = "battery"
	WarrantyCorrosion   WarrantyKind = "corrosion"
	WarrantyTires       WarrantyKind = "tires"
	WarrantyAftermarket WarrantyKind = "aftermarket"
	WarrantyExtended    WarrantyKind = "extended"
)

// Warranty is a stored coverage definition.
type Warranty struct {
	Version          int          `json:"version"`
	ID               int64        `json:"id"`
	VehicleID        int64        `json:"vehicle_id"`
	Kind             WarrantyKind `json:"kind"`
	Label            string       `json:"label"`
	Provider         string       `json:"provider"`
	StartAt          time.Time    `json:"start_at"`
	StartOdometerM   float64      `json:"start_odometer_m"`
	TermS            int64        `json:"term_s"`
	TermDistanceM    float64      `json:"term_distance_m"`
	CapacityFloorPct *float64     `json:"capacity_floor_pct"`
	DeductibleMinor  int64        `json:"deductible_minor"`
	Currency         string       `json:"currency"`
	Notes            string       `json:"notes"`
	CreatedAt        time.Time    `json:"created_at"`
	UpdatedAt        time.Time    `json:"updated_at"`
}

// CreateWarrantyRequest registers a coverage definition.
type CreateWarrantyRequest struct {
	VehicleID        int64        `json:"vehicle_id"`
	Kind             WarrantyKind `json:"kind"`
	Label            string       `json:"label"`
	Provider         string       `json:"provider"`
	StartAt          time.Time    `json:"start_at"`
	StartOdometerM   float64      `json:"start_odometer_m"`
	TermS            int64        `json:"term_s"`
	TermDistanceM    float64      `json:"term_distance_m"`
	CapacityFloorPct *float64     `json:"capacity_floor_pct"`
	DeductibleMinor  int64        `json:"deductible_minor"`
	Currency         string       `json:"currency"`
	Notes            string       `json:"notes"`
}

// ClaimStatus is the lifecycle stage of a warranty claim. The values mirror the
// warranty_claims_status_check database constraint.
type ClaimStatus string

const (
	ClaimDraft     ClaimStatus = "draft"
	ClaimSubmitted ClaimStatus = "submitted"
	ClaimApproved  ClaimStatus = "approved"
	ClaimDenied    ClaimStatus = "denied"
	ClaimClosed    ClaimStatus = "closed"
)

// WarrantyClaim is a recorded claim against a coverage.
type WarrantyClaim struct {
	ID           int64       `json:"id"`
	WarrantyID   int64       `json:"warranty_id"`
	Title        string      `json:"title"`
	Status       ClaimStatus `json:"status"`
	OpenedAt     time.Time   `json:"opened_at"`
	ClosedAt     *time.Time  `json:"closed_at"`
	AmountMinor  int64       `json:"amount_minor"`
	EvidenceNote string      `json:"evidence_note"`
	CreatedAt    time.Time   `json:"created_at"`
	UpdatedAt    time.Time   `json:"updated_at"`
}

// CreateClaimRequest opens a claim against a coverage.
type CreateClaimRequest struct {
	WarrantyID   int64       `json:"warranty_id"`
	Title        string      `json:"title"`
	Status       ClaimStatus `json:"status"`
	AmountMinor  int64       `json:"amount_minor"`
	EvidenceNote string      `json:"evidence_note"`
	Confirmed    bool        `json:"confirmed"`
}

// ReadinessCheck is one claim-readiness gate with a pass/fail outcome.
type ReadinessCheck struct {
	Code      string `json:"code"`
	Label     string `json:"label"`
	Satisfied bool   `json:"satisfied"`
	Detail    string `json:"detail"`
	Severity  string `json:"severity"`
}

// WarrantyCoverage projects when a coverage will expire and why.
type WarrantyCoverage struct {
	Warranty              Warranty         `json:"warranty"`
	Active                bool             `json:"active"`
	ElapsedS              int64            `json:"elapsed_s"`
	RemainingS            int64            `json:"remaining_s"`
	TimeUsedPct           float64          `json:"time_used_pct"`
	DistanceUsedM         float64          `json:"distance_used_m"`
	DistanceRemainingM    float64          `json:"distance_remaining_m"`
	DistanceUsedPct       float64          `json:"distance_used_pct"`
	ObservedPaceMPerS     *float64         `json:"observed_pace_m_per_s"`
	TimeExpiryAt          time.Time        `json:"time_expiry_at"`
	DistanceExpiryAt      *time.Time       `json:"distance_expiry_at"`
	ProjectedExpiryAt     time.Time        `json:"projected_expiry_at"`
	BindingLimit          string           `json:"binding_limit"`
	CapacityRetentionPct  *float64         `json:"capacity_retention_pct"`
	CapacityFloorBreachAt *time.Time       `json:"capacity_floor_breach_at"`
	CapacityHeadroomPct   *float64         `json:"capacity_headroom_pct"`
	ClaimWindowClosingS   *int64           `json:"claim_window_closing_s"`
	Readiness             []ReadinessCheck `json:"readiness"`
	ReadinessScore        float64          `json:"readiness_score"`
	Claims                []WarrantyClaim  `json:"claims"`
	Status                string           `json:"status"`
	Narrative             string           `json:"narrative"`
}

// WarrantyOverview is the portfolio answer across every coverage.
type WarrantyOverview struct {
	VehicleID          int64              `json:"vehicle_id"`
	AsOf               time.Time          `json:"as_of"`
	OdometerM          *float64           `json:"odometer_m"`
	Coverages          []WarrantyCoverage `json:"coverages"`
	ActiveCount        int                `json:"active_count"`
	ExpiringSoonCount  int                `json:"expiring_soon_count"`
	NextExpiryAt       *time.Time         `json:"next_expiry_at"`
	TotalClaimedMinor  int64              `json:"total_claimed_minor"`
	Currency           string             `json:"currency"`
	EvidenceBundleHash string             `json:"evidence_bundle_hash"`
	Quality            DataQuality        `json:"quality"`
	Evidence           []Evidence         `json:"evidence"`
}

// ---------------------------------------------------------------------------
// 6. Data retention and lifecycle governance
// ---------------------------------------------------------------------------

// RetentionPolicy is a plan-only lifecycle rule for one dataset.
type RetentionPolicy struct {
	ID                int64     `json:"id"`
	Dataset           string    `json:"dataset"`
	RetentionS        int64     `json:"retention_s"`
	DownsampleAfterS  *int64    `json:"downsample_after_s"`
	DownsampleBucketS *int64    `json:"downsample_bucket_s"`
	LegalHold         bool      `json:"legal_hold"`
	Enabled           bool      `json:"enabled"`
	Version           int       `json:"version"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// UpsertRetentionPolicyRequest authors or replaces a lifecycle rule.
type UpsertRetentionPolicyRequest struct {
	Dataset           string `json:"dataset"`
	RetentionS        int64  `json:"retention_s"`
	DownsampleAfterS  *int64 `json:"downsample_after_s"`
	DownsampleBucketS *int64 `json:"downsample_bucket_s"`
	LegalHold         bool   `json:"legal_hold"`
	Enabled           bool   `json:"enabled"`
}

// DatasetInventory is the live footprint of one governed dataset.
type DatasetInventory struct {
	Dataset      string     `json:"dataset"`
	Label        string     `json:"label"`
	RowCount     int64      `json:"row_count"`
	TotalBytes   int64      `json:"total_bytes"`
	OldestAt     *time.Time `json:"oldest_at"`
	NewestAt     *time.Time `json:"newest_at"`
	SpanS        *int64     `json:"span_s"`
	BytesPerRow  *float64   `json:"bytes_per_row"`
	IsHypertable bool       `json:"is_hypertable"`
	Governed     bool       `json:"governed"`
}

// RetentionImpact is the dry-run outcome for one policy.
type RetentionImpact struct {
	Dataset             string   `json:"dataset"`
	Label               string   `json:"label"`
	PolicyID            *int64   `json:"policy_id"`
	RetentionS          int64    `json:"retention_s"`
	RowsScanned         int64    `json:"rows_scanned"`
	RowsExpiring        int64    `json:"rows_expiring"`
	RowsDownsampling    int64    `json:"rows_downsampling"`
	RowsRetained        int64    `json:"rows_retained"`
	BytesReclaimable    int64    `json:"bytes_reclaimable"`
	ReclaimSharePct     float64  `json:"reclaim_share_pct"`
	FidelityLossPct     float64  `json:"fidelity_loss_pct"`
	BlockedByLegalHold  bool     `json:"blocked_by_legal_hold"`
	ProjectedDailyBytes *float64 `json:"projected_daily_growth_bytes"`
	RunwayDays          *int     `json:"runway_days"`
	Warnings            []string `json:"warnings"`
}

// RetentionRun is a persisted dry-run record.
type RetentionRun struct {
	ID               int64     `json:"id"`
	Dataset          string    `json:"dataset"`
	Mode             string    `json:"mode"`
	RowsScanned      int64     `json:"rows_scanned"`
	RowsExpiring     int64     `json:"rows_expiring"`
	RowsDownsampling int64     `json:"rows_downsampling"`
	BytesReclaimable int64     `json:"bytes_reclaimable"`
	FidelityLossPct  float64   `json:"fidelity_loss_pct"`
	BlockedByHold    bool      `json:"blocked_by_hold"`
	ExecutedAt       time.Time `json:"executed_at"`
}

// GovernanceSimulationRequest asks for a dry-run across selected datasets.
type GovernanceSimulationRequest struct {
	Datasets  []string `json:"datasets"`
	Confirmed bool     `json:"confirmed"`
}

// GovernanceOverview is the full lifecycle picture.
type GovernanceOverview struct {
	AsOf             time.Time          `json:"as_of"`
	Policies         []RetentionPolicy  `json:"policies"`
	Inventory        []DatasetInventory `json:"inventory"`
	TotalBytes       int64              `json:"total_bytes"`
	GovernedBytes    int64              `json:"governed_bytes"`
	UngovernedBytes  int64              `json:"ungoverned_bytes"`
	GovernedSharePct float64            `json:"governed_share_pct"`
	LegalHoldCount   int                `json:"legal_hold_count"`
	PlanOnly         bool               `json:"plan_only"`
	Quality          DataQuality        `json:"quality"`
	Evidence         []Evidence         `json:"evidence"`
}

// GovernanceSimulationResponse is a dry-run impact report.
type GovernanceSimulationResponse struct {
	AsOf                 time.Time         `json:"as_of"`
	Impacts              []RetentionImpact `json:"impacts"`
	TotalRowsExpiring    int64             `json:"total_rows_expiring"`
	TotalBytesReclaim    int64             `json:"total_bytes_reclaimable"`
	TotalFidelityLossPct float64           `json:"total_fidelity_loss_pct"`
	PlanOnly             bool              `json:"plan_only"`
	Quality              DataQuality       `json:"quality"`
	Evidence             []Evidence        `json:"evidence"`
}

// ---------------------------------------------------------------------------
// 7. Prediction accuracy and model trust
// ---------------------------------------------------------------------------

// TrustGrade is the headline verdict on a model's realised accuracy.
type TrustGrade string

const (
	TrustTrusted     TrustGrade = "trusted"
	TrustWatch       TrustGrade = "watch"
	TrustUnreliable  TrustGrade = "unreliable"
	TrustUnevaluated TrustGrade = "unevaluated"
)

// RecordPredictionRequest stores a forecast for later scoring.
type RecordPredictionRequest struct {
	VehicleID      int64     `json:"vehicle_id"`
	ModelName      string    `json:"model_name"`
	Target         string    `json:"target"`
	SIUnit         string    `json:"si_unit"`
	PredictedAt    time.Time `json:"predicted_at"`
	HorizonS       int64     `json:"horizon_s"`
	PredictedValue float64   `json:"predicted_value"`
	PredictedLow   *float64  `json:"predicted_low"`
	PredictedHigh  *float64  `json:"predicted_high"`
	Reference      string    `json:"reference"`
}

// RecordOutcomeRequest closes the loop on a stored forecast.
type RecordOutcomeRequest struct {
	PredictionID  int64     `json:"prediction_id"`
	ObservedValue float64   `json:"observed_value"`
	ObservedAt    time.Time `json:"observed_at"`
}

// Prediction is a stored forecast, optionally joined to its outcome.
type Prediction struct {
	ID             int64      `json:"id"`
	VehicleID      int64      `json:"vehicle_id"`
	ModelName      string     `json:"model_name"`
	Target         string     `json:"target"`
	SIUnit         string     `json:"si_unit"`
	PredictedAt    time.Time  `json:"predicted_at"`
	HorizonS       int64      `json:"horizon_s"`
	PredictedValue float64    `json:"predicted_value"`
	PredictedLow   *float64   `json:"predicted_low"`
	PredictedHigh  *float64   `json:"predicted_high"`
	Reference      string     `json:"reference"`
	ObservedValue  *float64   `json:"observed_value"`
	ObservedAt     *time.Time `json:"observed_at"`
	ErrorValue     *float64   `json:"error_value"`
	AbsErrorPct    *float64   `json:"abs_error_pct"`
	InInterval     *bool      `json:"in_interval"`
	CreatedAt      time.Time  `json:"created_at"`
}

// CalibrationBin is one bucket of the reliability curve.
type CalibrationBin struct {
	LowerPct     float64  `json:"lower_pct"`
	UpperPct     float64  `json:"upper_pct"`
	SampleCount  int      `json:"sample_count"`
	MeanAbsError float64  `json:"mean_abs_error"`
	MeanBias     float64  `json:"mean_bias"`
	CoveragePct  *float64 `json:"coverage_pct"`
}

// ModelScorecard is the realised accuracy report for one model target.
type ModelScorecard struct {
	ModelName          string           `json:"model_name"`
	Target             string           `json:"target"`
	SIUnit             string           `json:"si_unit"`
	SampleCount        int              `json:"sample_count"`
	ScoredCount        int              `json:"scored_count"`
	PendingCount       int              `json:"pending_count"`
	Bias               *float64         `json:"bias"`
	MeanAbsError       *float64         `json:"mean_abs_error"`
	RootMeanSqError    *float64         `json:"root_mean_square_error"`
	MeanAbsPctError    *float64         `json:"mean_abs_pct_error"`
	MedianAbsPctError  *float64         `json:"median_abs_pct_error"`
	IntervalCoveragePc *float64         `json:"interval_coverage_pct"`
	SkillVsNaivePct    *float64         `json:"skill_vs_naive_pct"`
	DriftRatio         *float64         `json:"drift_ratio"`
	DriftStatus        string           `json:"drift_status"`
	TrustGrade         TrustGrade       `json:"trust_grade"`
	TrustScore         float64          `json:"trust_score"`
	Calibration        []CalibrationBin `json:"calibration"`
	Narrative          string           `json:"narrative"`
	FirstScoredAt      *time.Time       `json:"first_scored_at"`
	LastScoredAt       *time.Time       `json:"last_scored_at"`
	Quality            DataQuality      `json:"quality"`
}

// ModelTrustReport aggregates every scored model for one vehicle.
type ModelTrustReport struct {
	VehicleID        int64            `json:"vehicle_id"`
	Window           Window           `json:"window"`
	Scorecards       []ModelScorecard `json:"scorecards"`
	TotalPredictions int              `json:"total_predictions"`
	TotalScored      int              `json:"total_scored"`
	TrustedCount     int              `json:"trusted_count"`
	WatchCount       int              `json:"watch_count"`
	UnreliableCount  int              `json:"unreliable_count"`
	PortfolioTrust   *float64         `json:"portfolio_trust_score"`
	Recent           []Prediction     `json:"recent_predictions"`
	Quality          DataQuality      `json:"quality"`
	Evidence         []Evidence       `json:"evidence"`
}
