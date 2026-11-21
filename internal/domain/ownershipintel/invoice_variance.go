package ownershipintel

import "time"

type MeterBoundary string

const (
	MeterBoundaryStation MeterBoundary = "station"
	MeterBoundaryBattery MeterBoundary = "battery"
)

type InvoiceMeterEvidence struct {
	ObservedBoundary MeterBoundary `json:"observed_boundary"`
	ObservedEnergyWh float64       `json:"observed_energy_wh"`
	MaxLossWh        *float64      `json:"max_loss_wh,omitempty"`
}

type InvoiceRateEvidence struct {
	Boundary    MeterBoundary `json:"boundary"`
	AmountMinor *int64        `json:"amount_minor"`
	EnergyWh    int64         `json:"energy_wh"`
}

type InvoiceVarianceEvidence struct {
	BilledBoundary MeterBoundary         `json:"billed_boundary,omitempty"`
	Meter          *InvoiceMeterEvidence `json:"meter,omitempty"`
	Rate           *InvoiceRateEvidence  `json:"rate,omitempty"`
	OtherFeesMinor *int64                `json:"other_fees_minor,omitempty"`
}

type InvoiceVarianceOptions struct {
	MaterialAmountMinor int64 `json:"material_amount_minor"`
	CompleteStatement   bool  `json:"complete_statement"`
}

type InvoiceVarianceAssessment struct {
	ExpectedEnergyLowerWh *float64 `json:"expected_energy_lower_wh,omitempty"`
	ExpectedEnergyUpperWh *float64 `json:"expected_energy_upper_wh,omitempty"`
	UnexplainedEnergyWh   *float64 `json:"unexplained_energy_wh,omitempty"`
	ExpectedEnergyMinor   *int64   `json:"expected_energy_minor,omitempty"`
	UnexplainedRateMinor  *int64   `json:"unexplained_rate_minor,omitempty"`
	ComponentsTotalMinor  *int64   `json:"components_total_minor,omitempty"`
	UnexplainedTotalMinor *int64   `json:"unexplained_total_minor,omitempty"`
}

type InvoiceVarianceFinding struct {
	LineID           int64                     `json:"line_id"`
	SessionID        *int64                    `json:"session_id,omitempty"`
	SessionStartedAt *time.Time                `json:"session_started_at,omitempty"`
	Assessment       InvoiceVarianceAssessment `json:"assessment"`
}

type InvoiceVarianceReview struct {
	State                     string                   `json:"state"`
	MatchedLines              int                      `json:"matched_lines"`
	ComparableLines           int                      `json:"comparable_lines"`
	Findings                  []InvoiceVarianceFinding `json:"findings"`
	UnexplainedStatementMinor *int64                   `json:"unexplained_statement_minor,omitempty"`
}

type InvoiceReviewScope struct {
	VehicleID       int64 `json:"vehicle_id"`
	ExpectedVersion int   `json:"expected_version"`
}

type InvoiceReviewLineInput struct {
	LineID   int64                   `json:"line_id"`
	Evidence InvoiceVarianceEvidence `json:"evidence"`
}

type UpdateInvoiceReviewRequest struct {
	InvoiceReviewScope
	Options   InvoiceVarianceOptions   `json:"variance_options"`
	Lines     []InvoiceReviewLineInput `json:"lines"`
	Confirmed bool                     `json:"confirmed"`
}
