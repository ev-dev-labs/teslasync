package actioncentersvc

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	port "github.com/ev-dev-labs/teslasync/internal/port/actioncenter"
)

const providerLimit = 50

type provider interface {
	SourceFeature() domain.SourceFeature
	Recommendations(ctx context.Context, filter ListFilter, now time.Time) ([]domain.Candidate, error)
}

type alertsProvider struct{ source port.SourceReader }

func (p alertsProvider) SourceFeature() domain.SourceFeature { return domain.SourceActiveAlerts }

func (p alertsProvider) Recommendations(
	ctx context.Context,
	filter ListFilter,
	now time.Time,
) ([]domain.Candidate, error) {
	rows, err := p.source.ListActiveAlerts(ctx, filter.VehicleID, now.Add(-14*24*time.Hour), providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		sourceKey := fmt.Sprintf("notification:%d", row.LogID)
		dedupKey := sourceKey
		if row.AlertID > 0 {
			sourceKey = fmt.Sprintf("rule:%d", row.AlertID)
			dedupKey = sourceKey
		}
		vehicleKey := int64(0)
		if row.Vehicle != nil {
			vehicleKey = row.Vehicle.ID
		}
		severity, priority := alertUrgency(row.Severity, row.DeliveryStatus)
		nav := "/alerts"
		observedAt := row.CreatedAt.UTC()
		items = append(items, domain.Candidate{
			SourceFeature:   domain.SourceActiveAlerts,
			SourceKey:       sourceKey,
			DedupKey:        fmt.Sprintf("%d:%s", vehicleKey, dedupKey),
			Vehicle:         row.Vehicle,
			Title:           "Review active alert: " + row.Title,
			Summary:         truncate(row.Message, 280),
			Rationale:       "This alert remains unacknowledged and unarchived in the notification record.",
			Priority:        priority,
			Severity:        severity,
			BaseConfidence:  0.94,
			ConfidenceBasis: []string{"Direct persisted alert delivery record", "Acknowledgement state is server-authoritative"},
			Evidence: []domain.EvidenceItem{{
				ID:      fmt.Sprintf("notification_log:%d", row.LogID),
				Kind:    "active_alert",
				Summary: fmt.Sprintf("Alert recorded with %s severity and %s delivery status.", row.Severity, row.DeliveryStatus),
				Provenance: domain.EvidenceProvenance{
					Source:   "notification_logs",
					RecordID: strconv.FormatInt(row.LogID, 10),
				},
				ObservedAt: &observedAt,
			}},
			SafeActions:    defaultActions(),
			NavigationPath: &nav,
			ObservedAt:     &observedAt,
			FreshFor:       24 * time.Hour,
			AgingFor:       7 * 24 * time.Hour,
			ExpiresAt:      observedAt.Add(30 * 24 * time.Hour),
			Limitations: []string{
				"Action Center acknowledgement does not acknowledge the source alert.",
				"The alert is evidence of a rule firing, not a diagnosis.",
			},
		})
	}
	return items, nil
}

type chargingProvider struct{ source port.SourceReader }

func (p chargingProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceChargingReliability
}

func (p chargingProvider) Recommendations(
	ctx context.Context,
	filter ListFilter,
	now time.Time,
) ([]domain.Candidate, error) {
	rows, err := p.source.ListStaleChargingSessions(ctx, filter.VehicleID, now.Add(-6*time.Hour), providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		age := now.Sub(row.StartedAt)
		priority := domain.PriorityMedium
		if age >= 24*time.Hour {
			priority = domain.PriorityHigh
		}
		nav := fmt.Sprintf("/charging?vehicle_id=%d", row.Vehicle.ID)
		observedAt := row.StartedAt.UTC()
		summary := fmt.Sprintf("Charging session %d has no recorded end after %s.", row.SessionID, coarseDuration(age))
		items = append(items, domain.Candidate{
			SourceFeature:  domain.SourceChargingReliability,
			SourceKey:      fmt.Sprintf("session:%d", row.SessionID),
			DedupKey:       fmt.Sprintf("%d:incomplete_session:%d", row.Vehicle.ID, row.SessionID),
			Vehicle:        &row.Vehicle,
			Title:          "Review incomplete charging session",
			Summary:        summary,
			Rationale:      "A persisted charging-session row remains open beyond the normal review threshold.",
			Priority:       priority,
			Severity:       domain.SeverityWarning,
			BaseConfidence: 0.82,
			ConfidenceBasis: []string{
				"Direct charging-session start record",
				"Missing end marker is observable, but its cause is unknown",
			},
			Evidence: []domain.EvidenceItem{{
				ID:      fmt.Sprintf("charging_session:%d", row.SessionID),
				Kind:    "open_charging_session",
				Summary: "Session start is persisted; ended_at is still null.",
				Provenance: domain.EvidenceProvenance{
					Source:   "charging_sessions",
					RecordID: strconv.FormatInt(row.SessionID, 10),
				},
				ObservedAt: &observedAt,
			}},
			SafeActions:    defaultActions(),
			NavigationPath: &nav,
			ObservedAt:     &observedAt,
			FreshFor:       12 * time.Hour,
			AgingFor:       48 * time.Hour,
			ExpiresAt:      now.Add(24 * time.Hour),
			Limitations: []string{
				"An open row may reflect delayed telemetry or session recovery; it does not prove a charging interruption.",
				"No energy, cost, or time impact is projected without a completed session.",
			},
		})
	}
	return items, nil
}

