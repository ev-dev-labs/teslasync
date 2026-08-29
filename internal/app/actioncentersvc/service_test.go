package actioncentersvc

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	advanceddomain "github.com/ev-dev-labs/teslasync/internal/domain/advancedintelligence"
	port "github.com/ev-dev-labs/teslasync/internal/port/actioncenter"
)

type fakeSource struct {
	alerts      []domain.AlertRecord
	battery     []domain.BatteryHealthRecord
	charging    []domain.ChargingRecord
	drives      []domain.DriveEfficiencyRecord
	workOrders  []domain.WorkOrderRecord
	commands    []domain.CommandReliabilityRecord
	signals     []domain.SignalHealthRecord
	vehicles    []domain.VehicleRef
	incidents   []domain.SystemIncidentRecord
	alertErr    error
	batteryErr  error
	chargingErr error
	driveErr    error
	workErr     error
	commandErr  error
	signalErr   error
	vehicleErr  error
	incidentErr error

	// signalHealthCalls counts ListSignalHealth invocations so a test can
	// prove the advanced-intelligence provider no longer routes its vehicle
	// roster through the findings feed.
	signalHealthCalls  int
	activeVehicleCalls int
	activeVehicleLimit int
}

func (f *fakeSource) ListActiveAlerts(
	context.Context, *int64, time.Time, int,
) ([]domain.AlertRecord, error) {
	return f.alerts, f.alertErr
}

func (f *fakeSource) ListLatestBatteryHealth(
	context.Context, *int64, int,
) ([]domain.BatteryHealthRecord, error) {
	return f.battery, f.batteryErr
}

func (f *fakeSource) ListStaleChargingSessions(
	context.Context, *int64, time.Time, int,
) ([]domain.ChargingRecord, error) {
	return f.charging, f.chargingErr
}

func (f *fakeSource) ListDriveEfficiencyEvidence(
	context.Context,
	*int64,
	time.Time,
	time.Time,
	int,
	float64,
	float64,
	int,
) ([]domain.DriveEfficiencyRecord, error) {
	return f.drives, f.driveErr
}

func (f *fakeSource) ListActiveWorkOrders(
	context.Context, *int64, int,
) ([]domain.WorkOrderRecord, error) {
	return f.workOrders, f.workErr
}

func (f *fakeSource) ListCommandReliability(
	context.Context, *int64, time.Time, time.Time, int,
) ([]domain.CommandReliabilityRecord, error) {
	return f.commands, f.commandErr
}

func (f *fakeSource) ListSignalHealth(
	context.Context, *int64, time.Time, time.Time, int,
) ([]domain.SignalHealthRecord, error) {
	f.signalHealthCalls++
	return f.signals, f.signalErr
}

func (f *fakeSource) ListActiveVehicles(
	_ context.Context, _ *int64, limit int,
) ([]domain.VehicleRef, error) {
	f.activeVehicleCalls++
	f.activeVehicleLimit = limit
	return f.vehicles, f.vehicleErr
}

func (f *fakeSource) ListOpenSystemIncidents(
	context.Context, int,
) ([]domain.SystemIncidentRecord, error) {
	return f.incidents, f.incidentErr
}

type fakeAdvancedIntelligence struct {
	firmware *advanceddomain.Page[advanceddomain.FirmwareCanary]
}

func (f *fakeAdvancedIntelligence) FirmwareCanary(
	context.Context, int64, int, int,
) (*advanceddomain.Page[advanceddomain.FirmwareCanary], error) {
	return f.firmware, nil
}

func (f *fakeAdvancedIntelligence) ComponentSurvival(
	context.Context, int64, int, int,
) (*advanceddomain.Page[advanceddomain.ComponentSurvival], error) {
	return &advanceddomain.Page[advanceddomain.ComponentSurvival]{Items: []advanceddomain.ComponentSurvival{}}, nil
}

func (f *fakeAdvancedIntelligence) RoadHazards(
	context.Context, int64, int, int,
) (*advanceddomain.HazardPage, error) {
	return &advanceddomain.HazardPage{
		Page: advanceddomain.Page[advanceddomain.HazardCluster]{
			Items: []advanceddomain.HazardCluster{},
		},
	}, nil
}

func (f *fakeAdvancedIntelligence) BehavioralSentinel(
	context.Context, int64, int, int,
) (*advanceddomain.SentinelPage, error) {
	return &advanceddomain.SentinelPage{
		Page: advanceddomain.Page[advanceddomain.SentinelFinding]{
			Items: []advanceddomain.SentinelFinding{},
		},
	}, nil
}

type fakeStates struct {
	states map[string]domain.CurrentState
	events map[string][]domain.ActionEvent
	nextID int64
}

func newFakeStates() *fakeStates {
	return &fakeStates{
		states: make(map[string]domain.CurrentState),
		events: make(map[string][]domain.ActionEvent),
		nextID: 1,
	}
}

