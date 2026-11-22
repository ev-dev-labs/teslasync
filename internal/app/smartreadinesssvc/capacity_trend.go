package smartreadinesssvc

import (
	"cmp"
	"math"
	"slices"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

const (
	capacityBaselineDays = 8
	capacityHalfDays     = 4
	capacityMinSwingPct  = 20
	capacityMaxSamples   = 180
)

type capacitySample struct {
	domain.CapacityObservation
	wh float64
}

type capacityCohort struct {
	baseline, early, late []float64
	latest                time.Time
	sources               []domain.CapacityChargeWindow
}

func capacityMonthStart(at time.Time) time.Time {
	return time.Date(at.Year(), at.Month(), 1, 0, 0, 0, 0, at.Location())
}

func EstimateMonthlyCapacityChange(observations []domain.CapacityObservation, localNow time.Time) (*domain.CapacityTrendDigest, domain.CapacityTrendReason) {
	location := localNow.Location()
	end := capacityMonthStart(localNow)
	recent := end.AddDate(0, -1, 0)
	baseline := recent.AddDate(0, -1, 0)
	middle := recent.AddDate(0, 0, 15)
	if len(observations) > capacityMaxSamples {
		return nil, domain.CapacityTrendSparse
	}
	samples := make([]capacitySample, 0, len(observations))
	for _, observation := range observations {
		if observation.First.At.Before(baseline) || !observation.Last.At.Before(end) ||
			(observation.First.At.Before(recent) && !observation.Last.At.Before(recent)) {
			continue
		}
		if sample, ok := capacityEstimate(observation); ok {
			samples = append(samples, sample)
		}
	}
	slices.SortFunc(samples, func(a, b capacitySample) int {
		if order := a.Last.At.Compare(b.Last.At); order != 0 {
			return order
		}
		return cmp.Compare(a.SessionID, b.SessionID)
	})

	// Choose the best-covered cohort before looking at capacity change.
	var best capacityCohort
	for _, anchor := range samples {
		if !anchor.Last.At.Before(recent) {
			break
		}
		cohort := cohortForCapacityAnchor(samples, anchor, recent, middle, location)
		if len(cohort.baseline) < capacityBaselineDays || len(cohort.early) < capacityHalfDays || len(cohort.late) < capacityHalfDays {
			continue
		}
		if cohort.coverage() > best.coverage() {
			best = cohort
		}
	}
	if best.coverage() == 0 {
		return nil, domain.CapacityTrendSparse
	}
	priorRange := capacitySpread(best.baseline)
	early, late := capacitySpread(best.early), capacitySpread(best.late)
	cutoff := max(2500, (priorRange.LowWh+priorRange.HighWh)*0.02)
	up := early.LowWh-priorRange.HighWh >= cutoff && late.LowWh-priorRange.HighWh >= cutoff
	down := priorRange.LowWh-early.HighWh >= cutoff && priorRange.LowWh-late.HighWh >= cutoff
	if !up && !down {
		return nil, domain.CapacityTrendWithin
	}

	recentSamples := append(best.early, best.late...)
	currentRange := capacitySpread(recentSamples)
	return &domain.CapacityTrendDigest{
		BaselineFrom: baseline.UTC(), RecentFrom: recent.UTC(), RecentTo: end.UTC(), ObservedTo: best.latest.UTC(),
		Baseline: priorRange, Recent: currentRange, Change: domain.CapacityRange{
			LowWh: currentRange.LowWh - priorRange.HighWh, HighWh: currentRange.HighWh - priorRange.LowWh,
		},
		BaselineDays: len(best.baseline), RecentDays: len(recentSamples), Sources: best.sources,
	}, domain.CapacityTrendChanged
}

func (c capacityCohort) coverage() int {
	return min(len(c.baseline), len(c.early)*2, len(c.late)*2)
}

func cohortForCapacityAnchor(samples []capacitySample, anchor capacitySample, recent, middle time.Time, loc *time.Location) capacityCohort {
	var out capacityCohort
	sessions := make(map[int64]bool)
	days := make(map[string]bool)
	var lastEnd time.Time
	for _, sample := range samples {
		day := sample.Last.At.In(loc).Format(time.DateOnly)
		if sessions[sample.SessionID] || days[day] || sample.First.At.Before(lastEnd) ||
			!capacityComparable(sample.First, anchor.First) || !capacityComparable(sample.Last, anchor.Last) {
			continue
		}
		sessions[sample.SessionID], days[day] = true, true
		lastEnd = sample.Last.At
		out.sources = append(out.sources, domain.CapacityChargeWindow{SessionID: sample.SessionID, StartAt: sample.First.At, EndAt: sample.Last.At})
		switch {
		case sample.Last.At.Before(recent):
			out.baseline = append(out.baseline, sample.wh)
		case sample.Last.At.Before(middle):
			out.early = append(out.early, sample.wh)
		default:
			out.late = append(out.late, sample.wh)
		}
		out.latest = sample.Last.At
	}
	return out
}

func capacityEstimate(observation domain.CapacityObservation) (capacitySample, bool) {
	a, b := observation.First, observation.Last
	elapsed := b.At.Sub(a.At)
	swing := b.BatteryPct - a.BatteryPct
	if observation.SessionID <= 0 || elapsed < 20*time.Minute || elapsed > 10*time.Hour ||
		!validCapacityEndpoint(a) || !validCapacityEndpoint(b) || swing < capacityMinSwingPct ||
		math.Abs(a.ModuleMinC-b.ModuleMinC) > 5 || math.Abs(a.ModuleMaxC-b.ModuleMaxC) > 5 {
		return capacitySample{}, false
	}
	wh := (b.PackAddedWh - a.PackAddedWh) * 100 / swing
	if !finiteBetween(wh, 10_000, 1_000_000) {
		return capacitySample{}, false
	}
	return capacitySample{CapacityObservation: observation, wh: wh}, true
}

func validCapacityEndpoint(e domain.CapacityEndpoint) bool {
	return finiteBetween(e.BatteryPct, 15, 85) && finiteBetween(e.PackAddedWh, 0, 1_000_000) &&
		finiteBetween(e.ModuleMinC, 10, 40) && finiteBetween(e.ModuleMaxC, e.ModuleMinC, min(45, e.ModuleMinC+8)) &&
		finiteBetween(e.ChargeRateW, 750, 30_000)
}

func capacityComparable(left, right domain.CapacityEndpoint) bool {
	return math.Abs(left.BatteryPct-right.BatteryPct) <= 5 && math.Abs(left.ModuleMinC-right.ModuleMinC) <= 5 &&
		math.Abs(left.ModuleMaxC-right.ModuleMaxC) <= 5 && math.Abs(left.ChargeRateW-right.ChargeRateW) <= right.ChargeRateW*.25
}

func capacitySpread(values []float64) domain.CapacityRange {
	slices.Sort(values)
	return domain.CapacityRange{
		LowWh: values[(len(values)-1)/4], HighWh: values[(len(values)-1)*3/4],
	}
}
