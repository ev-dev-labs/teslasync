package api

import (
	"fmt"
	"math"
	"strconv"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// toFloatOk parses a value to float64 and returns whether the signal was present.
// This distinguishes missing signals (ok=false) from actual zero values (ok=true, val=0).
//
// Phase-46 (signals-rewrite): this is now a thin wrapper around the
// canonical signal.Float64 converter. Any new conversion logic belongs
// in internal/signal/coerce.go so we keep ONE definition of "any → float64"
// across the entire codebase.
func toFloatOk(v interface{}) (float64, bool) {
	return signal.Float64(v)
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
