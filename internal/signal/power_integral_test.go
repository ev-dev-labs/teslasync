package signal

import (
	"math"
	"testing"
	"time"
)

func TestPowerIntegralClipsIntervalsPreservesSignedMeanAndUnknownGaps(t *testing.T) {
	start := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	point := func(seconds int, watts *float64) PowerSample {
		return PowerSample{Time: start.Add(time.Duration(seconds) * time.Second), PowerW: watts}
	}
	draw, regen, zero, invalid := 3600.0, -3600.0, 0.0, math.NaN()
	for _, tt := range []struct {
		name    string
		samples []PowerSample
		want    PowerIntegral
		meanW   float64
	}{
		{"constant seeded draw", []PowerSample{point(-10, &draw)}, PowerIntegral{DrawWh: 60, CoveredS: 60}, 3600},
		{"genuine net regeneration", []PowerSample{point(0, &regen)}, PowerIntegral{RegenWh: 60, CoveredS: 60}, -3600},
		{"null ends coverage, zero remains observed", []PowerSample{point(0, &draw), point(10, nil), point(30, &zero)}, PowerIntegral{DrawWh: 10, CoveredS: 40}, 900},
		{"invalid is not zero", []PowerSample{point(0, &draw), point(10, &invalid)}, PowerIntegral{DrawWh: 10, CoveredS: 10}, 3600},
		{"end event contributes no duration", []PowerSample{point(0, &zero), point(60, &draw)}, PowerIntegral{CoveredS: 60}, 0},
		{"duplicate timestamp uses latest state", []PowerSample{point(0, &draw), point(0, &regen)}, PowerIntegral{RegenWh: 60, CoveredS: 60}, -3600},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := IntegratePower(tt.samples, start, start.Add(time.Minute))
			if got != tt.want {
				t.Fatalf("integral = %+v, want %+v", got, tt.want)
			}
			if meanW, ok := got.MeanPowerW(); !ok || meanW != tt.meanW {
				t.Fatalf("signed mean = %g (%v), want %g", meanW, ok, tt.meanW)
			}
		})
	}
	if _, ok := (PowerIntegral{}).MeanPowerW(); ok {
		t.Fatal("missing history became measured zero")
	}
}
