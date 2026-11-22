package smartreadinesssvc

import (
	"context"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func rateComparisonFixture(now time.Time) (domain.Plan, map[string]*signal.Value, []domain.SiteRateWindow) {
	plan, values := readinessFixture(now)
	plan.DepartureAt = now.Add(6 * time.Hour)
	plan.CompareSiteRates = true
	values["BatteryLevel"].Raw = 40.0
	values["DetailedChargeState"].Raw = "Charging"
	values["NominalFullPackEnergyKwh"] = &signal.Value{Raw: 80000.0, Timestamp: now}
	values["ACChargingPower"] = &signal.Value{Raw: 10000.0, Timestamp: now}
	change := now.Add(3 * time.Hour)
	windows := []domain.SiteRateWindow{
		{PlaceID: 9, RatePerWh: "0.0004000000", Currency: "USD", EffectiveFrom: now.Add(-time.Hour), EffectiveTo: &change},
		{PlaceID: 9, RatePerWh: "0.0001000000", Currency: "USD", EffectiveFrom: change},
	}
	return plan, values, windows
}

func TestSiteRateComparisonUsesVerifiedWindowsAndConservativeFeasibility(t *testing.T) {
	// This interval crosses the US spring DST transition; price windows are instants.
	now := time.Date(2026, 3, 8, 7, 0, 0, 0, time.UTC)
	plan, values, windows := rateComparisonFixture(now)
	estimate := EstimateLatestStart(plan, values, now, func(float64, float64) bool { return true })
	comparison := estimateSiteRateComparison(plan, estimate, 80000, windows, now)
	if comparison == nil || !comparison.LowerRateStartAt.Equal(now.Add(3*time.Hour)) ||
		comparison.RequiredEnergyWh != 20000 || comparison.Currency != "USD" ||
		comparison.CostNowDecimal != "8.000000" || comparison.CostLaterDecimal != "2.000000" ||
		comparison.SavingDecimal != "6.000000" {
		t.Fatalf("comparison = %+v", comparison)
	}
	if comparison.LowerRateStartAt.After(*estimate.EarliestSafeStartAt) {
		t.Fatalf("lower-rate start %s is after buffered start %s",
			comparison.LowerRateStartAt, *estimate.EarliestSafeStartAt)
	}
}

func TestSiteRateComparisonChecksTheEarliestActionableStartWithinACheapWindow(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, values, _ := rateComparisonFixture(now)
	cheapStart, cheapEnd := now.Add(4*time.Minute), now.Add(124*time.Minute)
	windows := []domain.SiteRateWindow{
		{PlaceID: 9, RatePerWh: "0.0030000000", Currency: "USD", EffectiveFrom: now.Add(-time.Hour), EffectiveTo: &cheapStart},
		{PlaceID: 9, RatePerWh: "0.0000000000", Currency: "USD", EffectiveFrom: cheapStart, EffectiveTo: &cheapEnd},
		{PlaceID: 9, RatePerWh: "0.0030000000", Currency: "USD", EffectiveFrom: cheapEnd},
	}
	estimate := EstimateLatestStart(plan, values, now, func(float64, float64) bool { return true })
	comparison := estimateSiteRateComparison(plan, estimate, 80000, windows, now)
	if comparison == nil || !comparison.LowerRateStartAt.Equal(now.Add(5*time.Minute)) ||
		comparison.CostNowDecimal != "2.000000" || comparison.CostLaterDecimal != "0.500000" ||
		comparison.SavingDecimal != "1.500000" {
		t.Fatalf("comparison at the earliest actionable time = %+v", comparison)
	}
}

func TestSiteRateComparisonSuppressesUnreliableOrImmaterialAdvice(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	tests := []struct {
		name   string
		change func(*domain.Plan, *domain.LatestStart, *[]domain.SiteRateWindow, *float64)
	}{
		{"not opted in", func(p *domain.Plan, _ *domain.LatestStart, _ *[]domain.SiteRateWindow, _ *float64) {
			p.CompareSiteRates = false
		}},
		{"not enough time", func(_ *domain.Plan, e *domain.LatestStart, _ *[]domain.SiteRateWindow, _ *float64) {
			earliest := now.Add(4 * time.Minute)
			e.EarliestSafeStartAt = &earliest
		}},
		{"insufficient rate coverage", func(_ *domain.Plan, _ *domain.LatestStart, w *[]domain.SiteRateWindow, _ *float64) {
			end := now.Add(time.Hour)
			(*w)[0].EffectiveTo = &end
		}},
		{"mixed currencies", func(_ *domain.Plan, _ *domain.LatestStart, w *[]domain.SiteRateWindow, _ *float64) {
			(*w)[1].Currency = "EUR"
		}},
		{"overlapping windows", func(_ *domain.Plan, _ *domain.LatestStart, w *[]domain.SiteRateWindow, _ *float64) {
			(*w)[1].EffectiveFrom = now.Add(2 * time.Hour)
		}},
		{"invalid rate", func(_ *domain.Plan, _ *domain.LatestStart, w *[]domain.SiteRateWindow, _ *float64) {
			(*w)[1].RatePerWh = "not-a-price"
		}},
		{"small absolute saving", func(_ *domain.Plan, _ *domain.LatestStart, w *[]domain.SiteRateWindow, _ *float64) {
			(*w)[1].RatePerWh = "0.0003600000"
		}},
		{"small relative saving", func(_ *domain.Plan, _ *domain.LatestStart, w *[]domain.SiteRateWindow, _ *float64) {
			(*w)[0].RatePerWh = "0.0008000000"
			(*w)[1].RatePerWh = "0.0007400000"
		}},
		{"too many windows", func(_ *domain.Plan, _ *domain.LatestStart, w *[]domain.SiteRateWindow, _ *float64) {
			*w = make([]domain.SiteRateWindow, maxSiteRateWindows+1)
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plan, values, windows := rateComparisonFixture(now)
			estimate := EstimateLatestStart(plan, values, now, func(float64, float64) bool { return true })
			capacity := 80000.0
			test.change(&plan, &estimate, &windows, &capacity)
			if got := estimateSiteRateComparison(plan, estimate, capacity, windows, now); got != nil {
				t.Fatalf("unexpected comparison: %+v", got)
			}
		})
	}
}

func TestLatestStartsOnlyReadsRatesWithConsentAndRechecksChanges(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan, values, windows := rateComparisonFixture(now)
	repo := &stubRepository{activePlans: []domain.Plan{plan}, rateWindows: windows}
	live := &stubLive{values: values}
	service := New(repo, live, &stubSites{inside: true}, WithClock(func() time.Time { return now }))

	other, err := service.LatestStarts(context.Background(), "subject-b", plan.VehicleID)
	if err != nil || len(other) != 0 || live.reads != 0 || repo.rateReads != 0 {
		t.Fatalf("foreign subject = %+v, live reads %d, rate reads %d, error %v",
			other, live.reads, repo.rateReads, err)
	}
	repo.activePlans[0].CompareSiteRates = false
	withoutConsent, err := service.LatestStarts(context.Background(), "subject-a", plan.VehicleID)
	if err != nil || len(withoutConsent) != 1 || withoutConsent[0].CostComparison != nil || repo.rateReads != 0 {
		t.Fatalf("without consent = %+v, rate reads %d, error %v", withoutConsent, repo.rateReads, err)
	}
	repo.activePlans[0].CompareSiteRates = true
	withConsent, err := service.LatestStarts(context.Background(), "subject-a", plan.VehicleID)
	if err != nil || len(withConsent) != 1 || withConsent[0].CostComparison == nil || repo.rateReads != 2 {
		t.Fatalf("with consent = %+v, rate reads %d, error %v", withConsent, repo.rateReads, err)
	}
	repo.rateReads = 0
	repo.onRateRead = func(count int) {
		if count == 2 {
			repo.rateWindows[1].RatePerWh = "0.0002000000"
		}
	}
	changed, err := service.LatestStarts(context.Background(), "subject-a", plan.VehicleID)
	if err != nil || len(changed) != 1 || changed[0].CostComparison != nil {
		t.Fatalf("changed rates = %+v, error %v", changed, err)
	}
	repo.rateReads = 0
	repo.onRateRead = func(count int) {
		if count == 1 {
			repo.revokeActive = true
		}
	}
	revoked, err := service.LatestStarts(context.Background(), "subject-a", plan.VehicleID)
	if err != nil || len(revoked) != 0 {
		t.Fatalf("revoked comparison = %+v, error %v", revoked, err)
	}
}

func TestLatestStartsPricesNowAfterTheTariffReadCrossesARateBoundary(t *testing.T) {
	start := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	now := start
	plan, values, windows := rateComparisonFixture(start)
	change := start.Add(30 * time.Second)
	windows[0].RatePerWh = "0.0240000000"
	windows[0].EffectiveTo = &change
	windows[1].EffectiveFrom = change
	repo := &stubRepository{activePlans: []domain.Plan{plan}, rateWindows: windows}
	service := New(repo, &stubLive{values: values}, &stubSites{inside: true}, WithClock(func() time.Time { return now }))

	before, err := service.LatestStarts(context.Background(), "subject-a", plan.VehicleID)
	if err != nil || len(before) != 1 || before[0].CostComparison == nil {
		t.Fatalf("expected a material saving before the rate change, got %+v, error %v", before, err)
	}

	repo.rateReads = 0
	repo.onRateRead = func(count int) {
		if count == 2 {
			now = change
		}
	}
	after, err := service.LatestStarts(context.Background(), "subject-a", plan.VehicleID)
	if err != nil || len(after) != 1 || after[0].Status != domain.LatestStartEstimate || after[0].CostComparison != nil {
		t.Fatalf("expected a fresh start estimate without obsolete savings, got %+v, error %v", after, err)
	}
}
