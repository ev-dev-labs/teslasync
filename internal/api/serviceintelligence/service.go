package serviceintelligence

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/ev-dev-labs/teslasync/internal/integrations/nhtsa"
)

const (
	localReadTimeout      = 5 * time.Second
	observationWindow     = 30 * 24 * time.Hour
	maxObservations       = 50
	applicabilityReview   = "needs_review"
	applicabilityLikely   = "potentially_applicable"
	applicabilityUnlikely = "unlikely"
)

var (
	ErrVehicleNotFound = errors.New("vehicle not found")
	ErrInvalidVehicle  = errors.New("invalid vehicle ID")
)

type Service struct {
	vehicles       VehicleReader
	observations   ObservationReader
	nhtsa          nhtsa.Provider
	communications nhtsa.ManufacturerCommunicationsProvider
	now            func() time.Time
}

func NewService(
	vehicles VehicleReader,
	observations ObservationReader,
	nhtsaProvider nhtsa.Provider,
	communicationsProvider nhtsa.ManufacturerCommunicationsProvider,
) *Service {
	return &Service{
		vehicles:       vehicles,
		observations:   observations,
		nhtsa:          nhtsaProvider,
		communications: communicationsProvider,
		now:            time.Now,
	}
}

func (s *Service) Get(ctx context.Context, vehicleID int64, refresh bool) (*Response, error) {
	if vehicleID <= 0 {
		return nil, ErrInvalidVehicle
	}
	if s == nil || s.vehicles == nil || s.observations == nil || s.nhtsa == nil || s.communications == nil {
		return nil, errors.New("service intelligence dependencies are not configured")
	}

	readCtx, cancelRead := context.WithTimeout(ctx, localReadTimeout)
	vehicle, err := s.vehicles.GetVehicleMetadata(readCtx, vehicleID)
	cancelRead()
	if err != nil {
		return nil, fmt.Errorf("load service-intelligence vehicle %d: %w", vehicleID, err)
	}
	if vehicle == nil {
		return nil, ErrVehicleNotFound
	}

	opts := nhtsa.FetchOptions{Refresh: refresh}
	decoded, err := s.nhtsa.DecodeVIN(ctx, vehicle.VIN, opts)
	if err != nil {
		return nil, fmt.Errorf("decode service-intelligence vehicle %d: %w", vehicleID, err)
	}
	query := nhtsa.VehicleQuery{
		Make:      decoded.Vehicle.Make,
		Model:     decoded.Vehicle.Model,
		ModelYear: decoded.Vehicle.ModelYear,
	}

	recalls, err := s.nhtsa.Recalls(ctx, query, opts)
	if err != nil {
		return nil, fmt.Errorf("load recall inventory for vehicle %d: %w", vehicleID, err)
	}
	communications, err := s.communications.ManufacturerCommunications(ctx, query, opts)
	if err != nil {
		return nil, fmt.Errorf("load manufacturer communications for vehicle %d: %w", vehicleID, err)
	}

	now := s.now().UTC()
	observationCtx, cancelObservations := context.WithTimeout(ctx, localReadTimeout)
	observations, err := s.observations.RecentObservations(
		observationCtx,
		vehicleID,
		now.Add(-observationWindow),
		now,
		maxObservations,
	)
	cancelObservations()
	if err != nil {
		return nil, fmt.Errorf("load observed symptoms for vehicle %d: %w", vehicleID, err)
	}

	findings, recallSymptoms := rankRecallFindings(
		recalls.Recalls,
		decoded.Vehicle,
		vehicle.FirmwareVersion,
		observations,
	)
	communicationFindings, communicationSymptoms := rankCommunicationFindings(
		communications.Communications,
		decoded.Vehicle,
		vehicle.FirmwareVersion,
		observations,
	)
	rankedSymptoms := append(recallSymptoms, communicationSymptoms...)
	sort.SliceStable(rankedSymptoms, func(i, j int) bool {
		if rankedSymptoms[i].Score != rankedSymptoms[j].Score {
			return rankedSymptoms[i].Score > rankedSymptoms[j].Score
		}
		return rankedSymptoms[i].ObservedAt.After(rankedSymptoms[j].ObservedAt)
	})
	sources := []nhtsa.SourceMetadata{
		decoded.Source,
		recalls.Source,
		communications.Source,
	}
	limitations := buildLimitations(communications.Source)
	evidence := buildEvidence(
		findings,
		communicationFindings,
		rankedSymptoms,
		decoded.Vehicle,
		vehicle.FirmwareVersion,
		communications.Source,
		limitations,
	)

	potentialCount := 0
	for _, finding := range findings {
		if finding.Applicability == applicabilityLikely {
			potentialCount++
		}
	}

	return &Response{
		VehicleID:      vehicleID,
		GeneratedAt:    now,
		VehicleContext: buildVehicleContext(decoded.Vehicle, vehicle.FirmwareVersion),
		Summary: InventorySummary{
			RecallCandidates:             len(findings),
			PotentiallyApplicableRecalls: potentialCount,
			ManufacturerCommunications:   len(communicationFindings),
			SymptomMatches:               len(rankedSymptoms),
		},
		RecallFindings: findings,
		Communications: communicationFindings,
		RankedSymptoms: rankedSymptoms,
		Evidence:       evidence,
		Sources:        sources,
	}, nil
}

