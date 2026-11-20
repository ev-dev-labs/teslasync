package smartreadinesssvc

import (
	"context"
	"errors"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type stubRepository struct {
	claims        []*port.Claim
	activePlans   []domain.Plan
	activeCalls   int
	latestCalls   int
	revokeActive  bool
	finished      []domain.Decision
	candidates    []port.Candidate
	listCalls     int
	revokeOnCheck bool
	onList        func(int)
	claimScopes   []bool
	rateWindows   []domain.SiteRateWindow
	rateReads     int
	onRateRead    func(int)
}

func (*stubRepository) ListPlans(context.Context, string, int64, int, int) ([]domain.Plan, error) {
	return []domain.Plan{}, nil
}
func (r *stubRepository) ListActivePlans(_ context.Context, subject string, vehicleID int64, _ time.Time, _ int) ([]domain.Plan, error) {
	r.activeCalls++
	if r.revokeActive && r.activeCalls > 1 {
		return []domain.Plan{}, nil
	}
	return r.plansFor(subject, vehicleID), nil
}
func (r *stubRepository) ListLatestStartPlans(_ context.Context, subject string, vehicleID int64, _ time.Time, _ int) ([]domain.Plan, error) {
	r.latestCalls++
	if r.revokeActive && r.latestCalls > 1 {
		return []domain.Plan{}, nil
	}
	return r.plansFor(subject, vehicleID), nil
}
func (r *stubRepository) ListSiteRateWindows(_ context.Context, _ []int64, _, _ time.Time) ([]domain.SiteRateWindow, error) {
	r.rateReads++
	if r.onRateRead != nil {
		r.onRateRead(r.rateReads)
	}
	return append([]domain.SiteRateWindow(nil), r.rateWindows...), nil
}
func (r *stubRepository) plansFor(subject string, vehicleID int64) []domain.Plan {
	plans := make([]domain.Plan, 0, len(r.activePlans))
	for _, plan := range r.activePlans {
		if plan.Subject == subject && plan.VehicleID == vehicleID {
			plans = append(plans, plan)
		}
	}
	return plans
}
func (*stubRepository) SavePlan(_ context.Context, subject string, plan domain.Plan, _ time.Time) (*domain.Plan, error) {
	plan.Subject = subject
	return &plan, nil
}
func (*stubRepository) DeletePlan(context.Context, string, int64, int64) error { return nil }
func (*stubRepository) SnoozePlan(context.Context, string, int64, int64, *time.Time, time.Time) error {
	return nil
}
func (r *stubRepository) ClaimDue(_ context.Context, _ time.Time, sharedOpenMode bool) (*port.Claim, error) {
	r.claimScopes = append(r.claimScopes, sharedOpenMode)
	if len(r.claims) == 0 {
		return nil, nil
	}
	claim := r.claims[0]
	r.claims = r.claims[1:]
	return claim, nil
}
func (r *stubRepository) FinishClaim(_ context.Context, _ port.Claim, decision domain.Decision, _ time.Time) error {
	r.finished = append(r.finished, decision)
	return nil
}
func (r *stubRepository) ListCandidates(_ context.Context, subject string, vehicleID *int64, _ time.Time, _ int) ([]port.Candidate, error) {
	r.listCalls++
	if r.onList != nil {
		r.onList(r.listCalls)
	}
	if r.revokeOnCheck && r.listCalls > 1 {
		return nil, nil
	}
	result := make([]port.Candidate, 0)
	for _, candidate := range r.candidates {
		if candidate.Plan.Subject == subject && (vehicleID == nil || candidate.Plan.VehicleID == *vehicleID) {
			result = append(result, candidate)
		}
	}
	return result, nil
}

func (r *stubRepository) FindCandidate(ctx context.Context, subject string, vehicleID, planID int64, now time.Time) (*port.Candidate, error) {
	candidates, err := r.ListCandidates(ctx, subject, &vehicleID, now, 100)
	if err != nil {
		return nil, err
	}
	for _, candidate := range candidates {
		if candidate.Plan.ID == planID {
			return &candidate, nil
		}
	}
	return nil, nil
}

type stubLive struct {
	values map[string]*signal.Value
	err    error
	reads  int
	onRead func()
}

func (s *stubLive) GetAll(_ context.Context, _ int64, preference signal.LiveSignalReadPreference) (map[string]*signal.Value, error) {
	if preference != signal.LiveSignalReadDistributed {
		return nil, errors.New("expected distributed live read")
	}
	s.reads++
	if s.onRead != nil {
		s.onRead()
	}
	return s.values, s.err
}

type stubSites struct {
	inside    bool
	err       error
	reads     int
	placeID   int64
	latitude  float64
	longitude float64
	onRead    func()
}

func (s *stubSites) Contains(_ context.Context, placeID int64, latitude, longitude float64) (bool, error) {
	s.reads++
	s.placeID, s.latitude, s.longitude = placeID, latitude, longitude
	if s.onRead != nil {
		s.onRead()
	}
	return s.inside, s.err
}

func readinessFixture(now time.Time) (domain.Plan, map[string]*signal.Value) {
	placeID := int64(9)
	plan := domain.Plan{
		ID: 1, Subject: "subject-a", VehicleID: 7, ChargingPlaceID: &placeID,
		Enabled: true, NotifyAt: now, DepartureAt: now.Add(12 * time.Hour),
		TripUseLowPct: 35, TripUseHighPct: 45, ReservePct: 20, Version: 1,
	}
	values := map[string]*signal.Value{
		"BatteryLevel":        {Raw: 45.0, Timestamp: now},
		"DetailedChargeState": {Raw: "Disconnected", Timestamp: now},
		"Gear":                {Raw: "P", Timestamp: now},
		"LocationLatitude":    {Raw: 47.1, Timestamp: now},
		"LocationLongitude":   {Raw: -122.1, Timestamp: now},
	}
	return plan, values
}

func TestEstimateLatestStartRequiresFreshMeasuredChargingAndUsesConservativeRange(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, values := readinessFixture(now)
	plan.DepartureAt = now.Add(10 * time.Hour)
	values["BatteryLevel"].Raw = 40.0
	values["DetailedChargeState"].Raw = "Charging"
	values["NominalFullPackEnergyKwh"] = &signal.Value{Raw: 80000.0, Timestamp: now}
	values["ACChargingPower"] = &signal.Value{Raw: 10000.0, Timestamp: now}
	atSite := func(float64, float64) bool { return true }
	estimate := EstimateLatestStart(plan, values, now, atSite)
	if estimate.Status != domain.LatestStartEstimate || estimate.RequiredLowPct != 15 ||
		estimate.RequiredHighPct != 25 || estimate.ChargingPowerW != 10000 ||
		estimate.EarliestSafeStartAt == nil || !estimate.EarliestSafeStartAt.Equal(now.Add(7*time.Hour+30*time.Minute)) ||
		estimate.LatestSafeStartAt == nil || !estimate.LatestSafeStartAt.Equal(now.Add(8*time.Hour+30*time.Minute)) {
		t.Fatalf("unexpected latest-start estimate: %+v", estimate)
	}

	values["DCChargingPower"] = &signal.Value{Raw: 5000.0, Timestamp: now}
	conservative := EstimateLatestStart(plan, values, now, atSite)
	if conservative.Status != domain.LatestStartEstimate || conservative.ChargingPowerW != 5000 ||
		conservative.EarliestSafeStartAt == nil || !conservative.EarliestSafeStartAt.Equal(now.Add(5*time.Hour)) ||
		conservative.LatestSafeStartAt == nil || !conservative.LatestSafeStartAt.Equal(now.Add(7*time.Hour)) {
		t.Fatalf("estimate did not use the conservative fresh power: %+v", conservative)
	}

	tests := []struct {
		name   string
		change func(map[string]*signal.Value)
		status domain.LatestStartStatus
		reason domain.LatestStartReason
	}{
		{"stale power", func(v map[string]*signal.Value) { v["ACChargingPower"].Timestamp = now.Add(-3 * time.Minute) }, domain.LatestStartUnavailable, domain.LatestStartReasonNotCharging},
		{"future power", func(v map[string]*signal.Value) { v["ACChargingPower"].Timestamp = now.Add(time.Second) }, domain.LatestStartUnavailable, domain.LatestStartReasonNotCharging},
		{"synthetic power", func(v map[string]*signal.Value) { v["ACChargingPower"].TimestampSynthetic = true }, domain.LatestStartUnavailable, domain.LatestStartReasonNotCharging},
		{"zero power", func(v map[string]*signal.Value) { v["ACChargingPower"].Raw = 0.0 }, domain.LatestStartUnavailable, domain.LatestStartReasonNotCharging},
		{"stopped session", func(v map[string]*signal.Value) { v["DetailedChargeState"].Raw = "Stopped" }, domain.LatestStartUnavailable, domain.LatestStartReasonNotCharging},
		{"missing battery", func(v map[string]*signal.Value) { delete(v, "BatteryLevel") }, domain.LatestStartUnavailable, domain.LatestStartReasonUnknownState},
		{"missing pack capacity", func(v map[string]*signal.Value) { delete(v, "NominalFullPackEnergyKwh") }, domain.LatestStartUnavailable, domain.LatestStartReasonUnknownState},
		{"already enough charge", func(v map[string]*signal.Value) { v["BatteryLevel"].Raw = 70.0 }, domain.LatestStartSufficient, ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, fresh := readinessFixture(now)
			fresh["BatteryLevel"].Raw = 40.0
			fresh["DetailedChargeState"].Raw = "Charging"
			fresh["NominalFullPackEnergyKwh"] = &signal.Value{Raw: 80000.0, Timestamp: now}
			fresh["ACChargingPower"] = &signal.Value{Raw: 10000.0, Timestamp: now}
			test.change(fresh)
			got := EstimateLatestStart(plan, fresh, now, atSite)
			if got.Status != test.status || got.Reason != test.reason {
				t.Fatalf("estimate = %+v, want status %q reason %q", got, test.status, test.reason)
			}
		})
	}
}

