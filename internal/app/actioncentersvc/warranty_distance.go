package actioncentersvc

import (
	"context"
	"fmt"
	"strconv"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

type warrantyDistanceReader interface {
	ListWarrantyReminderCandidates(context.Context, string, *int64, time.Time, int) ([]port.WarrantyReminderCandidate, error)
}

type warrantyDistanceProvider struct{ reader warrantyDistanceReader }

func WithWarrantyDistance(reader warrantyDistanceReader) Option {
	return func(s *Service) {
		s.providers = append(s.providers, warrantyDistanceProvider{reader: reader})
	}
}

func (p warrantyDistanceProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceWarrantyDistance
}

func (p warrantyDistanceProvider) Recommendations(ctx context.Context, filter ListFilter, now time.Time) ([]domain.Candidate, error) {
	if filter.SharedOpenMode {
		return nil, nil
	}
	rows, err := p.reader.ListWarrantyReminderCandidates(ctx, filter.subject, filter.VehicleID, now, providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		projection := row.Projection
		key := fmt.Sprintf("warranty_distance:%d", projection.WarrantyID)
		path := fmt.Sprintf("/ownership/warranty-command?vehicle_id=%d&warranty_id=%d#warranty-mileage",
			projection.VehicleID, projection.WarrantyID)
		const summary = "At the recent recorded mileage pace, the documented distance limit may arrive soon, before the calendar term ends."
		items = append(items, domain.Candidate{
			SourceFeature: domain.SourceWarrantyDistance, SourceKey: key, DedupKey: key,
			Vehicle: &domain.VehicleRef{ID: projection.VehicleID, DisplayName: row.VehicleName},
			Title:   "Review the approaching warranty distance limit", Summary: summary,
			Rationale: "Recorded odometer readings and the distance and calendar terms entered for this warranty.",
			Priority:  domain.PriorityLow, Severity: domain.SeverityInfo, BaseConfidence: 0.72,
			ConfidenceBasis: []string{"Recent measured odometer and user-entered warranty terms"},
			Evidence: []domain.EvidenceItem{{
				ID: key, Kind: "warranty_distance", Summary: row.Warranty, ObservedAt: &projection.RecordedAt,
				WarrantyDistance: &projection, Provenance: domain.EvidenceProvenance{
					Source: "vehicle_warranties", RecordID: strconv.FormatInt(projection.WarrantyID, 10),
				},
			}},
			SafeActions: defaultActions(), NavigationPath: &path,
			ObservedAt: &projection.RecordedAt, FreshFor: 3 * 24 * time.Hour, AgingFor: 7 * 24 * time.Hour, ExpiresAt: projection.ExpiresAt,
			Limitations: []string{"The projected range is an estimate, not a coverage decision. Confirm terms with the warranty provider."},
		})
	}
	return items, nil
}
