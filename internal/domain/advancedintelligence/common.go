// Package advancedintelligence defines transport-neutral contracts for the
// advanced intelligence products.
package advancedintelligence

import "time"

type QualityStatus string

const (
	QualitySufficient   QualityStatus = "sufficient"
	QualityLimited      QualityStatus = "limited"
	QualityInsufficient QualityStatus = "insufficient"
)

type DataQuality struct {
	Status      QualityStatus `json:"status"`
	SampleCount int           `json:"sample_count"`
	CoveragePct *float64      `json:"coverage_pct"`
	WindowStart *time.Time    `json:"window_start"`
	WindowEnd   *time.Time    `json:"window_end"`
	Reasons     []string      `json:"reasons"`
}

type Evidence struct {
	Source      string     `json:"source"`
	ObservedAt  *time.Time `json:"observed_at"`
	SampleCount *int       `json:"sample_count"`
	Summary     string     `json:"summary"`
}

type Page[T any] struct {
	Items  []T `json:"items"`
	Total  int `json:"total"`
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

func Float64Pointer(value float64) *float64 { return &value }
func Int64Pointer(value int64) *int64       { return &value }
