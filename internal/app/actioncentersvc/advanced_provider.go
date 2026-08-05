package actioncentersvc

import (
	"context"
	"fmt"
	"strings"
	"time"

	actiondomain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	advanceddomain "github.com/ev-dev-labs/teslasync/internal/domain/advancedintelligence"
	actionport "github.com/ev-dev-labs/teslasync/internal/port/actioncenter"
)

const advancedVehicleLimit = 8

type AdvancedIntelligenceReader interface {
	FirmwareCanary(context.Context, int64, int, int) (*advanceddomain.Page[advanceddomain.FirmwareCanary], error)
	ComponentSurvival(context.Context, int64, int, int) (*advanceddomain.Page[advanceddomain.ComponentSurvival], error)
	RoadHazards(context.Context, int64, int, int) (*advanceddomain.HazardPage, error)
	BehavioralSentinel(context.Context, int64, int, int) (*advanceddomain.SentinelPage, error)
}

type advancedProvider struct {
	source   actionport.SourceReader
	advanced AdvancedIntelligenceReader
}

func (p advancedProvider) SourceFeature() actiondomain.SourceFeature {
	return actiondomain.SourceAdvancedIntelligence
}

func (p advancedProvider) Recommendations(
	ctx context.Context,
	filter ListFilter,
	now time.Time,
) ([]actiondomain.Candidate, error) {
	if filter.SourceFeature != nil &&
		*filter.SourceFeature != actiondomain.SourceAdvancedIntelligence {
		return []actiondomain.Candidate{}, nil
	}
	vehicles, err := p.source.ListSignalHealth(
		ctx,
		filter.VehicleID,
		now.Add(-30*24*time.Hour),
		now,
		advancedVehicleLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("list advanced-intelligence vehicles: %w", err)
	}

	items := make([]actiondomain.Candidate, 0)
	for _, vehicle := range vehicles {
		firmware, err := p.advanced.FirmwareCanary(ctx, vehicle.Vehicle.ID, 1, 0)
		if err != nil {
			return nil, fmt.Errorf("load firmware canary for vehicle %d: %w", vehicle.Vehicle.ID, err)
		}
		items = append(items, firmwareCandidates(vehicle.Vehicle, firmware, now)...)

		survival, err := p.advanced.ComponentSurvival(ctx, vehicle.Vehicle.ID, 10, 0)
		if err != nil {
			return nil, fmt.Errorf("load component survival for vehicle %d: %w", vehicle.Vehicle.ID, err)
		}
		items = append(items, survivalCandidates(vehicle.Vehicle, survival, now)...)

		hazards, err := p.advanced.RoadHazards(ctx, vehicle.Vehicle.ID, 25, 0)
		if err != nil {
			return nil, fmt.Errorf("load road hazards for vehicle %d: %w", vehicle.Vehicle.ID, err)
		}
		items = append(items, hazardCandidates(vehicle.Vehicle, hazards, now)...)

		sentinel, err := p.advanced.BehavioralSentinel(ctx, vehicle.Vehicle.ID, 25, 0)
		if err != nil {
			return nil, fmt.Errorf("load behavioral sentinel for vehicle %d: %w", vehicle.Vehicle.ID, err)
		}
		items = append(items, sentinelCandidates(vehicle.Vehicle, sentinel, now)...)
	}
	return items, nil
}

func firmwareCandidates(
	vehicle actiondomain.VehicleRef,
	page *advanceddomain.Page[advanceddomain.FirmwareCanary],
	now time.Time,
) []actiondomain.Candidate {
	if page == nil {
		return []actiondomain.Candidate{}
	}
	items := make([]actiondomain.Candidate, 0, len(page.Items))
	for _, finding := range page.Items {
		if finding.Decision != advanceddomain.CanaryHold &&
			finding.Decision != advanceddomain.CanaryInvestigate {
			continue
		}
		version := "unknown"
		if finding.Version != nil && strings.TrimSpace(*finding.Version) != "" {
			version = strings.TrimSpace(*finding.Version)
		}
		priority := actiondomain.PriorityMedium
		if finding.Decision == advanceddomain.CanaryHold {
			priority = actiondomain.PriorityHigh
		}
		summary := fmt.Sprintf(
			"Firmware %s is classified as %s from matched before/after efficiency evidence.",
			version,
			finding.Decision,
		)
		if finding.MatchedExcessPct != nil {
			summary = fmt.Sprintf(
				"Firmware %s shows %.1f%% excess efficiency regression versus its matched cohort.",
				version,
				*finding.MatchedExcessPct,
			)
		}
		observedAt := latestAdvancedEvidenceTime(finding.Evidence)
		nav := "/intelligence/firmware-canary"
		items = append(items, actiondomain.Candidate{
			SourceFeature:  actiondomain.SourceAdvancedIntelligence,
			SourceKey:      fmt.Sprintf("firmware:%d:%s", vehicle.ID, version),
			DedupKey:       fmt.Sprintf("%d:firmware:%s", vehicle.ID, version),
			Vehicle:        &vehicle,
			Title:          "Review firmware canary finding",
			Summary:        summary,
			Rationale:      "A rollout hold or investigation decision crossed the documented canary threshold.",
			Priority:       priority,
			Severity:       actiondomain.SeverityWarning,
			BaseConfidence: qualityConfidence(finding.WindowQuality),
			ConfidenceBasis: []string{
				"Decision is generated from bounded non-overlapping pre/post windows.",
				"Matched-cohort evidence is used when sufficient peer coverage exists.",
			},
			Evidence:       mapAdvancedEvidence("firmware_canary", finding.Evidence),
			SafeActions:    defaultActions(),
			NavigationPath: &nav,
			ObservedAt:     observedAt,
			FreshFor:       24 * time.Hour,
			AgingFor:       7 * 24 * time.Hour,
			ExpiresAt:      now.Add(6 * time.Hour),
			Limitations:    append([]string(nil), finding.Limitations...),
		})
	}
	return items
}

