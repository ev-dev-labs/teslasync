package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	capacityPackMeter    = "DCChargingEnergyIn"
	capacityMinTemp      = "ModuleTempMin"
	capacityMaxTemp      = "ModuleTempMax"
	capacityACPower      = "ACChargingPower"
	capacityDCPower      = "DCChargingPower"
	capacityPairMaxGap   = 90 * time.Second
	capacityConditionAge = 5 * time.Minute
)

type capacityChargeWindows interface {
	ListCapacityChargeWindows(context.Context, int64, time.Time, time.Time, int) ([]domain.CapacityChargeWindow, error)
}

type CapacityTrendHistory struct {
	windows capacityChargeWindows
	log     cabinTimeline
}

type capacityEvidence struct {
	Window      domain.CapacityChargeWindow
	Observation domain.CapacityObservation
}

func NewCapacityTrendHistory(windows capacityChargeWindows, log cabinTimeline) *CapacityTrendHistory {
	return &CapacityTrendHistory{windows: windows, log: log}
}

func (s *CapacityTrendHistory) Digest(ctx context.Context, vehicleID int64, localNow time.Time) (*domain.CapacityTrendDigest, domain.CapacityTrendReason, error) {
	end := capacityMonthStart(localNow)
	begin := end.AddDate(0, -2, 0)
	windows, err := s.windows.ListCapacityChargeWindows(ctx, vehicleID, begin, end, capacityMaxSamples+1)
	if err != nil {
		return nil, "", err
	}
	if len(windows) < 2*capacityBaselineDays || len(windows) > capacityMaxSamples {
		return nil, domain.CapacityTrendSparse, nil
	}
	observations := make([]domain.CapacityObservation, 0, len(windows))
	bySession := make(map[int64]capacityEvidence, len(windows))
	for _, window := range windows {
		sample, err := s.evidence(ctx, vehicleID, window)
		if err != nil {
			return nil, "", err
		}
		if sample != nil {
			observations = append(observations, sample.Observation)
			bySession[window.SessionID] = *sample
		}
	}
	digest, reason := EstimateMonthlyCapacityChange(observations, localNow)
	if digest == nil {
		return nil, reason, nil
	}
	evidence := make([]capacityEvidence, 0, len(digest.Sources))
	for _, source := range digest.Sources {
		evidence = append(evidence, bySession[source.SessionID])
	}
	digest.EvidenceFingerprint, err = batteryEvidenceFingerprint(evidence)
	return digest, reason, err
}

func (s *CapacityTrendHistory) evidence(ctx context.Context, vehicleID int64, window domain.CapacityChargeWindow) (*capacityEvidence, error) {
	window.StartAt, window.EndAt = window.StartAt.UTC(), window.EndAt.UTC()
	if duration := window.EndAt.Sub(window.StartAt); duration < 20*time.Minute || duration > 10*time.Hour {
		return nil, nil
	}
	fields := make([]signal.FieldMapping, 0, 6)
	for _, field := range []string{parkBattery, capacityPackMeter, capacityMinTemp, capacityMaxTemp, capacityACPower, capacityDCPower} {
		fields = append(fields, signal.FieldMapping{Signal: field, Field: field})
	}
	// Timeline is left-exclusive, but the first measurements can coincide
	// with session start. Older seed values do not qualify as measurements.
	rows, err := s.log.Timeline(ctx, vehicleID, fields, window.StartAt.Add(-time.Microsecond), window.EndAt,
		signal.TimelineOptions{MaxEvents: 8000, TrackSourceTime: true})
	if errors.Is(err, signal.ErrTimelineEventLimit) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read comparable battery charge: %w", err)
	}
	observation, ok := observedChargeCapacity(window, rows)
	if !ok {
		return nil, nil
	}
	observation.First.At, observation.Last.At = observation.First.At.UTC(), observation.Last.At.UTC()
	return &capacityEvidence{Window: window, Observation: observation}, nil
}

func (s *CapacityTrendHistory) fingerprint(ctx context.Context, vehicleID int64, windows []domain.CapacityChargeWindow) ([]byte, error) {
	if len(windows) < 2*capacityBaselineDays || len(windows) > capacityMaxSamples {
		return nil, nil
	}
	evidence := make([]capacityEvidence, 0, len(windows))
	for _, window := range windows {
		sample, err := s.evidence(ctx, vehicleID, window)
		if err != nil || sample == nil {
			return nil, err
		}
		evidence = append(evidence, *sample)
	}
	return batteryEvidenceFingerprint(evidence)
}

func observedChargeCapacity(window domain.CapacityChargeWindow, rows []signal.TimelineRow) (domain.CapacityObservation, bool) {
	out := domain.CapacityObservation{SessionID: window.SessionID}
	observedMeter := -1.0
	for _, row := range rows {
		if row.Timestamp.Before(window.StartAt) || row.Timestamp.After(window.EndAt) {
			continue
		}
		if dc, ok := signal.Float64(row.Fields[capacityDCPower]); ok && dc > 100 && row.Timestamp.Equal(row.ObservedAt[capacityDCPower]) {
			return domain.CapacityObservation{}, false
		}
		if row.Timestamp.Equal(row.ObservedAt[capacityPackMeter]) {
			meter, ok := signal.Float64(row.Fields[capacityPackMeter])
			if !ok || !finiteBetween(meter, 0, 1_000_000) || meter < observedMeter-50 {
				return domain.CapacityObservation{}, false
			}
			observedMeter = max(observedMeter, meter)
		}
		endpoint, ok := observedCapacityEndpoint(row, window.StartAt)
		if !ok {
			continue
		}
		if out.First.At.IsZero() {
			out.First = endpoint
		}
		out.Last = endpoint
	}
	_, qualified := capacityEstimate(out)
	return out, qualified
}

func observedCapacityEndpoint(row signal.TimelineRow, start time.Time) (domain.CapacityEndpoint, bool) {
	at := row.Timestamp
	if !at.Equal(sourceObservedAt(row, parkBattery)) && !at.Equal(sourceObservedAt(row, capacityPackMeter)) {
		return domain.CapacityEndpoint{}, false
	}
	fresh := func(field string, age time.Duration) bool {
		observed := sourceObservedAt(row, field)
		return !observed.Before(start) && !observed.After(at) && at.Sub(observed) <= age
	}
	if !fresh(parkBattery, capacityPairMaxGap) || !fresh(capacityPackMeter, capacityPairMaxGap) ||
		!fresh(capacityMinTemp, capacityConditionAge) || !fresh(capacityMaxTemp, capacityConditionAge) || !fresh(capacityACPower, capacityConditionAge) {
		return domain.CapacityEndpoint{}, false
	}
	battery, b := signal.Float64(row.Fields[parkBattery])
	meter, m := signal.Float64(row.Fields[capacityPackMeter])
	minTemp, lo := signal.Float64(row.Fields[capacityMinTemp])
	maxTemp, hi := signal.Float64(row.Fields[capacityMaxTemp])
	power, p := signal.Float64(row.Fields[capacityACPower])
	out := domain.CapacityEndpoint{At: at, BatteryPct: battery, PackAddedWh: meter, ModuleMinC: minTemp, ModuleMaxC: maxTemp, ChargeRateW: power}
	return out, b && m && lo && hi && p && validCapacityEndpoint(out)
}
