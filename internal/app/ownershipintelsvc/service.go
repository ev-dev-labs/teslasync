// Package ownershipintelsvc contains the deterministic ownership intelligence
// engines. It has no observability or transport dependency so every engine is
// unit-testable in isolation.
package ownershipintelsvc

import (
	"errors"
	"math"
	"sort"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

var (
	// ErrInvalidInput marks a caller mistake that maps to HTTP 400.
	ErrInvalidInput = errors.New("invalid ownership intelligence input")
	// ErrNotConfirmed marks a mutating request that skipped its confirmation gate.
	ErrNotConfirmed = errors.New("ownership intelligence request is not confirmed")
)

const (
	defaultLimit      = 25
	maxLimit          = 100
	defaultWindowDays = 90
	maxWindowDays     = 1095
	secondsPerDay     = 86400.0
)

// Service is the composition root for all ten ownership intelligence engines.
type Service struct {
	source  port.SourceRepository
	durable port.DurableRepository
	now     func() time.Time
}

// New builds the service. Both dependencies are mandatory.
func New(source port.SourceRepository, durable port.DurableRepository) *Service {
	if source == nil || durable == nil {
		panic("ownershipintelsvc.New: dependencies must not be nil")
	}
	return &Service{
		source:  source,
		durable: durable,
		now:     func() time.Time { return time.Now().UTC() },
	}
}

// WithClock overrides the clock. Tests use it to pin deterministic windows.
func (s *Service) WithClock(clock func() time.Time) *Service {
	if clock != nil {
		s.now = clock
	}
	return s
}

func normalizePage(limit, offset int) (int, int) {
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func (s *Service) window(days int) domain.Window {
	if days <= 0 {
		days = defaultWindowDays
	}
	if days > maxWindowDays {
		days = maxWindowDays
	}
	to := s.now().UTC()
	from := to.AddDate(0, 0, -days)
	return domain.Window{From: from, To: to, Days: days}
}

func quality(
	status domain.QualityStatus,
	samples int,
	coverage *float64,
	window domain.Window,
	reasons ...string,
) domain.DataQuality {
	start := window.From
	end := window.To
	return domain.DataQuality{
		Status:      status,
		SampleCount: samples,
		CoveragePct: coverage,
		WindowStart: &start,
		WindowEnd:   &end,
		Reasons:     nonNilStrings(reasons),
	}
}

// gradeQuality picks a status from sample volume against two thresholds.
func gradeQuality(samples, limited, sufficient int) domain.QualityStatus {
	switch {
	case samples >= sufficient:
		return domain.QualitySufficient
	case samples >= limited:
		return domain.QualityLimited
	default:
		return domain.QualityInsufficient
	}
}

func evidence(source string, observedAt *time.Time, samples *int, summary string) domain.Evidence {
	return domain.Evidence{
		Source:      source,
		ObservedAt:  observedAt,
		SampleCount: samples,
		Summary:     summary,
	}
}

func nonNilStrings(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			out = append(out, value)
		}
	}
	return out
}

func clamp(value, low, high float64) float64 {
	return math.Max(low, math.Min(high, value))
}

func pointer[T any](value T) *T { return &value }

func deref(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func derefI64(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func safeDiv(numerator, denominator float64) *float64 {
	if denominator == 0 || math.IsNaN(denominator) || math.IsInf(denominator, 0) {
		return nil
	}
	result := numerator / denominator
	if math.IsNaN(result) || math.IsInf(result, 0) {
		return nil
	}
	return &result
}

func roundMinor(value float64) int64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	return int64(math.Round(value))
}

func pageSlice[T any](items []T, limit, offset int) ([]T, int) {
	total := len(items)
	if offset >= total {
		return []T{}, total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return append([]T(nil), items[offset:end]...), total
}

func percentileOf(sorted []float64, value float64) *float64 {
	if len(sorted) == 0 {
		return nil
	}
	index := sort.SearchFloat64s(sorted, value)
	pct := float64(index) / float64(len(sorted)) * 100
	return &pct
}

func median(values []float64) *float64 {
	if len(values) == 0 {
		return nil
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	middle := len(sorted) / 2
	if len(sorted)%2 == 1 {
		return &sorted[middle]
	}
	value := (sorted[middle-1] + sorted[middle]) / 2
	return &value
}

func mean(values []float64) *float64 {
	if len(values) == 0 {
		return nil
	}
	total := 0.0
	for _, value := range values {
		total += value
	}
	return safeDiv(total, float64(len(values)))
}

func stddev(values []float64) float64 {
	if len(values) < 2 {
		return 0
	}
	average := deref(mean(values))
	sum := 0.0
	for _, value := range values {
		delta := value - average
		sum += delta * delta
	}
	return math.Sqrt(sum / float64(len(values)-1))
}

// validCurrency enforces the ISO-4217 alpha-3 shape used by every money column.
func validCurrency(code string) (string, bool) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if len(code) != 3 {
		return "", false
	}
	for _, r := range code {
		if r < 'A' || r > 'Z' {
			return "", false
		}
	}
	return code, true
}

func cleanText(value string, maxLength int) (string, bool) {
	value = strings.TrimSpace(value)
	if len(value) > maxLength {
		return "", false
	}
	return value, true
}

func requireText(value string, maxLength int) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > maxLength {
		return "", false
	}
	return value, true
}

func requirePositive(value int64) bool { return value > 0 }
func requireNonNeg(value int64) bool   { return value >= 0 }
func requireNonNegF(value float64) bool {
	return value >= 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}
