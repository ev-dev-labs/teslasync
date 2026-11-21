package smartreadinesssvc

import (
	"context"
	"math"
	"slices"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

const (
	coldTireEvidenceWindow  = 30 * 24 * time.Hour
	coldTireFreshness       = 72 * time.Hour
	coldTireMinSpacing      = 18 * time.Hour
	coldTireMinSpan         = 7 * 24 * time.Hour
	coldTireComparableTemp  = 5
	coldTireMinDropPa       = 12_000
	coldTireNoisePa         = 3_000
	coldTireMaxPeerSpreadPa = 6_000
	coldTireMinReadings     = 5
)

var coldTireCorners = [...]domain.TireCorner{
	domain.TireFrontLeft, domain.TireFrontRight, domain.TireRearLeft, domain.TireRearRight,
}

type ColdTireChecks struct {
	repo port.ColdTireRepository
	now  func() time.Time
}

func NewColdTireChecks(repo port.ColdTireRepository, now func() time.Time) *ColdTireChecks {
	return &ColdTireChecks{repo: repo, now: now}
}

func validColdTireScope(scope port.ColdTireScope) bool {
	return scope.VehicleID > 0 && privatePlanningSubject(scope.Subject)
}

func (s *ColdTireChecks) Read(ctx context.Context, scope port.ColdTireScope) (domain.ColdTireReview, error) {
	if !validColdTireScope(scope) {
		return domain.ColdTireReview{}, ErrInvalidInput
	}
	return s.repo.ReadColdTireReview(ctx, scope, s.now().UTC())
}

func (s *ColdTireChecks) Append(ctx context.Context, scope port.ColdTireScope, seriesID int64, reading domain.ColdTireReading) (
	domain.ColdTireDriftReason, bool, error,
) {
	now := s.now().UTC()
	from := now.Add(-coldTireEvidenceWindow)
	if !validColdTireScope(scope) || seriesID < 0 || !validColdTireReading(reading, now) || reading.ObservedAt.Before(from) {
		return "", false, ErrInvalidInput
	}
	reading.ObservedAt = reading.ObservedAt.UTC().Truncate(time.Microsecond)
	return s.repo.AppendColdTireReading(ctx, scope, seriesID, reading,
		port.ColdTireWindow{Now: now, From: from, MinSpacing: coldTireMinSpacing}, func(rows []domain.ColdTireReading) (*domain.ColdTireDrift, domain.ColdTireDriftReason) {
			return EvaluateColdTireDrift(rows, now)
		})
}

func (s *ColdTireChecks) Delete(ctx context.Context, scope port.ColdTireScope, seriesID int64) error {
	if !validColdTireScope(scope) || seriesID <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DeleteColdTireReview(ctx, scope, seriesID)
}

func (s *ColdTireChecks) List(ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int) ([]port.ColdTireCandidate, error) {
	if !privatePlanningSubject(subject) {
		return nil, nil
	}
	return s.repo.ListColdTireDrift(ctx, subject, vehicleID, now, min(max(limit, 1), 50))
}

func validColdTireReading(reading domain.ColdTireReading, now time.Time) bool {
	if !reading.ColdGaugeConfirmed || reading.ObservedAt.IsZero() || reading.ObservedAt.After(now) ||
		!finiteBetween(reading.AmbientC, -45, 50) {
		return false
	}
	for _, pressure := range reading.PressuresPa() {
		if !finiteBetween(pressure, 50_000, 700_000) {
			return false
		}
	}
	return true
}

func EvaluateColdTireDrift(readings []domain.ColdTireReading, now time.Time) (*domain.ColdTireDrift, domain.ColdTireDriftReason) {
	if len(readings) == 0 {
		return nil, domain.ColdTireDriftNoRecentReading
	}
	ordered := slices.Clone(readings)
	slices.SortFunc(ordered, func(a, b domain.ColdTireReading) int { return b.ObservedAt.Compare(a.ObservedAt) })
	latest := ordered[0]
	if !validColdTireReading(latest, now) {
		return nil, domain.ColdTireDriftInvalidReading
	}
	if now.Sub(latest.ObservedAt) >= coldTireFreshness {
		return nil, domain.ColdTireDriftNoRecentReading
	}
	qualified := make([]domain.ColdTireReading, 0, len(ordered))
	for _, reading := range ordered {
		if now.Sub(reading.ObservedAt) > coldTireEvidenceWindow {
			break
		}
		if !validColdTireReading(reading, now) {
			return nil, domain.ColdTireDriftInvalidReading
		}
		if math.Abs(reading.AmbientC-latest.AmbientC) > coldTireComparableTemp ||
			(len(qualified) > 0 && qualified[len(qualified)-1].ObservedAt.Sub(reading.ObservedAt) < coldTireMinSpacing) {
			continue
		}
		qualified = append(qualified, reading)
	}
	slices.Reverse(qualified)
	if len(qualified) < coldTireMinReadings || latest.ObservedAt.Sub(qualified[0].ObservedAt) < coldTireMinSpan {
		return nil, domain.ColdTireDriftInsufficientEvidence
	}
	var result *domain.ColdTireDrift
	for index, corner := range coldTireCorners {
		drop, ok := repeatedRelativeDrop(qualified, index)
		if !ok {
			continue
		}
		if result != nil {
			return nil, domain.ColdTireDriftNoRepeatedDrift
		}
		result = &domain.ColdTireDrift{
			Corner: corner, Count: len(qualified), BaselineAt: qualified[0].ObservedAt, ObservedAt: latest.ObservedAt,
			ExpiresAt: latest.ObservedAt.Add(coldTireFreshness), RelativeDropPa: drop, LastGaugePressurePa: latest.PressuresPa()[index],
		}
	}
	if result == nil {
		return nil, domain.ColdTireDriftNoRepeatedDrift
	}
	return result, domain.ColdTireDriftEligible
}

func repeatedRelativeDrop(readings []domain.ColdTireReading, corner int) (float64, bool) {
	residuals := make([]float64, len(readings))
	var peerChanges [3]float64
	start, end := readings[0].PressuresPa(), readings[len(readings)-1].PressuresPa()
	for i, reading := range readings {
		pressures := reading.PressuresPa()
		var peers [3]float64
		var other int
		for wheel, pressure := range pressures {
			if wheel != corner {
				peers[other] = pressure
				peerChanges[other] = end[wheel] - start[wheel]
				other++
			}
		}
		residuals[i] = pressures[corner] - medianThree(peers)
	}
	if slices.Max(peerChanges[:])-slices.Min(peerChanges[:]) > coldTireMaxPeerSpreadPa {
		return 0, false
	}
	baseline := medianThree([3]float64{residuals[0], residuals[1], residuals[2]})
	drop := baseline - max(residuals[len(residuals)-1], residuals[len(residuals)-2])
	if drop < coldTireMinDropPa {
		return 0, false
	}
	changes, largestStep := 0, 0.0
	for i := 1; i < len(residuals); i++ {
		step := residuals[i-1] - residuals[i]
		if step < -coldTireNoisePa {
			return 0, false
		}
		if step >= coldTireNoisePa {
			changes++
			largestStep = max(largestStep, step)
		}
	}
	// A single adjustment followed by flat readings is not repeated drift.
	return drop, changes >= 3 && largestStep*2 < residuals[0]-residuals[len(residuals)-1]
}

func medianThree(values [3]float64) float64 {
	slices.Sort(values[:])
	return values[1]
}
