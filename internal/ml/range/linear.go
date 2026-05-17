// Phase-50 / 0063 — ML2 Range-prediction model.
//
// linear.go ships the canonical heuristic Wh/km baseline used by:
//
//   - the deterministic RangeProjectionHandler at
//     internal/api/range_projection_handler.go (via the package-local
//     `defaultEfficiency` function in
//     internal/api/range_projection_handler_compute.go) when a
//     temp/speed bucket has no observed drives;
//   - the [Trainer] in trainer.go as the per-bucket fallback when
//     fewer than [DefaultMinSamplesPerBucket] drives exist for a
//     vehicle in the lookback window.
//
// Why this map lives here AND in internal/api:
//
//	The Phase-50 / 0063 slice's allowed-files list explicitly admits
//	`internal/ml/**` for ML-tier code AND forbids touching the
//	non-AI baseline at internal/api/range_projection_handler.go (and
//	its sibling _compute.go) beyond what this slice strictly requires.
//	Moving the canonical formula out of api would change the
//	deterministic handler's import surface (api would import
//	internal/ml/range), which is a wider architectural change than
//	this slice should make. The two-copy approach is contained: the
//	parity test at
//	internal/api/ai_ml_range_fallback_parity_test.go pins the two
//	formulas at representative bucket points, so a future divergence
//	is surfaced as a failing test rather than a silent learned-model
//	regression.
//
// Importing direction:
//
//	internal/api ── (compile-time) ──▶ internal/ml/range
//	                                       ▲
//	                                       └── internal/ai/tools
//
// The arrow only goes one way (api → ml/range, ai/tools → ml/range);
// internal/ml/range imports nothing project-local. This keeps
// ml/range safe to use from the AI tool layer without dragging the
// entire api package into the dependency graph of the eval harness
// or the dispatcher.
package mlrange

// TempBuckets is the canonical alphabetic list of temperature
// buckets the trainer iterates over. Mirrors
// internal/api/range_projection_handler_compute.go's
// `tempBucketFor` switch (the deterministic baseline that
// RangeProjectionHandler.buildScenarios uses).
//
// Order matters for golden tests + the AI tool's JSON envelope: the
// trainer emits buckets in (TempBucket, SpeedBucket) outer-product
// order, alphabetic on each axis.
var TempBuckets = []string{"cold", "freezing", "hot", "mild"}

// SpeedBuckets mirrors the canonical set used by
// internal/api/range_projection_handler_compute.go (the existing
// scenario projections in RangeProjectionHandler).
//
// Alphabetic order: city, highway, suburban.
var SpeedBuckets = []string{"city", "highway", "suburban"}

// TempBucketFor returns the canonical temperature bucket name for
// a temperature value in degrees Celsius. The thresholds match
// internal/api/range_projection_handler_compute.go's `tempBucketFor`
// byte-for-byte; the parity test pins the equivalence.
//
//	freezing: tempC < 0
//	cold:     0 <= tempC < 10
//	mild:     10 <= tempC < 25
//	hot:      tempC >= 25
func TempBucketFor(tempC float64) string {
	switch {
	case tempC < 0:
		return "freezing"
	case tempC < 10:
		return "cold"
	case tempC < 25:
		return "mild"
	default:
		return "hot"
	}
}

// SpeedBucketFor returns the canonical speed bucket name for a
// speed value in km/h:
//
//	city:     speedKmh < 50
//	suburban: 50 <= speedKmh < 90
//	highway:  speedKmh >= 90
//
// Note: the canonical Go `defaultEfficiency` uses miles-per-hour
// breakpoints (50/90 mph) which translate to ~80/144 km/h. The
// trainer normalises both to km/h here; the parity test pins the
// underlying Wh/km answer at each bucket so the formula divergence
// between the JS and Go fallbacks is documented and pinned rather
// than silently drifting.
func SpeedBucketFor(speedKmh float64) string {
	switch {
	case speedKmh < 50:
		return "city"
	case speedKmh < 90:
		return "suburban"
	default:
		return "highway"
	}
}

// HeuristicWhPerKm returns the canonical deterministic baseline
// Wh/km value for a (temp_bucket, speed_bucket) pair.
//
// The formula is byte-for-byte identical to
// internal/api/range_projection_handler_compute.go's
// `defaultEfficiency(tempC, speedKmh int)`:
//
//	base := 155.0  // mild city baseline
//	if speedKmh > 90  { base = 195 }
//	else if speedKmh > 50 { base = 170 }
//	if tempC < 0     { base *= 1.35 }
//	else if tempC < 10 { base *= 1.15 }
//	else if tempC > 35 { base *= 1.08 }
//
// We accept (tempBucket, speedBucket) here rather than raw
// (temp, speed) so the Trainer's per-bucket fallback path returns
// the SAME number regardless of where in the bucket the actual
// representative sample sits. The bucket -> representative-value
// mapping below pins each bucket to a fixed (temp, speed) pair so
// the heuristic is a pure function of bucket name (deterministic,
// goldens-pin-able):
//
//	temp:  freezing=-5°C, cold=5°C, mild=20°C, hot=30°C
//	speed: city=35km/h, suburban=70km/h, highway=110km/h
//
// The (temp=30, speed=110) "highway in hot weather" pair is hot=true
// so the legacy `tempC > 35` branch does NOT fire — that branch only
// matters above 35°C in the canonical Go formula. The parity test
// pins this explicitly so a future change to the API formula's >35°C
// branch is surfaced.
//
// Returns 0 (and the boolean ok=false) when the bucket pair is
// unknown — defence in depth so a future caller that passes an
// arbitrary string cannot silently get a "free" 155 Wh/km.
func HeuristicWhPerKm(tempBucket, speedBucket string) (float64, bool) {
	tempC, ok := representativeTempC(tempBucket)
	if !ok {
		return 0, false
	}
	speedKmh, ok := representativeSpeedKmh(speedBucket)
	if !ok {
		return 0, false
	}
	base := 155.0
	if speedKmh > 90 {
		base = 195
	} else if speedKmh > 50 {
		base = 170
	}
	switch {
	case tempC < 0:
		base *= 1.35
	case tempC < 10:
		base *= 1.15
	case tempC > 35:
		base *= 1.08
	}
	return base, true
}

// representativeTempC pins each temperature bucket name to a
// representative °C value in the middle of the bucket's range. The
// trainer uses these pinned values so the heuristic Wh/km is a pure
// function of bucket name (not of the actual sample mean) — this
// keeps the per-bucket fallback deterministic across vehicles and
// across calls.
func representativeTempC(tempBucket string) (float64, bool) {
	switch tempBucket {
	case "freezing":
		return -5, true
	case "cold":
		return 5, true
	case "mild":
		return 20, true
	case "hot":
		return 30, true
	}
	return 0, false
}

// representativeSpeedKmh pins each speed bucket name to a
// representative km/h value in the middle of the bucket's range.
// Same rationale as representativeTempC.
func representativeSpeedKmh(speedBucket string) (float64, bool) {
	switch speedBucket {
	case "city":
		return 35, true
	case "suburban":
		return 70, true
	case "highway":
		return 110, true
	}
	return 0, false
}
