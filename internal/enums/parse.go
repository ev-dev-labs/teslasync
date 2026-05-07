// Package enums provides the canonical short-form enum string constants
// (in constants.go) and the small set of textual predicates that
// downstream consumers use to interpret them.
//
// Per the codec canonical-string contract (see protomodel.DecodeValue),
// proto enum variants reach signal.Store as canonical short strings —
// the codec is the SINGLE conversion point for proto-enum →
// internal-representation translation in the entire pipeline. This
// package is therefore intentionally small: it holds the canonical
// constant names that consumers compare against, plus a few permissive
// boolean helpers (ParseEnumBool, IsCharging, IsChargeComplete,
// ParseHvacPower) that survive across both codec input and the legacy
// Tesla Fleet API JSON poll path.
//
// New per-enum string parsers MUST NOT be added here. If you need a
// new enum to round-trip from the wire, extend
// cmd/protogen-tesla/emit.go's longestCommonPrefix mapping; the codec
// will then emit the canonical short form into the L1 store and
// callers can compare against constants in constants.go directly.
package enums

import "strings"

// ParseEnumBool converts a Tesla enum string/bool/number to boolean.
// Used by the legacy Tesla Fleet API JSON poll path
// (internal/service/vehicle_service.go,
// internal/automation/redis_state_provider.go) to coerce mixed-shape
// JSON values to a flag — these call sites have not yet migrated to
// the codec-fed signal.Store pathway.
func ParseEnumBool(raw interface{}) bool {
	switch v := raw.(type) {
	case bool:
		return v
	case string:
		return v != "" && !strings.Contains(v, "Off") && v != "false" && v != "0"
	case float64:
		return v != 0
	case int:
		return v != 0
	}
	return false
}
