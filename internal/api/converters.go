package api

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
)

// toFloatOk parses a value to float64 and returns whether the signal was present.
// This distinguishes missing signals (ok=false) from actual zero values (ok=true, val=0).
func toFloatOk(v interface{}) (float64, bool) {
	if v == nil {
		return 0, false
	}
	// Handle map values: {"invalid": true} → skip, {"value": X} → unwrap
	if m, ok := v.(map[string]interface{}); ok {
		if inv, ok := m["invalid"]; ok {
			if b, ok := inv.(bool); ok && b {
				return 0, false
			}
		}
		if inner, ok := m["value"]; ok {
			v = inner
		} else {
			return 0, false
		}
	}
	switch val := v.(type) {
	case float64:
		return val, true
	case int:
		return float64(val), true
	case int64:
		return float64(val), true
	case json.Number:
		f, err := val.Float64()
		return f, err == nil
	case string:
		if val == "" || val == "<nil>" || val == "nil" || val == "null" {
			return 0, false
		}
		var f float64
		n, _ := fmt.Sscanf(val, "%f", &f)
		return f, n > 0
	case bool:
		if val {
			return 1, true
		}
		return 0, true
	}
	return 0, false
}

// safeFloat returns 0 if v is NaN or Inf, otherwise v.
func safeFloat(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

// formatFloat formats a float without trailing zeros.
func formatFloat(v float64) string {
	if v == float64(int64(v)) {
		return fmt.Sprintf("%d", int64(v))
	}
	return fmt.Sprintf("%.6f", v)
}

// toString converts an interface{} value to a string, unwrapping telemetry envelopes.
func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	// Unwrap {"value": X, ...} envelopes from wrapped telemetry payloads
	if m, ok := v.(map[string]interface{}); ok {
		if inner, has := m["value"]; has {
			v = inner
		} else {
			return ""
		}
	}
	switch val := v.(type) {
	case string:
		if val == "<nil>" || val == "nil" || val == "null" {
			return ""
		}
		return val
	case float64:
		return fmt.Sprintf("%v", val)
	case bool:
		if val {
			return "true"
		}
		return "false"
	default:
		s := fmt.Sprintf("%v", val)
		if s == "<nil>" || s == "nil" || s == "null" {
			return ""
		}
		return s
	}
}

// parseInt64 parses a string as a base-10 int64.
func parseInt64(s string) (int64, error) {
	return strconv.ParseInt(s, 10, 64)
}