func (f *fakeStates) ListStates(
	_ context.Context, _ string, ids []string,
) (map[string]domain.CurrentState, error) {
	result := make(map[string]domain.CurrentState)
	for _, id := range ids {
		if state, ok := f.states[id]; ok {
			result[id] = state
		}
	}
	return result, nil
}

func (f *fakeStates) ListRecentEvents(
	_ context.Context, _ string, ids []string, limit int,
) (map[string][]domain.ActionEvent, error) {
	result := make(map[string][]domain.ActionEvent)
	for _, id := range ids {
		items := f.events[id]
		if len(items) > limit {
			items = items[:limit]
		}
		result[id] = append([]domain.ActionEvent(nil), items...)
	}
	return result, nil
}

func (f *fakeStates) Transition(
	_ context.Context, request port.TransitionRequest,
) (*domain.CurrentState, *domain.ActionEvent, error) {
	current, ok := f.states[request.RecommendationID]
	if !ok {
		current = domain.CurrentState{Status: domain.StateOpen, Version: 0}
	}
	if current.Version != request.ExpectedVersion || !containsTestState(request.AllowedFrom, current.Status) {
		return nil, nil, port.ErrStateConflict
	}
	version := current.Version + 1
	updatedAt := request.Now
	next := domain.CurrentState{
		Status:       request.ToState,
		Version:      version,
		SnoozedUntil: request.SnoozedUntil,
		UpdatedAt:    &updatedAt,
	}
	event := domain.ActionEvent{
		ID:               f.nextID,
		RecommendationID: request.RecommendationID,
		Fingerprint:      request.Fingerprint,
		Action:           request.Action,
		FromState:        current.Status,
		ToState:          request.ToState,
		Outcome:          "applied",
		StateVersion:     version,
		OccurredAt:       request.Now,
	}
	f.nextID++
	f.states[request.RecommendationID] = next
	f.events[request.RecommendationID] = append(
		[]domain.ActionEvent{event}, f.events[request.RecommendationID]...,
	)
	return &next, &event, nil
}

func (f *fakeStates) ListHistory(
	_ context.Context, _ string, id string, limit, offset int,
) (*domain.HistoryPage, error) {
	items := f.events[id]
	start := minInt(offset, len(items))
	end := minInt(start+limit, len(items))
	return &domain.HistoryPage{
		Items:  append([]domain.ActionEvent(nil), items[start:end]...),
		Total:  len(items),
		Limit:  limit,
		Offset: offset,
	}, nil
}

func TestListRanksAndDeduplicatesDeterministically(t *testing.T) {
	now := time.Date(2026, 2, 20, 12, 0, 0, 0, time.UTC)
	vehicle := domain.VehicleRef{ID: 7, DisplayName: "Orion"}
	source := &fakeSource{
		alerts: []domain.AlertRecord{
			{
				LogID: 22, AlertID: 4, Vehicle: &vehicle, Title: "Battery alert",
				Message: "Newest evidence", Severity: "critical", DeliveryStatus: "sent",
				CreatedAt: now.Add(-time.Hour),
			},
			{
				LogID: 21, AlertID: 4, Vehicle: &vehicle, Title: "Battery alert",
				Message: "Older evidence", Severity: "critical", DeliveryStatus: "sent",
				CreatedAt: now.Add(-2 * time.Hour),
			},
		},
		workOrders: []domain.WorkOrderRecord{{
			ID: 9, Vehicle: vehicle, Title: "Inspect tire", Status: "open",
			Severity: "medium", UpdatedAt: now.Add(-time.Hour),
		}},
		signals: []domain.SignalHealthRecord{{
			Vehicle: vehicle, LatestSignalAt: testTimePtr(now.Add(-30 * time.Minute)), CheckedAt: now,
		}},
	}
	service := New(source, newFakeStates())
	service.now = func() time.Time { return now }

	first, err := service.List(context.Background(), "user-1", ListFilter{Limit: 25})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	second, err := service.List(context.Background(), "user-1", ListFilter{Limit: 25})
	if err != nil {
		t.Fatalf("second List() error = %v", err)
	}
	if len(first.Items) != 2 {
		t.Fatalf("item count = %d, want 2 (duplicate alerts merged)", len(first.Items))
	}
	if first.Items[0].SourceFeature != domain.SourceActiveAlerts {
		t.Fatalf("first source = %s, want active alerts", first.Items[0].SourceFeature)
	}
	if len(first.Items[0].Evidence) != 2 {
		t.Errorf("merged evidence count = %d, want 2", len(first.Items[0].Evidence))
	}
	if first.Items[0].ID != second.Items[0].ID ||
		first.Items[0].Fingerprint != second.Items[0].Fingerprint {
		t.Error("deterministic identity changed between identical reads")
	}
	if first.Items[0].ProjectedImpact != nil {
		t.Error("projected impact was fabricated")
	}
	if first.Items[0].Rank.Score <= first.Items[1].Rank.Score {
		t.Errorf("critical alert rank %d <= work order rank %d",
			first.Items[0].Rank.Score, first.Items[1].Rank.Score)
	}
	if len(first.Items[0].Rank.Basis) != 4 {
		t.Errorf("rank basis count = %d, want 4", len(first.Items[0].Rank.Basis))
	}
}

