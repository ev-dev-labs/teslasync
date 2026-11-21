package actioncentersvc

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type climateScheduleReader interface {
	List(context.Context, string, *int64, time.Time, int) ([]port.ClimateScheduleCandidate, error)
}

type climateScheduleProvider struct{ reader climateScheduleReader }

func WithClimateScheduleReviews(reader climateScheduleReader) Option {
	return func(s *Service) {
		s.providers = append(s.providers, climateScheduleProvider{reader: reader})
	}
}

func (climateScheduleProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceClimateSchedule
}

func (p climateScheduleProvider) Recommendations(ctx context.Context, filter ListFilter, now time.Time) ([]domain.Candidate, error) {
	if filter.SharedOpenMode {
		return nil, nil
	}
	rows, err := p.reader.List(ctx, filter.subject, filter.VehicleID, now, providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		evidence := row.Evidence
		key := fmt.Sprintf("climate_schedule:%d:%d", row.PlanID, evidence.WeekOf.Unix())
		path := fmt.Sprintf("/preconditioning-effectiveness?vehicle_id=%d&climate_review_vehicle_id=%d#scheduled-climate-review", row.VehicleID, row.VehicleID)
		items = append(items, domain.Candidate{
			SourceFeature: domain.SourceClimateSchedule, SourceKey: key, DedupKey: key,
			Vehicle:   &domain.VehicleRef{ID: row.VehicleID, DisplayName: row.VehicleName},
			Title:     "Review a recurring climate schedule",
			Summary:   fmt.Sprintf("Climate started near %d matching scheduled runs with no observed drive in the next 90 minutes.", len(evidence.RunTimes)),
			Rationale: "Review whether this schedule still fits your routine. Nothing changes automatically.",
			Priority:  domain.PriorityLow, Severity: domain.SeverityInfo, BaseConfidence: 0.8,
			ConfidenceBasis: []string{"Accepted scheduled command for this vehicle, observed HVAC changes and parked telemetry"},
			Evidence: []domain.EvidenceItem{{
				ID: key, Kind: "climate_schedule", Summary: "Observed climate starts with no matching drive", ObservedAt: &evidence.ObservedThrough,
				ClimateSchedule: &evidence, Provenance: domain.EvidenceProvenance{Source: "automation_history_and_vehicle_telemetry"},
			}},
			SafeActions: defaultActions(), NavigationPath: &path,
			ObservedAt: &evidence.ObservedThrough, FreshFor: 7 * 24 * time.Hour, AgingFor: 7 * 24 * time.Hour, ExpiresAt: evidence.ExpiresAt,
			Limitations: []string{"The observed time window does not explain why climate ran or what happened later."},
		})
	}
	return items, nil
}
