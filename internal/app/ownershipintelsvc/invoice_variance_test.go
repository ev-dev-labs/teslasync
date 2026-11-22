package ownershipintelsvc

import (
	"testing"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
)

func TestInvoiceVarianceKeepsLossesRatesAndComponentsSeparate(t *testing.T) {
	line := domain.InvoiceLine{BilledEnergyWh: 24000, BilledEnergyMinor: 600, BilledIdleMinor: 100,
		BilledTaxMinor: 80, BilledTotalMinor: 810, AmountCoverage: domain.InvoiceAllAmountsKnown}
	evidence := &domain.InvoiceVarianceEvidence{
		BilledBoundary: domain.MeterBoundaryStation,
		Meter: &domain.InvoiceMeterEvidence{
			ObservedBoundary: domain.MeterBoundaryBattery, ObservedEnergyWh: 20000, MaxLossWh: pointer(2500.0)},
		Rate:           &domain.InvoiceRateEvidence{Boundary: domain.MeterBoundaryStation, AmountMinor: pointer[int64](18), EnergyWh: 1000},
		OtherFeesMinor: pointer(int64(30)),
	}
	line.VarianceEvidence = evidence
	got := assessInvoiceVariance(line, true, 100)
	if deref(got.UnexplainedEnergyWh) != 1500 || got.UnexplainedRateMinor == nil || *got.UnexplainedRateMinor != 168 ||
		got.UnexplainedTotalMinor != nil || got.ComponentsTotalMinor == nil || *got.ComponentsTotalMinor != line.BilledTotalMinor {
		t.Fatalf("want significant energy/rate gaps, with tax, idle and other fees fully accounted: %+v", got)
	}
	evidence.Meter.ObservedBoundary, evidence.BilledBoundary = domain.MeterBoundaryStation, domain.MeterBoundaryBattery
	evidence.Meter.ObservedEnergyWh = 22000
	line.BilledEnergyWh = 20000
	got = assessInvoiceVariance(line, true, 100)
	if got.UnexplainedEnergyWh != nil || got.ExpectedEnergyMinor != nil || deref(got.ExpectedEnergyLowerWh) != 19500 ||
		deref(got.ExpectedEnergyUpperWh) != 22000 {
		t.Fatalf("expected lower battery energy within known losses and no cross-boundary price claim: %+v", got)
	}
}

func TestInvoiceVarianceSuppressesMissingOrNonmaterialEvidence(t *testing.T) {
	line := domain.InvoiceLine{BilledEnergyWh: 22000, BilledEnergyMinor: 700, BilledIdleMinor: 100,
		BilledTaxMinor: 80, BilledTotalMinor: 1000, AmountCoverage: domain.InvoiceAllAmountsKnown}
	evidence := &domain.InvoiceVarianceEvidence{BilledBoundary: domain.MeterBoundaryStation,
		Meter: &domain.InvoiceMeterEvidence{ObservedBoundary: domain.MeterBoundaryBattery, ObservedEnergyWh: 19000}}
	line.VarianceEvidence = evidence
	if got := assessInvoiceVariance(line, true, 100); got.ExpectedEnergyLowerWh != nil ||
		got.ExpectedEnergyMinor != nil || got.ComponentsTotalMinor != nil {
		t.Fatalf("unknown losses, prices and fees must never be treated as zero: %+v", got)
	}
	evidence.OtherFeesMinor = pointer(int64(20))
	if got := assessInvoiceVariance(line, true, 100); got.UnexplainedTotalMinor == nil || *got.UnexplainedTotalMinor != 100 {
		t.Fatalf("explicit complete components should expose unexplained arithmetic: %+v", got)
	}
	evidence.Rate = &domain.InvoiceRateEvidence{Boundary: domain.MeterBoundaryStation, AmountMinor: pointer[int64](10), EnergyWh: 1000}
	if got := assessInvoiceVariance(line, false, 100); got.ExpectedEnergyMinor != nil ||
		got.ExpectedEnergyLowerWh != nil || got.UnexplainedTotalMinor == nil || *got.UnexplainedTotalMinor != 100 {
		t.Fatalf("unmatched sessions cannot support price or meter comparisons, but never erase complete arithmetic: %+v", got)
	}
	if got := assessInvoiceVariance(line, false, 101); got.UnexplainedTotalMinor != nil {
		t.Fatalf("small discrepancy should stay quiet: %+v", got)
	}
}
