package database

// SI conversion helpers and constants retained for charging_repo.go until
// Slice 2 of the Phase-48 SI canonical mega-PR migrates the Charging
// aggregate fields and drops the kWh / kW display-unit boundary on the
// charging code path. After Slice 2 ships, this entire file is deleted.

const (
	metersPerMile = 1609.344
	mpsPerMph     = 0.44704
	kiloUnit      = 1000.0 // W↔kW and Wh↔kWh share a 1000 factor
)

// wPtrToKwPtr converts a nullable Watts value to a nullable kW value.
func wPtrToKwPtr(p *float64) *float64 {
	if p == nil {
		return nil
	}
	v := *p / kiloUnit
	return &v
}

// whPtrToKwhPtr converts a nullable Watt-hours value to a nullable kWh value.
func whPtrToKwhPtr(p *float64) *float64 {
	if p == nil {
		return nil
	}
	v := *p / kiloUnit
	return &v
}

// coerceToFloat normalizes JSON-decoded numbers (always float64) and typed
// numeric inputs into a float64 for unit conversion math.
func coerceToFloat(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int16:
		return float64(x), true
	case int32:
		return float64(x), true
	case int64:
		return float64(x), true
	}
	return 0, false
}
