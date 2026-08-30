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

const (
	batteryHealthReviewThresholdPct = 80.0
	driveBaselineWindow             = 30 * 24 * time.Hour
	driveFindingWindow              = 7 * 24 * time.Hour
	driveMinimumBaselineSamples     = 10
	driveMinimumIntensityRatio      = 1.5
	driveMinimumIntensityWhPerM     = 0.3
	commandReliabilityWindow        = 24 * time.Hour
	commandMinimumFailures          = 3
	commandMinimumFailureRatio      = 0.5
)

func sourceFilterAllows(filter ListFilter, source domain.SourceFeature) bool {
	return filter.SourceFeature == nil || *filter.SourceFeature == source
}

type batteryHealthProvider struct{ source port.SourceReader }

func (p batteryHealthProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceBatteryHealth
}

func (p batteryHealthProvider) Recommendations(
	ctx context.Context,
	filter ListFilter,
	now time.Time,
) ([]domain.Candidate, error) {
	if !sourceFilterAllows(filter, domain.SourceBatteryHealth) {
		return []domain.Candidate{}, nil
	}
	rows, err := p.source.ListLatestBatteryHealth(ctx, filter.VehicleID, providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		if row.SohPct >= batteryHealthReviewThresholdPct {
			continue
		}
		observedAt := row.IssuedAt.UTC()
		nav := fmt.Sprintf("/battery-passport?vehicle_id=%d", row.Vehicle.ID)
		summary := fmt.Sprintf(
			"The latest issued Battery Passport reports %.1f%% state of health, below its 80%% inspection threshold.",
			row.SohPct,
		)
		items = append(items, domain.Candidate{
			SourceFeature:   domain.SourceBatteryHealth,
			SourceKey:       fmt.Sprintf("battery_passport:%d", row.LedgerID),
			DedupKey:        fmt.Sprintf("%d:battery_health_threshold", row.Vehicle.ID),
			Vehicle:         &row.Vehicle,
			Title:           "Review battery health threshold",
			Summary:         summary,
			Rationale:       "The latest issued Battery Passport crossed its established 80 percent independent-inspection threshold.",
			Priority:        domain.PriorityHigh,
			Severity:        domain.SeverityWarning,
			BaseConfidence:  0.9,
			ConfidenceBasis: []string{"Direct issued Battery Passport ledger snapshot", "State-of-health threshold matches the passport scoring contract"},
			Evidence: []domain.EvidenceItem{{
				ID:      fmt.Sprintf("battery_passport:%d", row.LedgerID),
				Kind:    "battery_health_threshold",
				Summary: summary,
				Provenance: domain.EvidenceProvenance{
					Source:   "tesla_battery_passport_ledger",
					RecordID: strconv.FormatInt(row.LedgerID, 10),
				},
				ObservedAt: &observedAt,
			}},
			SafeActions:    defaultActions(),
			NavigationPath: &nav,
			ObservedAt:     &observedAt,
			FreshFor:       30 * 24 * time.Hour,
			AgingFor:       90 * 24 * time.Hour,
			ExpiresAt:      now.Add(24 * time.Hour),
			Limitations: []string{
				"State of health is an evidence-backed estimate, not a physical battery diagnosis or warranty determination.",
				"A newer passport is issued only when the Battery Passport is requested.",
			},
		})
	}
	return items, nil
}

type driveEfficiencyProvider struct{ source port.SourceReader }

func (p driveEfficiencyProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceDriveEfficiency
}