func TestEstimateLatestStartRejectsAnImpossibleBatteryTarget(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, values := readinessFixture(now)
	plan.TripUseHighPct = 90
	plan.ReservePct = 20
	values["BatteryLevel"].Raw = 100.0
	got := EstimateLatestStart(plan, values, now, nil)
	if got.Status != domain.LatestStartUnachievable || got.EarliestSafeStartAt != nil ||
		got.LatestSafeStartAt != nil || got.ExpiresAt == nil {
		t.Fatalf("impossible target estimate = %+v", got)
	}
}

func TestLatestStartOverdueUsesTheHigherTripEstimate(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, values := readinessFixture(now)
	plan.DepartureAt = now.Add(2 * time.Hour)
	values["BatteryLevel"].Raw = 40.0
	values["DetailedChargeState"].Raw = "Charging"
	values["NominalFullPackEnergyKwh"] = &signal.Value{Raw: 80000.0, Timestamp: now}
	values["ACChargingPower"] = &signal.Value{Raw: 10000.0, Timestamp: now}
	got := EstimateLatestStart(plan, values, now, func(float64, float64) bool { return true })
	if got.Status != domain.LatestStartOverdue || got.EarliestSafeStartAt == nil ||
		got.LatestSafeStartAt == nil || !got.EarliestSafeStartAt.Before(now) ||
		!got.LatestSafeStartAt.After(now) {
		t.Fatalf("conservative estimate = %+v", got)
	}
}