func TestConfidenceReflectsFreshness(t *testing.T) {
	now := time.Date(2026, 2, 20, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name       string
		observedAt *time.Time
		wantStatus domain.FreshnessStatus
		wantScore  float64
		wantLabel  domain.ConfidenceLabel
	}{
		{"fresh", testTimePtr(now.Add(-time.Hour)), domain.FreshnessFresh, 0.9, domain.ConfidenceHigh},
		{"aging", testTimePtr(now.Add(-36 * time.Hour)), domain.FreshnessAging, 0.78, domain.ConfidenceMedium},
		{"stale", testTimePtr(now.Add(-10 * 24 * time.Hour)), domain.FreshnessStale, 0.62, domain.ConfidenceMedium},
		{"unknown", nil, domain.FreshnessUnknown, 0.68, domain.ConfidenceMedium},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidate := testCandidate(now)
			candidate.ObservedAt = test.observedAt
			freshness := classifyFreshness(candidate, now)
			confidence := buildConfidence(candidate, freshness)
			if freshness.Status != test.wantStatus {
				t.Errorf("freshness = %s, want %s", freshness.Status, test.wantStatus)
			}
			if confidence.Score != test.wantScore || confidence.Label != test.wantLabel {
				t.Errorf("confidence = %.2f/%s, want %.2f/%s",
					confidence.Score, confidence.Label, test.wantScore, test.wantLabel)
			}
		})
	}
}

func TestProviderFailureDegradesExplicitly(t *testing.T) {
	now := time.Date(2026, 2, 20, 12, 0, 0, 0, time.UTC)
	source := &fakeSource{alertErr: errors.New("alerts table unavailable")}
	service := New(source, newFakeStates())
	service.now = func() time.Time { return now }

	response, err := service.List(context.Background(), "user-1", ListFilter{})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	status := response.ProviderStatus[0]
	if status.SourceFeature != domain.SourceActiveAlerts ||
		status.Status != domain.ProviderUnavailable ||
		len(status.Limitations) == 0 {
		t.Fatalf("provider status = %+v", status)
	}
	if len(response.Items) != 0 {
		t.Fatalf("items = %d, want 0", len(response.Items))
	}
}

func TestAdvancedIntelligenceFindingsFlowIntoActionCenter(t *testing.T) {
	now := time.Date(2026, 2, 20, 12, 0, 0, 0, time.UTC)
	vehicle := domain.VehicleRef{ID: 7, DisplayName: "Orion"}
	version := "2026.4.1"
	// The advanced-intelligence provider draws its roster from the vehicle
	// list, NOT from the signal-health findings feed, so seed the roster.
	source := &fakeSource{
		vehicles: []domain.VehicleRef{vehicle},
		signals: []domain.SignalHealthRecord{{
			Vehicle: vehicle, LatestSignalAt: testTimePtr(now.Add(-time.Hour)), CheckedAt: now,
		}},
	}
	advanced := &fakeAdvancedIntelligence{
		firmware: &advanceddomain.Page[advanceddomain.FirmwareCanary]{
			Items: []advanceddomain.FirmwareCanary{{
				VehicleID: 7,
				Version:   &version,
				Decision:  advanceddomain.CanaryHold,
				WindowQuality: advanceddomain.DataQuality{
					Status:      advanceddomain.QualitySufficient,
					SampleCount: 40,
				},
				Evidence: []advanceddomain.Evidence{{
					Source:     "drives_matched_model_cohort",
					ObservedAt: testTimePtr(now.Add(-2 * time.Hour)),
					Summary:    "Matched target and peer windows crossed the rollout hold threshold.",
				}},
				Limitations: []string{"Observed association is not proof of firmware causality."},
			}},
		},
	}
	service := New(source, newFakeStates(), WithAdvancedIntelligence(advanced))
	service.now = func() time.Time { return now }
	advancedSource := domain.SourceAdvancedIntelligence

	response, err := service.List(context.Background(), "user-1", ListFilter{
		SourceFeature: &advancedSource,
		Limit:         25,
	})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(response.Items) != 1 {
		t.Fatalf("item count = %d, want 1", len(response.Items))
	}
	item := response.Items[0]
	if item.SourceFeature != domain.SourceAdvancedIntelligence {
		t.Fatalf("source feature = %s", item.SourceFeature)
	}
	if item.NavigationPath == nil || *item.NavigationPath != "/intelligence/firmware-canary" {
		t.Fatalf("navigation path = %v", item.NavigationPath)
	}
	if item.Confidence.Score <= 0 || len(item.Evidence) != 1 {
		t.Fatalf("advanced recommendation lost evidence: %+v", item)
	}
}