type workOrdersProvider struct{ source port.SourceReader }

func (p workOrdersProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceFleetMaintenance
}

func (p workOrdersProvider) Recommendations(
	ctx context.Context,
	filter ListFilter,
	now time.Time,
) ([]domain.Candidate, error) {
	rows, err := p.source.ListActiveWorkOrders(ctx, filter.VehicleID, providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		priority, severity := workOrderUrgency(row.Severity, row.DueAt, now)
		nav := "/fleet-operations"
		observedAt := row.UpdatedAt.UTC()
		summary := "Active work order is " + strings.ReplaceAll(row.Status, "_", " ") + "."
		if row.DueAt != nil {
			summary += " Due " + row.DueAt.UTC().Format("2006-01-02") + "."
		}
		items = append(items, domain.Candidate{
			SourceFeature:   domain.SourceFleetMaintenance,
			SourceKey:       fmt.Sprintf("work_order:%d", row.ID),
			DedupKey:        fmt.Sprintf("%d:work_order:%d", row.Vehicle.ID, row.ID),
			Vehicle:         &row.Vehicle,
			Title:           row.Title,
			Summary:         summary,
			Rationale:       "This fleet maintenance work order is still active and may require coordination.",
			Priority:        priority,
			Severity:        severity,
			BaseConfidence:  0.98,
			ConfidenceBasis: []string{"Direct fleet work-order state", "Priority reflects recorded severity and due date only"},
			Evidence: []domain.EvidenceItem{{
				ID:      fmt.Sprintf("work_order:%d", row.ID),
				Kind:    "active_work_order",
				Summary: fmt.Sprintf("Work order status is %s with %s severity.", row.Status, row.Severity),
				Provenance: domain.EvidenceProvenance{
					Source:   "fleet_maintenance_work_orders",
					RecordID: strconv.FormatInt(row.ID, 10),
				},
				ObservedAt: &observedAt,
			}},
			ProjectedImpact: workOrderProjectedImpact(row),
			SafeActions:     defaultActions(),
			NavigationPath:  &nav,
			ObservedAt:      &observedAt,
			FreshFor:        7 * 24 * time.Hour,
			AgingFor:        30 * 24 * time.Hour,
			ExpiresAt:       now.Add(24 * time.Hour),
			Limitations: []string{
				"Action Center does not change the underlying work order.",
				"Maintenance records are operational plans, not vehicle diagnoses.",
			},
		})
	}
	return items, nil
}

func workOrderProjectedImpact(row domain.WorkOrderRecord) *domain.ProjectedImpact {
	impact := &domain.ProjectedImpact{Basis: []string{}}
	if row.CostMinor != nil && row.Currency != nil {
		currency := strings.ToUpper(strings.TrimSpace(*row.Currency))
		if *row.CostMinor >= 0 && currency != "" {
			costMinor := *row.CostMinor
			impact.CostMinor = &costMinor
			impact.Currency = &currency
			impact.Basis = append(impact.Basis, "Cost comes directly from the recorded work order.")
		}
	}
	if row.ScheduledStartAt != nil && row.ScheduledEndAt != nil {
		duration := row.ScheduledEndAt.Sub(*row.ScheduledStartAt)
		if duration > 0 {
			durationS := int64(duration / time.Second)
			impact.TimeS = &durationS
			impact.Basis = append(
				impact.Basis,
				"Downtime comes from the recorded maintenance schedule.",
			)
		}
	}
	var risk domain.ImpactRiskLevel
	switch strings.ToLower(row.Severity) {
	case "critical":
		risk = domain.ImpactRiskHigh
	case "high":
		risk = domain.ImpactRiskModerate
	}
	if risk != "" {
		impact.RiskLevel = &risk
		impact.Basis = append(
			impact.Basis,
			"Risk level mirrors the recorded work-order severity; it is not a diagnosis.",
		)
	}
	if len(impact.Basis) == 0 {
		return nil
	}
	return impact
}

