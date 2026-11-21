package actioncentersvc

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type coldTireDriftReader interface {
	List(context.Context, string, *int64, time.Time, int) ([]port.ColdTireCandidate, error)
}

type coldTireDriftProvider struct{ reader coldTireDriftReader }

func WithColdTireDrift(reader coldTireDriftReader) Option {
	return func(s *Service) {
		s.providers = append(s.providers, coldTireDriftProvider{reader: reader})
	}
}

func (coldTireDriftProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceColdTireDrift
}

func (p coldTireDriftProvider) Recommendations(ctx context.Context, filter ListFilter, now time.Time) ([]domain.Candidate, error) {
	if filter.SharedOpenMode {
		return nil, nil
	}
	rows, err := p.reader.List(ctx, filter.subject, filter.VehicleID, now, providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		drift := row.Drift
		key := fmt.Sprintf("cold_tire_drift:%d:%d", row.ReviewID, row.Occurrence)
		path := fmt.Sprintf("/tire-differential-drift?vehicle_id=%d#cold-tire-review", row.VehicleID)
		items = append(items, domain.Candidate{
			SourceFeature: domain.SourceColdTireDrift, SourceKey: key, DedupKey: key,
			Vehicle: &domain.VehicleRef{ID: row.VehicleID, DisplayName: row.VehicleName},
			Title:   "Check one tire manually", Summary: "One tire's cold gauge readings declined relative to the other three.",
			Rationale: "The pattern repeated across separate, comparable cold readings.",
			Priority:  domain.PriorityLow, Severity: domain.SeverityInfo, BaseConfidence: 0.72,
			ConfidenceBasis: []string{"Separate owner-entered cold gauge observations of all four wheels"},
			Evidence: []domain.EvidenceItem{{
				ID: key, Kind: "cold_tire_drift", Summary: "Cold gauge readings compared with the other wheels", ObservedAt: &drift.ObservedAt,
				ColdTireDrift: &drift, Provenance: domain.EvidenceProvenance{Source: "manual_cold_gauge"},
			}},
			SafeActions: defaultActions(), NavigationPath: &path,
			ObservedAt: &drift.ObservedAt, FreshFor: 24 * time.Hour, AgingFor: 72 * time.Hour, ExpiresAt: drift.ExpiresAt,
			Limitations: []string{"This does not diagnose a leak, set a target pressure, or replace vehicle warnings."},
		})
	}
	return items, nil
}
