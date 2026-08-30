// Package actioncentersvc ranks normalized evidence and manages inbox state.
package actioncentersvc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	port "github.com/ev-dev-labs/teslasync/internal/port/actioncenter"
)

var (
	ErrInvalidInput     = errors.New("invalid action center input")
	ErrStaleFingerprint = errors.New("stale recommendation fingerprint")
	ErrNotFound         = errors.New("action center recommendation not found")
)

const (
	defaultLimit        = 25
	maxLimit            = 100
	providerConcurrency = 4
)

type ListFilter struct {
	VehicleID     *int64
	Priority      *domain.Priority
	SourceFeature *domain.SourceFeature
	State         *domain.State
	Limit         int
	Offset        int
}

type ActionRequest struct {
	RecommendationID string
	Fingerprint      string
	Action           domain.ActionType
	ExpectedVersion  int
	Confirmed        bool
	SnoozedUntil     *time.Time
}

type Service struct {
	providers []provider
	source    port.SourceReader
	states    port.StateRepository
	now       func() time.Time
}

type Option func(*Service)

func WithAdvancedIntelligence(reader AdvancedIntelligenceReader) Option {
	if reader == nil {
		panic("actioncentersvc.WithAdvancedIntelligence: reader must not be nil")
	}
	return func(service *Service) {
		service.providers = append(service.providers, advancedProvider{
			source:   service.source,
			advanced: reader,
		})
	}
}

func New(source port.SourceReader, states port.StateRepository, options ...Option) *Service {
	if source == nil || states == nil {
		panic("actioncentersvc.New: dependencies must not be nil")
	}
	service := &Service{
		providers: []provider{
			alertsProvider{source: source},
			batteryHealthProvider{source: source},
			chargingProvider{source: source},
			driveEfficiencyProvider{source: source},
			workOrdersProvider{source: source},
			vehicleReadinessProvider{source: source},
			signalProvider{source: source},
			systemHealthProvider{source: source},
		},
		source: source,
		states: states,
		now:    func() time.Time { return time.Now().UTC() },
	}
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *Service) List(
	ctx context.Context,
	subject string,
	filter ListFilter,
) (*domain.Response, error) {
	if strings.TrimSpace(subject) == "" || len(subject) > 512 {
		return nil, fmt.Errorf("%w: subject is required", ErrInvalidInput)
	}
	normalizeFilter(&filter)
	now := s.now().UTC()
	recommendations, statuses := s.generate(ctx, filter, now)

	ids := make([]string, 0, len(recommendations))
	for i := range recommendations {
		ids = append(ids, recommendations[i].ID)
	}
	states, err := s.states.ListStates(ctx, subject, ids)
	if err != nil {
		return nil, fmt.Errorf("load action center states: %w", err)
	}
	events, err := s.states.ListRecentEvents(ctx, subject, ids, 3)
	if err != nil {
		return nil, fmt.Errorf("load action center outcomes: %w", err)
	}

	filtered := make([]domain.Recommendation, 0, len(recommendations))
	summary := domain.Summary{}
	for i := range recommendations {
		item := recommendations[i]
		if state, ok := states[item.ID]; ok {
			item.CurrentState = state
		}
		item.ActionHistory = nonNilEvents(events[item.ID])
		accumulateSummary(&summary, item)
		if filter.Priority != nil && item.Priority != *filter.Priority {
			continue
		}
		if filter.SourceFeature != nil && item.SourceFeature != *filter.SourceFeature {
			continue
		}
		if filter.State != nil && item.CurrentState.Status != *filter.State {
			continue
		}
		filtered = append(filtered, item)
	}
	total := len(filtered)
	start := minInt(filter.Offset, total)
	end := minInt(start+filter.Limit, total)
	page := append([]domain.Recommendation(nil), filtered[start:end]...)
	return &domain.Response{
		Items:          page,
		Total:          total,
		Limit:          filter.Limit,
		Offset:         filter.Offset,
		GeneratedAt:    now,
		Summary:        summary,
		ProviderStatus: statuses,
	}, nil
}