func TestWorkOrderProjectedImpactUsesOnlyPersistedValues(t *testing.T) {
	now := time.Date(2026, 2, 20, 12, 0, 0, 0, time.UTC)
	costMinor := int64(12500)
	currency := "usd"
	start := now.Add(2 * time.Hour)
	end := start.Add(90 * time.Minute)
	impact := workOrderProjectedImpact(domain.WorkOrderRecord{
		Severity:         "critical",
		CostMinor:        &costMinor,
		Currency:         &currency,
		ScheduledStartAt: &start,
		ScheduledEndAt:   &end,
	})
	if impact == nil {
		t.Fatal("impact = nil")
	}
	if impact.CostMinor == nil || *impact.CostMinor != costMinor ||
		impact.Currency == nil || *impact.Currency != "USD" {
		t.Fatalf("cost impact = %+v", impact)
	}
	if impact.TimeS == nil || *impact.TimeS != 5400 {
		t.Fatalf("time impact = %+v", impact.TimeS)
	}
	if impact.RiskLevel == nil || *impact.RiskLevel != domain.ImpactRiskHigh {
		t.Fatalf("risk impact = %+v", impact.RiskLevel)
	}
	if !projectedImpactValid(impact) {
		t.Fatalf("impact failed contract validation: %+v", impact)
	}
	if workOrderProjectedImpact(domain.WorkOrderRecord{Severity: "medium"}) != nil {
		t.Fatal("unsupported values produced a projected impact")
	}
}