func TestLatestStartsIncludeEnabledPlansBeforeNotificationWindow(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, values := readinessFixture(now)
	plan.NotifyAt = now.Add(time.Hour)
	repo := &stubRepository{activePlans: []domain.Plan{plan}}
	live := &stubLive{values: values}
	service := New(repo, live, &stubSites{}, WithClock(func() time.Time { return now }))
	estimates, err := service.LatestStarts(context.Background(), "subject-b", 7)
	if err != nil || len(estimates) != 0 || live.reads != 0 {
		t.Fatalf("foreign subject estimates = %+v, reads=%d, error=%v", estimates, live.reads, err)
	}
	estimates, err = service.LatestStarts(context.Background(), "subject-a", 7)
	if err != nil || len(estimates) != 1 || live.reads != 1 {
		t.Fatalf("owner estimates = %+v, reads=%d, error=%v", estimates, live.reads, err)
	}
}

func TestLatestStartsRechecksConsentAndEvidenceAfterSlowReads(t *testing.T) {
	start := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	now := start
	plan, values := readinessFixture(start)
	repo := &stubRepository{activePlans: []domain.Plan{plan}, revokeActive: true}
	live := &stubLive{values: values, onRead: func() {
		now = now.Add(signal.LiveSignalFreshnessThreshold + time.Second)
	}}
	service := New(repo, live, &stubSites{}, WithClock(func() time.Time { return now }))
	estimates, err := service.LatestStarts(context.Background(), "subject-a", 7)
	if err != nil || len(estimates) != 0 || live.reads != 1 || repo.latestCalls != 2 {
		t.Fatalf("revoked estimates = %+v, signal reads=%d, plan reads=%d, error=%v",
			estimates, live.reads, repo.latestCalls, err)
	}

	repo.revokeActive = false
	repo.latestCalls = 0
	estimates, err = service.LatestStarts(context.Background(), "subject-a", 7)
	if err != nil || len(estimates) != 1 || estimates[0].Status != domain.LatestStartUnavailable {
		t.Fatalf("expired signal estimate = %+v, error=%v", estimates, err)
	}
}

