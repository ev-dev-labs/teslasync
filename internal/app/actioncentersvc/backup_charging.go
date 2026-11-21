package actioncentersvc

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	readiness "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

type BackupChargingReader interface {
	ListBackupDecisions(context.Context, string, *int64, int) ([]readiness.BackupChargingDecision, error)
}

type backupChargingProvider struct{ reader BackupChargingReader }

func WithBackupCharging(reader BackupChargingReader) Option {
	return func(s *Service) { s.providers = append(s.providers, backupChargingProvider{reader: reader}) }
}

func (p backupChargingProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceSmartCharging
}

func (p backupChargingProvider) Recommendations(ctx context.Context, filter ListFilter, _ time.Time) ([]domain.Candidate, error) {
	rows, err := p.reader.ListBackupDecisions(ctx, filter.subject, filter.VehicleID, providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		sample := row.Sample
		key := fmt.Sprintf("backup_charging:%d", row.Watch.ID)
		path := fmt.Sprintf("/settings/smart-charging?vehicle_id=%d&backup_watch_id=%d#backup-charging", row.Watch.VehicleID, row.Watch.ID)
		basis := "Your outage and circuit confirmations, two Tesla Energy meter readings, and vehicle charging telemetry."
		items = append(items, domain.Candidate{
			SourceFeature: domain.SourceSmartCharging, SourceKey: key, DedupKey: key,
			Vehicle:   &domain.VehicleRef{ID: row.Watch.VehicleID},
			Title:     "Vehicle charging is drawing from household backup",
			Summary:   "Review the current charging load while the site is on backup.",
			Rationale: basis, Priority: domain.PriorityHigh, Severity: domain.SeverityWarning, BaseConfidence: 0.75,
			ConfidenceBasis: []string{basis},
			Evidence: []domain.EvidenceItem{{
				ID: key, Kind: "backup_charging", Summary: basis, ObservedAt: &sample.ObservedAt, BackupCharging: &sample,
				Provenance: domain.EvidenceProvenance{Source: "tesla_energy"},
			}},
			SafeActions: []domain.ActionType{domain.ActionNavigate}, NavigationPath: &path,
			ObservedAt: &sample.ObservedAt, FreshFor: 90 * time.Second, ExpiresAt: sample.ExpiresAt,
			Limitations: []string{"This estimate is not a backup runtime forecast. Nothing changes automatically."},
		})
	}
	return items, nil
}