func TestSignalProviderIgnoresRoutineVehicleSleep(t *testing.T) {
	now := time.Date(2026, 2, 20, 12, 0, 0, 0, time.UTC)
	source := &fakeSource{signals: []domain.SignalHealthRecord{{
		Vehicle:        domain.VehicleRef{ID: 7, DisplayName: "Orion"},
		LatestSignalAt: testTimePtr(now.Add(-8 * time.Hour)),
		CheckedAt:      now,
	}}}
	provider := signalProvider{source: source}
	items, err := provider.Recommendations(context.Background(), ListFilter{}, now)
	if err != nil {
		t.Fatalf("Recommendations() error = %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("routine sleep produced %d recommendation(s)", len(items))
	}
}

func TestSignalProviderSurfacesNormalizationProvenanceIncident(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	latestUnversionedAt := now.Add(-12 * time.Minute)
	source := &fakeSource{signals: []domain.SignalHealthRecord{{
		Vehicle:                domain.VehicleRef{ID: 7, DisplayName: "Orion"},
		LatestSignalAt:         testTimePtr(now.Add(-10 * time.Minute)),
		LatestUnversionedAt:    &latestUnversionedAt,
		SampleCount:            100,
		VersionedSampleCount:   80,
		UnversionedSampleCount: 20,
		CheckedAt:              now,
	}}}

	items, err := (signalProvider{source: source}).Recommendations(
		context.Background(),
		ListFilter{},
		now,
	)
	if err != nil {
		t.Fatalf("Recommendations() error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items = %d, want one normalization incident", len(items))
	}
	item := items[0]
	if item.DedupKey != "7:signal_normalization_provenance" {
		t.Errorf("dedup key = %q", item.DedupKey)
	}
	if item.Title != "Review telemetry normalization provenance" {
		t.Errorf("title = %q", item.Title)
	}
	if item.Priority != domain.PriorityHigh {
		t.Errorf("priority = %q, want high for 20%% unattested rows", item.Priority)
	}
	if len(item.Evidence) != 2 || item.Evidence[0].Kind != "normalization_provenance" {
		t.Fatalf("evidence = %+v", item.Evidence)
	}
	if item.ObservedAt == nil || !item.ObservedAt.Equal(latestUnversionedAt) ||
		item.Evidence[0].ObservedAt == nil || !item.Evidence[0].ObservedAt.Equal(latestUnversionedAt) {
		t.Errorf("normalization observation time = %v/%v, want %v",
			item.ObservedAt, item.Evidence[0].ObservedAt, latestUnversionedAt)
	}
	if item.NavigationPath == nil || *item.NavigationPath != "/signal-log?vehicle_id=7" {
		t.Errorf("navigation = %v", item.NavigationPath)
	}
}

func TestSignalFindingsKeepIndependentIdentityAndState(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	latestSignalAt := now.Add(-48 * time.Hour)
	latestUnversionedAt := now.Add(-49 * time.Hour)
	source := &fakeSource{signals: []domain.SignalHealthRecord{{
		Vehicle:                domain.VehicleRef{ID: 7, DisplayName: "Orion"},
		LatestSignalAt:         &latestSignalAt,
		LatestUnversionedAt:    &latestUnversionedAt,
		SampleCount:            100,
		VersionedSampleCount:   80,
		UnversionedSampleCount: 20,
		CheckedAt:              now,
	}}}
	states := newFakeStates()
	service := New(source, states)
	service.now = func() time.Time { return now }

	page, err := service.List(context.Background(), "user-1", ListFilter{})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(page.Items) != 2 {
		t.Fatalf("signal recommendations = %d, want freshness and normalization", len(page.Items))
	}
	first, second := page.Items[0], page.Items[1]
	if first.ID == second.ID {
		t.Fatalf("recommendation IDs collide: %q", first.ID)
	}

	_, err = service.ApplyAction(context.Background(), "user-1", ActionRequest{
		RecommendationID: first.ID,
		Fingerprint:      first.Fingerprint,
		Action:           domain.ActionAcknowledge,
		ExpectedVersion:  0,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("ApplyAction() error = %v", err)
	}

	page, err = service.List(context.Background(), "user-1", ListFilter{})
	if err != nil {
		t.Fatalf("List() after action error = %v", err)
	}
	statuses := make(map[string]domain.State)
	for _, item := range page.Items {
		statuses[item.ID] = item.CurrentState.Status
	}
	if statuses[first.ID] != domain.StateAcknowledged {
		t.Errorf("acted-on state = %q, want acknowledged", statuses[first.ID])
	}
	if statuses[second.ID] != domain.StateOpen {
		t.Errorf("independent state = %q, want open", statuses[second.ID])
	}
}

func TestSignalProviderSkipsFullyAttestedFreshTelemetry(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	source := &fakeSource{signals: []domain.SignalHealthRecord{{
		Vehicle:              domain.VehicleRef{ID: 7, DisplayName: "Orion"},
		LatestSignalAt:       testTimePtr(now.Add(-10 * time.Minute)),
		SampleCount:          100,
		VersionedSampleCount: 100,
		CheckedAt:            now,
	}}}

	items, err := (signalProvider{source: source}).Recommendations(
		context.Background(),
		ListFilter{},
		now,
	)
	if err != nil {
		t.Fatalf("Recommendations() error = %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("fully attested fresh telemetry produced %d recommendation(s)", len(items))
	}
}

// A vehicle with zero persisted samples in the bounded window has NO coverage
// measurement — absence of rows is not evidence of missing provenance. The
// provider must not invent a 0%-coverage incident from an empty window (the
// stale-telemetry finding is the honest signal there).
func TestSignalProviderDoesNotFabricateCoverageFromZeroSamples(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	source := &fakeSource{signals: []domain.SignalHealthRecord{
		{
			// Fresh but silent window: nothing to attest, nothing to claim.
			Vehicle:                domain.VehicleRef{ID: 7, DisplayName: "Orion"},
			LatestSignalAt:         testTimePtr(now.Add(-10 * time.Minute)),
			SampleCount:            0,
			VersionedSampleCount:   0,
			UnversionedSampleCount: 0,
			CheckedAt:              now,
		},
		{
			// No signal at all: stale finding only, still no coverage claim.
			Vehicle:                domain.VehicleRef{ID: 8, DisplayName: "Vega"},
			LatestSignalAt:         nil,
			SampleCount:            0,
			VersionedSampleCount:   0,
			UnversionedSampleCount: 0,
			CheckedAt:              now,
		},
	}}

	items, err := (signalProvider{source: source}).Recommendations(
		context.Background(),
		ListFilter{},
		now,
	)
	if err != nil {
		t.Fatalf("Recommendations() error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items = %d, want only the no-signal freshness finding", len(items))
	}
	if items[0].DedupKey != "8:signal_freshness" {
		t.Errorf("dedup key = %q, want the freshness finding for vehicle 8", items[0].DedupKey)
	}
	for _, item := range items {
		if strings.Contains(item.DedupKey, "signal_normalization_provenance") {
			t.Errorf("zero-sample window fabricated a coverage incident: %q", item.DedupKey)
		}
	}
}

// Coverage priority must be evidence-proportional: a materially low coverage
// escalates, a marginal gap does not.
func TestSignalProviderScalesCoveragePriorityWithEvidence(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name        string
		versioned   int64
		unversioned int64
		want        domain.Priority
	}{
		{"marginal gap stays medium", 995, 5, domain.PriorityMedium},
		{"materially low coverage escalates", 800, 200, domain.PriorityHigh},
		{"no coverage at all escalates", 0, 1000, domain.PriorityHigh},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			source := &fakeSource{signals: []domain.SignalHealthRecord{{
				Vehicle:                domain.VehicleRef{ID: 7, DisplayName: "Orion"},
				LatestSignalAt:         testTimePtr(now.Add(-10 * time.Minute)),
				LatestUnversionedAt:    testTimePtr(now.Add(-11 * time.Minute)),
				SampleCount:            tt.versioned + tt.unversioned,
				VersionedSampleCount:   tt.versioned,
				UnversionedSampleCount: tt.unversioned,
				CheckedAt:              now,
			}}}
			items, err := (signalProvider{source: source}).Recommendations(
				context.Background(), ListFilter{}, now,
			)
			if err != nil {
				t.Fatalf("Recommendations() error = %v", err)
			}
			if len(items) != 1 {
				t.Fatalf("items = %d, want 1", len(items))
			}
			if items[0].Priority != tt.want {
				t.Errorf("priority = %q, want %q", items[0].Priority, tt.want)
			}
			// The summary must carry the raw counts, never a bare percentage.
			if !strings.Contains(items[0].Summary, strconv.FormatInt(tt.unversioned, 10)) ||
				!strings.Contains(items[0].Summary, strconv.FormatInt(tt.versioned+tt.unversioned, 10)) {
				t.Errorf("summary %q must state the unversioned/total counts", items[0].Summary)
			}
			if items[0].Severity != domain.SeverityWarning {
				t.Errorf("severity = %q, want warning", items[0].Severity)
			}
		})
	}
}