func (p driveEfficiencyProvider) Recommendations(
	ctx context.Context,
	filter ListFilter,
	now time.Time,
) ([]domain.Candidate, error) {
	if !sourceFilterAllows(filter, domain.SourceDriveEfficiency) {
		return []domain.Candidate{}, nil
	}
	rows, err := p.source.ListDriveEfficiencyEvidence(
		ctx,
		filter.VehicleID,
		now.Add(-driveBaselineWindow),
		now.Add(-driveFindingWindow),
		driveMinimumBaselineSamples,
		driveMinimumIntensityRatio,
		driveMinimumIntensityWhPerM,
		providerLimit,
	)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		priority := domain.PriorityMedium
		if row.IntensityRatio >= 2 {
			priority = domain.PriorityHigh
		}
		observedAt := row.EndedAt.UTC()
		nav := fmt.Sprintf("/drives/%d", row.DriveID)
		excessPct := (row.IntensityRatio - 1) * 100
		summary := fmt.Sprintf(
			"Completed drive %d used %.0f%% more energy per meter than this vehicle's 30-day baseline.",
			row.DriveID,
			excessPct,
		)
		excessEnergyWh := row.ExcessEnergyWh
		items = append(items, domain.Candidate{
			SourceFeature:  domain.SourceDriveEfficiency,
			SourceKey:      fmt.Sprintf("drive:%d", row.DriveID),
			DedupKey:       fmt.Sprintf("%d:drive_efficiency:%d", row.Vehicle.ID, row.DriveID),
			Vehicle:        &row.Vehicle,
			Title:          "Review unusually energy-intensive drive",
			Summary:        summary,
			Rationale:      "A completed drive exceeded both its vehicle-specific 30-day baseline and the absolute review floor.",
			Priority:       priority,
			Severity:       domain.SeverityWarning,
			BaseConfidence: 0.86,
			ConfidenceBasis: []string{
				fmt.Sprintf("Baseline contains %d completed drives", row.BaselineSampleCount),
				"Energy and distance come directly from the completed drive record",
			},
			Evidence: []domain.EvidenceItem{{
				ID:      fmt.Sprintf("drive:%d", row.DriveID),
				Kind:    "drive_efficiency_exception",
				Summary: summary,
				Provenance: domain.EvidenceProvenance{
					Source:   "drives",
					RecordID: strconv.FormatInt(row.DriveID, 10),
				},
				ObservedAt: &observedAt,
			}},
			ProjectedImpact: &domain.ProjectedImpact{
				EnergyWh: &excessEnergyWh,
				Basis: []string{
					"Excess energy is the recorded drive energy minus the vehicle's measured 30-day baseline at the same distance.",
				},
			},
			SafeActions:    defaultActions(),
			NavigationPath: &nav,
			ObservedAt:     &observedAt,
			FreshFor:       24 * time.Hour,
			AgingFor:       7 * 24 * time.Hour,
			ExpiresAt:      now.Add(7 * 24 * time.Hour),
			Limitations: []string{
				"The baseline is not matched for route, weather, traffic, load, or cabin-conditioning use.",
				"High energy intensity is an exception to review, not evidence of a vehicle fault.",
			},
		})
	}
	return items, nil
}

type vehicleReadinessProvider struct{ source port.SourceReader }

func (p vehicleReadinessProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceVehicleReadiness
}

func (p vehicleReadinessProvider) Recommendations(
	ctx context.Context,
	filter ListFilter,
	now time.Time,
) ([]domain.Candidate, error) {
	if !sourceFilterAllows(filter, domain.SourceVehicleReadiness) {
		return []domain.Candidate{}, nil
	}
	windowStart := now.Add(-commandReliabilityWindow)
	rows, err := p.source.ListCommandReliability(
		ctx,
		filter.VehicleID,
		windowStart,
		now,
		providerLimit,
	)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		if row.AttemptCount == 0 || row.FailureCount < commandMinimumFailures {
			continue
		}
		failureRatio := float64(row.FailureCount) / float64(row.AttemptCount)
		if failureRatio < commandMinimumFailureRatio {
			continue
		}
		priority := domain.PriorityMedium
		if row.FailureCount >= 5 || failureRatio >= 0.8 {
			priority = domain.PriorityHigh
		}
		observedAt := row.LatestFailureAt.UTC()
		nav := fmt.Sprintf("/command-history?vehicle_id=%d", row.Vehicle.ID)
		summary := fmt.Sprintf(
			"%d of %d completed command attempts failed in the last 24 hours.",
			row.FailureCount,
			row.AttemptCount,
		)
		items = append(items, domain.Candidate{
			SourceFeature:   domain.SourceVehicleReadiness,
			SourceKey:       fmt.Sprintf("vehicle:%d:command_window", row.Vehicle.ID),
			DedupKey:        fmt.Sprintf("%d:command_reliability", row.Vehicle.ID),
			Vehicle:         &row.Vehicle,
			Title:           "Review vehicle command reliability",
			Summary:         summary,
			Rationale:       "Repeated persisted command failures can prevent expected remote vehicle operations.",
			Priority:        priority,
			Severity:        domain.SeverityWarning,
			BaseConfidence:  0.94,
			ConfidenceBasis: []string{"Direct persisted command outcomes", "Pending commands are excluded from the failure ratio"},
			Evidence: []domain.EvidenceItem{{
				ID:      fmt.Sprintf("command_window:%d", row.Vehicle.ID),
				Kind:    "command_reliability",
				Summary: summary,
				Provenance: domain.EvidenceProvenance{
					Source: "command_logs",
					RecordID: fmt.Sprintf(
						"vehicle:%d:%s",
						row.Vehicle.ID,
						row.WindowStart.UTC().Format(time.RFC3339),
					),
				},
				ObservedAt: &observedAt,
			}},
			SafeActions:    defaultActions(),
			NavigationPath: &nav,
			ObservedAt:     &observedAt,
			FreshFor:       6 * time.Hour,
			AgingFor:       24 * time.Hour,
			ExpiresAt:      now.Add(6 * time.Hour),
			Limitations: []string{
				"Command failures may reflect vehicle sleep, connectivity, authorization, or upstream service conditions.",
				"The evidence does not identify a root cause and does not justify automatically replaying commands.",
			},
		})
	}
	return items, nil
}

