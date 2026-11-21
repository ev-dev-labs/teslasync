package actioncentersvc

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type tripMaintenanceReader interface {
	ListTripMaintenanceCandidates(context.Context, string, *int64, time.Time, int) ([]port.TripMaintenanceCandidate, error)
}

type tripMaintenanceProvider struct{ reader tripMaintenanceReader }

func WithTripMaintenance(reader tripMaintenanceReader) Option {
	return func(s *Service) {
		s.providers = append(s.providers, tripMaintenanceProvider{reader: reader})
	}
}

func (tripMaintenanceProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceTripMaintenance
}

func (p tripMaintenanceProvider) Recommendations(ctx context.Context, filter ListFilter, now time.Time) ([]domain.Candidate, error) {
	if filter.SharedOpenMode {
		return nil, nil
	}
	rows, err := p.reader.ListTripMaintenanceCandidates(ctx, filter.subject, filter.VehicleID, now, providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		projection := row.Projection
		key := fmt.Sprintf("trip_maintenance:%d:%d", projection.PlanID, row.PlanVersion)
		path := fmt.Sprintf("/maintenance?vehicle_id=%d", projection.VehicleID)
		items = append(items, domain.Candidate{
			SourceFeature: domain.SourceTripMaintenance, SourceKey: key, DedupKey: key,
			Vehicle: &domain.VehicleRef{ID: projection.VehicleID, DisplayName: row.VehicleName},
			Title:   "Review maintenance before your trip", Summary: "The saved trip distance could carry this vehicle past its recorded service interval.",
			Rationale: "Even the lower end of the entered trip estimate crosses the recorded service odometer plus its documented interval.",
			Priority:  domain.PriorityLow, Severity: domain.SeverityInfo, BaseConfidence: 0.72,
			ConfidenceBasis: []string{"Completed-drive odometer, entered service record and estimated trip distance"},
			Evidence: []domain.EvidenceItem{{
				ID: key, Kind: "trip_maintenance", Summary: projection.ServiceLabel, ObservedAt: &projection.RecordedAt,
				TripMaintenance: &projection, Provenance: domain.EvidenceProvenance{Source: "drives"},
			}},
			SafeActions: defaultActions(), NavigationPath: &path,
			ObservedAt: &projection.RecordedAt, FreshFor: 24 * time.Hour, AgingFor: 48 * time.Hour, ExpiresAt: projection.ExpiresAt,
			Limitations: []string{"This compares a planned distance with the entered interval. It does not book service or assess the vehicle's condition."},
		})
	}
	return items, nil
}
