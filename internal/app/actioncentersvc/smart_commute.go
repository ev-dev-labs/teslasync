package actioncentersvc

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	commute "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

type SmartCommuteReader interface {
	ListSuggestions(context.Context, string, *int64, time.Time, int) ([]commute.SuggestedRoutine, error)
	ListTrafficDecisions(context.Context, string, *int64, time.Time, int) ([]commute.TrafficDecision, error)
}

type smartCommuteProvider struct{ reader SmartCommuteReader }

func (p smartCommuteProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceSmartCommute
}

func (p smartCommuteProvider) Recommendations(
	ctx context.Context, filter ListFilter, now time.Time,
) ([]domain.Candidate, error) {
	rows, err := p.reader.ListSuggestions(ctx, filter.subject, filter.VehicleID, now, providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		if row.Evidence == nil {
			continue
		}
		evidence := row.Evidence
		observedAt := evidence.LastObservedAt.UTC()
		expiresAt := observedAt.Add(56 * 24 * time.Hour)
		path := fmt.Sprintf("/settings?vehicle_id=%d#smart-commute", row.VehicleID)
		sourceKey := fmt.Sprintf("routine:%d", row.ID)
		summary := fmt.Sprintf(
			"%d matching departure days between %s and %s (%s). Candidate destination: %.5f, %.5f.",
			evidence.MatchingDays, localClock(evidence.WindowStartS), localClock(evidence.WindowEndS),
			row.TimeZone, row.Destination.Latitude, row.Destination.Longitude,
		)
		items = append(items, domain.Candidate{
			SourceFeature:  domain.SourceSmartCommute,
			SourceKey:      sourceKey,
			DedupKey:       sourceKey,
			Vehicle:        &domain.VehicleRef{ID: row.VehicleID, DisplayName: row.VehicleName},
			Title:          fmt.Sprintf("Is this your regular %s drive?", row.Weekday),
			Summary:        summary,
			Rationale:      "Locally analyzed completed drives have similar departure times and endpoints.",
			Priority:       domain.PriorityLow,
			Severity:       domain.SeverityInfo,
			BaseConfidence: 0.8,
			ConfidenceBasis: []string{
				"At least seven distinct local days within a bounded eight-week window",
				"Similar endpoints and departure times do not identify the driver",
			},
			Evidence: []domain.EvidenceItem{{
				ID: sourceKey, Kind: "recurring_drive", Summary: summary,
				Provenance: domain.EvidenceProvenance{Source: "local_drive_analysis", RecordID: sourceKey},
				ObservedAt: &observedAt,
				RecurringDrive: &domain.RecurringDriveEvidence{
					RoutineID: row.ID, Weekday: int(row.Weekday), MatchingDays: evidence.MatchingDays,
					WindowStartS: evidence.WindowStartS, WindowEndS: evidence.WindowEndS,
					TimeZone: row.TimeZone, DestinationLatitude: row.Destination.Latitude,
					DestinationLongitude: row.Destination.Longitude,
				},
			}},
			// These routine actions use the separately authorized Smart Commute
			// endpoints, not Action Center's generic state-transition endpoint.
			SafeActions: []domain.ActionType{
				domain.ActionNavigate, domain.ActionSmartCommuteUse,
				domain.ActionSmartCommuteEdit, domain.ActionSmartCommuteDecline, domain.ActionSmartCommuteSnooze,
			},
			NavigationPath: &path,
			ObservedAt:     &observedAt,
			FreshFor:       14 * 24 * time.Hour,
			AgingFor:       56 * 24 * time.Hour,
			ExpiresAt:      expiresAt,
			Limitations: []string{
				"The driver and destination name are not inferred.",
				"This suggestion does not send notifications or operate the vehicle.",
			},
		})
	}
	comparisons, err := p.reader.ListTrafficDecisions(ctx, filter.subject, filter.VehicleID, now, providerLimit)
	if err != nil {
		return items, err
	}
	for _, row := range comparisons {
		items = append(items, trafficCandidate(row))
	}
	return items, nil
}

func trafficCandidate(row commute.TrafficDecision) domain.Candidate {
	key := fmt.Sprintf("traffic:%d:%d", row.RoutineID, row.DepartureAt.Unix())
	path := commute.TrafficComparisonPath(row.VehicleID, row.OccurrenceID)
	summary := fmt.Sprintf("HERE estimates %d minutes on the usual route and %d minutes on an alternative.",
		(row.UsualS+30)/60, (row.AlternativeS+30)/60)
	return domain.Candidate{
		SourceFeature: domain.SourceSmartCommute, SourceKey: key, DedupKey: key,
		Vehicle: &domain.VehicleRef{ID: row.VehicleID, DisplayName: row.VehicleName},
		Title:   "A faster route is available before your departure", Summary: summary,
		Rationale: "Fresh HERE Traffic Flow covered both routes; the estimated difference exceeds your selected threshold.",
		Priority:  domain.PriorityMedium, Severity: domain.SeverityInfo, BaseConfidence: 0.8,
		ConfidenceBasis: []string{"Both routes had fresh directional HERE Traffic Flow coverage"},
		Evidence: []domain.EvidenceItem{{
			ID: key, Kind: "commute_traffic", Summary: summary, ObservedAt: &row.ObservedAt,
			Provenance:     domain.EvidenceProvenance{Source: "here_routing_traffic", RecordID: key},
			CommuteTraffic: &domain.CommuteTrafficEvidence{UsualS: row.UsualS, AlternativeS: row.AlternativeS},
		}},
		SafeActions: []domain.ActionType{domain.ActionNavigate}, NavigationPath: &path,
		ObservedAt: &row.ObservedAt, FreshFor: 5 * time.Minute, AgingFor: 5 * time.Minute, ExpiresAt: row.ExpiresAt,
		Limitations: []string{"These are provider estimates, not measured trip times.", "Tesla calculates its own route."},
	}
}

func localClock(seconds int) string {
	return fmt.Sprintf("%02d:%02d", seconds/3600, seconds%3600/60)
}
