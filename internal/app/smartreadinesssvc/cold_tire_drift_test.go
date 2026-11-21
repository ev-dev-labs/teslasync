package smartreadinesssvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

func TestColdTireDriftRequiresRepeatedComparableOneWheelChange(t *testing.T) {
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	makeReadings := func(drop []float64) []domain.ColdTireReading {
		common := []float64{270_000, 278_000, 274_000, 282_000, 276_000}
		base := now.Add(-9 * 24 * time.Hour)
		readings := make([]domain.ColdTireReading, len(common))
		for i, value := range common {
			readings[i] = domain.ColdTireReading{
				ObservedAt: base.Add(time.Duration(i) * 48 * time.Hour), AmbientC: 7 + float64(i%2),
				FrontLeftPa: value - drop[i], FrontRightPa: value, RearLeftPa: value - 9_000, RearRightPa: value - 8_000,
				ColdGaugeConfirmed: true,
			}
		}
		return readings
	}
	positive := []float64{0, 4_000, 9_000, 17_000, 23_000}
	result, reason := EvaluateColdTireDrift(makeReadings(positive), now)
	if result == nil || reason != domain.ColdTireDriftEligible || result.Corner != domain.TireFrontLeft ||
		result.Count != 5 || result.RelativeDropPa != 13_000 || result.LastGaugePressurePa != 253_000 {
		t.Fatalf("repeated front-left deviation was not isolated from a common-mode swing: %+v (%s)", result, reason)
	}

	for _, test := range []struct {
		name   string
		mutate func([]domain.ColdTireReading)
		drop   []float64
		want   domain.ColdTireDriftReason
	}{
		{name: "four tires move together", drop: []float64{0, 0, 0, 0, 0}, want: domain.ColdTireDriftNoRepeatedDrift},
		{name: "single step followed by stable values", drop: []float64{0, 0, 0, 22_000, 22_000}, want: domain.ColdTireDriftNoRepeatedDrift},
		{name: "top-up after a decrease", drop: []float64{0, 4_000, 9_000, 26_000, 16_000}, want: domain.ColdTireDriftNoRepeatedDrift},
		{name: "very different ambient temperature", mutate: func(rows []domain.ColdTireReading) { rows[2].AmbientC = 17 }, want: domain.ColdTireDriftInsufficientEvidence},
		{name: "duplicate reading time", mutate: func(rows []domain.ColdTireReading) { rows[2].ObservedAt = rows[1].ObservedAt }, want: domain.ColdTireDriftInsufficientEvidence},
		{name: "not measured cold", mutate: func(rows []domain.ColdTireReading) { rows[1].ColdGaugeConfirmed = false }, want: domain.ColdTireDriftInvalidReading},
		{name: "second wheel independently moves", mutate: func(rows []domain.ColdTireReading) {
			rows[len(rows)-1].RearRightPa -= 9_000
		}, want: domain.ColdTireDriftNoRepeatedDrift},
		{name: "no recent reading", mutate: func(rows []domain.ColdTireReading) {
			for i := range rows {
				rows[i].ObservedAt = rows[i].ObservedAt.Add(-72 * time.Hour)
			}
		}, want: domain.ColdTireDriftNoRecentReading},
	} {
		t.Run(test.name, func(t *testing.T) {
			drop := test.drop
			if drop == nil {
				drop = positive
			}
			readings := makeReadings(drop)
			if test.mutate != nil {
				test.mutate(readings)
			}
			if result, got := EvaluateColdTireDrift(readings, now); result != nil || got != test.want {
				t.Fatalf("unexpected result %+v (%s), want suppression %s", result, got, test.want)
			}
		})
	}
}