func survivalCandidates(
	vehicle actiondomain.VehicleRef,
	page *advanceddomain.Page[advanceddomain.ComponentSurvival],
	now time.Time,
) []actiondomain.Candidate {
	if page == nil {
		return []actiondomain.Candidate{}
	}
	items := make([]actiondomain.Candidate, 0, len(page.Items))
	for _, finding := range page.Items {
		if finding.SurvivalProbabilityPct == nil ||
			finding.DataQuality.Status == advanceddomain.QualityInsufficient ||
			*finding.SurvivalProbabilityPct > 75 {
			continue
		}
		priority := actiondomain.PriorityMedium
		riskLevel := actiondomain.ImpactRiskModerate
		if *finding.SurvivalProbabilityPct <= 50 {
			priority = actiondomain.PriorityHigh
			riskLevel = actiondomain.ImpactRiskHigh
		}
		nav := "/intelligence/component-survival"
		observedAt := latestAdvancedEvidenceTime(finding.Evidence)
		items = append(items, actiondomain.Candidate{
			SourceFeature: actiondomain.SourceAdvancedIntelligence,
			SourceKey: fmt.Sprintf(
				"component_survival:%d:%s",
				vehicle.ID,
				finding.Component,
			),
			DedupKey: fmt.Sprintf(
				"%d:component_survival:%s",
				vehicle.ID,
				finding.Component,
			),
			Vehicle: &vehicle,
			Title:   "Review component survival estimate",
			Summary: fmt.Sprintf(
				"%s has a %.1f%% modeled one-year event-free survival probability.",
				strings.ReplaceAll(finding.Component, "_", " "),
				*finding.SurvivalProbabilityPct,
			),
			Rationale: "The evidence-backed survival estimate crossed the 75 percent review threshold.",
			Priority:  priority,
			Severity:  actiondomain.SeverityWarning,
			BaseConfidence: qualityConfidence(
				finding.DataQuality,
			),
			ConfidenceBasis: []string{
				"Only recorded exposure and component-specific outcome proxies are used.",
				"Insufficient-quality estimates are omitted from the Action Center.",
			},
			Evidence: mapAdvancedEvidence(
				"component_survival:"+finding.Component,
				finding.Evidence,
			),
			ProjectedImpact: &actiondomain.ProjectedImpact{
				RiskLevel: &riskLevel,
				Basis: []string{
					"Qualitative risk reflects the displayed survival threshold; it is not a failure diagnosis.",
				},
			},
			SafeActions:    defaultActions(),
			NavigationPath: &nav,
			ObservedAt:     observedAt,
			FreshFor:       7 * 24 * time.Hour,
			AgingFor:       30 * 24 * time.Hour,
			ExpiresAt:      now.Add(24 * time.Hour),
			Limitations:    append([]string(nil), finding.Limitations...),
		})
	}
	return items
}