// Every vehicle here yields BOTH a stale finding and a coverage finding, so
// the provider must still honour providerLimit rather than returning 2N.
func TestSignalProviderBoundsCombinedFindingsToProviderLimit(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC)
	signals := make([]domain.SignalHealthRecord, 0, providerLimit)
	for i := range providerLimit {
		id := int64(i + 1)
		signals = append(signals, domain.SignalHealthRecord{
			Vehicle:                domain.VehicleRef{ID: id},
			LatestSignalAt:         testTimePtr(now.Add(-96 * time.Hour)),
			LatestUnversionedAt:    testTimePtr(now.Add(-97 * time.Hour)),
			SampleCount:            10,
			VersionedSampleCount:   4,
			UnversionedSampleCount: 6,
			CheckedAt:              now,
		})
	}
	source := &fakeSource{signals: signals}

	items, err := (signalProvider{source: source}).Recommendations(
		context.Background(), ListFilter{}, now,
	)
	if err != nil {
		t.Fatalf("Recommendations() error = %v", err)
	}
	if len(items) != providerLimit {
		t.Fatalf("items = %d, want exactly providerLimit (%d)", len(items), providerLimit)
	}
	// Both finding kinds must be representable within the bound; dedup keys
	// must stay unique so the bounded page cannot collapse two findings.
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		if item.SourceFeature != domain.SourceSignalHealth {
			t.Errorf("source feature = %q, want SourceSignalHealth", item.SourceFeature)
		}
		if _, dup := seen[item.DedupKey]; dup {
			t.Fatalf("duplicate dedup key %q inside the bounded page", item.DedupKey)
		}
		seen[item.DedupKey] = struct{}{}
	}
}

func TestBatteryHealthProviderUsesIssuedPassportEvidence(t *testing.T) {
	now := time.Date(2026, 2, 20, 12, 0, 0, 0, time.UTC)
	source := &fakeSource{battery: []domain.BatteryHealthRecord{
		{
			LedgerID: 44,
			Vehicle:  domain.VehicleRef{ID: 7, DisplayName: "Orion"},
			SohPct:   79.2,
			IssuedAt: now.Add(-time.Hour),
		},
		{
			LedgerID: 45,
			Vehicle:  domain.VehicleRef{ID: 8, DisplayName: "Nova"},
			SohPct:   92,
			IssuedAt: now.Add(-time.Hour),
		},
	}}
	items, err := (batteryHealthProvider{source: source}).Recommendations(
		context.Background(),
		ListFilter{},
		now,
	)
	if err != nil {
		t.Fatalf("Recommendations() error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items = %d, want only the below-threshold passport", len(items))
	}
	item := items[0]
	if item.SourceFeature != domain.SourceBatteryHealth ||
		item.ProjectedImpact != nil ||
		item.NavigationPath == nil ||
		*item.NavigationPath != "/battery-passport?vehicle_id=7" {
		t.Fatalf("battery recommendation = %+v", item)
	}
	if item.Evidence[0].Provenance.Source != "tesla_battery_passport_ledger" {
		t.Fatalf("battery provenance = %+v", item.Evidence[0].Provenance)
	}
}

