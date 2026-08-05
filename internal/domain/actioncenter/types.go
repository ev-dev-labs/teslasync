// Package actioncenter defines the provider-neutral decision-inbox contract.
package actioncenter

import "time"

type SourceFeature string

const (
	SourceActiveAlerts        SourceFeature = "active_alerts"
	SourceChargingReliability SourceFeature = "charging_reliability"
	SourceFleetMaintenance    SourceFeature = "fleet_maintenance"
	SourceSignalHealth        SourceFeature = "signal_health"
)

func (v SourceFeature) Valid() bool {
	switch v {
	case SourceActiveAlerts, SourceChargingReliability, SourceFleetMaintenance, SourceSignalHealth:
		return true
	default:
		return false
	}
}

type Priority string

const (
	PriorityCritical Priority = "critical"
	PriorityHigh     Priority = "high"
	PriorityMedium   Priority = "medium"
	PriorityLow      Priority = "low"
)

func (v Priority) Valid() bool {
	switch v {
	case PriorityCritical, PriorityHigh, PriorityMedium, PriorityLow:
		return true
	default:
		return false
	}
}

type Severity string

const (
	SeverityCritical Severity = "critical"
	SeverityWarning  Severity = "warning"
	SeverityInfo     Severity = "info"
)

func (v Severity) Valid() bool {
	switch v {
	case SeverityCritical, SeverityWarning, SeverityInfo:
		return true
	default:
		return false
	}
}

type ConfidenceLabel string

const (
	ConfidenceHigh   ConfidenceLabel = "high"
	ConfidenceMedium ConfidenceLabel = "medium"
	ConfidenceLow    ConfidenceLabel = "low"
)

type FreshnessStatus string

const (
	FreshnessFresh   FreshnessStatus = "fresh"
	FreshnessAging   FreshnessStatus = "aging"
	FreshnessStale   FreshnessStatus = "stale"
	FreshnessUnknown FreshnessStatus = "unknown"
)

type ActionType string

const (
	ActionAcknowledge ActionType = "acknowledge"
	ActionSnooze      ActionType = "snooze"
	ActionDismiss     ActionType = "dismiss"
	ActionRestore     ActionType = "restore"
	ActionNavigate    ActionType = "navigate"
)

func (v ActionType) ValidStateAction() bool {
	switch v {
	case ActionAcknowledge, ActionSnooze, ActionDismiss, ActionRestore:
		return true
	default:
		return false
	}
}

type State string

const (
	StateOpen         State = "open"
	StateAcknowledged State = "acknowledged"
	StateSnoozed      State = "snoozed"
	StateDismissed    State = "dismissed"
)

func (v State) Valid() bool {
	switch v {
	case StateOpen, StateAcknowledged, StateSnoozed, StateDismissed:
		return true
	default:
		return false
	}
}

type ProviderAvailability string

const (
	ProviderAvailable   ProviderAvailability = "available"
	ProviderDegraded    ProviderAvailability = "degraded"
	ProviderUnavailable ProviderAvailability = "unavailable"
)

type VehicleRef struct {
	ID          int64  `json:"id"`
	DisplayName string `json:"display_name"`
}

type Rank struct {
	Score int      `json:"score"`
	Basis []string `json:"basis"`
}

type Confidence struct {
	Score float64         `json:"score"`
	Label ConfidenceLabel `json:"label"`
	Basis []string        `json:"basis"`
}

type EvidenceProvenance struct {
	Source    string  `json:"source"`
	RecordID  string  `json:"record_id"`
	SourceURL *string `json:"source_url"`
}

type EvidenceItem struct {
	ID         string             `json:"id"`
	Kind       string             `json:"kind"`
	Summary    string             `json:"summary"`
	Provenance EvidenceProvenance `json:"provenance"`
	ObservedAt *time.Time         `json:"observed_at"`
}

type ImpactRiskLevel string

const (
	ImpactRiskLow      ImpactRiskLevel = "low"
	ImpactRiskModerate ImpactRiskLevel = "moderate"
	ImpactRiskHigh     ImpactRiskLevel = "high"
)

func (v ImpactRiskLevel) Valid() bool {
	switch v {
	case ImpactRiskLow, ImpactRiskModerate, ImpactRiskHigh:
		return true
	default:
		return false
	}
}

// ProjectedImpact is nil unless a source supplies a defensible projection.
// Measurements remain SI-canonical; risk_level is qualitative by design.
type ProjectedImpact struct {
	EnergyWh  *float64         `json:"energy_wh"`
	CostMinor *int64           `json:"cost_minor"`
	Currency  *string          `json:"currency"`
	TimeS     *int64           `json:"time_s"`
	RiskLevel *ImpactRiskLevel `json:"risk_level"`
	Basis     []string         `json:"basis"`
}

type Freshness struct {
	Status     FreshnessStatus `json:"status"`
	ObservedAt *time.Time      `json:"observed_at"`
	AgeS       *int64          `json:"age_s"`
}