func TestLatestStartsRequiresPowerAtTheSelectedChargingPlace(t *testing.T) {
	start := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	tests := []struct {
		name      string
		change    func(map[string]*signal.Value)
		inside    bool
		status    domain.LatestStartStatus
		reason    domain.LatestStartReason
		siteReads int
	}{
		{"selected place", nil, true, domain.LatestStartEstimate, "", 1},
		{"different place", nil, false, domain.LatestStartUnavailable, "outside_site", 1},
		{"stale location", func(v map[string]*signal.Value) { v["LocationLatitude"].Timestamp = start.Add(-3 * time.Minute) }, true, domain.LatestStartUnavailable, "unknown_location", 0},
		{"synthetic location", func(v map[string]*signal.Value) { v["LocationLongitude"].TimestampSynthetic = true }, true, domain.LatestStartUnavailable, "unknown_location", 0},
		{"inconsistent location", func(v map[string]*signal.Value) { v["LocationLatitude"].Timestamp = start.Add(-11 * time.Second) }, true, domain.LatestStartUnavailable, "unknown_location", 0},
		{"moving vehicle", func(v map[string]*signal.Value) { v["Gear"].Raw = "D" }, true, domain.LatestStartUnavailable, "unknown_location", 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plan, values := readinessFixture(start)
			values["BatteryLevel"].Raw = 40.0
			values["DetailedChargeState"].Raw = "Charging"
			values["NominalFullPackEnergyKwh"] = &signal.Value{Raw: 80000.0, Timestamp: start}
			values["ACChargingPower"] = &signal.Value{Raw: 10000.0, Timestamp: start}
			if test.change != nil {
				test.change(values)
			}
			repo := &stubRepository{activePlans: []domain.Plan{plan}}
			sites := &stubSites{inside: test.inside}
			service := New(repo, &stubLive{values: values}, sites, WithClock(func() time.Time { return start }))
			estimates, err := service.LatestStarts(context.Background(), "subject-a", 7)
			if err != nil || len(estimates) != 1 || estimates[0].Status != test.status ||
				estimates[0].Reason != test.reason || sites.reads != test.siteReads {
				t.Fatalf("estimates = %+v, site reads = %d, error = %v", estimates, sites.reads, err)
			}
			if test.siteReads == 1 && (sites.placeID != *plan.ChargingPlaceID ||
				sites.latitude != 47.1 || sites.longitude != -122.1) {
				t.Fatalf("site lookup used place %d and coordinates %f/%f", sites.placeID, sites.latitude, sites.longitude)
			}
			if test.status == domain.LatestStartUnavailable &&
				(estimates[0].EarliestSafeStartAt != nil || estimates[0].LatestSafeStartAt != nil) {
				t.Fatalf("unavailable estimate exposed a start time: %+v", estimates[0])
			}
		})
	}
}

func TestLatestStartExpiresWithItsOldestLocationEvidence(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, values := readinessFixture(now)
	values["BatteryLevel"].Raw = 40.0
	values["DetailedChargeState"].Raw = "Charging"
	values["NominalFullPackEnergyKwh"] = &signal.Value{Raw: 80000.0, Timestamp: now}
	values["ACChargingPower"] = &signal.Value{Raw: 10000.0, Timestamp: now}
	values["Gear"].Timestamp = now.Add(-30 * time.Second)
	got := EstimateLatestStart(plan, values, now, func(float64, float64) bool { return true })
	wantObserved := now.Add(-30 * time.Second)
	if got.Status != domain.LatestStartEstimate || got.ObservedAt == nil || got.ExpiresAt == nil ||
		!got.ObservedAt.Equal(wantObserved) ||
		!got.ExpiresAt.Equal(wantObserved.Add(signal.LiveSignalFreshnessThreshold)) {
		t.Fatalf("location-dependent expiry = %+v", got)
	}
}

