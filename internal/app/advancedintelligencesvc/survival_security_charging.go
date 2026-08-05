package advancedintelligencesvc

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/advancedintelligence"
)

func (s *Service) ComponentSurvival(
	ctx context.Context,
	vehicleID int64,
	limit, offset int,
) (*domain.Page[domain.ComponentSurvival], error) {
	limit, offset = normalizePage(limit, offset)
	now := s.now().UTC()
	start := now.Add(-2 * 365 * 24 * time.Hour)
	source, err := s.source.Survival(ctx, vehicleID, start, now)
	if err != nil {
		return nil, fmt.Errorf("load component survival evidence: %w", err)
	}
	items := BuildComponentSurvival(source, now)
	pageItems, total := pageSlice(items, limit, offset)
	return &domain.Page[domain.ComponentSurvival]{
		Items: pageItems, Total: total, Limit: limit, Offset: offset,
	}, nil
}

// BuildComponentSurvival estimates event-free horizons only from recorded
// component-specific outcomes and observed exposure.
func BuildComponentSurvival(
	source *domain.SurvivalEvidence,
	now time.Time,
) []domain.ComponentSurvival {
	if source == nil {
		return []domain.ComponentSurvival{}
	}
	components := []struct {
		name         string
		eventCount   int
		intervention string
	}{
		{name: "hv_battery", eventCount: source.BatteryEventCount, intervention: "complete battery inspection"},
		{name: "tires", eventCount: source.TireEventCount, intervention: "complete tire inspection and alignment"},
		{name: "brakes", eventCount: source.BrakeEventCount, intervention: "complete brake inspection"},
		{name: "charging_system", eventCount: source.ChargingSystemEventCount, intervention: "inspect charging equipment and inlet"},
	}
	totalEvents := source.TireEventCount + source.BrakeEventCount +
		source.BatteryEventCount + source.ChargingSystemEventCount
	risks := make([]domain.CompetingRisk, 0, len(components))
	for _, component := range components {
		var probability *float64
		if totalEvents > 0 {
			value := float64(component.eventCount) / float64(totalEvents) * 100
			probability = &value
		}
		risks = append(risks, domain.CompetingRisk{
			Risk: component.name, ProbabilityPct: probability, EvidenceCount: component.eventCount,
		})
	}

	items := make([]domain.ComponentSurvival, 0, len(components))
	for _, component := range components {
		item := domain.ComponentSurvival{
			VehicleID:      source.VehicleID,
			Component:      component.name,
			CompetingRisks: append([]domain.CompetingRisk(nil), risks...),
			Intervention: domain.InterventionSensitivity{
				Intervention: component.intervention, AssumedHazardDeltaPct: -20,
			},
			Evidence: []domain.Evidence{
				evidence(
					"drives",
					source.LatestObservedAt,
					intPointer(source.DriveSampleCount),
					"Completed drives define the observed exposure window.",
				),
				evidence(
					"fleet_maintenance_work_orders_and_charging_sessions",
					source.LatestObservedAt,
					intPointer(component.eventCount),
					"Recorded component interventions or incomplete charging outcomes define events.",
				),
			},
			Limitations: []string{
				"Recorded work orders are intervention proxies, not confirmed physical failures.",
				"Percentile horizons describe event-free survival and are distinct from remaining-useful-life thresholds.",
				"Intervention sensitivity assumes a transparent 20 percent hazard reduction and is not a service guarantee.",
			},
			GeneratedAt: now.UTC(),
		}
		sufficientExposure := source.ExposureS != nil &&
			*source.ExposureS >= int64(90*24*time.Hour/time.Second) &&
			source.DriveSampleCount >= 20
		if !sufficientExposure || component.eventCount == 0 {
			reasons := []string{}
			if !sufficientExposure {
				reasons = append(reasons, "at least 20 drives over 90 days of exposure are required")
			}
			if component.eventCount == 0 {
				reasons = append(reasons, "no recorded component outcome exists; a zero event rate is not treated as infinite survival")
			}
			item.DataQuality = quality(
				domain.QualityInsufficient,
				source.DriveSampleCount,
				nil,
				nil,
				source.LatestObservedAt,
				reasons...,
			)
			items = append(items, item)
			continue
		}

		exposureS := float64(*source.ExposureS)
		hazardPerS := float64(component.eventCount) / exposureS
		horizonS := float64(365 * 24 * time.Hour / time.Second)
		survivalPct := math.Exp(-hazardPerS*horizonS) * 100
		p10S := int64(-math.Log(0.9) / hazardPerS)
		p50S := int64(-math.Log(0.5) / hazardPerS)
		p90S := int64(-math.Log(0.1) / hazardPerS)
		adjustedP50S := int64(-math.Log(0.5) / (hazardPerS * 0.8))
		item.SurvivalProbabilityPct = pointer(survivalPct)
		item.HorizonP10S = &p10S
		item.HorizonP50S = &p50S
		item.HorizonP90S = &p90S
		item.Intervention.AdjustedP50S = &adjustedP50S
		item.DataQuality = quality(
			domain.QualityLimited,
			source.DriveSampleCount+component.eventCount,
			nil,
			nil,
			source.LatestObservedAt,
			"single-vehicle outcome history supports an empirical rate but not a population-calibrated survival model",
		)
		items = append(items, item)
	}
	return items
}