func buildVehicleContext(decoded nhtsa.DecodedVehicle, firmware *string) VehicleContext {
	return VehicleContext{
		Make:            decoded.Make,
		Model:           decoded.Model,
		ModelYear:       decoded.ModelYear,
		BuildDate:       nil,
		BuildMatchBasis: "Decoded model year and assembly plant; exact build date is unavailable.",
		PlantCountry:    optionalString(decoded.PlantCountry),
		PlantState:      optionalString(decoded.PlantState),
		PlantCity:       optionalString(decoded.PlantCity),
		FirmwareVersion: cloneString(firmware),
	}
}

func rankRecallFindings(
	recalls []nhtsa.Recall,
	decoded nhtsa.DecodedVehicle,
	firmware *string,
	observations []SignalObservation,
) ([]Finding, []SymptomMatch) {
	findings := make([]Finding, 0, len(recalls))
	allSymptoms := make([]SymptomMatch, 0)

	for _, recall := range recalls {
		factors, confidence := applicabilityFactors(recall, decoded, firmware)
		symptoms := matchSymptoms(recall, observations)
		for i := range symptoms {
			symptoms[i].FindingID = recall.CampaignNumber
		}
		if len(symptoms) > 0 {
			symptomBoost := math.Min(0.15, symptoms[0].Score*0.15)
			confidence += symptomBoost
			factors = append(factors, MatchFactor{
				Dimension: "observed_symptoms",
				Status:    "matched",
				Weight:    roundConfidence(symptomBoost),
				Detail:    fmt.Sprintf("%d recent signal-derived symptom match(es) overlap the campaign component.", len(symptoms)),
			})
		} else {
			factors = append(factors, MatchFactor{
				Dimension: "observed_symptoms",
				Status:    "not_observed",
				Weight:    0,
				Detail:    "No recent statistical signal deviation overlapped the campaign component.",
			})
		}

		// Make/model/year matching cannot establish exact production-range
		// inclusion, so confidence remains capped below certainty.
		confidence = math.Min(0.86, roundConfidence(confidence))
		applicability := classifyApplicability(confidence)
		hypothesis := buildHypothesis(recall, applicability, symptoms)

		findings = append(findings, Finding{
			ID:                recall.CampaignNumber,
			Kind:              "recall",
			Title:             "NHTSA Campaign " + recall.CampaignNumber,
			Component:         recall.Component,
			Summary:           recall.Summary,
			Consequence:       recall.Consequence,
			Remedy:            recall.Remedy,
			ReportReceivedAt:  recall.ReportReceivedAt,
			Applicability:     applicability,
			Confidence:        confidence,
			ConfidenceLabel:   confidenceLabel(confidence),
			CompletionStatus:  "unknown",
			Hypothesis:        hypothesis,
			MatchFactors:      factors,
			SymptomMatches:    symptoms,
			ParkIt:            recall.ParkIt,
			ParkOutside:       recall.ParkOutside,
			OverTheAirUpdate:  recall.OverTheAirUpdate,
			SourceDocumentURL: recall.SourceDocumentURL,
		})
		allSymptoms = append(allSymptoms, symptoms...)
	}

	sort.SliceStable(findings, func(i, j int) bool {
		if findings[i].Confidence != findings[j].Confidence {
			return findings[i].Confidence > findings[j].Confidence
		}
		return findings[i].ID < findings[j].ID
	})
	sort.SliceStable(allSymptoms, func(i, j int) bool {
		if allSymptoms[i].Score != allSymptoms[j].Score {
			return allSymptoms[i].Score > allSymptoms[j].Score
		}
		return allSymptoms[i].ObservedAt.After(allSymptoms[j].ObservedAt)
	})
	return findings, allSymptoms
}

