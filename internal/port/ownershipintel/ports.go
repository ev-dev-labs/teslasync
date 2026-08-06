package ownershipintel

import (
	"context"
	"errors"
	"time"
)

var (
	// ErrNotFound is returned when a subject-scoped record does not exist.
	ErrNotFound = errors.New("ownership intelligence record not found")
	// ErrConflict is returned when a uniqueness constraint rejects a write.
	ErrConflict = errors.New("ownership intelligence record already exists")
)

// DriveRecord is one completed drive projected into SI canonical units. It is
// the shared evidence row for insurance risk, driver fingerprinting,
// jurisdictional apportionment, and consumable duty-cycle stress.
type DriveRecord struct {
	ID             int64
	StartedAt      time.Time
	EndedAt        *time.Time
	DistanceM      *float64
	DurationS      *int64
	EnergyUsedWh   *float64
	RegenEnergyWh  *float64
	AvgSpeedMps    *float64
	MaxSpeedMps    *float64
	AvgPowerW      *float64
	PeakPowerW     *float64
	AmbientTempC   *float64
	StartLat       *float64
	StartLng       *float64
	EndLat         *float64
	EndLng         *float64
	StartOdometerM *float64
	EndOdometerM   *float64
	StartPlace     string
	EndPlace       string
}

// ChargeRecord is one charging session projected into SI canonical units with
// money already normalised to ISO-4217 minor units.
type ChargeRecord struct {
	ID            int64
	StartedAt     time.Time
	EndedAt       *time.Time
	EnergyAddedWh *float64
	PeakPowerW    *float64
	AvgPowerW     *float64
	DeltaSOCPct   *float64
	CostMinor     *int64
	CostCurrency  string
	ChargerType   string
	StartPlace    string
	StartLat      *float64
	StartLng      *float64
}

// VehicleSnapshot carries the odometer and battery-retention context needed by
// warranty coverage and consumable lifecycle projection.
type VehicleSnapshot struct {
	VehicleID          int64
	DisplayName        string
	VIN                string
	EnrolledAt         *time.Time
	OdometerM          *float64
	FirstOdometerM     *float64
	FirstObservedAt    *time.Time
	LastObservedAt     *time.Time
	BaselineCapacityWh *float64
	RecentCapacityWh   *float64
	CapacitySamples    int
}

// DatasetStat is the live storage footprint of one governed dataset.
type DatasetStat struct {
	Dataset      string
	RowCount     int64
	TotalBytes   int64
	OldestAt     *time.Time
	NewestAt     *time.Time
	IsHypertable bool
}

// SourceRepository reads existing telemetry-derived evidence. It never writes.
type SourceRepository interface {
	ListDrives(ctx context.Context, vehicleID int64, from, to time.Time) ([]DriveRecord, error)
	ListCharges(ctx context.Context, vehicleID int64, from, to time.Time) ([]ChargeRecord, error)
	VehicleSnapshot(ctx context.Context, vehicleID int64) (*VehicleSnapshot, error)
	DatasetStats(ctx context.Context, datasets []string) ([]DatasetStat, error)
	DatasetExpiry(ctx context.Context, dataset string, cutoff, downsampleCutoff time.Time) (scanned, expiring, downsampling int64, err error)
}

// InsuranceRepository persists underwriting baselines.
type InsuranceRepository interface {
	// GetPolicy returns (nil, nil) when the subject has not configured a policy
	// for the vehicle yet; that is an expected empty state, not an error.
	GetPolicy(ctx context.Context, subject string, vehicleID int64) (*PolicyRecord, error)
	UpsertPolicy(ctx context.Context, subject string, record PolicyRecord) (*PolicyRecord, error)
	DeletePolicy(ctx context.Context, subject string, id int64) error
}

// TariffRepository persists user-authored rate plans and their bands.
type TariffRepository interface {
	ListTariffs(ctx context.Context, subject string, limit, offset int) ([]TariffRecord, int, error)
	GetTariffs(ctx context.Context, subject string, ids []int64) ([]TariffRecord, error)
	CreateTariff(ctx context.Context, subject string, record TariffRecord) (*TariffRecord, error)
	DeleteTariff(ctx context.Context, subject string, id int64) error
}

// InvoiceRepository persists provider invoices, lines, and disputes.
type InvoiceRepository interface {
	ListInvoices(ctx context.Context, subject string, vehicleID int64, limit, offset int) ([]InvoiceRecord, int, error)
	GetInvoice(ctx context.Context, subject string, id int64) (*InvoiceRecord, error)
	CreateInvoice(ctx context.Context, subject string, record InvoiceRecord) (*InvoiceRecord, error)
	DeleteInvoice(ctx context.Context, subject string, id int64) error
	CreateDispute(ctx context.Context, subject string, record DisputeRecord) (*DisputeRecord, error)
	ListDisputes(ctx context.Context, subject string, invoiceID int64) ([]DisputeRecord, error)
}

