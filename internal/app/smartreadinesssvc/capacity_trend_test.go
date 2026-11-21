package smartreadinesssvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

func TestMonthlyCapacityChangeRequiresComparableEvidenceAndPersistence(t *testing.T) {
	now := time.Date(2026, 11, 5, 6, 0, 0, 0, time.UTC)
	makeObservation := func(month time.Month, day int, id int64, capacityWh float64) domain.CapacityObservation {
		start := time.Date(2026, month, day, 2, 0, 0, 0, time.UTC)
		return domain.CapacityObservation{
			SessionID: id,
			First:     domain.CapacityEndpoint{At: start, BatteryPct: 30, PackAddedWh: .3 * capacityWh, ModuleMinC: 23, ModuleMaxC: 25, ChargeRateW: 7200},
			Last:      domain.CapacityEndpoint{At: start.Add(3 * time.Hour), BatteryPct: 70, PackAddedWh: .7 * capacityWh, ModuleMinC: 24, ModuleMaxC: 26, ChargeRateW: 7000},
		}
	}
	var observations []domain.CapacityObservation
	for i := range 8 {
		observations = append(observations, makeObservation(time.September, 2+i*3, int64(i+1), 75_000+float64(i%2)*500))
	}
	for i, day := range []int{2, 5, 9, 14, 17, 21, 25, 30} {
		observations = append(observations, makeObservation(time.October, day, int64(i+9), 69_000+float64(i%2)*500))
	}
	observations = append(observations, makeObservation(time.November, 1, 50, 93_000))
	digest, reason := EstimateMonthlyCapacityChange(observations, now)
	if digest == nil || reason != domain.CapacityTrendChanged || digest.BaselineDays != 8 || digest.RecentDays != 8 ||
		digest.Change.LowWh != -6500 || digest.Change.HighWh != -5500 ||
		digest.RecentTo.Day() != 1 || digest.RecentTo.Month() != time.November || digest.ObservedTo.Month() != time.October {
		t.Fatalf("want estimated -6500 to -5500 Wh over 8+8 comparable days, got %+v (%s)", digest, reason)
	}

	for _, test := range []struct {
		name   string
		change func([]domain.CapacityObservation)
		want   domain.CapacityTrendReason
	}{
		{"duplicate sessions in the second half", func(samples []domain.CapacityObservation) {
			samples[12].SessionID = samples[13].SessionID
		}, domain.CapacityTrendSparse},
		{"pack temperature is not comparable", func(samples []domain.CapacityObservation) {
			samples[12].Last.ModuleMaxC = 38
		}, domain.CapacityTrendSparse},
		{"temporary dip but late month recovered", func(samples []domain.CapacityObservation) {
			for i := 12; i < 16; i++ {
				samples[i].First.PackAddedWh, samples[i].Last.PackAddedWh = 22_500, 52_500
			}
		}, domain.CapacityTrendWithin},
		{"swing too small to estimate capacity", func(samples []domain.CapacityObservation) {
			samples[4].Last.BatteryPct = 40
		}, domain.CapacityTrendSparse},
	} {
		t.Run(test.name, func(t *testing.T) {
			changed := append([]domain.CapacityObservation(nil), observations...)
			test.change(changed)
			if got, reason := EstimateMonthlyCapacityChange(changed, now); got != nil || reason != test.want {
				t.Fatalf("want quiet reason %s, got %+v (%s)", test.want, got, reason)
			}
		})
	}
}