type systemHealthProvider struct{ source port.SourceReader }

func (p systemHealthProvider) SourceFeature() domain.SourceFeature {
	return domain.SourceSystemHealth
}

func (p systemHealthProvider) Recommendations(
	ctx context.Context,
	filter ListFilter,
	now time.Time,
) ([]domain.Candidate, error) {
	if !sourceFilterAllows(filter, domain.SourceSystemHealth) {
		return []domain.Candidate{}, nil
	}
	rows, err := p.source.ListOpenSystemIncidents(ctx, providerLimit)
	if err != nil {
		return nil, err
	}
	items := make([]domain.Candidate, 0, len(rows))
	for _, row := range rows {
		priority, severity := incidentUrgency(row.Severity)
		observedAt := row.UpdatedAt.UTC()
		nav := fmt.Sprintf("/system-status/incidents/%d", row.ID)
		summary := fmt.Sprintf(
			"System incident is %s with %s recorded severity.",
			strings.ReplaceAll(row.Status, "_", " "),
			row.Severity,
		)
		if len(row.AffectedComponents) > 0 {
			summary += fmt.Sprintf(
				" %d component(s) are marked affected.",
				len(row.AffectedComponents),
			)
		}
		items = append(items, domain.Candidate{
			SourceFeature:   domain.SourceSystemHealth,
			SourceKey:       fmt.Sprintf("system_incident:%d", row.ID),
			DedupKey:        fmt.Sprintf("system_incident:%d", row.ID),
			Title:           "Review system incident: " + row.Title,
			Summary:         summary,
			Rationale:       "The persisted incident remains unresolved in the system-status record.",
			Priority:        priority,
			Severity:        severity,
			BaseConfidence:  0.99,
			ConfidenceBasis: []string{"Direct unresolved system-incident record", "Severity and status are operator- or monitor-authored facts"},
			Evidence: []domain.EvidenceItem{{
				ID:      fmt.Sprintf("system_incident:%d", row.ID),
				Kind:    "open_system_incident",
				Summary: summary,
				Provenance: domain.EvidenceProvenance{
					Source:   "status_incidents",
					RecordID: strconv.FormatInt(row.ID, 10),
				},
				ObservedAt: &observedAt,
			}},
			SafeActions:    defaultActions(),
			NavigationPath: &nav,
			ObservedAt:     &observedAt,
			FreshFor:       6 * time.Hour,
			AgingFor:       24 * time.Hour,
			ExpiresAt:      now.Add(6 * time.Hour),
			Limitations: []string{
				"The incident describes TeslaSync service health and does not establish a vehicle fault.",
				"Action Center state changes do not resolve the underlying system incident.",
			},
		})
	}
	return items, nil
}

func incidentUrgency(value string) (domain.Priority, domain.Severity) {
	switch strings.ToLower(value) {
	case "critical":
		return domain.PriorityCritical, domain.SeverityCritical
	case "major":
		return domain.PriorityHigh, domain.SeverityWarning
	default:
		return domain.PriorityMedium, domain.SeverityInfo
	}
}