type CurrentState struct {
	Status       State      `json:"status"`
	Version      int        `json:"version"`
	SnoozedUntil *time.Time `json:"snoozed_until"`
	UpdatedAt    *time.Time `json:"updated_at"`
}

type ActionEvent struct {
	ID               int64      `json:"id"`
	RecommendationID string     `json:"recommendation_id"`
	Fingerprint      string     `json:"fingerprint"`
	Action           ActionType `json:"action"`
	FromState        State      `json:"from_state"`
	ToState          State      `json:"to_state"`
	Outcome          string     `json:"outcome"`
	StateVersion     int        `json:"state_version"`
	OccurredAt       time.Time  `json:"occurred_at"`
}

type Recommendation struct {
	ID              string           `json:"id"`
	Fingerprint     string           `json:"fingerprint"`
	SourceFeature   SourceFeature    `json:"source_feature"`
	RelatedSources  []SourceFeature  `json:"related_sources"`
	Vehicle         *VehicleRef      `json:"vehicle"`
	Title           string           `json:"title"`
	Summary         string           `json:"summary"`
	Rationale       string           `json:"rationale"`
	Priority        Priority         `json:"priority"`
	Severity        Severity         `json:"severity"`
	Rank            Rank             `json:"rank"`
	Confidence      Confidence       `json:"confidence"`
	Evidence        []EvidenceItem   `json:"evidence"`
	ProjectedImpact *ProjectedImpact `json:"projected_impact"`
	SafeActions     []ActionType     `json:"safe_actions"`
	NavigationPath  *string          `json:"navigation_path"`
	ExpiresAt       time.Time        `json:"expires_at"`
	Freshness       Freshness        `json:"freshness"`
	Limitations     []string         `json:"limitations"`
	CurrentState    CurrentState     `json:"current_state"`
	ActionHistory   []ActionEvent    `json:"action_history"`
}

type ProviderStatus struct {
	SourceFeature SourceFeature        `json:"source_feature"`
	Status        ProviderAvailability `json:"status"`
	ItemCount     int                  `json:"item_count"`
	Limitations   []string             `json:"limitations"`
}

type Summary struct {
	Open         int `json:"open"`
	Acknowledged int `json:"acknowledged"`
	Snoozed      int `json:"snoozed"`
	Dismissed    int `json:"dismissed"`
	Critical     int `json:"critical"`
	High         int `json:"high"`
}

type Response struct {
	Items          []Recommendation `json:"items"`
	Total          int              `json:"total"`
	Limit          int              `json:"limit"`
	Offset         int              `json:"offset"`
	GeneratedAt    time.Time        `json:"generated_at"`
	Summary        Summary          `json:"summary"`
	ProviderStatus []ProviderStatus `json:"provider_status"`
}

type ActionResult struct {
	Recommendation Recommendation `json:"recommendation"`
	Event          ActionEvent    `json:"event"`
}

type HistoryPage struct {
	Items  []ActionEvent `json:"items"`
	Total  int           `json:"total"`
	Limit  int           `json:"limit"`
	Offset int           `json:"offset"`
}

// Candidate is the normalized provider output before rank, confidence,
// fingerprint, state, and pagination are applied.
type Candidate struct {
	SourceFeature   SourceFeature
	SourceKey       string
	DedupKey        string
	Vehicle         *VehicleRef
	Title           string
	Summary         string
	Rationale       string
	Priority        Priority
	Severity        Severity
	BaseConfidence  float64
	ConfidenceBasis []string
	Evidence        []EvidenceItem
	ProjectedImpact *ProjectedImpact
	SafeActions     []ActionType
	NavigationPath  *string
	ObservedAt      *time.Time
	FreshFor        time.Duration
	AgingFor        time.Duration
	ExpiresAt       time.Time
	Limitations     []string
}

// Source records are deliberately minimal facts. Providers, not repositories,
// decide whether those facts warrant a recommendation.
type AlertRecord struct {
	LogID          int64
	AlertID        int64
	Vehicle        *VehicleRef
	Title          string
	Message        string
	Severity       string
	DeliveryStatus string
	CreatedAt      time.Time
}

type ChargingRecord struct {
	SessionID   int64
	Vehicle     VehicleRef
	StartedAt   time.Time
	StartSocPct *float64
	StartPlace  *string
}

type WorkOrderRecord struct {
	ID               int64
	Vehicle          VehicleRef
	Title            string
	Description      *string
	Status           string
	Severity         string
	DueAt            *time.Time
	ScheduledStartAt *time.Time
	ScheduledEndAt   *time.Time
	CostMinor        *int64
	Currency         *string
	UpdatedAt        time.Time
}

type SignalHealthRecord struct {
	Vehicle        VehicleRef
	LatestSignalAt *time.Time
	CheckedAt      time.Time
}
