package ownershipintel

import "time"

// PolicyRecord is the stored insurance underwriting baseline.
type PolicyRecord struct {
	ID                 int64
	VehicleID          int64
	Insurer            string
	PolicyRef          string
	Currency           string
	AnnualPremiumMinor int64
	DeductibleMinor    int64
	CoverageStart      time.Time
	CoverageEnd        *time.Time
	TelematicsProgram  bool
	MaxDiscountPct     float64
	Version            int
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// TariffRateRecord is one stored price band.
type TariffRateRecord struct {
	ID               int64
	TariffID         int64
	Label            string
	DayMask          int
	StartMinute      int
	EndMinute        int
	PriceMinorPerWh  float64
	TierUpperWh      *float64
	SeasonStartMonth int
	SeasonEndMonth   int
}

// TariffRecord is a stored rate plan with its bands.
type TariffRecord struct {
	ID                        int64
	Name                      string
	Provider                  string
	Currency                  string
	Structure                 string
	StandingChargeMinorPerDay float64
	DemandChargeMinorPerW     float64
	ExportPriceMinorPerWh     float64
	IsCurrent                 bool
	Version                   int
	Rates                     []TariffRateRecord
	CreatedAt                 time.Time
	UpdatedAt                 time.Time
}

// InvoiceLineRecord is one billed charging event.
type InvoiceLineRecord struct {
	ID                int64
	InvoiceID         int64
	LineRef           string
	OccurredAt        time.Time
	Location          string
	BilledEnergyWh    float64
	BilledEnergyMinor int64
	BilledIdleMinor   int64
	BilledTaxMinor    int64
	BilledTotalMinor  int64
}

// InvoiceRecord is a stored provider invoice.
type InvoiceRecord struct {
	ID               int64
	VehicleID        int64
	Provider         string
	InvoiceRef       string
	Currency         string
	PeriodStart      time.Time
	PeriodEnd        time.Time
	BilledTotalMinor int64
	Status           string
	Version          int
	Lines            []InvoiceLineRecord
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// DisputeRecord is a stored challenge against an invoice.
type DisputeRecord struct {
	ID             int64
	InvoiceID      int64
	ClaimedMinor   int64
	RecoveredMinor int64
	Status         string
	Reasons        []string
	Note           string
	OpenedAt       time.Time
	ResolvedAt     *time.Time
}

// DriverProfileRecord is a stored driver identity.
type DriverProfileRecord struct {
	ID        int64
	VehicleID int64
	Name      string
	Accent    string
	IsPrimary bool
	Version   int
	CreatedAt time.Time
	UpdatedAt time.Time
}

// AssignmentRecord attributes one drive to one driver.
type AssignmentRecord struct {
	DriveID         int64
	DriverProfileID int64
	Source          string
	ConfidencePct   float64
	AssignedAt      time.Time
}

// WarrantyRecord is a stored coverage definition.
type WarrantyRecord struct {
	ID               int64
	VehicleID        int64
	Kind             string
	Label            string
	Provider         string
	StartAt          time.Time
	StartOdometerM   float64
	TermS            int64
	TermDistanceM    float64
	CapacityFloorPct *float64
	DeductibleMinor  int64
	Currency         string
	Notes            string
	Version          int
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// ClaimRecord is a stored warranty claim.
type ClaimRecord struct {
	ID           int64
	WarrantyID   int64
	Title        string
	Status       string
	OpenedAt     time.Time
	ClosedAt     *time.Time
	AmountMinor  int64
	EvidenceNote string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// RetentionPolicyRecord is a stored lifecycle rule.
type RetentionPolicyRecord struct {
	ID                int64
	Dataset           string
	RetentionS        int64
	DownsampleAfterS  *int64
	DownsampleBucketS *int64
	LegalHold         bool
	Enabled           bool
	Version           int
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// RetentionRunRecord is a persisted dry-run result.
type RetentionRunRecord struct {
	ID               int64
	Dataset          string
	Mode             string
	RowsScanned      int64
	RowsExpiring     int64
	RowsDownsampling int64
	BytesReclaimable int64
	FidelityLossPct  float64
	BlockedByHold    bool
	ExecutedAt       time.Time
}

// PredictionRecord is a stored forecast joined to its realised outcome.
type PredictionRecord struct {
	ID             int64
	VehicleID      int64
	ModelName      string
	Target         string
	SIUnit         string
	PredictedAt    time.Time
	HorizonS       int64
	PredictedValue float64
	PredictedLow   *float64
	PredictedHigh  *float64
	Reference      string
	ObservedValue  *float64
	ObservedAt     *time.Time
	CreatedAt      time.Time
}

// JurisdictionRateRecord is a stored bounding-box taxing authority.
type JurisdictionRateRecord struct {
	ID                   int64
	JurisdictionCode     string
	Label                string
	Currency             string
	RoadUsageMinorPerM   float64
	RegistrationFeeMinor int64
	GridIntensityGPerWh  float64
	MinLat               float64
	MaxLat               float64
	MinLng               float64
	MaxLng               float64
	Version              int
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// FilingRecord is an immutable compliance snapshot.
type FilingRecord struct {
	ID               int64
	VehicleID        int64
	PeriodStart      time.Time
	PeriodEnd        time.Time
	Status           string
	TotalDistanceM   float64
	TotalEnergyWh    float64
	TotalChargeMinor int64
	Currency         string
	Digest           string
	Snapshot         []byte
	FiledAt          *time.Time
	CreatedAt        time.Time
}

// ConsumableItemRecord is a stored wear part.
type ConsumableItemRecord struct {
	ID                 int64
	VehicleID          int64
	Category           string
	Label              string
	Position           string
	InstalledAt        time.Time
	InstalledOdometerM float64
	RatedLifeM         *float64
	RatedLifeS         *int64
	CostMinor          int64
	Currency           string
	RetiredAt          *time.Time
	Notes              string
	Version            int
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// ConsumableEventRecord is a stored maintenance touchpoint.
type ConsumableEventRecord struct {
	ID         int64
	ItemID     int64
	Kind       string
	OccurredAt time.Time
	OdometerM  *float64
	CostMinor  int64
	Note       string
	CreatedAt  time.Time
}

// SubscriptionRecord is a stored paid feature.
type SubscriptionRecord struct {
	ID                    int64
	VehicleID             int64
	Name                  string
	Kind                  string
	BillingPeriod         string
	PriceMinor            int64
	Currency              string
	UsageMetric           string
	BenchmarkMinorPerUnit float64
	StartedAt             time.Time
	EndedAt               *time.Time
	Version               int
	CreatedAt             time.Time
	UpdatedAt             time.Time
}
