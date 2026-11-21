package actioncentersvc

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	readiness "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

type SolarChargingReader interface {
	ListSolarChargingOpportunities(context.Context, string, *int64, time.Time, int) ([]readiness.SolarChargingOpportunity, error)
}

type solarChargingProvider struct{ reader SolarChargingReader }

func WithSolarCharging(reader SolarChargingReader) Option {
	return func(s *Service) { s.providers = append(s.providers, solarChargingProvider{reader: reader}) }
}

func (p solarChargingProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceSmartCharging
}

func (p solarChargingProvider) Recommendations(ctx context.Context, filter ListFilter, now time.Time) ([]domain.Candidate, error) {
	rows, err := p.reader.ListSolarChargingOpportunities(ctx, filter.subject, filter.VehicleID, now, providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		key := fmt.Sprintf("solar_surplus:%d:%d", row.Scope.PlanID, row.Scope.ConsentedAt.UnixMicro())
		path := fmt.Sprintf("/settings/smart-charging?vehicle_id=%d#solar-charging", row.Scope.VehicleID)
		decision := row.Decision
		summary := "The home site has sustained solar export and the plugged-in vehicle is still below its charge limit."
		items = append(items, domain.Candidate{
			SourceFeature: domain.SourceSmartCharging, SourceKey: key, DedupKey: key,
			Vehicle: &domain.VehicleRef{ID: row.Scope.VehicleID, DisplayName: row.Scope.VehicleName},
			Title:   "There may be surplus solar available to charge", Summary: summary,
			Rationale: "Repeated export readings show the home battery remains above its configured reserve.",
			Priority:  domain.PriorityLow, Severity: domain.SeverityInfo, BaseConfidence: 0.75,
			ConfidenceBasis: []string{"Timestamped Tesla Energy readings and fresh shared vehicle signals"},
			Evidence: []domain.EvidenceItem{{
				ID: key, Kind: "solar_surplus", Summary: summary, ObservedAt: &decision.ObservedAt,
				SolarSurplus: &decision, Provenance: domain.EvidenceProvenance{Source: "tesla_energy"},
			}},
			SafeActions: []domain.ActionType{domain.ActionNavigate}, NavigationPath: &path,
			ObservedAt: &decision.ObservedAt, FreshFor: 2 * time.Minute, ExpiresAt: decision.ExpiresAt,
			Limitations: []string{"Solar export can change; nothing is sent to the vehicle or changed at home."},
		})
	}
	return items, nil
}
