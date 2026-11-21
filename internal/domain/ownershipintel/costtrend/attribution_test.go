package costtrend

import "testing"

func syntheticPeriod(distance float64, firstWh, secondWh float64, firstMinor, secondMinor int64) Period {
	return Period{DistanceM: &distance, Sessions: []Session{
		{SiteID: 1, Currency: "USD", CostMinor: &firstMinor, BilledEnergyWh: &firstWh},
		{SiteID: 1, Currency: "USD", CostMinor: &firstMinor, BilledEnergyWh: &firstWh},
		{SiteID: 2, Currency: "USD", CostMinor: &secondMinor, BilledEnergyWh: &secondWh},
		{SiteID: 2, Currency: "USD", CostMinor: &secondMinor, BilledEnergyWh: &secondWh},
	}}
}

func TestCompareSeparatesDistancePriceAndSiteMix(t *testing.T) {
	prior := syntheticPeriod(80_000, 10_000, 10_000, 100, 300)
	current := syntheticPeriod(160_000, 10_000, 30_000, 150, 1050)
	excluded := int64(200)
	current.Sessions = append(current.Sessions, Session{Currency: "USD", CostMinor: &excluded})
	result, reason := Compare(prior, current, "USD", 100)
	if reason != Published || result == nil {
		t.Fatalf("want two months of comparable evidence: %+v %s", result, reason)
	}
	if result.DistanceMinor != 1000 || result.SiteMixMinor != 300 || result.EffectivePriceMinor != 300 ||
		result.PurchaseIntensityMinor != 0 || result.UnattributedMinor != 200 {
		t.Fatalf("want distinct mean effects and excluded spend, got %+v", result)
	}
	if result.ComparableSites != 2 || result.Current.ComparedSessions != 4 ||
		result.Current.RecordedCosts != 5 || result.Current.ComparedSpendMinor != 2400 ||
		result.Current.RecordedSpendMinor != 2600 {
		t.Fatalf("want visible exclusions and comparable cohort, got %+v", result)
	}
	reversed, _ := Compare(current, prior, "USD", 100)
	if reversed == nil || reversed.DistanceMinor != -result.DistanceMinor ||
		reversed.SiteMixMinor != -result.SiteMixMinor || reversed.EffectivePriceMinor != -result.EffectivePriceMinor ||
		reversed.UnattributedMinor != -result.UnattributedMinor {
		t.Fatalf("reversing periods must reverse the attribution: %+v", reversed)
	}
}

func TestCompareSuppressesMissingEnergyMixedCurrencyAndSmallChanges(t *testing.T) {
	prior := syntheticPeriod(80_000, 10_000, 10_000, 100, 300)
	tests := []struct {
		name string
		edit func(*Period)
		want Reason
	}{
		{"near identical month", func(*Period) {}, BelowMaterialThreshold},
		{"foreign currency is not converted", func(p *Period) { p.Sessions[0].Currency = "JPY" }, InsufficientCoverage},
		{"missing metered energy is not estimated", func(p *Period) { p.Sessions[1].BilledEnergyWh = nil }, InsufficientCoverage},
		{"distance cannot be inferred from purchases", func(p *Period) { p.DistanceM = nil }, InsufficientCoverage},
		{"unpriced sessions count against coverage", func(p *Period) {
			p.Sessions = append(p.Sessions, Session{}, Session{})
		}, InsufficientCoverage},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			current := syntheticPeriod(80_000, 10_000, 10_000, 101, 300)
			tc.edit(&current)
			if result, got := Compare(prior, current, "USD", 100); result != nil || got != tc.want {
				t.Fatalf("want no digest (%s), got %+v %s", tc.want, result, got)
			}
		})
	}
}