// DriverRepository persists driver identities and drive attributions.
type DriverRepository interface {
	ListProfiles(ctx context.Context, subject string, vehicleID int64) ([]DriverProfileRecord, error)
	CreateProfile(ctx context.Context, subject string, record DriverProfileRecord) (*DriverProfileRecord, error)
	DeleteProfile(ctx context.Context, subject string, id int64) error
	ListAssignments(ctx context.Context, subject string, vehicleID int64, from, to time.Time) ([]AssignmentRecord, error)
	UpsertAssignment(ctx context.Context, subject string, record AssignmentRecord) error
}

// WarrantyRepository persists coverage definitions and claims.
type WarrantyRepository interface {
	ListWarranties(ctx context.Context, subject string, vehicleID int64) ([]WarrantyRecord, error)
	CreateWarranty(ctx context.Context, subject string, record WarrantyRecord) (*WarrantyRecord, error)
	DeleteWarranty(ctx context.Context, subject string, id int64) error
	ListClaims(ctx context.Context, subject string, vehicleID int64) ([]ClaimRecord, error)
	CreateClaim(ctx context.Context, subject string, record ClaimRecord) (*ClaimRecord, error)
}

// GovernanceRepository persists lifecycle policies and dry-run history.
type GovernanceRepository interface {
	ListRetentionPolicies(ctx context.Context, subject string) ([]RetentionPolicyRecord, error)
	UpsertRetentionPolicy(ctx context.Context, subject string, record RetentionPolicyRecord) (*RetentionPolicyRecord, error)
	DeleteRetentionPolicy(ctx context.Context, subject string, id int64) error
	RecordRuns(ctx context.Context, subject string, records []RetentionRunRecord) error
	ListRuns(ctx context.Context, subject string, limit, offset int) ([]RetentionRunRecord, int, error)
}

// ModelTrustRepository persists forecasts and their realised outcomes.
type ModelTrustRepository interface {
	CreatePrediction(ctx context.Context, subject string, record PredictionRecord) (*PredictionRecord, error)
	RecordOutcome(ctx context.Context, subject string, id int64, value float64, observedAt time.Time) (*PredictionRecord, error)
	ListPredictions(ctx context.Context, subject string, vehicleID int64, from, to time.Time) ([]PredictionRecord, error)
}

// ComplianceRepository persists jurisdiction rates and immutable filings.
type ComplianceRepository interface {
	ListRates(ctx context.Context, subject string) ([]JurisdictionRateRecord, error)
	CreateRate(ctx context.Context, subject string, record JurisdictionRateRecord) (*JurisdictionRateRecord, error)
	DeleteRate(ctx context.Context, subject string, id int64) error
	ListFilings(ctx context.Context, subject string, vehicleID int64, limit, offset int) ([]FilingRecord, int, error)
	CreateFiling(ctx context.Context, subject string, record FilingRecord) (*FilingRecord, error)
}

// ConsumablesRepository persists wear parts and their maintenance events.
type ConsumablesRepository interface {
	ListItems(ctx context.Context, subject string, vehicleID int64) ([]ConsumableItemRecord, error)
	CreateItem(ctx context.Context, subject string, record ConsumableItemRecord) (*ConsumableItemRecord, error)
	DeleteItem(ctx context.Context, subject string, id int64) error
	ListEvents(ctx context.Context, subject string, vehicleID int64) ([]ConsumableEventRecord, error)
	CreateEvent(ctx context.Context, subject string, record ConsumableEventRecord) (*ConsumableEventRecord, error)
}

// SubscriptionRepository persists paid features scored for ROI.
type SubscriptionRepository interface {
	ListSubscriptions(ctx context.Context, subject string, vehicleID int64) ([]SubscriptionRecord, error)
	CreateSubscription(ctx context.Context, subject string, record SubscriptionRecord) (*SubscriptionRecord, error)
	DeleteSubscription(ctx context.Context, subject string, id int64) error
}

// DurableRepository is the aggregate write port implemented by one adapter.
type DurableRepository interface {
	InsuranceRepository
	TariffRepository
	InvoiceRepository
	DriverRepository
	WarrantyRepository
	GovernanceRepository
	ModelTrustRepository
	ComplianceRepository
	ConsumablesRepository
	SubscriptionRepository
}
