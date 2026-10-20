package nl

// Conversion between canonical SI meters and the imperial mile, shared by
// every watch-context range projection so the envelope's display pair
// cannot drift between writers.
const metersPerMile = 1609.344

// ProjectRangeDisplay sets the envelope's pre-computed display-unit range
// pair (km + mi) from canonical SI meters. Dual-unit precedent (cToFPtr):
// small local models cannot reliably do fractional miles conversions, so
// the adapter emits both values pre-computed. A nil envelope is a no-op.
func ProjectRangeDisplay(env *WatchContextEnvelope, meters float64) {
	if env == nil {
		return
	}
	env.RangeKm = meters / 1000
	env.RangeMi = meters / metersPerMile
}
