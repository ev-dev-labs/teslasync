package carbon

import (
	"math"
	"sort"
)

// ---------------------------------------------------------------------------
// Pure, unit-testable core. Nothing in this file touches the database, the
// clock, or the network — every function is a deterministic transform of its
// inputs, so the per-session CO2, the green-score, and the greenest-window
// selection are reproducible and independently testable (carbon_test.go).
// ---------------------------------------------------------------------------

const (
	// GasBaselineKgCO2PerKm is the distance-based CO2 footprint attributed to
	// an equivalent internal-combustion (gasoline) car, in kilograms of CO2
	// per kilometre driven. 0.192 kg/km (~192 g/km) is a deliberately
	// conservative real-world average for a mid-size petrol car including
	// well-to-wheel (fuel production + tailpipe) emissions — comparable to the
	// EPA average passenger-vehicle figure of ~404 g CO2/mile (≈251 g/km
	// tailpipe) net of the upstream/efficiency spread. It is the single,
	// documented constant behind the "CO2 saved vs a gas car" headline; a
	// future Settings key could make it user-editable per their prior vehicle.
	GasBaselineKgCO2PerKm = 0.192

	// hoursPerDay is the fixed span of the diurnal grid model (0..23).
	hoursPerDay = 24

	// GreenestWindowHours is the length of the recommended contiguous charging
	// window. Three hours comfortably covers a typical overnight/solar top-up
	// while staying inside a single low-intensity trough of the diurnal curve.
	GreenestWindowHours = 3

	// flatCurveGreenScore is returned by GreenScore when the curve is flat
	// (max == min): no hour is dirtier than any other, so any timing is
	// maximally green.
	flatCurveGreenScore = 100.0
)

// HourIntensity is one hour of the diurnal grid carbon-intensity curve.
// GCO2PerKWh is grams of CO2 attributed per kWh drawn during HourOfDay.
type HourIntensity struct {
	HourOfDay  int     `json:"hour_of_day"`
	GCO2PerKWh float64 `json:"g_co2_per_kwh"`
}

// clamp bounds v to [lo, hi].
func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// round1/round2 round to a fixed number of decimals so the JSON body carries a
// stable, display-ready numeric form (mirrors the tco / batterypassport
// rounding boundary).
func round1(v float64) float64 { return math.Round(v*10) / 10 }
func round2(v float64) float64 { return math.Round(v*100) / 100 }

