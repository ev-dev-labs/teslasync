// Package tools contains pointer helpers shared by AI tool subpackages.
//
// These helpers return any so JSON encoding preserves nil measurements as
// literal null values instead of replacing them with numeric zero values.

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