func TestDriveEfficiencyProviderProjectsOnlyMeasuredExcessEnergy(t *testing.T) {
	now := time.Date(2026, 2, 20, 12, 0, 0, 0, time.UTC)
	source := &fakeSource{drives: []domain.DriveEfficiencyRecord{{
		DriveID:               91,
		Vehicle:               domain.VehicleRef{ID: 7, DisplayName: "Orion"},
		StartedAt:             now.Add(-2 * time.Hour),
		EndedAt:               now.Add(-time.Hour),
		DistanceM:             20_000,
		EnergyUsedWh:          8_000,
		EnergyIntensityWhPerM: 0.4,
		BaselineWhPerM:        0.2,
		BaselineSampleCount:   20,
		IntensityRatio:        2,
		ExcessEnergyWh:        4_000,
	}}}
	items, err := (driveEfficiencyProvider{source: source}).Recommendations(
		context.Background(),
		ListFilter{},
		now,
	)
	if err != nil {
		t.Fatalf("Recommendations() error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	item := items[0]
	if item.Priority != domain.PriorityHigh ||
		item.ProjectedImpact == nil ||
		item.ProjectedImpact.EnergyWh == nil ||
		*item.ProjectedImpact.EnergyWh != 4_000 {
		t.Fatalf("drive recommendation = %+v", item)
	}
	if item.NavigationPath == nil || *item.NavigationPath != "/drives/91" {
		t.Fatalf("drive navigation = %v", item.NavigationPath)
	}
}

func TestVehicleReadinessProviderRequiresRepeatedFailures(t *testing.T) {
	now := time.Date(2026, 2, 20, 12, 0, 0, 0, time.UTC)
	source := &fakeSource{commands: []domain.CommandReliabilityRecord{
		{
			Vehicle:         domain.VehicleRef{ID: 7, DisplayName: "Orion"},
			AttemptCount:    5,
			FailureCount:    4,
			LatestFailureAt: now.Add(-time.Hour),
			WindowStart:     now.Add(-24 * time.Hour),
			CheckedAt:       now,
		},
		{
			Vehicle:         domain.VehicleRef{ID: 8, DisplayName: "Nova"},
			AttemptCount:    2,
			FailureCount:    2,
			LatestFailureAt: now.Add(-time.Hour),
			WindowStart:     now.Add(-24 * time.Hour),
			CheckedAt:       now,
		},
	}}
	items, err := (vehicleReadinessProvider{source: source}).Recommendations(
		context.Background(),
		ListFilter{},
		now,
	)
	if err != nil {
		t.Fatalf("Recommendations() error = %v", err)
	}
	if len(items) != 1 || items[0].Vehicle == nil || items[0].Vehicle.ID != 7 {
		t.Fatalf("command recommendations = %+v", items)
	}
	if items[0].Priority != domain.PriorityHigh ||
		items[0].Evidence[0].Provenance.Source != "command_logs" {
		t.Fatalf("command recommendation = %+v", items[0])
	}
}

func TestSystemHealthProviderUsesOnlyUnresolvedIncidentRecords(t *testing.T) {
	now := time.Date(2026, 2, 20, 12, 0, 0, 0, time.UTC)
	source := &fakeSource{incidents: []domain.SystemIncidentRecord{{
		ID:                 12,
		Title:              "Telemetry ingestion delayed",
		Severity:           "critical",
		Status:             "investigating",
		AffectedComponents: []string{"mqtt", "signal-writer"},
		StartedAt:          now.Add(-2 * time.Hour),
		UpdatedAt:          now.Add(-time.Hour),
	}}}
	provider := systemHealthProvider{source: source}
	items, err := provider.Recommendations(context.Background(), ListFilter{}, now)
	if err != nil {
		t.Fatalf("Recommendations() error = %v", err)
	}
	if len(items) != 1 ||
		items[0].Priority != domain.PriorityCritical ||
		items[0].Severity != domain.SeverityCritical ||
		items[0].Vehicle != nil {
		t.Fatalf("system recommendation = %+v", items)
	}
	vehicleID := int64(7)
	filtered, err := provider.Recommendations(
		context.Background(),
		ListFilter{VehicleID: &vehicleID},
		now,
	)
	if err != nil || len(filtered) != 1 {
		t.Fatalf("vehicle-filtered system recommendations = %+v, err = %v", filtered, err)
	}
}

func TestActionsRequireFreshFingerprintAndVersion(t *testing.T) {
	now := time.Date(2026, 2, 20, 12, 0, 0, 0, time.UTC)
	source := &fakeSource{alerts: []domain.AlertRecord{{
		LogID: 1, AlertID: 2, Title: "Alert", Message: "Evidence",
		Severity: "warn", DeliveryStatus: "sent", CreatedAt: now.Add(-time.Hour),
	}}}
	states := newFakeStates()
	service := New(source, states)
	service.now = func() time.Time { return now }
	page, err := service.List(context.Background(), "user-1", ListFilter{})
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("initial List() = items:%d err:%v", len(page.Items), err)
	}
	item := page.Items[0]
	request := ActionRequest{
		RecommendationID: item.ID,
		Fingerprint:      item.Fingerprint,
		Action:           domain.ActionAcknowledge,
		ExpectedVersion:  0,
		Confirmed:        true,
	}
	result, err := service.ApplyAction(context.Background(), "user-1", request)
	if err != nil {
		t.Fatalf("ApplyAction() error = %v", err)
	}
	if result.Recommendation.CurrentState.Status != domain.StateAcknowledged ||
		result.Recommendation.CurrentState.Version != 1 {
		t.Fatalf("state = %+v", result.Recommendation.CurrentState)
	}

	_, err = service.ApplyAction(context.Background(), "user-1", request)
	if !errors.Is(err, port.ErrStateConflict) {
		t.Fatalf("stale version error = %v, want state conflict", err)
	}

	source.alerts[0].Message = "Changed evidence"
	_, err = service.ApplyAction(context.Background(), "user-1", ActionRequest{
		RecommendationID: item.ID,
		Fingerprint:      item.Fingerprint,
		Action:           domain.ActionDismiss,
		ExpectedVersion:  1,
		Confirmed:        true,
	})
	if !errors.Is(err, ErrStaleFingerprint) {
		t.Fatalf("changed evidence error = %v, want stale fingerprint", err)
	}
}

func TestActionValidationAndSnoozeTransition(t *testing.T) {
	now := time.Date(2026, 2, 20, 12, 0, 0, 0, time.UTC)
	candidate := testCandidate(now)
	source := &fakeSource{workOrders: []domain.WorkOrderRecord{{
		ID: 12, Vehicle: *candidate.Vehicle, Title: candidate.Title,
		Status: "open", Severity: "medium", UpdatedAt: *candidate.ObservedAt,
	}}}
	service := New(source, newFakeStates())
	service.now = func() time.Time { return now }
	page, _ := service.List(context.Background(), "user-1", ListFilter{})
	item := page.Items[0]

	_, err := service.ApplyAction(context.Background(), "user-1", ActionRequest{
		RecommendationID: item.ID, Fingerprint: item.Fingerprint,
		Action: domain.ActionSnooze, Confirmed: false,
		SnoozedUntil: testTimePtr(now.Add(24 * time.Hour)),
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unconfirmed error = %v, want invalid input", err)
	}
	result, err := service.ApplyAction(context.Background(), "user-1", ActionRequest{
		RecommendationID: item.ID, Fingerprint: item.Fingerprint,
		Action: domain.ActionSnooze, Confirmed: true,
		SnoozedUntil: testTimePtr(now.Add(24 * time.Hour)),
	})
	if err != nil {
		t.Fatalf("snooze error = %v", err)
	}
	if result.Event.ToState != domain.StateSnoozed ||
		result.Recommendation.CurrentState.SnoozedUntil == nil {
		t.Fatalf("snooze result = %+v", result)
	}
}

func testCandidate(now time.Time) domain.Candidate {
	vehicle := &domain.VehicleRef{ID: 5, DisplayName: "Nova"}
	observedAt := now.Add(-time.Hour)
	return domain.Candidate{
		SourceFeature:   domain.SourceFleetMaintenance,
		SourceKey:       "work_order:1",
		DedupKey:        "5:work_order:1",
		Vehicle:         vehicle,
		Title:           "Review work order",
		Summary:         "Work order is active.",
		Rationale:       "Persisted source state.",
		Priority:        domain.PriorityMedium,
		Severity:        domain.SeverityWarning,
		BaseConfidence:  0.9,
		ConfidenceBasis: []string{"Direct record"},
		Evidence: []domain.EvidenceItem{{
			ID: "work_order:1", Kind: "work_order", Summary: "Active",
			Provenance: domain.EvidenceProvenance{Source: "test", RecordID: "1"},
			ObservedAt: &observedAt,
		}},
		SafeActions: []domain.ActionType{domain.ActionAcknowledge},
		ObservedAt:  &observedAt,
		FreshFor:    24 * time.Hour,
		AgingFor:    7 * 24 * time.Hour,
		ExpiresAt:   now.Add(24 * time.Hour),
	}
}

func testTimePtr(value time.Time) *time.Time { return &value }

func containsTestState(states []domain.State, target domain.State) bool {
	for _, state := range states {
		if state == target {
			return true
		}
	}
	return false
}

func TestRecommendationIdentityFormat(t *testing.T) {
	now := time.Now().UTC()
	id := deterministicID(testCandidate(now))
	if len(id) != 27 || !validRecommendationID(id) {
		t.Fatalf("ID %q does not match the strict contract", id)
	}
}

func TestFingerprintIgnoresCheckTimeButTracksSourceFacts(t *testing.T) {
	now := time.Date(2026, 2, 20, 12, 0, 0, 0, time.UTC)
	first := testCandidate(now)
	first.Evidence = append(first.Evidence, domain.EvidenceItem{
		ID: "check:1", Kind: "bounded_query", Summary: "Provider checked",
		Provenance: domain.EvidenceProvenance{Source: "provider", RecordID: "vehicle:5"},
		ObservedAt: &now,
	})
	second := first
	later := now.Add(time.Minute)
	second.Evidence = append([]domain.EvidenceItem(nil), first.Evidence...)
	second.Evidence[1].ObservedAt = &later
	if deterministicFingerprint(first) != deterministicFingerprint(second) {
		t.Fatal("provider check time changed the semantic fingerprint")
	}

	changed := first
	changed.Evidence = append([]domain.EvidenceItem(nil), first.Evidence...)
	sourceObservedAt := now.Add(-2 * time.Hour)
	changed.Evidence[0].ObservedAt = &sourceObservedAt
	if deterministicFingerprint(first) == deterministicFingerprint(changed) {
		t.Fatal("source evidence timestamp did not change the semantic fingerprint")
	}
}
