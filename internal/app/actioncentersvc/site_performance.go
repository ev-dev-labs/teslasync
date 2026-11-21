package actioncentersvc

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	readiness "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

type SitePerformanceReader interface {
	ListSitePerformanceReviews(context.Context, string, *int64, time.Time, int) ([]readiness.SitePerformanceReview, error)
}

type sitePerformanceProvider struct{ reader SitePerformanceReader }

func (p sitePerformanceProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceChargingSitePerformance
}

func (p sitePerformanceProvider) Recommendations(ctx context.Context, filter ListFilter, now time.Time) ([]domain.Candidate, error) {
	rows, err := p.reader.ListSitePerformanceReviews(ctx, filter.subject, filter.VehicleID, now, providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		key := fmt.Sprintf("site_performance:%d:%d", row.VehicleID, row.PlaceID)
		path := fmt.Sprintf("/settings/smart-charging?vehicle_id=%d#site-performance", row.VehicleID)
		summary := fmt.Sprintf("%d recent sessions averaged %.0f W at %s versus a median of %.0f W across %d comparable sessions.",
			row.RecentCount, row.RecentW, row.PlaceName, row.BaselineW, row.BaselineCount)
		items = append(items, domain.Candidate{
			SourceFeature: domain.SourceChargingSitePerformance,
			SourceKey:     fmt.Sprintf("%s:%d", key, row.LatestID),
			DedupKey:      key,
			Vehicle:       &domain.VehicleRef{ID: row.VehicleID, DisplayName: row.VehicleName},
			Title:         "Charging has been slower at this place",
			Summary:       summary,
			Rationale:     "Two recent sessions delivered materially less energy per elapsed hour than comparable sessions for the same vehicle and location.",
			Priority:      domain.PriorityLow, Severity: domain.SeverityInfo, BaseConfidence: 0.75,
			ConfidenceBasis: []string{"Timestamped charging meter readings and similar charge levels and connector type"},
			Evidence: []domain.EvidenceItem{{
				ID: key, Kind: "site_performance", Summary: summary, ObservedAt: &row.ObservedAt,
				SitePerformance: &row,
				Provenance:      domain.EvidenceProvenance{Source: "charging_telemetry", RecordID: fmt.Sprint(row.LatestID)},
			}},
			SafeActions: []domain.ActionType{domain.ActionNavigate}, NavigationPath: &path,
			ObservedAt: &row.ObservedAt, FreshFor: 14 * 24 * time.Hour, AgingFor: 14 * 24 * time.Hour, ExpiresAt: row.ExpiresAt,
			Limitations: []string{"Elapsed rates can include pauses. Review the current limit, schedule and site conditions; this is not a charger diagnosis."},
		})
	}
	return items, nil
}