func (s *Service) ApplyAction(
	ctx context.Context,
	subject string,
	request ActionRequest,
) (*domain.ActionResult, error) {
	now := s.now().UTC()
	if err := validateAction(subject, request, now); err != nil {
		return nil, err
	}
	items, _ := s.generate(ctx, ListFilter{Limit: maxLimit}, now)
	var recommendation *domain.Recommendation
	for i := range items {
		if items[i].ID == request.RecommendationID {
			recommendation = &items[i]
			break
		}
	}
	if recommendation == nil {
		return nil, ErrNotFound
	}
	if recommendation.Fingerprint != request.Fingerprint {
		return nil, ErrStaleFingerprint
	}
	allowed, toState := transitionFor(request.Action)
	snoozedUntil := request.SnoozedUntil
	if request.Action != domain.ActionSnooze {
		snoozedUntil = nil
	}
	state, event, err := s.states.Transition(ctx, port.TransitionRequest{
		Subject:          subject,
		RecommendationID: recommendation.ID,
		Fingerprint:      recommendation.Fingerprint,
		Action:           request.Action,
		AllowedFrom:      allowed,
		ToState:          toState,
		ExpectedVersion:  request.ExpectedVersion,
		SnoozedUntil:     snoozedUntil,
		Now:              now,
	})
	if err != nil {
		return nil, fmt.Errorf("transition action center state: %w", err)
	}
	recommendation.CurrentState = *state
	recommendation.ActionHistory = []domain.ActionEvent{*event}
	return &domain.ActionResult{Recommendation: *recommendation, Event: *event}, nil
}

func (s *Service) History(
	ctx context.Context,
	subject, recommendationID string,
	limit, offset int,
) (*domain.HistoryPage, error) {
	if strings.TrimSpace(subject) == "" || len(subject) > 512 ||
		!validRecommendationID(recommendationID) {
		return nil, fmt.Errorf("%w: invalid history request", ErrInvalidInput)
	}
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	if offset < 0 {
		offset = 0
	}
	page, err := s.states.ListHistory(ctx, subject, recommendationID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list action center history: %w", err)
	}
	return page, nil
}

func (s *Service) generate(
	ctx context.Context,
	filter ListFilter,
	now time.Time,
) ([]domain.Recommendation, []domain.ProviderStatus) {
	candidates := make([]domain.Candidate, 0, providerLimit*len(s.providers))
	statuses := make([]domain.ProviderStatus, 0, len(s.providers))
	type providerResult struct {
		items []domain.Candidate
		err   error
	}
	results := make([]providerResult, len(s.providers))
	limit := make(chan struct{}, providerConcurrency)
	var providersFinished sync.WaitGroup
	providersFinished.Add(len(s.providers))
	for index, candidateProvider := range s.providers {
		go func() {
			defer providersFinished.Done()
			select {
			case limit <- struct{}{}:
				defer func() { <-limit }()
			case <-ctx.Done():
				results[index].err = ctx.Err()
				return
			}
			results[index].items, results[index].err = candidateProvider.Recommendations(
				ctx,
				filter,
				now,
			)
		}()
	}
	providersFinished.Wait()

	for index, candidateProvider := range s.providers {
		result := results[index]
		status := domain.ProviderStatus{
			SourceFeature: candidateProvider.SourceFeature(),
			Status:        domain.ProviderAvailable,
			Limitations:   []string{},
		}
		if result.err != nil {
			status.Status = domain.ProviderUnavailable
			status.Limitations = []string{
				"Source data is temporarily unavailable; no findings were inferred for this provider.",
			}
		} else {
			for _, item := range result.items {
				if candidateValid(item) && item.ExpiresAt.After(now) {
					candidates = append(candidates, item)
					status.ItemCount++
				} else {
					status.Status = domain.ProviderDegraded
					status.Limitations = append(status.Limitations,
						"A malformed or expired source finding was omitted.")
				}
			}
		}
		statuses = append(statuses, status)
	}

	candidates = deduplicate(candidates)
	items := make([]domain.Recommendation, 0, len(candidates))
	for _, candidate := range candidates {
		items = append(items, buildRecommendation(candidate, now))
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Rank.Score != items[j].Rank.Score {
			return items[i].Rank.Score > items[j].Rank.Score
		}
		if items[i].Confidence.Score != items[j].Confidence.Score {
			return items[i].Confidence.Score > items[j].Confidence.Score
		}
		left, right := evidenceTime(items[i]), evidenceTime(items[j])
		if !left.Equal(right) {
			return left.After(right)
		}
		return items[i].ID < items[j].ID
	})
	return items, statuses
}