func rankCommunicationFindings(
	communications []nhtsa.ManufacturerCommunication,
	decoded nhtsa.DecodedVehicle,
	firmware *string,
	observations []SignalObservation,
) ([]CommunicationFinding, []SymptomMatch) {
	findings := make([]CommunicationFinding, 0, len(communications))
	allSymptoms := make([]SymptomMatch, 0)
	for _, communication := range communications {
		proxy := nhtsa.Recall{
			CampaignNumber: communication.NHTSAID,
			Component:      communication.Component,
			Summary:        communication.Summary,
			ModelYear:      communication.ModelYear,
			Make:           communication.Manufacturer,
			Model:          communication.Model,
		}
		factors, confidence := applicabilityFactors(proxy, decoded, firmware)
		symptoms := matchSymptoms(proxy, observations)
		findingID := "tsb-" + communication.NHTSAID
		for i := range symptoms {
			symptoms[i].FindingID = findingID
		}
		if len(symptoms) > 0 {
			symptomBoost := math.Min(0.15, symptoms[0].Score*0.15)
			confidence += symptomBoost
			factors = append(factors, MatchFactor{
				Dimension: "observed_symptoms",
				Status:    "matched",
				Weight:    roundConfidence(symptomBoost),
				Detail: fmt.Sprintf(
					"%d recent signal-derived symptom match(es) overlap the communication component.",
					len(symptoms),
				),
			})
		} else {
			factors = append(factors, MatchFactor{
				Dimension: "observed_symptoms",
				Status:    "not_observed",
				Weight:    0,
				Detail:    "No recent statistical signal deviation overlapped the communication component.",
			})
		}
		confidence = math.Min(0.86, roundConfidence(confidence))
		applicability := classifyApplicability(confidence)
		hypothesis := fmt.Sprintf(
			"Manufacturer communication %s is %s based on decoded make, model, and model year",
			communication.CommunicationNumber,
			strings.ReplaceAll(applicability, "_", " "),
		)
		if len(symptoms) > 0 {
			hypothesis += fmt.Sprintf(
				", with a recent %s signal pattern worth technician review.",
				symptoms[0].Component,
			)
		} else {
			hypothesis += "; exact build-range inclusion and service history require authoritative confirmation."
		}

		findings = append(findings, CommunicationFinding{
			ID:                  findingID,
			NHTSAID:             communication.NHTSAID,
			CommunicationNumber: communication.CommunicationNumber,
			CommunicationType:   communication.CommunicationType,
			Manufacturer:        communication.Manufacturer,
			Model:               communication.Model,
			ModelYear:           communication.ModelYear,
			PublishedAt:         communication.PublishedAt,
			Component:           communication.Component,
			Summary:             communication.Summary,
			Applicability:       applicability,
			Confidence:          confidence,
			ConfidenceLabel:     confidenceLabel(confidence),
			Hypothesis:          hypothesis,
			MatchFactors:        factors,
			SymptomMatches:      symptoms,
			SourceDocumentURL:   communication.SourceDocumentURL,
		})
		allSymptoms = append(allSymptoms, symptoms...)
	}
	sort.SliceStable(findings, func(i, j int) bool {
		if findings[i].Confidence != findings[j].Confidence {
			return findings[i].Confidence > findings[j].Confidence
		}
		if findings[i].PublishedAt != nil && findings[j].PublishedAt != nil &&
			!findings[i].PublishedAt.Equal(*findings[j].PublishedAt) {
			return findings[i].PublishedAt.After(*findings[j].PublishedAt)
		}
		return findings[i].ID < findings[j].ID
	})
	sort.SliceStable(allSymptoms, func(i, j int) bool {
		if allSymptoms[i].Score != allSymptoms[j].Score {
			return allSymptoms[i].Score > allSymptoms[j].Score
		}
		return allSymptoms[i].ObservedAt.After(allSymptoms[j].ObservedAt)
	})
	return findings, allSymptoms
}

