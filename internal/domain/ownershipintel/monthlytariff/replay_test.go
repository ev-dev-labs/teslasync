package monthlytariff

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
)

func testMonth(t *testing.T) (Month, domain.Tariff, domain.Tariff) {
	t.Helper()
	zone, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, 11, 1, 0, 0, 0, 0, zone)
	month := Month{From: from, Through: from.AddDate(0, 1, 0), Observed: 4}
	for i := range month.Observed {
		start := from.AddDate(0, 0, i).Add(30 * time.Minute)
		month.Metered = append(month.Metered, MeteredSession{Start: start, End: start.Add(3 * time.Hour), BilledWh: 8_000, BilledEnergyMinor: 500})
	}
	current := domain.Tariff{ID: 1, IsCurrent: true, Currency: "USD", Structure: domain.TariffFlat, StandingChargeMinorPerDay: 30,
		Rates: []domain.TariffRate{testBand(0, 1440, .0625)}}
	alternative := domain.Tariff{ID: 2, Currency: "USD", Structure: domain.TariffTOU, StandingChargeMinorPerDay: 40,
		Rates: []domain.TariffRate{testBand(0, 120, .03125), testBand(120, 1440, .015625)}}
	return month, current, alternative
}

func testBand(from, to int, price float64) domain.TariffRate {
	return domain.TariffRate{DayMask: 127, StartMinute: from, EndMinute: to, SeasonStartMonth: 1, SeasonEndMonth: 12, PriceMinorPerWh: price}
}

func TestReplayUsesObservedTimesAndDayBasedFixedChargesAcrossDST(t *testing.T) {
	month, current, alternative := testMonth(t)
	got, outcome := Replay(month, current, alternative, 200, 500)
	if outcome != MaterialSavings || got == nil {
		t.Fatalf("want cost comparison, got %v %s", got, outcome)
	}
	if got.Sessions != 4 || got.EnergyWh != 32_000 || got.Days != 30 ||
		got.CurrentFixedMinor != 900 || got.AltFixedMinor != 1200 || got.SwitchFeeMinor != 200 ||
		got.Current != (CostRange{2900, 2900}) || got.Alternative != (CostRange{1700, 2200}) ||
		got.NetSavings != (CostRange{500, 1000}) {
		t.Fatalf("want bounded as-run costs and fee-adjusted savings, got %+v", got)
	}
}

func TestReplayStaysQuietWhenTermsOrReadinessEvidenceDoNotSupportSavings(t *testing.T) {
	cases := []struct {
		name string
		edit func(*Month, *domain.Tariff)
		want Outcome
	}{
		{"unpriced time", func(_ *Month, plan *domain.Tariff) { plan.Rates[1].StartMinute++ }, UnsupportedTariff},
		{"overlapping time bands", func(_ *Month, plan *domain.Tariff) { plan.Rates[1].StartMinute-- }, UnsupportedTariff},
		{"unknown household demand", func(_ *Month, plan *domain.Tariff) { plan.DemandChargeMinorPerW = .001 }, UnsupportedTariff},
		{"different denominations", func(_ *Month, plan *domain.Tariff) { plan.Currency = "EUR" }, UnsupportedTariff},
		{"some charges lack receipts", func(m *Month, _ *domain.Tariff) { m.Observed++ }, InsufficientEvidence},
		{"current tariff cannot explain the receipt", func(m *Month, _ *domain.Tariff) { m.Metered[1].BilledEnergyMinor = 575 }, TermsDoNotMatch},
		{"an incomplete charge has no metered duration", func(m *Month, _ *domain.Tariff) { m.Metered[0].End = time.Time{} }, InsufficientEvidence},
		{"only cheaper if charging moves", func(_ *Month, plan *domain.Tariff) { plan.Rates[0].PriceMinorPerWh = .0625 }, BelowMinimum},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			month, current, alternative := testMonth(t)
			tc.edit(&month, &alternative)
			if got, outcome := Replay(month, current, alternative, 200, 500); got != nil || outcome != tc.want {
				t.Fatalf("want no comparison (%s), got %v %s", tc.want, got, outcome)
			}
		})
	}
}
