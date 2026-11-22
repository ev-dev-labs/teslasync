package smartreadiness

import "time"

type CapacityEndpoint struct {
	At          time.Time
	BatteryPct  float64
	PackAddedWh float64
	ModuleMinC  float64
	ModuleMaxC  float64
	ChargeRateW float64
}

type CapacityObservation struct {
	SessionID int64
	First     CapacityEndpoint
	Last      CapacityEndpoint
}

type CapacityChargeWindow struct {
	SessionID int64
	StartAt   time.Time
	EndAt     time.Time
}

type CapacityRange struct {
	LowWh  float64 `json:"low_wh"`
	HighWh float64 `json:"high_wh"`
}

type CapacityTrendDigest struct {
	BaselineFrom        time.Time              `json:"baseline_from"`
	RecentFrom          time.Time              `json:"recent_from"`
	RecentTo            time.Time              `json:"recent_to"`
	ObservedTo          time.Time              `json:"observed_to"`
	Baseline            CapacityRange          `json:"baseline"`
	Recent              CapacityRange          `json:"recent"`
	Change              CapacityRange          `json:"change"`
	BaselineDays        int                    `json:"baseline_days"`
	RecentDays          int                    `json:"recent_days"`
	ExpiresAt           time.Time              `json:"expires_at"`
	Sources             []CapacityChargeWindow `json:"-"`
	SourceWindows       []CapacityChargeWindow `json:"-"`
	EvidenceFingerprint []byte                 `json:"-"`
}

type CapacityTrendPlan struct {
	ID       int64                `json:"id"`
	TimeZone string               `json:"time_zone"`
	Paused   bool                 `json:"paused"`
	Digest   *CapacityTrendDigest `json:"digest,omitempty"`
}

type CapacityTrendSettings struct {
	Plan *CapacityTrendPlan `json:"plan"`
}

type CapacityTrendReason string

const (
	CapacityTrendSparse  CapacityTrendReason = "insufficient_comparable_charge_days"
	CapacityTrendWithin  CapacityTrendReason = "within_uncertainty_or_transient"
	CapacityTrendChanged CapacityTrendReason = "persistent_estimated_change"
)