func (s *Service) RoadHazards(
	ctx context.Context,
	vehicleID int64,
	limit, offset int,
) (*domain.HazardPage, error) {
	limit, offset = normalizePage(limit, offset)
	now := s.now().UTC()
	rows, _, err := s.source.ListHazardEvidence(
		ctx, vehicleID, now.Add(-90*24*time.Hour), now, 1000, 0,
	)
	if err != nil {
		return nil, fmt.Errorf("load road hazard evidence: %w", err)
	}
	clusters := make([]domain.HazardCluster, 0, len(rows))
	for _, row := range rows {
		// A security event without a legitimately correlated coarse cell is
		// not exposed as a road hazard. Exact coordinates are never queried.
		if row.CoarseCell == nil || *row.CoarseCell == "" {
			continue
		}
		confidence := clamp(45+15*math.Log1p(float64(row.ObservationCount)), 0, 95)
		clusters = append(clusters, domain.HazardCluster{
			HazardType:       row.HazardType,
			Severity:         row.Severity,
			ConfidencePct:    confidence,
			ObservationCount: row.ObservationCount,
			CoarseCell:       *row.CoarseCell,
			LastSeen:         row.LastSeen.UTC(),
			Evidence: []domain.Evidence{
				evidence(
					"security_events_and_signal_log",
					timePointer(row.LastSeen),
					intPointer(row.ObservationCount),
					"Direct crash or airbag transitions are correlated only with a location observed within fifteen minutes and reduced to a two-decimal coarse cell.",
				),
			},
		})
	}
	sort.SliceStable(clusters, func(i, j int) bool {
		return clusters[i].LastSeen.After(clusters[j].LastSeen)
	})
	pageItems, total := pageSlice(clusters, limit, offset)
	status := domain.QualityInsufficient
	reasons := []string{"no safely correlated coarse spatial evidence was available"}
	if total > 0 {
		status = domain.QualityLimited
		reasons = []string{"clusters expose coarse cells only; exact raw coordinates are never returned"}
	}
	return &domain.HazardPage{
		Page: domain.Page[domain.HazardCluster]{
			Items: pageItems, Total: total, Limit: limit, Offset: offset,
		},
		DataQuality: quality(status, total, nil, nil, timePointer(now), reasons...),
		Limitations: []string{
			"Safety transitions without a legitimately correlated coarse cell are omitted rather than spatially guessed.",
			"Empty results mean no qualifying evidence, not that a road is hazard-free.",
		},
		GeneratedAt: now,
	}, nil
}

func (s *Service) BehavioralSentinel(
	ctx context.Context,
	vehicleID int64,
	limit, offset int,
) (*domain.SentinelPage, error) {
	limit, offset = normalizePage(limit, offset)
	now := s.now().UTC()
	source, err := s.source.Sentinel(ctx, vehicleID, now.Add(-30*24*time.Hour), now)
	if err != nil {
		return nil, fmt.Errorf("load behavioral sentinel evidence: %w", err)
	}
	findings := BuildSentinelFindings(source)
	pageItems, total := pageSlice(findings, limit, offset)
	samples := 0
	if source != nil {
		samples = source.CommandSampleCount + source.TelemetrySampleCount
	}
	status := domain.QualityLimited
	if samples == 0 {
		status = domain.QualityInsufficient
	}
	return &domain.SentinelPage{
		Page: domain.Page[domain.SentinelFinding]{
			Items: pageItems, Total: total, Limit: limit, Offset: offset,
		},
		DataQuality: quality(status, samples, nil, nil, timePointer(now),
			"findings are deterministic threshold signals, not attack attribution"),
		Limitations: []string{
			"Impossible travel is not evaluated because no trustworthy geolocation evidence is joined to identities.",
			"No attack is inferred when command, audit, or telemetry evidence does not cross a documented threshold.",
			"Actor values and session identities are aggregated and never returned.",
		},
		GeneratedAt: now,
	}, nil
}