func TestLatestStartWithoutSiteStillReportsSufficientAndImpossibleTargets(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	for _, status := range []domain.LatestStartStatus{domain.LatestStartSufficient, domain.LatestStartUnachievable} {
		t.Run(string(status), func(t *testing.T) {
			plan, values := readinessFixture(now)
			values["BatteryLevel"].Raw = 100.0
			if status == domain.LatestStartUnachievable {
				plan.TripUseHighPct = 90
			}
			repo := &stubRepository{activePlans: []domain.Plan{plan}}
			sites := &stubSites{err: errors.New("site unavailable")}
			service := New(repo, &stubLive{values: values}, sites, WithClock(func() time.Time { return now }))
			estimates, err := service.LatestStarts(context.Background(), "subject-a", 7)
			if err != nil || len(estimates) != 1 || estimates[0].Status != status || sites.reads != 0 {
				t.Fatalf("site-independent estimates = %+v, site reads = %d, error = %v", estimates, sites.reads, err)
			}
		})
	}
}

func TestLatestStartsRechecksConsentAndFreshnessAfterPlaceLookup(t *testing.T) {
	start := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	now := start
	plan, values := readinessFixture(start)
	values["BatteryLevel"].Raw = 40.0
	values["DetailedChargeState"].Raw = "Charging"
	values["NominalFullPackEnergyKwh"] = &signal.Value{Raw: 80000.0, Timestamp: start}
	values["ACChargingPower"] = &signal.Value{Raw: 10000.0, Timestamp: start}
	repo := &stubRepository{activePlans: []domain.Plan{plan}}
	sites := &stubSites{inside: true, onRead: func() { repo.revokeActive = true }}
	service := New(repo, &stubLive{values: values}, sites, WithClock(func() time.Time { return now }))
	estimates, err := service.LatestStarts(context.Background(), "subject-a", 7)
	if err != nil || len(estimates) != 0 || sites.reads != 1 {
		t.Fatalf("revoked estimates = %+v, site reads = %d, error = %v", estimates, sites.reads, err)
	}

	repo.revokeActive = false
	repo.latestCalls = 0
	sites.onRead = func() { now = now.Add(signal.LiveSignalFreshnessThreshold + time.Second) }
	estimates, err = service.LatestStarts(context.Background(), "subject-a", 7)
	if err != nil || len(estimates) != 1 || estimates[0].Status != domain.LatestStartUnavailable {
		t.Fatalf("expired estimates = %+v, error = %v", estimates, err)
	}
}

func TestProcessDueDoesNotReadSignalsWithoutAnEnabledPlan(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	repo, live, sites := &stubRepository{}, &stubLive{}, &stubSites{}
	service := New(repo, live, sites, WithClock(func() time.Time { return now }))
	processed, err := service.ProcessDue(context.Background(), 10)
	if err != nil || processed != 0 || live.reads != 0 || sites.reads != 0 {
		t.Fatalf("processed %d, reads %d/%d, error %v", processed, live.reads, sites.reads, err)
	}
}

func TestProcessDueUsesConfiguredOwnerScope(t *testing.T) {
	for _, shared := range []bool{false, true} {
		repo := &stubRepository{}
		service := New(repo, &stubLive{}, &stubSites{}, WithSharedOpenMode(shared))
		if _, err := service.ProcessDue(context.Background(), 1); err != nil {
			t.Fatal(err)
		}
		if len(repo.claimScopes) != 1 || repo.claimScopes[0] != shared {
			t.Fatalf("shared=%v, requested claim scopes = %+v", shared, repo.claimScopes)
		}
	}
}

