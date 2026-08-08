package serviceintelligence

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/integrations/nhtsa"
)

const EvidenceSchemaVersion = "1.0.0"

type VehicleMetadata struct {
	ID              int64
	VIN             string `json:"-"`
	StoredModel     *string
	FirmwareVersion *string
}

type SignalObservation struct {
	Signal      string
	Value       float64
	Baseline    float64
	Deviation   float64
	SampleCount int
	ObservedAt  time.Time
}

type VehicleReader interface {
	GetVehicleMetadata(ctx context.Context, vehicleID int64) (*VehicleMetadata, error)
}

type ObservationReader interface {
	RecentObservations(ctx context.Context, vehicleID int64, start, end time.Time, limit int) ([]SignalObservation, error)
}

type IntelligenceService interface {
	Get(ctx context.Context, vehicleID int64, refresh bool) (*Response, error)
}

type Response struct {
	VehicleID      int64                  `json:"vehicle_id"`
	GeneratedAt    time.Time              `json:"generated_at"`
	VehicleContext VehicleContext         `json:"vehicle_context"`
	Summary        InventorySummary       `json:"summary"`
	RecallFindings []Finding              `json:"recall_findings"`
	Communications []CommunicationFinding `json:"communications"`
	RankedSymptoms []SymptomMatch         `json:"ranked_symptoms"`
	Evidence       EvidenceBundle         `json:"evidence"`
	Sources        []nhtsa.SourceMetadata `json:"sources"`
}

type VehicleContext struct {
	Make            string  `json:"make"`
	Model           string  `json:"model"`
	ModelYear       int     `json:"model_year"`
	BuildDate       *string `json:"build_date"`
	BuildMatchBasis string  `json:"build_match_basis"`
	PlantCountry    *string `json:"plant_country"`
	PlantState      *string `json:"plant_state"`
	PlantCity       *string `json:"plant_city"`
	FirmwareVersion *string `json:"firmware_version"`
}

type InventorySummary struct {
	RecallCandidates             int `json:"recall_candidates"`
	PotentiallyApplicableRecalls int `json:"potentially_applicable_recalls"`
	ManufacturerCommunications   int `json:"manufacturer_communications"`
	SymptomMatches               int `json:"symptom_matches"`
}

type Finding struct {
	ID                string         `json:"id"`
	Kind              string         `json:"kind"`
	Title             string         `json:"title"`
	Component         string         `json:"component"`
	Summary           string         `json:"summary"`
	Consequence       string         `json:"consequence"`
	Remedy            string         `json:"remedy"`
	ReportReceivedAt  *time.Time     `json:"report_received_at"`
	Applicability     string         `json:"applicability"`
	Confidence        float64        `json:"confidence"`
	ConfidenceLabel   string         `json:"confidence_label"`
	CompletionStatus  string         `json:"completion_status"`
	Hypothesis        string         `json:"hypothesis"`
	MatchFactors      []MatchFactor  `json:"match_factors"`
	SymptomMatches    []SymptomMatch `json:"symptom_matches"`
	ParkIt            bool           `json:"park_it"`
	ParkOutside       bool           `json:"park_outside"`
	OverTheAirUpdate  bool           `json:"over_the_air_update"`
	SourceDocumentURL string         `json:"source_document_url"`
}

type CommunicationFinding struct {
	ID                  string         `json:"id"`
	NHTSAID             string         `json:"nhtsa_id"`
	CommunicationNumber string         `json:"communication_number"`
	CommunicationType   string         `json:"communication_type"`
	Manufacturer        string         `json:"manufacturer"`
	Model               string         `json:"model"`
	ModelYear           int            `json:"model_year"`
	PublishedAt         *time.Time     `json:"published_at"`
	Component           string         `json:"component"`
	Summary             string         `json:"summary"`
	Applicability       string         `json:"applicability"`
	Confidence          float64        `json:"confidence"`
	ConfidenceLabel     string         `json:"confidence_label"`
	Hypothesis          string         `json:"hypothesis"`
	MatchFactors        []MatchFactor  `json:"match_factors"`
	SymptomMatches      []SymptomMatch `json:"symptom_matches"`
	SourceDocumentURL   string         `json:"source_document_url"`
}

type MatchFactor struct {
	Dimension string  `json:"dimension"`
	Status    string  `json:"status"`
	Weight    float64 `json:"weight"`
	Detail    string  `json:"detail"`
}

type SymptomMatch struct {
	FindingID  string    `json:"finding_id"`
	Signal     string    `json:"signal"`
	Component  string    `json:"component"`
	Severity   string    `json:"severity"`
	ObservedAt time.Time `json:"observed_at"`
	Score      float64   `json:"score"`
	Evidence   string    `json:"evidence"`
}

type EvidenceBundle struct {
	SchemaVersion string         `json:"schema_version"`
	Items         []EvidenceItem `json:"items"`
	Limitations   []string       `json:"limitations"`
	Disclaimer    string         `json:"disclaimer"`
}

type EvidenceItem struct {
	ID                string     `json:"id"`
	Kind              string     `json:"kind"`
	Title             string     `json:"title"`
	Summary           string     `json:"summary"`
	SourceName        string     `json:"source_name"`
	SourceDocumentURL *string    `json:"source_document_url"`
	ObservedAt        *time.Time `json:"observed_at"`
	Confidence        *float64   `json:"confidence"`
	FindingID         *string    `json:"finding_id"`
}
