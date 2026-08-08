// Package advancedintelligencesvc contains deterministic advanced
// intelligence engines. It intentionally has no observability dependency.
package advancedintelligencesvc

import (
	"errors"
	"math"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/advancedintelligence"
	port "github.com/ev-dev-labs/teslasync/internal/port/advancedintelligence"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

var (
	ErrInvalidInput = errors.New("invalid advanced intelligence input")
	ErrNotConfirmed = errors.New("advanced intelligence request is not confirmed")
)

const (
	defaultLimit = 25
	maxLimit     = 100
)

type Service struct {
	source  port.SourceRepository
	state   signal.StateReader
	durable port.DurableRepository
	now     func() time.Time
}

func New(
	source port.SourceRepository,
	state signal.StateReader,
	durable port.DurableRepository,
) *Service {
	if source == nil || state == nil || durable == nil {
		panic("advancedintelligencesvc.New: dependencies must not be nil")
	}
	return &Service{
		source:  source,
		state:   state,
		durable: durable,
		now:     func() time.Time { return time.Now().UTC() },
	}
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

func quality(
	status domain.QualityStatus,
	samples int,
	coverage *float64,
	start, end *time.Time,
	reasons ...string,
) domain.DataQuality {
	return domain.DataQuality{
		Status:      status,
		SampleCount: samples,
		CoveragePct: coverage,
		WindowStart: start,
		WindowEnd:   end,
		Reasons:     nonNilStrings(reasons),
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
	if values == nil {
		return []string{}
	}
	return values
}

func clamp(value, low, high float64) float64 {
	return math.Max(low, math.Min(high, value))
}

func pointer(value float64) *float64 { return &value }
func intPointer(value int) *int      { return &value }
func timePointer(value time.Time) *time.Time {
	value = value.UTC()
	return &value
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

func cleanToken(value string, maxLength int) string {
	value = strings.TrimSpace(value)
	if len(value) > maxLength {
		return ""
	}
	return value
}
