package signal

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// Float64 is the SINGLE conversion point for any signal-derived value to
// a Go float64. It mirrors the codec value-kind surface
// (float64/float32 for Float5; int/int8/int16/int32/int64 plus the unsigned
// counterparts for Int3/Int4) PLUS the JSON-decode artifacts that surface
// when the same value is round-tripped through JSON or a generic transport
// (json.Number, numeric strings, bool 1/0).
//
// Returns ok=false for nil, unsupported types, and unparseable strings so
// callers can distinguish "missing or non-numeric" from a legitimate zero.
//
// CONTRACT — read this before adding a new numeric narrowing assertion:
//
//	NEW CALLERS MUST USE THIS HELPER. Do NOT write fresh
//	`v.Raw.(float64)` / `m["k"].(float64)` narrowings against signal-
//	derived values. The codec stores Float5 as float32 and Int3/Int4
//	as int32; a `.(float64)` assertion silently drops every such value.
//	Dashboard regressions have already come from this bug class; do not
//	reintroduce it.
//
// Legacy envelope shapes accepted (do not extend without proof of source):
//
//   - {"invalid": true}     → returns (0, false)
//   - {"value": <numeric>}  → unwraps and recurses
//
// These envelope shapes do NOT come from the in-process codec or from
// signal_log decode (both produce typed Go values directly). They are
// preserved here for compatibility with legacy webhook/MQTT envelope
// callers that route through the API converter.
func Float64(v any) (float64, bool) {
	if v == nil {
		return 0, false
	}
	if m, ok := v.(map[string]any); ok {
		if inv, ok := m["invalid"].(bool); ok && inv {
			return 0, false
		}
		inner, ok := m["value"]
		if !ok {
			return 0, false
		}
		v = inner
	}
	switch val := v.(type) {
	case float64:
		return val, true
	case float32:
		return float64(val), true
	case int:
		return float64(val), true
	case int8:
		return float64(val), true
	case int16:
		return float64(val), true
	case int32:
		return float64(val), true
	case int64:
		return float64(val), true
	case uint:
		return float64(val), true
	case uint8:
		return float64(val), true
	case uint16:
		return float64(val), true
	case uint32:
		return float64(val), true
	case uint64:
		return float64(val), true
	case json.Number:
		f, err := val.Float64()
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return 0, false
		}
		return f, true
	case string:
		s := strings.TrimSpace(val)
		switch s {
		case "", "<nil>", "nil", "null", "NaN":
			return 0, false
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return 0, false
		}
		return f, true
	case bool:
		// Legacy envelope compat only — do NOT introduce new bool→float
		// signal mappings. A boolean signal should be consumed via
		// signal.Store.GetBool, not coerced to 1/0.
		if val {
			return 1, true
		}
		return 0, true
	}
	return 0, false
}

// Float64Value is a thin nil-safe convenience wrapper around Float64 for
// callers that already hold a *signal.Value. Saves the .Raw indirection
// and explicit nil check at every call site (notably the
// service.BuildStateFromSignalStore projection layer).
func Float64Value(v *Value) (float64, bool) {
	if v == nil {
		return 0, false
	}
	return Float64(v.Raw)
}
