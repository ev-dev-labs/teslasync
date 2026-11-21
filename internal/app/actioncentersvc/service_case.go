package actioncentersvc

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

const serviceCaseCardLifetime = 30 * 24 * time.Hour

type serviceCaseReader interface {
	List(context.Context, string, *int64, time.Time, int) ([]port.ServiceCaseCandidate, error)
}

type serviceCaseProvider struct {
	reader serviceCaseReader
	record func(string)
}

func WithServiceCases(reader serviceCaseReader, record func(string)) Option {
	return func(s *Service) {
		s.providers = append(s.providers, serviceCaseProvider{reader: reader, record: record})
	}
}

func (serviceCaseProvider) SourceFeature() domain.SourceFeature { return domain.SourceServiceCase }

func (p serviceCaseProvider) Recommendations(ctx context.Context, filter ListFilter, now time.Time) ([]domain.Candidate, error) {
	if filter.SharedOpenMode {
		return nil, nil
	}
	rows, err := p.reader.List(ctx, filter.subject, filter.VehicleID, now.Add(-serviceCaseCardLifetime), providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		if p.record != nil {
			p.record("card_eligible")
		}
		key := fmt.Sprintf("service_case:%d", row.ID)
		path := fmt.Sprintf("/diagnostics/service-evidence?vehicle_id=%d#private-service-case", row.VehicleID)
		items = append(items, domain.Candidate{
			SourceFeature: domain.SourceServiceCase, SourceKey: key, DedupKey: key,
			Vehicle:   &domain.VehicleRef{ID: row.VehicleID, DisplayName: row.VehicleName},
			Title:     "Review your private service case",
			Summary:   "Choose which recorded details and timestamps to include in a local export.",
			Rationale: "You opened this case and recorded evidence for this vehicle.",
			Priority:  domain.PriorityLow, Severity: domain.SeverityInfo, BaseConfidence: 1,
			ConfidenceBasis: []string{"User-recorded case evidence, not a diagnosis"},
			Evidence: []domain.EvidenceItem{{
				ID: key, Kind: "service_case",
				Summary: "User-recorded case evidence, not a diagnosis", ObservedAt: &row.UpdatedAt,
				Provenance: domain.EvidenceProvenance{Source: "user_recorded"},
			}},
			SafeActions: defaultActions(), NavigationPath: &path,
			ObservedAt: &row.UpdatedAt, FreshFor: 7 * 24 * time.Hour, AgingFor: serviceCaseCardLifetime,
			ExpiresAt:   row.UpdatedAt.Add(serviceCaseCardLifetime),
			Limitations: []string{"Nothing is sent to a service provider. Review the export before sharing it."},
		})
	}
	return items, nil
}