func applicabilityFactors(
	recall nhtsa.Recall,
	decoded nhtsa.DecodedVehicle,
	firmware *string,
) ([]MatchFactor, float64) {
	factors := make([]MatchFactor, 0, 5)
	confidence := 0.0

	makeMatched := normalizedText(recall.Make) == normalizedText(decoded.Make)
	factors = append(factors, factor("make", makeMatched, 0.15,
		"Decoded manufacturer matches the campaign manufacturer.",
		"Decoded manufacturer does not match the campaign manufacturer."))
	if makeMatched {
		confidence += 0.15
	}

	modelMatched := normalizedText(recall.Model) == normalizedText(decoded.Model)
	factors = append(factors, factor("model", modelMatched, 0.25,
		"Decoded model matches the campaign model.",
		"Decoded model does not match the campaign model."))
	if modelMatched {
		confidence += 0.25
	}

	yearMatched := recall.ModelYear == decoded.ModelYear
	factors = append(factors, factor("model_year", yearMatched, 0.30,
		"Decoded model year matches the campaign model year.",
		"Decoded model year does not match the campaign model year."))
	if yearMatched {
		confidence += 0.30
	}

	factors = append(factors, MatchFactor{
		Dimension: "build",
		Status:    "unknown",
		Weight:    0,
		Detail:    "Exact build date and structured campaign production boundaries are unavailable from this API.",
	})

	corpus := normalizedText(strings.Join([]string{recall.Component, recall.Summary, recall.Remedy}, " "))
	switch {
	case firmware == nil || strings.TrimSpace(*firmware) == "":
		factors = append(factors, MatchFactor{
			Dimension: "firmware",
			Status:    "unknown",
			Weight:    0,
			Detail:    "No current firmware observation is available.",
		})
	case strings.Contains(corpus, normalizedText(*firmware)):
		confidence += 0.05
		factors = append(factors, MatchFactor{
			Dimension: "firmware",
			Status:    "matched",
			Weight:    0.05,
			Detail:    "The observed firmware version is explicitly referenced by campaign text.",
		})
	case strings.Contains(corpus, "software") || recall.OverTheAirUpdate:
		factors = append(factors, MatchFactor{
			Dimension: "firmware",
			Status:    "context_only",
			Weight:    0,
			Detail:    "Firmware is observed, but NHTSA does not provide a structured affected/fixed version range for this campaign.",
		})
	default:
		factors = append(factors, MatchFactor{
			Dimension: "firmware",
			Status:    "not_applicable",
			Weight:    0,
			Detail:    "Campaign text does not identify firmware as an applicability boundary.",
		})
	}
	return factors, confidence
}

func factor(dimension string, matched bool, weight float64, matchedDetail, unmatchedDetail string) MatchFactor {
	if matched {
		return MatchFactor{Dimension: dimension, Status: "matched", Weight: weight, Detail: matchedDetail}
	}
	return MatchFactor{Dimension: dimension, Status: "not_matched", Weight: 0, Detail: unmatchedDetail}
}

