package ownershipintel

import "time"

// QualityStatus mirrors the advanced intelligence vocabulary so the frontend
// can reuse one badge component across every intelligence product.
type QualityStatus string

const (
	QualitySufficient   QualityStatus = "sufficient"
	QualityLimited      QualityStatus = "limited"
	QualityInsufficient QualityStatus = "insufficient"
)

// DataQuality explains how much evidence backs a computed answer. Engines never
// fabricate a zero when evidence is missing; they downgrade status instead.
type DataQuality struct {
	Status      QualityStatus `json:"status"`
	SampleCount int           `json:"sample_count"`
	CoveragePct *float64      `json:"coverage_pct"`
	WindowStart *time.Time    `json:"window_start"`
	WindowEnd   *time.Time    `json:"window_end"`
	Reasons     []string      `json:"reasons"`
}

// Evidence is one traceable observation that contributed to a result.
type Evidence struct {
	Source      string     `json:"source"`
	ObservedAt  *time.Time `json:"observed_at"`
	SampleCount *int       `json:"sample_count"`
	Summary     string     `json:"summary"`
}

// Page is the shared list envelope for every paginated ownership endpoint.
type Page[T any] struct {
	Items  []T `json:"items"`
	Total  int `json:"total"`
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

// Window is the resolved analysis interval echoed back to the client.
type Window struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
	Days int       `json:"days"`
}

func Float64Pointer(value float64) *float64 { return &value }
func IntPointer(value int) *int             { return &value }
func TimePointer(value time.Time) *time.Time {
	value = value.UTC()
	return &value
}