type signalProvider struct{ source port.SourceReader }

func (p signalProvider) SourceFeature() domain.SourceFeature { return domain.SourceSignalHealth }

func (p signalProvider) Recommendations(
	ctx context.Context,
	filter ListFilter,
	now time.Time,
) ([]domain.Candidate, error) {
	windowStart := now.Add(-30 * 24 * time.Hour)
	rows, err := p.source.ListSignalHealth(ctx, filter.VehicleID, windowStart, now, providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows)*2)
	for _, row := range rows {
		if row.LatestSignalAt == nil || now.Sub(*row.LatestSignalAt) >= 24*time.Hour {
			items = append(items, signalFreshnessCandidate(row, now))
		}
		if row.SampleCount > 0 && row.UnversionedSampleCount > 0 {
			items = append(items, signalNormalizationCandidate(row, now))
		}
	}
	if len(items) > providerLimit {
		items = items[:providerLimit]
	}
	return items, nil
}

func signalFreshnessCandidate(row domain.SignalHealthRecord, now time.Time) domain.Candidate {
	priority := domain.PriorityMedium
	confidence := 0.76
	confidenceBasis := []string{"Direct latest signal timestamp within a bounded 30-day window"}
	evidenceSummary := "No signal was observed in the bounded 30-day review window."
	observedAt := row.LatestSignalAt
	if observedAt != nil {
		evidenceSummary = "Latest persisted signal is " + coarseDuration(now.Sub(*observedAt)) + " old."
		if now.Sub(*observedAt) >= 72*time.Hour {
			priority = domain.PriorityHigh
		}
	} else {
		confidence = 0.42
		confidenceBasis = []string{
			"Bounded query found no signal in the last 30 days",
			"Telemetry before the review window was not inspected",
		}
	}
	nav := fmt.Sprintf("/signals?vehicle_id=%d", row.Vehicle.ID)
	checkedAt := row.CheckedAt.UTC()
	return domain.Candidate{
		SourceFeature: domain.SourceSignalHealth,
		// Deterministic identity contract: the freshness incident has used
		// `vehicle:<id>` since it shipped, and deterministicID() hashes
		// SourceFeature|SourceKey|VehicleID. Re-keying it would mint a NEW
		// recommendation ID and orphan every existing acknowledgement,
		// snooze and dismissal for this finding. Only the newer
		// normalization-provenance candidate gets a distinct key.
		SourceKey:       fmt.Sprintf("vehicle:%d", row.Vehicle.ID),
		DedupKey:        fmt.Sprintf("%d:signal_freshness", row.Vehicle.ID),
		Vehicle:         &row.Vehicle,
		Title:           "Review telemetry freshness",
		Summary:         evidenceSummary,
		Rationale:       "Recent persisted telemetry helps TeslaSync keep vehicle findings current.",
		Priority:        priority,
		Severity:        domain.SeverityWarning,
		BaseConfidence:  confidence,
		ConfidenceBasis: confidenceBasis,
		Evidence: []domain.EvidenceItem{{
			ID:      fmt.Sprintf("signal_window:%d", row.Vehicle.ID),
			Kind:    "signal_freshness",
			Summary: evidenceSummary,
			Provenance: domain.EvidenceProvenance{
				Source:   "signal_log",
				RecordID: fmt.Sprintf("vehicle:%d:30d_window", row.Vehicle.ID),
			},
			ObservedAt: observedAt,
		}, {
			ID:      fmt.Sprintf("signal_check:%d", row.Vehicle.ID),
			Kind:    "bounded_query",
			Summary: "The signal freshness query completed at this timestamp.",
			Provenance: domain.EvidenceProvenance{
				Source:   "action_center_signal_provider",
				RecordID: fmt.Sprintf("vehicle:%d", row.Vehicle.ID),
			},
			ObservedAt: &checkedAt,
		}},
		SafeActions:    defaultActions(),
		NavigationPath: &nav,
		ObservedAt:     observedAt,
		FreshFor:       24 * time.Hour,
		AgingFor:       7 * 24 * time.Hour,
		ExpiresAt:      now.Add(6 * time.Hour),
		Limitations: []string{
			"Stale telemetry may reflect vehicle sleep, connectivity, or ingestion delay; it is not a connectivity diagnosis.",
			"The no-signal check is intentionally bounded to 30 days.",
		},
	}
}