func matchSymptoms(recall nhtsa.Recall, observations []SignalObservation) []SymptomMatch {
	recallTags := componentTags(strings.Join([]string{
		recall.Component,
		recall.Summary,
		recall.Consequence,
	}, " "))
	matches := make([]SymptomMatch, 0)
	for _, observation := range observations {
		signalTags := componentTags(observation.Signal)
		component := firstSharedComponent(recallTags, signalTags)
		if component == "" {
			continue
		}
		score := math.Min(1, observation.Deviation/6)
		matches = append(matches, SymptomMatch{
			Signal:     observation.Signal,
			Component:  component,
			Severity:   observationSeverity(observation.Deviation),
			ObservedAt: observation.ObservedAt.UTC(),
			Score:      roundConfidence(score),
			Evidence: fmt.Sprintf(
				"%s showed a %.1fσ statistical deviation across %d recent samples.",
				observation.Signal,
				observation.Deviation,
				observation.SampleCount,
			),
		})
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].Score != matches[j].Score {
			return matches[i].Score > matches[j].Score
		}
		return matches[i].ObservedAt.After(matches[j].ObservedAt)
	})
	return matches
}

var componentPatterns = []struct {
	component string
	terms     []string
}{
	{"tires", []string{"tire", "tyre", "tpms", "wheelpressure"}},
	{"brakes", []string{"brake", "abs"}},
	{"steering", []string{"steering"}},
	{"suspension", []string{"suspension"}},
	{"airbags", []string{"airbag", "airbags", "restraint", "seatbelt"}},
	{"latches", []string{"latch", "doorlock", "hood", "trunk"}},
	{"visibility", []string{"visibility", "wiper", "defrost", "windshield"}},
	{"drivetrain", []string{"powertrain", "drivetrain", "motor", "stator", "inverter", "torque"}},
	{"battery_charging", []string{"battery", "packvoltage", "isolation", "charging", "charger", "electrical"}},
	{"adas", []string{"adas", "autonomous", "selfdriving", "collision", "camera", "autopilot"}},
	{"thermal", []string{"temperature", "temp", "thermal", "coolant", "heater"}},
}

func componentTags(value string) map[string]struct{} {
	normalized := normalizedText(value)
	tags := make(map[string]struct{})
	for _, pattern := range componentPatterns {
		for _, term := range pattern.terms {
			if strings.Contains(normalized, term) {
				tags[pattern.component] = struct{}{}
				break
			}
		}
	}
	return tags
}

func firstSharedComponent(a, b map[string]struct{}) string {
	for _, pattern := range componentPatterns {
		if _, ok := a[pattern.component]; !ok {
			continue
		}
		if _, ok := b[pattern.component]; ok {
			return pattern.component
		}
	}
	return ""
}