func TestProcessAndPrivateReadRecheckResolvedState(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, values := readinessFixture(now)
	repo := &stubRepository{
		claims:     []*port.Claim{{Plan: plan, Token: "lease"}},
		candidates: []port.Candidate{{Plan: plan, PlaceUpdatedAt: now, Decision: domain.Decision{Kind: domain.DecisionPlugIn}}},
	}
	live, sites := &stubLive{values: values}, &stubSites{inside: true}
	service := New(repo, live, sites, WithClock(func() time.Time { return now }))
	processed, err := service.ProcessDue(context.Background(), 10)
	if err != nil || processed != 1 || len(repo.finished) != 1 || repo.finished[0].Reason != domain.ReasonEligible {
		t.Fatalf("processed %d, decisions %+v, error %v", processed, repo.finished, err)
	}
	items, err := service.ListCandidates(context.Background(), "subject-a", nil, now, 10)
	if err != nil || len(items) != 1 || items[0].Decision.ArrivalHighPct != 10 {
		t.Fatalf("owner candidates = %+v, %v", items, err)
	}
	items, err = service.ListCandidates(context.Background(), "subject-b", nil, now, 10)
	if err != nil || len(items) != 0 {
		t.Fatalf("other subject candidates = %+v, %v", items, err)
	}
	values["DetailedChargeState"].Raw = "Charging"
	items, err = service.ListCandidates(context.Background(), "subject-a", nil, now, 10)
	if err != nil || len(items) != 0 {
		t.Fatalf("resolved candidates = %+v, %v", items, err)
	}
}

func TestReadRechecksRevocationAndReportsSignalFailure(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, values := readinessFixture(now)
	repo := &stubRepository{candidates: []port.Candidate{{
		Plan: plan, PlaceUpdatedAt: now, Decision: domain.Decision{Kind: domain.DecisionPlugIn},
	}}, revokeOnCheck: true}
	live, sites := &stubLive{values: values}, &stubSites{inside: true}
	service := New(repo, live, sites, WithClock(func() time.Time { return now }))
	items, err := service.ListCandidates(context.Background(), "subject-a", nil, now, 10)
	if err != nil || len(items) != 0 {
		t.Fatalf("revoked candidates = %+v, %v", items, err)
	}
	repo.listCalls = 0
	want := errors.New("live state unavailable")
	live.err = want
	if _, err := service.ListCandidates(context.Background(), "subject-a", nil, now, 10); !errors.Is(err, want) {
		t.Fatalf("live read error = %v, want wrapped error", err)
	}
}

func TestSlowReadsCannotExposeExpiredEvidence(t *testing.T) {
	start := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	for _, delay := range []string{"signals", "site", "consent"} {
		t.Run(delay, func(t *testing.T) {
			now := start
			plan, values := readinessFixture(now)
			repo := &stubRepository{candidates: []port.Candidate{{
				Plan: plan, PlaceUpdatedAt: now, Decision: domain.Decision{Kind: domain.DecisionPlugIn},
			}}}
			live, sites := &stubLive{values: values}, &stubSites{inside: true}
			advance := func() { now = now.Add(signal.LiveSignalFreshnessThreshold + time.Second) }
			switch delay {
			case "signals":
				live.onRead = advance
			case "site":
				sites.onRead = advance
			case "consent":
				repo.onList = func(call int) {
					if call == 2 {
						advance()
					}
				}
			}
			service := New(repo, live, sites, WithClock(func() time.Time { return now }))
			items, err := service.ListCandidates(context.Background(), "subject-a", nil, start, 10)
			if err != nil || len(items) != 0 {
				t.Fatalf("expired candidates = %+v, %v", items, err)
			}
		})
	}
}

func TestSaveRequiresValidExplicitPlan(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, values := readinessFixture(now)
	service := New(&stubRepository{}, &stubLive{values: values}, &stubSites{inside: true}, WithClock(func() time.Time { return now }))
	if _, err := service.SavePlan(context.Background(), "subject-a", plan); err != nil {
		t.Fatal(err)
	}
	plan.ChargingPlaceID = nil
	if _, err := service.SavePlan(context.Background(), "subject-a", plan); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("missing place error = %v", err)
	}
	if _, err := service.ListPlans(context.Background(), "", 7, 50, 0); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("missing subject error = %v", err)
	}
	if err := service.SnoozePlan(context.Background(), "subject-a", 7, 1, -1); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("negative snooze error = %v", err)
	}
}