func buildRecommendation(candidate domain.Candidate, now time.Time) domain.Recommendation {
	freshness := classifyFreshness(candidate, now)
	confidence := buildConfidence(candidate, freshness)
	rank := buildRank(candidate.Priority, candidate.Severity, freshness.Status, confidence.Score)
	id := deterministicID(candidate)
	fingerprint := deterministicFingerprint(candidate)
	return domain.Recommendation{
		ID:              id,
		Fingerprint:     fingerprint,
		SourceFeature:   candidate.SourceFeature,
		RelatedSources:  []domain.SourceFeature{candidate.SourceFeature},
		Vehicle:         candidate.Vehicle,
		Title:           candidate.Title,
		Summary:         candidate.Summary,
		Rationale:       candidate.Rationale,
		Priority:        candidate.Priority,
		Severity:        candidate.Severity,
		Rank:            rank,
		Confidence:      confidence,
		Evidence:        nonNilEvidence(candidate.Evidence),
		ProjectedImpact: candidate.ProjectedImpact,
		SafeActions:     append([]domain.ActionType(nil), candidate.SafeActions...),
		NavigationPath:  candidate.NavigationPath,
		ExpiresAt:       candidate.ExpiresAt,
		Freshness:       freshness,
		Limitations:     nonNilStrings(candidate.Limitations),
		CurrentState: domain.CurrentState{
			Status:  domain.StateOpen,
			Version: 0,
		},
		ActionHistory: []domain.ActionEvent{},
	}
}

func deduplicate(candidates []domain.Candidate) []domain.Candidate {
	byKey := make(map[string]domain.Candidate, len(candidates))
	order := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		key := string(candidate.SourceFeature) + ":" + candidate.DedupKey
		existing, found := byKey[key]
		if !found {
			byKey[key] = candidate
			order = append(order, key)
			continue
		}
		if candidateHigher(candidate, existing) {
			candidate.Evidence = mergeEvidence(candidate.Evidence, existing.Evidence)
			candidate.Limitations = mergeStrings(candidate.Limitations, existing.Limitations)
			byKey[key] = candidate
		} else {
			existing.Evidence = mergeEvidence(existing.Evidence, candidate.Evidence)
			existing.Limitations = mergeStrings(existing.Limitations, candidate.Limitations)
			byKey[key] = existing
		}
	}
	result := make([]domain.Candidate, 0, len(order))
	for _, key := range order {
		result = append(result, byKey[key])
	}
	return result
}

func deterministicID(candidate domain.Candidate) string {
	vehicleID := int64(0)
	if candidate.Vehicle != nil {
		vehicleID = candidate.Vehicle.ID
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf(
		"%s|%s|%d", candidate.SourceFeature, candidate.SourceKey, vehicleID,
	)))
	return "ac_" + hex.EncodeToString(sum[:12])
}

