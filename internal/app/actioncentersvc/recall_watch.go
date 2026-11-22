package actioncentersvc

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type recallWatchReader interface {
	List(context.Context, string, *int64, time.Time, int) ([]port.RecallWatchCandidate, error)
}

type recallWatchProvider struct{ reader recallWatchReader }

func WithRecallWatch(reader recallWatchReader) Option {
	return func(s *Service) {
		s.providers = append(s.providers, recallWatchProvider{reader: reader})
	}
}

func (recallWatchProvider) SourceFeature() domain.SourceFeature { return domain.SourceRecallWatch }

func (p recallWatchProvider) Recommendations(ctx context.Context, filter ListFilter, now time.Time) ([]domain.Candidate, error) {
	if filter.SharedOpenMode {
		return nil, nil
	}
	rows, err := p.reader.List(ctx, filter.subject, filter.VehicleID, now, providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		match := row.Match
		key := fmt.Sprintf("recall_watch:%d:%s", row.WatchID, match.Campaign)
		path := fmt.Sprintf("/maintenance?vehicle_id=%d#recall-watch", row.VehicleID)
		items = append(items, domain.Candidate{
			SourceFeature: domain.SourceRecallWatch, SourceKey: key, DedupKey: key,
			Vehicle:   &domain.VehicleRef{ID: row.VehicleID, DisplayName: row.VehicleName},
			Title:     "Review an official recall notice",
			Summary:   "An NHTSA campaign matches the model and year you selected. Verify your VIN with Tesla.",
			Rationale: "Verification is the only way to know if this campaign is open for your car.",
			Priority:  domain.PriorityMedium, Severity: domain.SeverityInfo, BaseConfidence: 0.65,
			ConfidenceBasis: []string{"Official NHTSA recall data and owner-confirmed make, model and model year"},
			Evidence: []domain.EvidenceItem{{
				ID: key, Kind: "recall_watch_match", Summary: match.Remedy, ObservedAt: &match.ReportedAt,
				RecallWatchMatch: &match, Provenance: domain.EvidenceProvenance{
					Source: "nhtsa_recalls", RecordID: match.Campaign, SourceURL: &match.SourceURL,
				},
			}},
			SafeActions: defaultActions(), NavigationPath: &path,
			ObservedAt: &match.CheckedAt, FreshFor: 24 * time.Hour, AgingFor: 48 * time.Hour, ExpiresAt: match.FreshUntil,
			Limitations: []string{"The catalog does not say whether this VIN is affected or whether the remedy is complete."},
		})
	}
	return items, nil
}