// BuildSentinelFindings only emits findings supported by aggregate evidence.
func BuildSentinelFindings(source *domain.SentinelEvidence) []domain.SentinelFinding {
	findings := []domain.SentinelFinding{}
	if source == nil {
		return findings
	}
	if source.RecentCommandCount >= 5 && source.PriorCommandCount >= 10 {
		recentRate := float64(source.RecentFailureCount) / float64(source.RecentCommandCount)
		priorRate := float64(source.PriorFailureCount) / float64(source.PriorCommandCount)
		if recentRate-priorRate >= 0.30 {
			findings = append(findings, domain.SentinelFinding{
				FindingType:   "command_failure_regression",
				Severity:      "warning",
				ConfidencePct: clamp(60+(recentRate-priorRate)*40, 0, 95),
				Explanation:   "The recent command failure rate is at least 30 percentage points above the prior observed window.",
				ObservedAt:    source.LatestCommandAt,
				Evidence: []domain.Evidence{
					evidence("command_executions", source.LatestCommandAt,
						intPointer(source.CommandSampleCount),
						"Recent and prior status counts are compared without exposing command parameters or actors."),
				},
				Limitations: []string{
					"Failures may reflect connectivity or upstream service conditions and do not prove malicious activity.",
				},
			})
		}
	}
	if source.MaxCommandsPerMinute >= 10 {
		findings = append(findings, domain.SentinelFinding{
			FindingType:   "command_burst",
			Severity:      "warning",
			ConfidencePct: clamp(55+float64(source.MaxCommandsPerMinute-10)*2, 0, 95),
			Explanation:   "At least ten command audit rows were recorded in one minute.",
			ObservedAt:    source.LatestCommandAt,
			Evidence: []domain.Evidence{
				evidence("command_executions", source.LatestCommandAt,
					intPointer(source.MaxCommandsPerMinute),
					"Peak command count is aggregated to a one-minute bucket."),
			},
			Limitations: []string{
				"Automation retries can create legitimate bursts; command contents are not inspected.",
			},
		})
	}
	if source.RecentIdentityCount >= 3 &&
		source.RecentIdentityCount > source.PriorIdentityCount+1 {
		findings = append(findings, domain.SentinelFinding{
			FindingType:   "identity_diversity_change",
			Severity:      "info",
			ConfidencePct: 65,
			Explanation:   "The count of distinct command identities increased materially in the recent window.",
			ObservedAt:    source.LatestCommandAt,
			Evidence: []domain.Evidence{
				evidence("command_executions", source.LatestCommandAt,
					intPointer(source.RecentIdentityCount),
					"Only distinct identity counts are retained in the finding."),
			},
			Limitations: []string{
				"Identity count changes may be expected after operator or integration changes.",
			},
		})
	}
	if source.TelemetrySampleCount >= 2 && source.MaxTelemetryGapS != nil &&
		*source.MaxTelemetryGapS > int64(24*time.Hour/time.Second) {
		findings = append(findings, domain.SentinelFinding{
			FindingType:   "telemetry_integrity_gap",
			Severity:      "info",
			ConfidencePct: 90,
			Explanation:   "The durable telemetry change feed contains an observed gap longer than twenty-four hours.",
			ObservedAt:    source.LatestTelemetryAt,
			Evidence: []domain.Evidence{
				evidence("signal_log", source.LatestTelemetryAt,
					intPointer(source.TelemetrySampleCount),
					"Consecutive change-feed timestamps are compared without treating missing signals as state."),
			},
			Limitations: []string{
				"A sleeping or disconnected vehicle can create a legitimate gap; this is not evidence of tampering.",
			},
		})
	}
	return findings
}

func (s *Service) ChargingForensics(
	ctx context.Context,
	vehicleID int64,
	limit, offset int,
) (*domain.ChargingForensicsPage, error) {
	limit, offset = normalizePage(limit, offset)
	now := s.now().UTC()
	rows, total, err := s.source.ListChargingEvidence(ctx, vehicleID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("load charging forensics evidence: %w", err)
	}
	items := make([]domain.ChargingForensicsItem, 0, len(rows))
	supported := 0
	for _, row := range rows {
		status := "unsupported"
		limitations := []string{
			"Meter-side energy, tariff line items, taxes, and fees are not recorded for this session.",
			"Loss and billing discrepancy fields remain null rather than substituting pack energy or a default tariff.",
		}
		if row.EndedAt == nil {
			status = "incomplete"
		} else if row.RecordedCostMinor != nil || row.VehicleEnergyWh != nil {
			status = "recorded_only"
			supported++
		}
		items = append(items, domain.ChargingForensicsItem{
			SessionID:         row.SessionID,
			StartedAt:         row.StartedAt.UTC(),
			EndedAt:           row.EndedAt,
			VehicleEnergyWh:   row.VehicleEnergyWh,
			RecordedCostMinor: row.RecordedCostMinor,
			Currency:          row.Currency,
			Status:            status,
			Evidence: []domain.Evidence{
				evidence(
					"charging_sessions",
					timePointer(row.StartedAt),
					intPointer(1),
					"Vehicle-side session energy and recorded cost are returned exactly when present.",
				),
			},
			Limitations: limitations,
		})
	}
	status := domain.QualityInsufficient
	if supported > 0 {
		status = domain.QualityLimited
	}
	return &domain.ChargingForensicsPage{
		Page: domain.Page[domain.ChargingForensicsItem]{
			Items: items, Total: total, Limit: limit, Offset: offset,
		},
		DataQuality: quality(status, len(rows), nil, nil, timePointer(now),
			"full reconciliation requires independently recorded meter energy and typed tariff or fee records"),
		GeneratedAt: now,
	}, nil
}