func deterministicFingerprint(candidate domain.Candidate) string {
	type evidenceFingerprint struct {
		Kind       string
		Source     string
		RecordID   string
		ObservedAt *time.Time
	}
	type semanticFingerprint struct {
		SourceFeature domain.SourceFeature
		SourceKey     string
		VehicleID     int64
		Title         string
		Summary       string
		Priority      domain.Priority
		Severity      domain.Severity
		Evidence      []evidenceFingerprint
	}
	vehicleID := int64(0)
	if candidate.Vehicle != nil {
		vehicleID = candidate.Vehicle.ID
	}
	evidence := make([]evidenceFingerprint, 0, len(candidate.Evidence))
	for _, item := range candidate.Evidence {
		// A bounded_query item records when the provider checked for data.
		// It is useful provenance, but changes on every read and is not a
		// semantic source fact. Excluding it keeps fingerprints actionable
		// while source record IDs/timestamps still protect against stale data.
		if item.Kind == "bounded_query" {
			continue
		}
		evidence = append(evidence, evidenceFingerprint{
			Kind:       item.Kind,
			Source:     item.Provenance.Source,
			RecordID:   item.Provenance.RecordID,
			ObservedAt: item.ObservedAt,
		})
	}
	payload, _ := json.Marshal(semanticFingerprint{
		SourceFeature: candidate.SourceFeature,
		SourceKey:     candidate.SourceKey,
		VehicleID:     vehicleID,
		Title:         candidate.Title,
		Summary:       candidate.Summary,
		Priority:      candidate.Priority,
		Severity:      candidate.Severity,
		Evidence:      evidence,
	})
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func classifyFreshness(candidate domain.Candidate, now time.Time) domain.Freshness {
	if candidate.ObservedAt == nil {
		return domain.Freshness{Status: domain.FreshnessUnknown}
	}
	observedAt := candidate.ObservedAt.UTC()
	age := now.Sub(observedAt)
	if age < 0 {
		age = 0
	}
	ageS := int64(age / time.Second)
	status := domain.FreshnessStale
	if age <= candidate.FreshFor {
		status = domain.FreshnessFresh
	} else if age <= candidate.AgingFor {
		status = domain.FreshnessAging
	}
	return domain.Freshness{Status: status, ObservedAt: &observedAt, AgeS: &ageS}
}

func buildConfidence(candidate domain.Candidate, freshness domain.Freshness) domain.Confidence {
	score := candidate.BaseConfidence
	basis := append([]string(nil), candidate.ConfidenceBasis...)
	switch freshness.Status {
	case domain.FreshnessFresh:
		basis = append(basis, "Evidence is within the provider's fresh window")
	case domain.FreshnessAging:
		score -= 0.12
		basis = append(basis, "Aging evidence reduces confidence by 0.12")
	case domain.FreshnessStale:
		score -= 0.28
		basis = append(basis, "Stale evidence reduces confidence by 0.28")
	default:
		score -= 0.22
		basis = append(basis, "Unknown observation age reduces confidence by 0.22")
	}
	score = math.Round(clamp(score, 0.05, 0.99)*100) / 100
	label := domain.ConfidenceLow
	if score >= 0.8 {
		label = domain.ConfidenceHigh
	} else if score >= 0.55 {
		label = domain.ConfidenceMedium
	}
	return domain.Confidence{Score: score, Label: label, Basis: basis}
}

func buildRank(
	priority domain.Priority,
	severity domain.Severity,
	freshness domain.FreshnessStatus,
	confidence float64,
) domain.Rank {
	score := 0
	basis := make([]string, 0, 4)
	priorityWeight := map[domain.Priority]int{
		domain.PriorityCritical: 400,
		domain.PriorityHigh:     300,
		domain.PriorityMedium:   200,
		domain.PriorityLow:      100,
	}[priority]
	score += priorityWeight
	basis = append(basis, fmt.Sprintf("priority %s +%d", priority, priorityWeight))
	severityWeight := map[domain.Severity]int{
		domain.SeverityCritical: 80,
		domain.SeverityWarning:  50,
		domain.SeverityInfo:     20,
	}[severity]
	score += severityWeight
	basis = append(basis, fmt.Sprintf("severity %s +%d", severity, severityWeight))
	freshnessWeight := map[domain.FreshnessStatus]int{
		domain.FreshnessFresh:   40,
		domain.FreshnessAging:   20,
		domain.FreshnessStale:   0,
		domain.FreshnessUnknown: 0,
	}[freshness]
	score += freshnessWeight
	basis = append(basis, fmt.Sprintf("freshness %s +%d", freshness, freshnessWeight))
	confidenceWeight := int(math.Round(confidence * 100))
	score += confidenceWeight
	basis = append(basis, fmt.Sprintf("confidence %.2f +%d", confidence, confidenceWeight))
	return domain.Rank{Score: score, Basis: basis}
}

func transitionFor(action domain.ActionType) ([]domain.State, domain.State) {
	switch action {
	case domain.ActionAcknowledge:
		return []domain.State{domain.StateOpen, domain.StateSnoozed}, domain.StateAcknowledged
	case domain.ActionSnooze:
		return []domain.State{domain.StateOpen, domain.StateAcknowledged}, domain.StateSnoozed
	case domain.ActionDismiss:
		return []domain.State{domain.StateOpen, domain.StateAcknowledged, domain.StateSnoozed}, domain.StateDismissed
	case domain.ActionRestore:
		return []domain.State{domain.StateAcknowledged, domain.StateSnoozed, domain.StateDismissed}, domain.StateOpen
	default:
		return nil, ""
	}
}

func validateAction(subject string, request ActionRequest, now time.Time) error {
	if strings.TrimSpace(subject) == "" || len(subject) > 512 ||
		!validRecommendationID(request.RecommendationID) {
		return fmt.Errorf("%w: invalid subject or recommendation ID", ErrInvalidInput)
	}
	if !request.Confirmed {
		return fmt.Errorf("%w: explicit confirmation is required", ErrInvalidInput)
	}
	if len(request.Fingerprint) != 64 {
		return fmt.Errorf("%w: fingerprint must be a SHA-256 hex string", ErrInvalidInput)
	}
	if _, err := hex.DecodeString(request.Fingerprint); err != nil {
		return fmt.Errorf("%w: invalid fingerprint", ErrInvalidInput)
	}
	if !request.Action.ValidStateAction() || request.ExpectedVersion < 0 {
		return fmt.Errorf("%w: invalid action or version", ErrInvalidInput)
	}
	if request.Action == domain.ActionSnooze {
		if request.SnoozedUntil == nil {
			return fmt.Errorf("%w: snoozed_until is required", ErrInvalidInput)
		}
		duration := request.SnoozedUntil.Sub(now)
		if duration < 15*time.Minute || duration > 30*24*time.Hour {
			return fmt.Errorf("%w: snooze must be between 15 minutes and 30 days", ErrInvalidInput)
		}
	} else if request.SnoozedUntil != nil {
		return fmt.Errorf("%w: snoozed_until is only valid for snooze", ErrInvalidInput)
	}
	return nil
}

func validRecommendationID(value string) bool {
	if len(value) != 27 || !strings.HasPrefix(value, "ac_") {
		return false
	}
	_, err := hex.DecodeString(value[3:])
	return err == nil
}

func normalizeFilter(filter *ListFilter) {
	if filter.Limit <= 0 {
		filter.Limit = defaultLimit
	}
	if filter.Limit > maxLimit {
		filter.Limit = maxLimit
	}
	if filter.Offset < 0 {
		filter.Offset = 0
	}
}

func candidateValid(candidate domain.Candidate) bool {
	return candidate.SourceFeature.Valid() &&
		candidate.SourceKey != "" &&
		candidate.DedupKey != "" &&
		candidate.Title != "" &&
		candidate.Summary != "" &&
		candidate.Priority.Valid() &&
		candidate.Severity.Valid() &&
		len(candidate.Evidence) > 0 &&
		candidate.BaseConfidence > 0 &&
		candidate.ExpiresAt.IsZero() == false &&
		projectedImpactValid(candidate.ProjectedImpact)
}

func projectedImpactValid(impact *domain.ProjectedImpact) bool {
	if impact == nil {
		return true
	}
	if len(impact.Basis) == 0 {
		return false
	}
	hasValue := impact.EnergyWh != nil || impact.CostMinor != nil ||
		impact.TimeS != nil || impact.RiskLevel != nil
	if !hasValue ||
		(impact.EnergyWh != nil && *impact.EnergyWh < 0) ||
		(impact.CostMinor != nil && *impact.CostMinor < 0) ||
		(impact.TimeS != nil && *impact.TimeS < 0) {
		return false
	}
	if (impact.CostMinor == nil) != (impact.Currency == nil) {
		return false
	}
	return impact.RiskLevel == nil || impact.RiskLevel.Valid()
}

func candidateHigher(left, right domain.Candidate) bool {
	weight := map[domain.Priority]int{
		domain.PriorityCritical: 4,
		domain.PriorityHigh:     3,
		domain.PriorityMedium:   2,
		domain.PriorityLow:      1,
	}
	if weight[left.Priority] != weight[right.Priority] {
		return weight[left.Priority] > weight[right.Priority]
	}
	if left.ObservedAt == nil {
		return false
	}
	if right.ObservedAt == nil {
		return true
	}
	return left.ObservedAt.After(*right.ObservedAt)
}

func mergeEvidence(primary, secondary []domain.EvidenceItem) []domain.EvidenceItem {
	result := append([]domain.EvidenceItem(nil), primary...)
	seen := make(map[string]struct{}, len(result))
	for _, item := range result {
		seen[item.ID] = struct{}{}
	}
	for _, item := range secondary {
		if len(result) >= 8 {
			break
		}
		if _, ok := seen[item.ID]; !ok {
			result = append(result, item)
			seen[item.ID] = struct{}{}
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].ObservedAt == nil {
			return false
		}
		if result[j].ObservedAt == nil {
			return true
		}
		return result[i].ObservedAt.After(*result[j].ObservedAt)
	})
	return result
}

