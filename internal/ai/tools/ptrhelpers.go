// Package tools — ptr helpers shared across carved subpackages.
//
// These exported helpers were promoted to the parent tools package
// during R6.25 (drive_coaching → coaching/ carve). They were originally
// unexported in drive_coaching.go but speed_profile.go (still in parent)
// also depends on them, so a clean carve required hoisting them to the
// shared parent package as exported `tools.DerefFloat64Ptr` etc.
//
// Semantic contract preserved verbatim per ADR-015 §I12: the helpers
// return `any` so the JSON encoder emits literal `null` for nil
// aggregates rather than the type's zero value. CToFPtr converts
// Celsius → Fahrenheit at the JSON boundary so small LLMs receive
// pre-converted scalars without having to do the arithmetic.
package tools

// CToFPtr converts a *float64 Celsius reading to a Fahrenheit float64
// returned as `any`. nil in → nil out.
func CToFPtr(p *float64) any {
	if p == nil {
		return nil
	}
	return (*p)*9.0/5.0 + 32.0
}

// DerefFloat64Ptr returns the deref'd value or typed nil any so the
// JSON encoder emits `null` for nil aggregates instead of `0`.
func DerefFloat64Ptr(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

// DerefInt16Ptr mirrors [DerefFloat64Ptr] for *int16 (battery pct).
func DerefInt16Ptr(p *int16) any {
	if p == nil {
		return nil
	}
	return *p
}

// DerefStringPtr mirrors [DerefFloat64Ptr] for *string (ended_status).
// Empty strings stay empty (not collapsed to nil) so a future
// migration that allows empty-string sentinels keeps round-trip
// integrity.
func DerefStringPtr(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}
