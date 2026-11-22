package actioncentersvc

import (
	"context"
	"fmt"
	"strconv"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel/subscriptionrenewal"
)

type renewalReader interface {
	ListCandidates(context.Context, string, *int64, time.Time, int) ([]port.Candidate, error)
}

type renewalProvider struct{ reader renewalReader }

func WithSubscriptionRenewals(reader renewalReader) Option {
	return func(s *Service) {
		s.providers = append(s.providers, renewalProvider{reader: reader})
	}
}

func (p renewalProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceSubscriptionRenewal
}

func (p renewalProvider) Recommendations(ctx context.Context, filter ListFilter, now time.Time) ([]domain.Candidate, error) {
	if filter.ExcludePrivate || filter.SharedOpenMode {
		return nil, nil
	}
	rows, err := p.reader.ListCandidates(ctx, filter.subject, filter.VehicleID, now, providerLimit)
	if err != nil {
		return nil, err
	}
	const basis = "Owner-confirmed renewal date and stored subscription terms."
	const limit = "Observed activity does not prove subscription use. No renewal or cancellation is made automatically."
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		key := "subscription_renewal:" + row.OccurrenceID
		path := fmt.Sprintf("/ownership/subscription-roi?vehicle_id=%d&subscription_id=%d#private-renewal", row.VehicleID, row.SubscriptionID)
		items = append(items, domain.Candidate{
			SourceFeature: domain.SourceSubscriptionRenewal, SourceKey: key, DedupKey: key,
			Vehicle: &domain.VehicleRef{ID: row.VehicleID, DisplayName: row.VehicleName},
			Title:   "Review the recorded subscription renewal", Summary: "Check the recorded price and observed activity before the renewal date.",
			Rationale: basis, Priority: domain.PriorityLow, Severity: domain.SeverityInfo, BaseConfidence: 0.9,
			ConfidenceBasis: []string{basis}, Limitations: []string{limit},
			Evidence: []domain.EvidenceItem{{
				ID: key, Kind: "subscription_renewal", Summary: basis, ObservedAt: &row.PublishedAt,
				Provenance: domain.EvidenceProvenance{Source: "vehicle_subscriptions", RecordID: strconv.FormatInt(row.SubscriptionID, 10)},
			}},
			SafeActions: defaultActions(), NavigationPath: &path,
			ObservedAt: &row.PublishedAt, FreshFor: row.ExpiresAt.Sub(row.PublishedAt), ExpiresAt: row.ExpiresAt,
		})
	}
	return items, nil
}
