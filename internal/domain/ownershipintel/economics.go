package ownershipintel

import "time"

// ---------------------------------------------------------------------------
// 1. Insurance telematics and underwriting
// ---------------------------------------------------------------------------

// RiskGrade is the underwriting band a modelled loss cost falls into.
type RiskGrade string

const (
	RiskPreferred   RiskGrade = "preferred"
	RiskStandard    RiskGrade = "standard"
	RiskSubstandard RiskGrade = "substandard"
	RiskHigh        RiskGrade = "high"
)

// RiskFactorDirection tells the UI whether a higher observed rate is worse.
type RiskFactorDirection string

const (
	DirectionHigherIsWorse  RiskFactorDirection = "higher_is_worse"
	DirectionHigherIsBetter RiskFactorDirection = "higher_is_better"
)

// InsurancePolicy is the stored underwriting baseline for one vehicle.
type InsurancePolicy struct {
	ID                 int64      `json:"id"`
	VehicleID          int64      `json:"vehicle_id"`
	Insurer            string     `json:"insurer"`
	PolicyRef          string     `json:"policy_ref"`
	Currency           string     `json:"currency"`
	AnnualPremiumMinor int64      `json:"annual_premium_minor"`
	DeductibleMinor    int64      `json:"deductible_minor"`
	CoverageStart      time.Time  `json:"coverage_start"`
	CoverageEnd        *time.Time `json:"coverage_end"`
	TelematicsProgram  bool       `json:"telematics_program"`
	MaxDiscountPct     float64    `json:"max_discount_pct"`
	Version            int        `json:"version"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

// UpsertInsurancePolicyRequest creates or replaces the underwriting baseline.
type UpsertInsurancePolicyRequest struct {
	VehicleID          int64      `json:"vehicle_id"`
	Insurer            string     `json:"insurer"`
	PolicyRef          string     `json:"policy_ref"`
	Currency           string     `json:"currency"`
	AnnualPremiumMinor int64      `json:"annual_premium_minor"`
	DeductibleMinor    int64      `json:"deductible_minor"`
	CoverageStart      time.Time  `json:"coverage_start"`
	CoverageEnd        *time.Time `json:"coverage_end"`
	TelematicsProgram  bool       `json:"telematics_program"`
	MaxDiscountPct     float64    `json:"max_discount_pct"`
}

// RiskFactor is one exposure-normalised underwriting signal.
type RiskFactor struct {
	Code            string              `json:"code"`
	Label           string              `json:"label"`
	Direction       RiskFactorDirection `json:"direction"`
	ObservedRate    float64             `json:"observed_rate"`
	BaselineRate    float64             `json:"baseline_rate"`
	RateUnit        string              `json:"rate_unit"`
	Weight          float64             `json:"weight"`
	Score           float64             `json:"score"`
	ContributionPct float64             `json:"contribution_pct"`
	Percentile      *float64            `json:"percentile"`
	SampleCount     int                 `json:"sample_count"`
	Narrative       string              `json:"narrative"`
}

// RiskTrendPoint is one bucket of the rolling risk history.
type RiskTrendPoint struct {
	BucketStart   time.Time `json:"bucket_start"`
	RiskScore     float64   `json:"risk_score"`
	DistanceM     float64   `json:"distance_m"`
	DriveCount    int       `json:"drive_count"`
	LossCostIndex float64   `json:"loss_cost_index"`
}

// PremiumSimulation converts the modelled loss cost into money.
type PremiumSimulation struct {
	Currency             string   `json:"currency"`
	BaselinePremiumMinor int64    `json:"baseline_premium_minor"`
	ModelledPremiumMinor int64    `json:"modelled_premium_minor"`
	DeltaMinor           int64    `json:"delta_minor"`
	DeltaPct             float64  `json:"delta_pct"`
	AppliedDiscountPct   float64  `json:"applied_discount_pct"`
	MaxDiscountPct       float64  `json:"max_discount_pct"`
	ExpectedLossMinor    *int64   `json:"expected_loss_minor"`
	DeductibleMinor      int64    `json:"deductible_minor"`
	CostPerDistanceMinor *float64 `json:"cost_per_distance_minor_per_m"`
}

// RiskLever quantifies what improving one factor is worth.
type RiskLever struct {
	FactorCode           string   `json:"factor_code"`
	Label                string   `json:"label"`
	TargetReductionPct   float64  `json:"target_reduction_pct"`
	ProjectedScoreDelta  float64  `json:"projected_score_delta"`
	ProjectedPremiumSave *int64   `json:"projected_premium_save_minor"`
	Difficulty           string   `json:"difficulty"`
	Confidence           float64  `json:"confidence"`
	PayoffRank           int      `json:"payoff_rank"`
	EffortHoursPerWeek   *float64 `json:"effort_hours_per_week"`
}

// InsuranceRiskProfile is the full underwriting answer for one vehicle.
type InsuranceRiskProfile struct {
	VehicleID          int64              `json:"vehicle_id"`
	Window             Window             `json:"window"`
	Policy             *InsurancePolicy   `json:"policy"`
	ExposureDistanceM  float64            `json:"exposure_distance_m"`
	ExposureDurationS  int64              `json:"exposure_duration_s"`
	DriveCount         int                `json:"drive_count"`
	NightDistanceM     float64            `json:"night_distance_m"`
	RiskScore          float64            `json:"risk_score"`
	RiskGrade          RiskGrade          `json:"risk_grade"`
	FrequencyIndex     float64            `json:"frequency_index"`
	SeverityIndex      float64            `json:"severity_index"`
	LossCostIndex      float64            `json:"loss_cost_index"`
	PeerPercentile     *float64           `json:"peer_percentile"`
	Factors            []RiskFactor       `json:"factors"`
	Trend              []RiskTrendPoint   `json:"trend"`
	Premium            *PremiumSimulation `json:"premium"`
	Levers             []RiskLever        `json:"levers"`
	EvidencePacketHash string             `json:"evidence_packet_hash"`
	Quality            DataQuality        `json:"quality"`
	Evidence           []Evidence         `json:"evidence"`
}

// ---------------------------------------------------------------------------
// 2. Utility tariff arbitrage
// ---------------------------------------------------------------------------

// TariffStructure enumerates the supported rate-plan shapes.
type TariffStructure string

const (
	TariffFlat     TariffStructure = "flat"
	TariffTOU      TariffStructure = "tou"
	TariffTiered   TariffStructure = "tiered"
	TariffRealTime TariffStructure = "real_time"
	TariffDemand   TariffStructure = "demand"
)

// TariffRate is one price band inside a tariff.
type TariffRate struct {
	ID               int64    `json:"id"`
	Label            string   `json:"label"`
	DayMask          int      `json:"day_mask"`
	StartMinute      int      `json:"start_minute"`
	EndMinute        int      `json:"end_minute"`
	PriceMinorPerWh  float64  `json:"price_minor_per_wh"`
	TierUpperWh      *float64 `json:"tier_upper_wh"`
	SeasonStartMonth int      `json:"season_start_month"`
	SeasonEndMonth   int      `json:"season_end_month"`
}

// Tariff is a complete user-authored rate plan.
type Tariff struct {
	ID                        int64           `json:"id"`
	Name                      string          `json:"name"`
	Provider                  string          `json:"provider"`
	Currency                  string          `json:"currency"`
	Structure                 TariffStructure `json:"structure"`
	StandingChargeMinorPerDay float64         `json:"standing_charge_minor_per_day"`
	DemandChargeMinorPerW     float64         `json:"demand_charge_minor_per_w"`
	ExportPriceMinorPerWh     float64         `json:"export_price_minor_per_wh"`
	IsCurrent                 bool            `json:"is_current"`
	Version                   int             `json:"version"`
	Rates                     []TariffRate    `json:"rates"`
	CreatedAt                 time.Time       `json:"created_at"`
	UpdatedAt                 time.Time       `json:"updated_at"`
}

// CreateTariffRequest authors a new plan together with all of its bands.
type CreateTariffRequest struct {
	Name                      string          `json:"name"`
	Provider                  string          `json:"provider"`
	Currency                  string          `json:"currency"`
	Structure                 TariffStructure `json:"structure"`
	StandingChargeMinorPerDay float64         `json:"standing_charge_minor_per_day"`
	DemandChargeMinorPerW     float64         `json:"demand_charge_minor_per_w"`
	ExportPriceMinorPerWh     float64         `json:"export_price_minor_per_wh"`
	IsCurrent                 bool            `json:"is_current"`
	Rates                     []TariffRate    `json:"rates"`
}

// TariffSimulationRequest replays real charging load against selected plans.
type TariffSimulationRequest struct {
	VehicleID      int64   `json:"vehicle_id"`
	WindowDays     int     `json:"window_days"`
	TariffIDs      []int64 `json:"tariff_ids"`
	ShiftablePct   float64 `json:"shiftable_pct"`
	SwitchFeeMinor int64   `json:"switch_fee_minor"`
	Confirmed      bool    `json:"confirmed"`
}

// TariffBandUsage explains how much energy landed in one price band.
type TariffBandUsage struct {
	Label           string  `json:"label"`
	EnergyWh        float64 `json:"energy_wh"`
	SharePct        float64 `json:"share_pct"`
	PriceMinorPerWh float64 `json:"price_minor_per_wh"`
	CostMinor       int64   `json:"cost_minor"`
}

// TariffSimulationResult is the modelled annual cost of one plan.
type TariffSimulationResult struct {
	TariffID                 int64             `json:"tariff_id"`
	Name                     string            `json:"name"`
	Provider                 string            `json:"provider"`
	Structure                TariffStructure   `json:"structure"`
	Currency                 string            `json:"currency"`
	IsCurrent                bool              `json:"is_current"`
	Rank                     int               `json:"rank"`
	ObservedEnergyWh         float64           `json:"observed_energy_wh"`
	AnnualisedEnergyWh       float64           `json:"annualised_energy_wh"`
	EnergyCostMinor          int64             `json:"energy_cost_minor"`
	StandingCostMinor        int64             `json:"standing_cost_minor"`
	DemandCostMinor          int64             `json:"demand_cost_minor"`
	AnnualCostMinor          int64             `json:"annual_cost_minor"`
	EffectivePriceMinorPerWh float64           `json:"effective_price_minor_per_wh"`
	DeltaVsCurrentMinor      *int64            `json:"delta_vs_current_minor"`
	BreakEvenDays            *int              `json:"break_even_days"`
	LoadShiftSavingMinor     int64             `json:"load_shift_saving_minor"`
	PeakDemandW              *float64          `json:"peak_demand_w"`
	Bands                    []TariffBandUsage `json:"bands"`
	Warnings                 []string          `json:"warnings"`
}

// TariffSimulationResponse ranks every evaluated plan.
type TariffSimulationResponse struct {
	VehicleID        int64                    `json:"vehicle_id"`
	Window           Window                   `json:"window"`
	SessionCount     int                      `json:"session_count"`
	ObservedEnergyWh float64                  `json:"observed_energy_wh"`
	ShiftablePct     float64                  `json:"shiftable_pct"`
	Results          []TariffSimulationResult `json:"results"`
	BestTariffID     *int64                   `json:"best_tariff_id"`
	CurrentTariffID  *int64                   `json:"current_tariff_id"`
	MaxSavingMinor   *int64                   `json:"max_saving_minor"`
	Quality          DataQuality              `json:"quality"`
	Evidence         []Evidence               `json:"evidence"`
}

// ---------------------------------------------------------------------------
// 3. Charging invoice reconciliation
// ---------------------------------------------------------------------------

// InvoiceStatus tracks the reconciliation lifecycle of a provider invoice.
type InvoiceStatus string

const (
	InvoiceOpen       InvoiceStatus = "open"
	InvoiceReconciled InvoiceStatus = "reconciled"
	InvoiceDisputed   InvoiceStatus = "disputed"
	InvoiceSettled    InvoiceStatus = "settled"
)

// MatchState classifies how an invoice line lined up with measured telemetry.
type MatchState string

const (
	MatchExact      MatchState = "exact"
	MatchProbable   MatchState = "probable"
	MatchAmbiguous  MatchState = "ambiguous"
	MatchUnmatched  MatchState = "unmatched"
	MatchDuplicate  MatchState = "duplicate"
	MatchUninvoiced MatchState = "uninvoiced"
)

// InvoiceLine is one billed charging event as reported by the provider.
type InvoiceLine struct {
	ID                int64     `json:"id"`
	LineRef           string    `json:"line_ref"`
	OccurredAt        time.Time `json:"occurred_at"`
	Location          string    `json:"location"`
	BilledEnergyWh    float64   `json:"billed_energy_wh"`
	BilledEnergyMinor int64     `json:"billed_energy_minor"`
	BilledIdleMinor   int64     `json:"billed_idle_minor"`
	BilledTaxMinor    int64     `json:"billed_tax_minor"`
	BilledTotalMinor  int64     `json:"billed_total_minor"`
}

// ChargingInvoice is a stored provider invoice with all of its lines.
type ChargingInvoice struct {
	ID               int64         `json:"id"`
	VehicleID        int64         `json:"vehicle_id"`
	Provider         string        `json:"provider"`
	InvoiceRef       string        `json:"invoice_ref"`
	Currency         string        `json:"currency"`
	PeriodStart      time.Time     `json:"period_start"`
	PeriodEnd        time.Time     `json:"period_end"`
	BilledTotalMinor int64         `json:"billed_total_minor"`
	Status           InvoiceStatus `json:"status"`
	LineCount        int           `json:"line_count"`
	Version          int           `json:"version"`
	Lines            []InvoiceLine `json:"lines"`
	CreatedAt        time.Time     `json:"created_at"`
	UpdatedAt        time.Time     `json:"updated_at"`
}

// CreateInvoiceRequest ingests a provider statement.
type CreateInvoiceRequest struct {
	VehicleID        int64         `json:"vehicle_id"`
	Provider         string        `json:"provider"`
	InvoiceRef       string        `json:"invoice_ref"`
	Currency         string        `json:"currency"`
	PeriodStart      time.Time     `json:"period_start"`
	PeriodEnd        time.Time     `json:"period_end"`
	BilledTotalMinor int64         `json:"billed_total_minor"`
	Lines            []InvoiceLine `json:"lines"`
}

// ReconciledLine pairs one invoice line with the measured session behind it.
type ReconciledLine struct {
	Line              InvoiceLine `json:"line"`
	MatchState        MatchState  `json:"match_state"`
	MatchConfidence   float64     `json:"match_confidence_pct"`
	SessionID         *int64      `json:"session_id"`
	SessionStartedAt  *time.Time  `json:"session_started_at"`
	MeasuredEnergyWh  *float64    `json:"measured_energy_wh"`
	EnergyDeltaWh     *float64    `json:"energy_delta_wh"`
	EnergyDeltaPct    *float64    `json:"energy_delta_pct"`
	TimeDeltaS        *int64      `json:"time_delta_s"`
	ExpectedCostMinor *int64      `json:"expected_cost_minor"`
	VarianceMinor     int64       `json:"variance_minor"`
	VarianceReasons   []string    `json:"variance_reasons"`
	Recoverable       bool        `json:"recoverable"`
	Ambiguous         bool        `json:"ambiguous"`
}

// UninvoicedSession is a measured session the provider never billed.
type UninvoicedSession struct {
	SessionID int64     `json:"session_id"`
	StartedAt time.Time `json:"started_at"`
	EnergyWh  float64   `json:"energy_wh"`
	Location  string    `json:"location"`
	Narrative string    `json:"narrative"`
}

// VarianceBucket aggregates one category of billing discrepancy.
type VarianceBucket struct {
	Reason      string  `json:"reason"`
	Label       string  `json:"label"`
	LineCount   int     `json:"line_count"`
	AmountMinor int64   `json:"amount_minor"`
	SharePct    float64 `json:"share_pct"`
	Recoverable bool    `json:"recoverable"`
}

// InvoiceDispute is a recorded challenge against an invoice.
type InvoiceDispute struct {
	ID             int64      `json:"id"`
	InvoiceID      int64      `json:"invoice_id"`
	ClaimedMinor   int64      `json:"claimed_minor"`
	RecoveredMinor int64      `json:"recovered_minor"`
	Status         string     `json:"status"`
	Reasons        []string   `json:"reasons"`
	Note           string     `json:"note"`
	OpenedAt       time.Time  `json:"opened_at"`
	ResolvedAt     *time.Time `json:"resolved_at"`
}

// CreateDisputeRequest opens a dispute against a reconciled invoice.
type CreateDisputeRequest struct {
	ClaimedMinor int64    `json:"claimed_minor"`
	Reasons      []string `json:"reasons"`
	Note         string   `json:"note"`
	Confirmed    bool     `json:"confirmed"`
}

// ReconciliationReport is the full audit of one invoice.
type ReconciliationReport struct {
	Invoice             ChargingInvoice     `json:"invoice"`
	Lines               []ReconciledLine    `json:"lines"`
	Uninvoiced          []UninvoicedSession `json:"uninvoiced_sessions"`
	VarianceBuckets     []VarianceBucket    `json:"variance_buckets"`
	MatchedLineCount    int                 `json:"matched_line_count"`
	UnmatchedLineCount  int                 `json:"unmatched_line_count"`
	BilledTotalMinor    int64               `json:"billed_total_minor"`
	ExpectedTotalMinor  int64               `json:"expected_total_minor"`
	NetVarianceMinor    int64               `json:"net_variance_minor"`
	RecoverableMinor    int64               `json:"recoverable_minor"`
	MeasuredEnergyWh    float64             `json:"measured_energy_wh"`
	BilledEnergyWh      float64             `json:"billed_energy_wh"`
	EnergyVarianceWh    float64             `json:"energy_variance_wh"`
	DisputePacketDigest string              `json:"dispute_packet_digest"`
	Disputes            []InvoiceDispute    `json:"disputes"`
	Quality             DataQuality         `json:"quality"`
	Evidence            []Evidence          `json:"evidence"`
}

// ---------------------------------------------------------------------------
// 10. Subscription and paid-feature ROI
// ---------------------------------------------------------------------------

// UsageMetric is the telemetry series a paid feature is scored against.
type UsageMetric string

const (
	UsageSuperchargingEnergy UsageMetric = "supercharging_energy"
	UsageDrivingDistance     UsageMetric = "driving_distance"
	UsageConnectivityTime    UsageMetric = "connectivity_time"
	UsageChargingSessions    UsageMetric = "charging_sessions"
	UsageDriveCount          UsageMetric = "drive_count"
	UsageNone                UsageMetric = "none"
)

// SubscriptionKind separates recurring plans from one-off purchases. The values
// are constrained by the vehicle_subscriptions_kind_check DB constraint.
type SubscriptionKind string

const (
	SubscriptionRecurring SubscriptionKind = "subscription"
	SubscriptionOneTime   SubscriptionKind = "one_time"
)

// BillingPeriod is how often a paid feature is charged. The valid pairings with
// SubscriptionKind are enforced by the vehicle_subscriptions_billing_kind DB
// constraint: one_time purchases bill "once", recurring plans bill monthly or
// annually.
type BillingPeriod string

const (
	BillingMonthly BillingPeriod = "monthly"
	BillingAnnual  BillingPeriod = "annual"
	BillingOnce    BillingPeriod = "once"
)

// Subscription is a stored paid feature or recurring plan.
type Subscription struct {
	ID                    int64            `json:"id"`
	VehicleID             int64            `json:"vehicle_id"`
	Name                  string           `json:"name"`
	Kind                  SubscriptionKind `json:"kind"`
	BillingPeriod         BillingPeriod    `json:"billing_period"`
	PriceMinor            int64            `json:"price_minor"`
	Currency              string           `json:"currency"`
	UsageMetric           UsageMetric      `json:"usage_metric"`
	BenchmarkMinorPerUnit float64          `json:"benchmark_minor_per_unit"`
	StartedAt             time.Time        `json:"started_at"`
	EndedAt               *time.Time       `json:"ended_at"`
	Version               int              `json:"version"`
	CreatedAt             time.Time        `json:"created_at"`
	UpdatedAt             time.Time        `json:"updated_at"`
}

// CreateSubscriptionRequest registers a paid feature for ROI scoring.
type CreateSubscriptionRequest struct {
	VehicleID             int64            `json:"vehicle_id"`
	Name                  string           `json:"name"`
	Kind                  SubscriptionKind `json:"kind"`
	BillingPeriod         BillingPeriod    `json:"billing_period"`
	PriceMinor            int64            `json:"price_minor"`
	Currency              string           `json:"currency"`
	UsageMetric           UsageMetric      `json:"usage_metric"`
	BenchmarkMinorPerUnit float64          `json:"benchmark_minor_per_unit"`
	StartedAt             time.Time        `json:"started_at"`
	EndedAt               *time.Time       `json:"ended_at"`
}

// SubscriptionVerdict is the keep/cancel recommendation.
type SubscriptionVerdict string

const (
	VerdictKeep     SubscriptionVerdict = "keep"
	VerdictReview   SubscriptionVerdict = "review"
	VerdictCancel   SubscriptionVerdict = "cancel"
	VerdictUnknown  SubscriptionVerdict = "unknown"
	VerdictTooEarly SubscriptionVerdict = "too_early"
)

// SubscriptionROI scores one paid feature against realised usage.
type SubscriptionROI struct {
	Subscription         Subscription        `json:"subscription"`
	ActiveDays           int                 `json:"active_days"`
	SpendToDateMinor     int64               `json:"spend_to_date_minor"`
	MonthlyCostMinor     int64               `json:"monthly_cost_minor"`
	UsageQuantity        *float64            `json:"usage_quantity"`
	UsageUnit            string              `json:"usage_unit"`
	UsagePerMonth        *float64            `json:"usage_per_month"`
	RealisedValueMinor   *int64              `json:"realised_value_minor"`
	NetValueMinor        *int64              `json:"net_value_minor"`
	ROIPct               *float64            `json:"roi_pct"`
	BreakEvenUsagePerMon *float64            `json:"break_even_usage_per_month"`
	UtilisationPct       *float64            `json:"utilisation_pct"`
	Verdict              SubscriptionVerdict `json:"verdict"`
	Confidence           float64             `json:"confidence"`
	Narrative            string              `json:"narrative"`
	Quality              DataQuality         `json:"quality"`
}

// SubscriptionROIReport aggregates the whole paid-feature portfolio.
type SubscriptionROIReport struct {
	VehicleID           int64             `json:"vehicle_id"`
	Window              Window            `json:"window"`
	Currency            string            `json:"currency"`
	Items               []SubscriptionROI `json:"items"`
	TotalMonthlyMinor   int64             `json:"total_monthly_cost_minor"`
	TotalSpendMinor     int64             `json:"total_spend_to_date_minor"`
	TotalValueMinor     *int64            `json:"total_realised_value_minor"`
	PortfolioROIPct     *float64          `json:"portfolio_roi_pct"`
	CancelCandidateSave int64             `json:"cancel_candidate_saving_minor"`
	Quality             DataQuality       `json:"quality"`
	Evidence            []Evidence        `json:"evidence"`
}
