package batterypassport

import (
	"crypto/sha256"
	"encoding/hex"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Pure, unit-testable core. Nothing in this file touches the database, the
// clock, or the network — every function is a deterministic transform of its
// inputs so the provenance hash, the health grade, and the recommendations
// are reproducible and independently testable.
// ---------------------------------------------------------------------------

// Thresholds and weights. Kept as named constants so the scoring is
// documented and a test can pin the exact boundaries.
const (
	// dcFastChargeThresholdW: charging above this instantaneous power is
	// treated as DC fast-charging (Superchargers / DC rapids). Mirrors the
	// established batterydegradation heuristic (peak_power_w > 50 kW).
	dcFastChargeThresholdW = 50000.0

	// Thermal bands (deg C) applied to a drive's average ambient temperature.
	thermalColdMaxC = 10.0
	thermalHotMinC  = 30.0

	// ratedFullCycles is the nominal cycle life a modern EV pack is designed
	// for; cycle wear penalty saturates here.
	ratedFullCycles = 1500.0

	// Grade-score penalty weights (points subtracted from SoH).
	fastChargePenaltyPts = 8.0
	cyclePenaltyPts      = 12.0

	// canonicalVersion namespaces the hash so a future change to the
	// serialization cannot silently collide with an old digest.
	canonicalVersion = "tsbp-v1"

	// gradeUnknown is returned when there is not enough SoH data to grade.
	gradeUnknown = "N/A"
)

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

// round1/round2/round4 round to a fixed number of decimals so the JSON body
// and the hashed facts share one canonical numeric form.
func round1(v float64) float64 { return math.Round(v*10) / 10 }
func round2(v float64) float64 { return math.Round(v*100) / 100 }
func round4(v float64) float64 { return math.Round(v*10000) / 10000 }

// GradeScore reduces the three durability signals to a single 0..100 score.
//
// SoH is the dominant term. Two documented penalties are subtracted:
//   - fast-charge penalty: up to fastChargePenaltyPts, scaling linearly with
//     the DC-fast-charge ratio (0..1). Sustained DC fast-charging accelerates
//     capacity fade, so a pack that has only ever fast-charged loses the full
//     penalty.
//   - cycle penalty: up to cyclePenaltyPts, scaling linearly with equivalent
//     full cycles up to ratedFullCycles, then saturating. A pack near its
//     rated cycle life carries the full penalty.
//
// The result is clamped to [0, 100]. Pure and side-effect free.
func GradeScore(sohPct, fastChargeRatio, equivalentFullCycles float64) float64 {
	soh := clamp(sohPct, 0, 100)
	fastPenalty := clamp(fastChargeRatio, 0, 1) * fastChargePenaltyPts
	cyclePenalty := clamp(equivalentFullCycles/ratedFullCycles, 0, 1) * cyclePenaltyPts
	return clamp(soh-fastPenalty-cyclePenalty, 0, 100)
}

// Grade maps GradeScore to a letter grade A..F using fixed 10-point bands.
// A pure function so the boundaries are testable in isolation.
func Grade(sohPct, fastChargeRatio, equivalentFullCycles float64) string {
	score := GradeScore(sohPct, fastChargeRatio, equivalentFullCycles)
	switch {
	case score >= 90:
		return "A"
	case score >= 80:
		return "B"
	case score >= 70:
		return "C"
	case score >= 60:
		return "D"
	case score >= 50:
		return "E"
	default:
		return "F"
	}
}

// MaskVIN reveals the manufacturer WMI (first three characters) and the last
// four characters of the VIN, masking the unique serial in between. A resale
// buyer can cross-reference the plant/region and the tail without the full
// identifier being exposed on a shareable certificate. VINs too short to
// safely reveal are fully masked.
func MaskVIN(vin string) string {
	v := strings.ToUpper(strings.TrimSpace(vin))
	n := len(v)
	if n == 0 {
		return ""
	}
	if n <= 7 {
		return strings.Repeat("*", n)
	}
	return v[:3] + strings.Repeat("*", n-7) + v[n-4:]
}

// ThermalExposureFrom converts drive counts per temperature band into
// percentages that sum to 100 (within rounding) when there is at least one
// temperature-carrying drive. With no data every band is 0.
func ThermalExposureFrom(cold, nominal, hot int64) ThermalExposure {
	total := cold + nominal + hot
	if total <= 0 {
		return ThermalExposure{}
	}
	tf := float64(total)
	return ThermalExposure{
		ColdPct:    round1(float64(cold) / tf * 100),
		NominalPct: round1(float64(nominal) / tf * 100),
		HotPct:     round1(float64(hot) / tf * 100),
	}
}

// EstimateOriginalCapacityWh returns the pack's nameplate energy in Wh from
// the VIN's model-year/trim code, falling back to model name then a 75 kWh
// default. A local copy of the batterydegradation helper (the carve playbook
// duplicates small stranded helpers rather than importing another handler).
func EstimateOriginalCapacityWh(vin, model string) float64 {
	if len(vin) >= 8 {
		switch vin[7] {
		case 'E', 'F':
			return 60000.0
		case 'K', 'L', 'M':
			return 75000.0
		case 'S', 'A', 'P':
			return 100000.0
		}
	}
	m := strings.ToLower(model)
	if strings.Contains(m, "model s") || strings.Contains(m, "model x") {
		return 100000.0
	}
	return 75000.0
}

// medianWh returns the median of a capacity-estimate sample. The median is
// used (rather than the mean or the single latest reading) so one noisy
// day — a partial charge, a mixed drive-and-charge day — cannot swing the
// headline SoH. Returns 0 for an empty sample.
func medianWh(samples []float64) float64 {
	if len(samples) == 0 {
		return 0
	}
	cp := make([]float64, len(samples))
	copy(cp, samples)
	sort.Float64s(cp)
	mid := len(cp) / 2
	if len(cp)%2 == 1 {
		return cp[mid]
	}
	return (cp[mid-1] + cp[mid]) / 2
}

// Recommendations derives buyer-facing guidance from the passport metrics.
// Deterministic and ordered by severity so the certificate reads
// consistently. Always returns a non-nil slice.
func Recommendations(sohPct, fastChargeRatio, avgChargeLimitPct, thermalHotPct, equivalentFullCycles float64) []string {
	recs := make([]string, 0, 5)

	if sohPct > 0 && sohPct < 80 {
		recs = append(recs, "State-of-Health has crossed the 80% warranty threshold; commission an independent battery inspection before resale.")
	}
	if fastChargeRatio > 0.5 {
		recs = append(recs, "DC fast-charging dominates this pack's history; favour AC charging where possible to slow capacity fade.")
	}
	if avgChargeLimitPct > 90 {
		recs = append(recs, "Average charge limit is high; capping daily charges near 80% reduces calendar aging.")
	}
	if thermalHotPct > 30 {
		recs = append(recs, "Frequent high-temperature operation detected; precondition and park in shade to limit thermal stress.")
	}
	if equivalentFullCycles > ratedFullCycles {
		recs = append(recs, "Equivalent full cycles exceed the pack's rated cycle life; factor expected end-of-life into valuation.")
	}
	if len(recs) == 0 {
		recs = append(recs, "Battery health and usage are within healthy bounds; maintain current charging habits.")
	}
	return recs
}

// PassportCoreFacts is the immutable subset of the passport that the
// provenance hash binds. IssuedAt is rounded to the day by the canonicalizer
// so repeated reads on the same day (with unchanged history) reproduce the
// same digest.
type PassportCoreFacts struct {
	VehicleID            int64
	FirstObservedAt      time.Time
	SohPct               float64
	CapacityKwh          float64
	EquivalentFullCycles float64
	FastChargeRatio      float64
	IssuedAt             time.Time
}

// dayUTC formats an instant as its UTC calendar day. A zero time yields the
// Go zero day ("0001-01-01"), which is still deterministic — a vehicle with
// no observed history hashes to a stable value.
func dayUTC(t time.Time) string {
	return t.UTC().Format("2006-01-02")
}

// f4 renders a float with fixed 4-decimal precision, normalizing -0 to 0 so
// the canonical form never depends on the sign bit of a zero.
func f4(v float64) string {
	if v == 0 {
		v = 0
	}
	return strconv.FormatFloat(v, 'f', 4, 64)
}

// CanonicalString serializes the core facts into a single deterministic,
// order-fixed line. Field order, separators, day-granularity timestamps, and
// fixed numeric precision are all pinned here so the same facts always
// produce the same bytes across processes and runs. Pure.
func CanonicalString(f PassportCoreFacts) string {
	parts := []string{
		canonicalVersion,
		"vehicle_id=" + strconv.FormatInt(f.VehicleID, 10),
		"first_observed_at=" + dayUTC(f.FirstObservedAt),
		"soh_pct=" + f4(f.SohPct),
		"capacity_kwh=" + f4(f.CapacityKwh),
		"equivalent_full_cycles=" + f4(f.EquivalentFullCycles),
		"fast_charge_ratio=" + f4(f.FastChargeRatio),
		"issued_at=" + dayUTC(f.IssuedAt),
	}
	return strings.Join(parts, "|")
}

// ProvenanceHash is the lowercase hex SHA-256 of the canonical serialization.
// Stable across runs for identical inputs; the sole binding between the
// human-readable certificate and its tamper-evidence check. Pure.
func ProvenanceHash(f PassportCoreFacts) string {
	sum := sha256.Sum256([]byte(CanonicalString(f)))
	return hex.EncodeToString(sum[:])
}