func hazardCandidates(
	vehicle actiondomain.VehicleRef,
	page *advanceddomain.HazardPage,
	now time.Time,
) []actiondomain.Candidate {
	if page == nil {
		return []actiondomain.Candidate{}
	}
	items := make([]actiondomain.Candidate, 0, len(page.Items))
	for _, finding := range page.Items {
		observedAt := finding.LastSeen.UTC()
		nav := "/intelligence/road-hazards"
		priority := actiondomain.PriorityHigh
		severity := actiondomain.SeverityWarning
		if strings.EqualFold(finding.Severity, "critical") {
			priority = actiondomain.PriorityCritical
			severity = actiondomain.SeverityCritical
		}
		items = append(items, actiondomain.Candidate{
			SourceFeature: actiondomain.SourceAdvancedIntelligence,
			SourceKey: fmt.Sprintf(
				"road_hazard:%d:%s:%s",
				vehicle.ID,
				finding.CoarseCell,
				finding.HazardType,
			),
			DedupKey: fmt.Sprintf(
				"%d:road_hazard:%s:%s",
				vehicle.ID,
				finding.CoarseCell,
				finding.HazardType,
			),
			Vehicle: &vehicle,
			Title:   "Review road hazard evidence",
			Summary: fmt.Sprintf(
				"%d %s observation(s) are clustered in coarse cell %s.",
				finding.ObservationCount,
				strings.ReplaceAll(finding.HazardType, "_", " "),
				finding.CoarseCell,
			),
			Rationale:      "A direct crash or airbag transition was safely correlated with a coarse location cell.",
			Priority:       priority,
			Severity:       severity,
			BaseConfidence: finding.ConfidencePct / 100,
			ConfidenceBasis: []string{
				"Confidence increases only with direct qualifying observations.",
				"Exact coordinates are never returned or inferred.",
			},
			Evidence: mapAdvancedEvidence(
				"road_hazard:"+finding.CoarseCell+":"+finding.HazardType,
				finding.Evidence,
			),
			SafeActions:    defaultActions(),
			NavigationPath: &nav,
			ObservedAt:     &observedAt,
			FreshFor:       7 * 24 * time.Hour,
			AgingFor:       30 * 24 * time.Hour,
			ExpiresAt:      now.Add(6 * time.Hour),
			Limitations:    append([]string(nil), page.Limitations...),
		})
	}
	return items
}

func sentinelCandidates(
	vehicle actiondomain.VehicleRef,
	page *advanceddomain.SentinelPage,
	now time.Time,
) []actiondomain.Candidate {
	if page == nil {
		return []actiondomain.Candidate{}
	}
	items := make([]actiondomain.Candidate, 0, len(page.Items))
	for _, finding := range page.Items {
		priority := actiondomain.PriorityMedium
		severity := actiondomain.SeverityInfo
		if strings.EqualFold(finding.Severity, "warning") {
			priority = actiondomain.PriorityHigh
			severity = actiondomain.SeverityWarning
		}
		nav := "/intelligence/behavioral-sentinel"
		items = append(items, actiondomain.Candidate{
			SourceFeature: actiondomain.SourceAdvancedIntelligence,
			SourceKey: fmt.Sprintf(
				"behavioral_sentinel:%d:%s",
				vehicle.ID,
				finding.FindingType,
			),
			DedupKey: fmt.Sprintf(
				"%d:behavioral_sentinel:%s",
				vehicle.ID,
				finding.FindingType,
			),
			Vehicle:        &vehicle,
			Title:          "Review behavioral sentinel finding",
			Summary:        finding.Explanation,
			Rationale:      "A deterministic behavioral threshold was crossed in bounded command or telemetry evidence.",
			Priority:       priority,
			Severity:       severity,
			BaseConfidence: finding.ConfidencePct / 100,
			ConfidenceBasis: []string{
				"Thresholds use aggregate counts and never expose actor identities.",
				"The finding is behavioral evidence, not attack attribution.",
			},
			Evidence: mapAdvancedEvidence(
				"behavioral_sentinel:"+finding.FindingType,
				finding.Evidence,
			),
			SafeActions:    defaultActions(),
			NavigationPath: &nav,
			ObservedAt:     finding.ObservedAt,
			FreshFor:       24 * time.Hour,
			AgingFor:       7 * 24 * time.Hour,
			ExpiresAt:      now.Add(6 * time.Hour),
			Limitations: append(
				append([]string(nil), finding.Limitations...),
				page.Limitations...,
			),
		})
	}
	return items
}

func mapAdvancedEvidence(prefix string, evidence []advanceddomain.Evidence) []actiondomain.EvidenceItem {
	items := make([]actiondomain.EvidenceItem, 0, len(evidence))
	for index, item := range evidence {
		items = append(items, actiondomain.EvidenceItem{
			ID:      fmt.Sprintf("%s:%d", prefix, index),
			Kind:    "advanced_intelligence",
			Summary: item.Summary,
			Provenance: actiondomain.EvidenceProvenance{
				Source:   item.Source,
				RecordID: fmt.Sprintf("%s:%d", prefix, index),
			},
			ObservedAt: item.ObservedAt,
		})
	}
	return items
}

func latestAdvancedEvidenceTime(evidence []advanceddomain.Evidence) *time.Time {
	var latest *time.Time
	for _, item := range evidence {
		if item.ObservedAt == nil || (latest != nil && !item.ObservedAt.After(*latest)) {
			continue
		}
		value := item.ObservedAt.UTC()
		latest = &value
	}
	return latest
}

func qualityConfidence(quality advanceddomain.DataQuality) float64 {
	switch quality.Status {
	case advanceddomain.QualitySufficient:
		return 0.9
	case advanceddomain.QualityLimited:
		return 0.7
	default:
		return 0.45
	}
}
