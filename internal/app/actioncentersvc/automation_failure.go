package actioncentersvc

import (
	"context"
	"fmt"
	"strconv"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
)

type AutomationFailureReader interface {
	ListFailureGroups(context.Context, *int64, time.Time, int) ([]domain.AutomationFailureGroup, error)
}

type automationFailureProvider struct {
	reader  AutomationFailureReader
	allowed func(context.Context, string) bool
}

func WithAutomationFailureGroups(reader AutomationFailureReader, allowed func(context.Context, string) bool) Option {
	return func(s *Service) {
		s.providers = append(s.providers, automationFailureProvider{reader: reader, allowed: allowed})
	}
}

func (p automationFailureProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceAutomationFailure
}

func (p automationFailureProvider) Recommendations(ctx context.Context, filter ListFilter, now time.Time) ([]domain.Candidate, error) {
	if filter.ExcludePrivate || filter.SharedOpenMode || !p.allowed(ctx, filter.subject) {
		return nil, nil
	}
	groups, err := p.reader.ListFailureGroups(ctx, filter.VehicleID, now, providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(groups))
	for _, group := range groups {
		key := fmt.Sprintf("automation:%d", group.AutomationID)
		path := fmt.Sprintf("/automations/history?automation_id=%d&history_id=%d", group.AutomationID, group.HistoryID)
		latest := group.LastEndedAt.UTC()
		expires := group.FirstEndedAt.Add(domain.AutomationFailureWindow)
		var vehicle *domain.VehicleRef
		if group.VehicleID != nil {
			vehicle = &domain.VehicleRef{ID: *group.VehicleID}
		}
		const basis = "Counts separate completed runs with a failed or partial outcome, not retries within one run."
		items = append(items, domain.Candidate{
			SourceFeature: domain.SourceAutomationFailure, SourceKey: key, DedupKey: key,
			Vehicle: vehicle, Title: "Review repeated automation failures",
			Summary: "Open the latest recorded outcome to see what happened.", Rationale: basis,
			Priority: domain.PriorityMedium, Severity: domain.SeverityWarning, BaseConfidence: 0.96,
			ConfidenceBasis: []string{basis},
			Evidence: []domain.EvidenceItem{{
				ID: key, Kind: "automation_failure", Summary: basis, ObservedAt: &latest,
				Provenance: domain.EvidenceProvenance{
					Source: "automation_history", RecordID: strconv.FormatInt(group.HistoryID, 10),
				},
				AutomationFailure: &domain.AutomationFailureEvidence{Name: group.Name, FailureCount: group.FailureCount},
			}},
			SafeActions: []domain.ActionType{domain.ActionNavigate}, NavigationPath: &path,
			ObservedAt: &latest, FreshFor: domain.AutomationFailureWindow, ExpiresAt: expires,
		})
	}
	return items, nil
}