func signalNormalizationCandidate(row domain.SignalHealthRecord, now time.Time) domain.Candidate {
	missingPct := float64(row.UnversionedSampleCount) / float64(row.SampleCount) * 100
	coveragePct := float64(row.VersionedSampleCount) / float64(row.SampleCount) * 100
	priority := domain.PriorityMedium
	if missingPct >= 10 {
		priority = domain.PriorityHigh
	}
	summary := fmt.Sprintf(
		"%d of %d persisted samples (%.1f%%) lack normalization-version evidence in the bounded 30-day window.",
		row.UnversionedSampleCount,
		row.SampleCount,
		missingPct,
	)
	nav := fmt.Sprintf("/signal-log?vehicle_id=%d", row.Vehicle.ID)
	checkedAt := row.CheckedAt.UTC()
	observedAt := row.LatestUnversionedAt
	return domain.Candidate{
		SourceFeature:  domain.SourceSignalHealth,
		SourceKey:      fmt.Sprintf("signal_normalization_provenance:vehicle:%d", row.Vehicle.ID),
		DedupKey:       fmt.Sprintf("%d:signal_normalization_provenance", row.Vehicle.ID),
		Vehicle:        &row.Vehicle,
		Title:          "Review telemetry normalization provenance",
		Summary:        summary,
		Rationale:      "Only version-attested rows prove which normalization rules produced persisted signal values.",
		Priority:       priority,
		Severity:       domain.SeverityWarning,
		BaseConfidence: 0.99,
		ConfidenceBasis: []string{
			"Direct counts from normalization_version in signal_log",
			"Explicitly bounded 30-day evidence window",
		},
		Evidence: []domain.EvidenceItem{{
			ID:      fmt.Sprintf("signal_normalization:%d", row.Vehicle.ID),
			Kind:    "normalization_provenance",
			Summary: fmt.Sprintf("%d normalized, %d unversioned, %.1f%% attested coverage.", row.VersionedSampleCount, row.UnversionedSampleCount, coveragePct),
			Provenance: domain.EvidenceProvenance{
				Source:   "signal_log",
				RecordID: fmt.Sprintf("vehicle:%d:normalization:30d_window", row.Vehicle.ID),
			},
			ObservedAt: observedAt,
		}, {
			ID:      fmt.Sprintf("signal_normalization_check:%d", row.Vehicle.ID),
			Kind:    "bounded_query",
			Summary: "The normalization-provenance query completed at this timestamp.",
			Provenance: domain.EvidenceProvenance{
				Source:   "action_center_signal_provider",
				RecordID: fmt.Sprintf("vehicle:%d", row.Vehicle.ID),
			},
			ObservedAt: &checkedAt,
		}},
		SafeActions:    defaultActions(),
		NavigationPath: &nav,
		ObservedAt:     observedAt,
		FreshFor:       6 * time.Hour,
		AgingFor:       24 * time.Hour,
		ExpiresAt:      now.Add(6 * time.Hour),
		Limitations: []string{
			"An unversioned row is legacy or unattested; it does not prove that the stored value is numerically wrong.",
			"The review is intentionally bounded to the last 30 days.",
		},
	}
}

func defaultActions() []domain.ActionType {
	return []domain.ActionType{
		domain.ActionAcknowledge,
		domain.ActionSnooze,
		domain.ActionDismiss,
		domain.ActionRestore,
		domain.ActionNavigate,
	}
}

func alertUrgency(value, deliveryStatus string) (domain.Severity, domain.Priority) {
	switch strings.ToLower(value) {
	case "critical":
		return domain.SeverityCritical, domain.PriorityCritical
	case "warn", "warning":
		return domain.SeverityWarning, domain.PriorityHigh
	default:
		if deliveryStatus == "failed" {
			return domain.SeverityWarning, domain.PriorityHigh
		}
		return domain.SeverityInfo, domain.PriorityMedium
	}
}

func workOrderUrgency(value string, dueAt *time.Time, now time.Time) (domain.Priority, domain.Severity) {
	switch strings.ToLower(value) {
	case "critical":
		return domain.PriorityCritical, domain.SeverityCritical
	case "high":
		return domain.PriorityHigh, domain.SeverityWarning
	}
	if dueAt != nil && dueAt.Before(now.Add(24*time.Hour)) {
		return domain.PriorityHigh, domain.SeverityWarning
	}
	if strings.EqualFold(value, "medium") {
		return domain.PriorityMedium, domain.SeverityWarning
	}
	return domain.PriorityLow, domain.SeverityInfo
}

func truncate(value string, max int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max-1]) + "…"
}

func coarseDuration(value time.Duration) string {
	if value < time.Hour {
		return fmt.Sprintf("%d minutes", maxInt(1, int(value.Minutes())))
	}
	if value < 48*time.Hour {
		return fmt.Sprintf("%d hours", int(value.Hours()))
	}
	return fmt.Sprintf("%d days", int(value.Hours()/24))
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