// safeF guards against NaN/Inf which silently break json.Encode.
func safeF(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

// SessionCO2Kg attributes a CO2 footprint to a single charging session:
// energy drawn (kWh) times the grid intensity at the session's hour (gCO2/kWh),
// converted from grams to kilograms. Non-positive inputs yield 0 (no negative
// or phantom emissions). Pure.
func SessionCO2Kg(energyKwh, gCO2PerKWh float64) float64 {
	if energyKwh <= 0 || gCO2PerKWh <= 0 {
		return 0
	}
	return energyKwh * gCO2PerKWh / 1000.0
}

// GasEquivCO2Kg is the CO2 an equivalent gasoline car would have emitted over
// the same distance (km), using the documented GasBaselineKgCO2PerKm baseline.
// Non-positive distance yields 0. Pure.
func GasEquivCO2Kg(distanceKm float64) float64 {
	if distanceKm <= 0 {
		return 0
	}
	return distanceKm * GasBaselineKgCO2PerKm
}

// GreenScore maps a realized (energy-weighted) charging intensity onto a 0..100
// timing score relative to the theoretical greenest (minIntensity) and dirtiest
// (maxIntensity) hours of the curve:
//
//	score = (max - realized) / (max - min) * 100
//
//   - 100 ⇒ every kWh was drawn at the greenest hour (realized == min).
//   - 0   ⇒ every kWh was drawn at the dirtiest hour (realized == max).
//   - a flat curve (max == min) can't be gamed, so it scores 100.
//
// The result is clamped to [0, 100]. Pure and side-effect free — this is the
// documented scoring contract pinned by carbon_test.go.
func GreenScore(realizedIntensity, minIntensity, maxIntensity float64) float64 {
	span := maxIntensity - minIntensity
	if span <= 0 {
		return flatCurveGreenScore
	}
	return clamp((maxIntensity-realizedIntensity)/span*100, 0, 100)
}

// CurveStats reduces a curve to its min/max intensity and the (sorted) sets of
// hours that achieve each. Greenest hours == every hour at the minimum
// intensity; dirtiest == every hour at the maximum. An empty curve yields
// (0, 0) and non-nil empty hour slices so the JSON never carries null arrays.
// Pure.
func CurveStats(curve []HourIntensity) (minV, maxV float64, greenest, dirtiest []int) {
	greenest, dirtiest = []int{}, []int{}
	if len(curve) == 0 {
		return 0, 0, greenest, dirtiest
	}
	minV, maxV = curve[0].GCO2PerKWh, curve[0].GCO2PerKWh
	for _, h := range curve {
		if h.GCO2PerKWh < minV {
			minV = h.GCO2PerKWh
		}
		if h.GCO2PerKWh > maxV {
			maxV = h.GCO2PerKWh
		}
	}
	for _, h := range curve {
		if h.GCO2PerKWh == minV {
			greenest = append(greenest, h.HourOfDay)
		}
		if h.GCO2PerKWh == maxV {
			dirtiest = append(dirtiest, h.HourOfDay)
		}
	}
	sort.Ints(greenest)
	sort.Ints(dirtiest)
	return minV, maxV, greenest, dirtiest
}

// intensityLookup indexes a curve by hour for O(1) intensity lookups. Hours
// outside 0..23 are ignored. Pure.
func intensityLookup(curve []HourIntensity) map[int]float64 {
	m := make(map[int]float64, len(curve))
	for _, h := range curve {
		if h.HourOfDay >= 0 && h.HourOfDay < hoursPerDay {
			m[h.HourOfDay] = h.GCO2PerKWh
		}
	}
	return m
}

// EnergyWeightedIntensity returns the realized grid intensity a driver's
// charging actually incurred: sum(energy_h * intensity_h) / sum(energy_h) over
// the hours present in the intensity lookup. Hours with energy but no matching
// intensity are skipped (they can't be scored). Returns 0 when the total
// weighted energy is 0. Pure.
func EnergyWeightedIntensity(energyKwhByHour, lookup map[int]float64) float64 {
	var num, den float64
	for hour, energy := range energyKwhByHour {
		gi, ok := lookup[hour]
		if !ok || energy <= 0 {
			continue
		}
		num += energy * gi
		den += energy
	}
	if den <= 0 {
		return 0
	}
	return num / den
}

// GreenestWindow scans all 24 wrap-around start positions and returns the
// contiguous `length`-hour clock window with the lowest MEAN grid intensity.
// The window wraps past midnight (e.g. 23:00 → 02:00). Ties break toward the
// earliest start hour. It returns the start hour (inclusive, 0..23), the end
// hour (EXCLUSIVE, 0..23, wrapping), and the window's mean intensity.
//
// A window is only considered when every one of its hours is present in the
// curve, so a partially-populated curve never yields a spurious "greenest"
// window over missing hours. An empty curve or non-positive length yields
// (0, 0, 0). Pure.
func GreenestWindow(curve []HourIntensity, length int) (startHour, endHour int, avgIntensity float64) {
	lookup := intensityLookup(curve)
	if length <= 0 || len(lookup) == 0 {
		return 0, 0, 0
	}
	if length > hoursPerDay {
		length = hoursPerDay
	}
	best := math.Inf(1)
	bestStart := -1
	for start := 0; start < hoursPerDay; start++ {
		var sum float64
		complete := true
		for i := 0; i < length; i++ {
			gi, ok := lookup[(start+i)%hoursPerDay]
			if !ok {
				complete = false
				break
			}
			sum += gi
		}
		if !complete {
			continue
		}
		if avg := sum / float64(length); avg < best {
			best = avg
			bestStart = start
		}
	}
	if bestStart < 0 {
		return 0, 0, 0
	}
	return bestStart, (bestStart + length) % hoursPerDay, best
}

// PotentialSaving quantifies shifting ALL charging from the realized average
// intensity into the greenest window's average intensity, over the observed
// total energy:
//
//	saving_kg  = total_energy_kwh * (current_avg - greenest_avg) / 1000
//	saving_pct = (current_avg - greenest_avg) / current_avg * 100
//
// Both are clamped at 0 — if the driver already charges greener than the window
// average (or there is no energy), there is nothing to save. Pure.
func PotentialSaving(totalEnergyKwh, currentAvgIntensity, greenestAvgIntensity float64) (savingKg, savingPct float64) {
	delta := currentAvgIntensity - greenestAvgIntensity
	if delta <= 0 || totalEnergyKwh <= 0 {
		return 0, 0
	}
	savingKg = totalEnergyKwh * delta / 1000.0
	if currentAvgIntensity > 0 {
		savingPct = delta / currentAvgIntensity * 100
	}
	return savingKg, savingPct
}
