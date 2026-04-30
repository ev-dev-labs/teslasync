// Package telemetry contains pure helpers for transforming Tesla Fleet
// Telemetry payloads before they enter the storage and FSM pipeline.
//
// Helpers in this package must remain free of side effects (no DB, no
// network, no logging beyond errors) so they can be unit-tested in
// isolation and reused from both the HTTP ingest path and the MQTT
// subscriber path.
package telemetry

import (
	"encoding/json"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/enums"
)

// NamedValue is one (name, value) pair preserving Tesla emission order.
//
// Order matters for the FSM trackStateTransition step because the same
// batch can contain prior+new values for a state-machine signal; iterating
// in Tesla's emission order keeps state diffs deterministic. Using a slice
// instead of a map also avoids Go's randomized map iteration order, which
// previously caused flaky FSM behaviour.
type NamedValue struct {
	Name  string
	Value any
}

// NormalizeFleetUnits applies the unit/format conversions Tesla Fleet
// Telemetry payloads need before downstream processing.
//
// Raw values are stored AS-IS (no unit conversion) — conversion to display
// units happens in the frontend. Only format normalization is done here:
//
//   - Tesla enum strings are stripped of their type prefix (e.g.
//     "ChargeStateCharging" → "Charging") so dashboards and storage layers
//     deal with short, human-readable values.
//   - Compound TypeDoors / TypeTireLocation maps are flattened to JSON
//     strings because downstream consumers (signal_history,
//     vehicle_live_state, snapshot tables) expect scalar string values.
//   - Compound TypeTime maps {hour, minute, second} are flattened to
//     "HH:MM:SS" strings.
//
// The input slice is mutated in place and returned for chaining. The
// returned slice preserves the input order so the FSM and other ordered
// consumers see signals in Tesla emission order.
func NormalizeFleetUnits(raw []NamedValue) []NamedValue {
	for i := range raw {
		switch raw[i].Name {
		case "Gear":
			if parsed := enums.ParseGear(toStringValue(raw[i].Value)); parsed != "" {
				raw[i].Value = parsed
			}
		case "ForwardCollisionWarning":
			raw[i].Value = enums.ParseForwardCollisionWarning(toStringValue(raw[i].Value))
		case "LaneDepartureAvoidance":
			raw[i].Value = enums.ParseLaneDepartureAvoidance(toStringValue(raw[i].Value))
		case "SpeedLimitWarning":
			raw[i].Value = enums.ParseSpeedLimitWarning(toStringValue(raw[i].Value))
		case "CruiseFollowDistance":
			raw[i].Value = enums.ParseCruiseFollowDistance(toStringValue(raw[i].Value))
		case "SentryMode":
			raw[i].Value = enums.ParseSentryMode(toStringValue(raw[i].Value))
		case "CenterDisplay":
			raw[i].Value = enums.ParseCenterDisplay(toStringValue(raw[i].Value))
		case "BMSState":
			raw[i].Value = enums.ParseBMSState(toStringValue(raw[i].Value))
		case "ChargePort":
			raw[i].Value = enums.ParseChargePort(toStringValue(raw[i].Value))
		case "ChargePortLatch":
			raw[i].Value = enums.ParseChargePortLatch(toStringValue(raw[i].Value))
		case "ChargeState":
			raw[i].Value = enums.ParseChargeState(toStringValue(raw[i].Value))
		case "DetailedChargeState":
			raw[i].Value = enums.ParseDetailedChargeState(toStringValue(raw[i].Value))
		case "ScheduledChargingMode":
			raw[i].Value = enums.ParseScheduledChargingMode(toStringValue(raw[i].Value))
		case "CabinOverheatProtectionMode":
			raw[i].Value = enums.ParseCabinOverheatMode(toStringValue(raw[i].Value))
		case "ClimateKeeperMode":
			raw[i].Value = enums.ParseClimateKeeperMode(toStringValue(raw[i].Value))
		case "LightsTurnSignal":
			raw[i].Value = enums.ParseTurnSignal(toStringValue(raw[i].Value))
		case "TonneauPosition":
			raw[i].Value = enums.ParseTonneauPosition(toStringValue(raw[i].Value))
		case "TonneauTentMode":
			raw[i].Value = enums.ParseTonneauTentMode(toStringValue(raw[i].Value))
		case "DefrostMode":
			raw[i].Value = enums.ParseDefrostMode(toStringValue(raw[i].Value))
		case "HvacAutoMode":
			raw[i].Value = enums.ParseHvacAutoMode(toStringValue(raw[i].Value))
		case "FdWindow", "FpWindow", "RdWindow", "RpWindow":
			raw[i].Value = enums.ParseWindowState(toStringValue(raw[i].Value))
		case "PowershareStatus":
			raw[i].Value = enums.ParsePowershareStatus(toStringValue(raw[i].Value))
		case "PowershareStopReason":
			raw[i].Value = enums.ParsePowershareStopReason(toStringValue(raw[i].Value))
		case "PowershareType":
			raw[i].Value = enums.ParsePowershareType(toStringValue(raw[i].Value))
		}

		// Compound flattening for registry-typed signals. Done in the same
		// pass so each NamedValue is visited exactly once.
		info, ok := enums.SignalRegistry[raw[i].Name]
		if !ok {
			continue
		}
		switch info.Type {
		case enums.TypeDoors, enums.TypeTireLocation:
			raw[i].Value = flattenCompoundMap(raw[i].Value)
		case enums.TypeTime:
			raw[i].Value = flattenCompoundTime(raw[i].Value)
		}
	}
	return raw
}

