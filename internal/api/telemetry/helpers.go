package telemetry

import (
	"fmt"
	"runtime/debug"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// toFloatOk coerces a telemetry signal value to a float64, reporting whether
// the conversion succeeded. Local copy of the package-api converter helper
// (the parent api package is not importable from this subpackage).
func toFloatOk(v interface{}) (float64, bool) {
	return signal.Float64(v)
}

// formatFloat renders a float without a trailing decimal when it is integral.
// Local copy of the package-api converter helper.
func formatFloat(v float64) string {
	if v == float64(int64(v)) {
		return fmt.Sprintf("%d", int64(v))
	}
	return fmt.Sprintf("%.6f", v)
}

// toString coerces a telemetry signal value to its string form, unwrapping
// {"value": X} envelopes and normalising nil-like sentinels to "". Local copy
// of the package-api converter helper.
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

// safeGo runs fn in a goroutine with panic recovery, counting recovered panics
// and logging the stack. Local copy of the package-api goroutine helper.
func safeGo(name string, fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				metrics.PanicsRecovered.WithLabelValues(name).Inc()
				log.Error().
					Interface("panic", r).
					Str("goroutine", name).
					Bytes("stack", debug.Stack()).
					Msg("recovered panic in background goroutine")
			}
		}()
		fn()
	}()
}