func normalizedText(value string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(value) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func classifyApplicability(confidence float64) string {
	switch {
	case confidence >= 0.65:
		return applicabilityLikely
	case confidence >= 0.40:
		return applicabilityReview
	default:
		return applicabilityUnlikely
	}
}

func confidenceLabel(confidence float64) string {
	switch {
	case confidence >= 0.80:
		return "high"
	case confidence >= 0.55:
		return "medium"
	default:
		return "low"
	}
}

func observationSeverity(deviation float64) string {
	switch {
	case deviation >= 5:
		return "critical"
	case deviation >= 4:
		return "warning"
	default:
		return "info"
	}
}

func buildHypothesis(recall nhtsa.Recall, applicability string, symptoms []SymptomMatch) string {
	if len(symptoms) > 0 {
		return fmt.Sprintf(
			"Campaign %s is %s based on vehicle metadata, with a recent %s signal pattern worth technician review.",
			recall.CampaignNumber,
			strings.ReplaceAll(applicability, "_", " "),
			symptoms[0].Component,
		)
	}
	return fmt.Sprintf(
		"Campaign %s is %s from decoded make, model, and model year; exact build-range inclusion and completion require authoritative confirmation.",
		recall.CampaignNumber,
		strings.ReplaceAll(applicability, "_", " "),
	)
}

func buildLimitations(source nhtsa.SourceMetadata) []string {
	limitations := []string{
		"Recall candidates are matched by decoded make, model, and model year; the public endpoint does not confirm campaign completion for this specific vehicle.",
		"Exact build date and structured campaign production-range boundaries are unavailable.",
		"Firmware is supporting context only unless a campaign explicitly names the observed version.",
		"Manufacturer communications are matched from the latest normalized official NHTSA bulk artifact by make, model, and model year; bulletin applicability still requires build-range confirmation.",
		"Symptom matches are statistical hypotheses for technician review, not causal proof.",
	}
	if source.Status != nhtsa.SourceStatusAvailable && source.Detail != nil {
		limitations = append(limitations, *source.Detail)
	}
	return limitations
}

func buildEvidence(
	findings []Finding,
	communications []CommunicationFinding,
	symptoms []SymptomMatch,
	decoded nhtsa.DecodedVehicle,
	firmware *string,
	communicationsSource nhtsa.SourceMetadata,
	limitations []string,
) EvidenceBundle {
	items := make([]EvidenceItem, 0, 1+len(findings)+len(communications)+len(symptoms)+1)
	contextSummary := fmt.Sprintf("%s %s, model year %d", decoded.Make, decoded.Model, decoded.ModelYear)
	if firmware != nil && strings.TrimSpace(*firmware) != "" {
		contextSummary += ", observed firmware " + strings.TrimSpace(*firmware)
	}
	items = append(items, EvidenceItem{
		ID:         "vehicle-context",
		Kind:       "vehicle_context",
		Title:      "Vehicle applicability context",
		Summary:    contextSummary,
		SourceName: "NHTSA vPIC vehicle decoder and TeslaSync firmware history",
	})
	for _, finding := range findings {
		url := finding.SourceDocumentURL
		confidence := finding.Confidence
		findingID := finding.ID
		items = append(items, EvidenceItem{
			ID:                "recall-" + finding.ID,
			Kind:              "recall_hypothesis",
			Title:             finding.Title,
			Summary:           finding.Hypothesis,
			SourceName:        "NHTSA recalls",
			SourceDocumentURL: &url,
			ObservedAt:        finding.ReportReceivedAt,
			Confidence:        &confidence,
			FindingID:         &findingID,
		})
	}
	for _, communication := range communications {
		sourceURL := communication.SourceDocumentURL
		confidence := communication.Confidence
		findingID := communication.ID
		items = append(items, EvidenceItem{
			ID:                "communication-" + communication.NHTSAID,
			Kind:              "manufacturer_communication_hypothesis",
			Title:             "Manufacturer communication " + communication.CommunicationNumber,
			Summary:           communication.Hypothesis,
			SourceName:        "NHTSA manufacturer communications",
			SourceDocumentURL: &sourceURL,
			ObservedAt:        communication.PublishedAt,
			Confidence:        &confidence,
			FindingID:         &findingID,
		})
	}
	for i, symptom := range symptoms {
		observedAt := symptom.ObservedAt
		confidence := symptom.Score
		findingID := symptom.FindingID
		items = append(items, EvidenceItem{
			ID:         fmt.Sprintf("symptom-%s-%d", symptom.FindingID, i+1),
			Kind:       "observed_symptom",
			Title:      symptom.Signal,
			Summary:    symptom.Evidence,
			SourceName: "TeslaSync signal_log statistical observation",
			ObservedAt: &observedAt,
			Confidence: &confidence,
			FindingID:  &findingID,
		})
	}
	if communicationsSource.Status != nhtsa.SourceStatusAvailable {
		url := communicationsSource.SourceURL
		summary := "Manufacturer communications/TSB inventory is explicitly unavailable from the configured typed provider."
		if communicationsSource.Detail != nil {
			summary = *communicationsSource.Detail
		}
		items = append(items, EvidenceItem{
			ID:                "communications-source-limitation",
			Kind:              "source_limitation",
			Title:             "Manufacturer communications source limitation",
			Summary:           summary,
			SourceName:        communicationsSource.Name,
			SourceDocumentURL: &url,
		})
	}
	return EvidenceBundle{
		SchemaVersion: EvidenceSchemaVersion,
		Items:         items,
		Limitations:   append([]string(nil), limitations...),
		Disclaimer:    "Applicability and symptom correlations are evidence-ranked service hypotheses for qualified review.",
	}
}

func optionalString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func roundConfidence(value float64) float64 {
	return math.Round(value*100) / 100
}

var _ IntelligenceService = (*Service)(nil)