// flattenCompoundMap flattens a compound {DriverFront, ...} or
// {FrontLeft, ...} map into a JSON string. Returns the input unchanged
// when it is already a string or has an unsupported shape.
func flattenCompoundMap(v any) any {
	if v == nil {
		return v
	}
	if _, ok := v.(string); ok {
		return v
	}
	m, ok := v.(map[string]interface{})
	if !ok {
		return v
	}
	// Unwrap {"value": {...}} envelopes first.
	if inner, has := m["value"]; has {
		if innerMap, ok := inner.(map[string]interface{}); ok {
			m = innerMap
		} else if s, ok := inner.(string); ok {
			return s
		}
	}
	if jsonBytes, err := json.Marshal(m); err == nil {
		return string(jsonBytes)
	}
	return v
}

// flattenCompoundTime flattens a {hour, minute, second} compound into an
// "HH:MM:SS" string. Returns the input unchanged for malformed or
// out-of-range values rather than corrupting them to "00:00:00".
func flattenCompoundTime(v any) any {
	if v == nil {
		return v
	}
	if _, ok := v.(string); ok {
		return v
	}
	m, ok := v.(map[string]interface{})
	if !ok {
		return v
	}
	if inner, has := m["value"]; has {
		if innerMap, ok := inner.(map[string]interface{}); ok {
			m = innerMap
		} else if s, ok := inner.(string); ok {
			return s
		}
	}
	hour, hOk := extractTimeField(m, "hour")
	minute, mOk := extractTimeField(m, "minute")
	if !hOk || !mOk {
		return v
	}
	second, _ := extractTimeField(m, "second")
	if hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59 {
		return v
	}
	return fmt.Sprintf("%02d:%02d:%02d", hour, minute, second)
}

// extractTimeField extracts an integer time component from a compound time map.
func extractTimeField(m map[string]interface{}, key string) (int, bool) {
	v, ok := m[key]
	if !ok {
		return 0, false
	}
	switch val := v.(type) {
	case float64:
		return int(val), true
	case int:
		return val, true
	case int64:
		return int(val), true
	case json.Number:
		f, err := val.Float64()
		return int(f), err == nil
	}
	return 0, false
}

// toStringValue mirrors the conversion the api package uses for enum
// inputs. Kept local to avoid an import cycle with internal/api.
func toStringValue(v any) string {
	if v == nil {
		return ""
	}
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

// FromMap converts a map of signals into an ordered slice. Map iteration
// order is randomized in Go, so this is only useful when the caller does
// not rely on a specific order. Use this only as an adapter at the boundary
// between map-based legacy code and the slice-based normalize pipeline.
func FromMap(signals map[string]interface{}) []NamedValue {
	out := make([]NamedValue, 0, len(signals))
	for k, v := range signals {
		out = append(out, NamedValue{Name: k, Value: v})
	}
	return out
}

// WriteIntoMap copies the (name, value) pairs from nvs back into signals,
// overwriting any existing entries. This is the companion to FromMap and is
// only intended for boundary adaptation.
func WriteIntoMap(nvs []NamedValue, signals map[string]interface{}) {
	for _, nv := range nvs {
		signals[nv.Name] = nv.Value
	}
}