func mergeStrings(primary, secondary []string) []string {
	result := append([]string(nil), primary...)
	seen := make(map[string]struct{}, len(result))
	for _, value := range result {
		seen[value] = struct{}{}
	}
	for _, value := range secondary {
		if _, ok := seen[value]; !ok {
			result = append(result, value)
			seen[value] = struct{}{}
		}
	}
	return result
}

func accumulateSummary(summary *domain.Summary, item domain.Recommendation) {
	switch item.CurrentState.Status {
	case domain.StateAcknowledged:
		summary.Acknowledged++
	case domain.StateSnoozed:
		summary.Snoozed++
	case domain.StateDismissed:
		summary.Dismissed++
	default:
		summary.Open++
	}
	if item.Priority == domain.PriorityCritical {
		summary.Critical++
	}
	if item.Priority == domain.PriorityHigh {
		summary.High++
	}
}

func evidenceTime(item domain.Recommendation) time.Time {
	for _, evidence := range item.Evidence {
		if evidence.ObservedAt != nil {
			return *evidence.ObservedAt
		}
	}
	return time.Time{}
}

func nonNilEvents(items []domain.ActionEvent) []domain.ActionEvent {
	if items == nil {
		return []domain.ActionEvent{}
	}
	return items
}

func nonNilEvidence(items []domain.EvidenceItem) []domain.EvidenceItem {
	if items == nil {
		return []domain.EvidenceItem{}
	}
	return items
}

func nonNilStrings(items []string) []string {
	if items == nil {
		return []string{}
	}
	return items
}

func clamp(value, low, high float64) float64 {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
