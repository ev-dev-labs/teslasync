package codec

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// jsonCoercionTotal counts successful per-field tolerant coercions in
// either the JSON or proto-batch decode path. Label cardinality is
// bounded by design: `field` is one of the four enumerated in
// canonicalizeFieldsJSON / canonicalizeFieldsProto and `from` is one of
// {"bool","string","number","other"}, so the time-series count is
// ~12 forever. A sustained non-zero rate per (field,from) pair signals
// that the Tesla wire shape has drifted and the declared ValueKind in
// classifyExplicit (cmd/protogen-tesla/emit.go) is stale.
//
// IMPORTANT: do NOT also increment jsonDecodeErrorsTotal when this
// counter fires. A successful coercion is schema drift, not a decode
// failure — conflating the two would force every drift event to also
// page the codec error-rate alert.
var jsonCoercionTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Subsystem: "codec",
	Name:      "json_coercion_total",
	Help:      "Per-field tolerant coercion events when the on-wire shape differs from the declared ValueKind (signals Tesla schema drift).",
}, []string{"field", "from"})

// canonicalizeFieldsJSON lists the fields whose JSON path delegates to
// decodeCanonicalJSONField INSTEAD OF the strict ValueKind switch in
// DecodeJSONField. These are exactly the fields whose declared kind
// in classifyExplicit (proto-derived) diverges from the JSON shape
// Tesla Fleet Telemetry actually emits over MQTT.
//
// Adding a field here is a deliberate decision: it weakens the strict
// schema contract for that one field in exchange for tolerance to a
// known wire-shape drift. This is preferable to either (a) changing
// classifyExplicit globally — which would break
// the proto-batch path on legacy firmware — or (b) widening DB schema
// to absorb the drift everywhere — which would lose useful type
// semantics on the BOOLEAN columns.
var canonicalizeFieldsJSON = map[string]bool{
	"DriverSeatBelt":    true,
	"PassengerSeatBelt": true,
	"GpsState":          true,
	"RearSeatHeaters":   true,
	// Same Enum→BOOLEAN / Float→TEXT pattern caught by
	// tmp/audit_signal_types/main.go before production drop.
	"HvacAutoMode":  true,
	"HvacPower":     true,
	"HvacFanStatus": true,
	// Paired with migration 000210_climate_overheat_limit_text.up.sql,
	// which converts the DB column from DOUBLE PRECISION (Celsius) to
	// TEXT (enum label). The codec cannot honestly map the proto enum
	// {Unknown, Low, Medium, High} to Celsius without asserting precision
	// Tesla does not publish; the migration lets the column hold the
	// label directly so we no longer need to invent values.
	"CabinOverheatProtectionTemperatureLimit": true,
}

// canonicalizeFieldsProto mirrors canonicalizeFieldsJSON for the
// proto-batch decode path. The set is identical today because the
// storage contract is path-agnostic (the writers see codec.Atomic.Value
// without knowing which path produced it), but kept as a separate
// variable so a future JSON-only or proto-only override is a one-line
// localised edit.
var canonicalizeFieldsProto = canonicalizeFieldsJSON

// canonicalizeFieldValue maps a decoded value to the storage-compatible
// type for the destination column. Input can come from either:
//
//   - the JSON path: json.Unmarshal(body, &any) produces bool, string,
//     or float64 (json's universal number type) for numeric bodies, or
//     map/slice for object/array (rejected by the per-field coercer).
//
//   - the proto-batch path: protomodel.DecodeDatum dispatches on the
//     proto Value oneof variant, producing string (StringValue or any
//     EnumValue.String() with TrimPrefix), bool (BooleanValue), float32
//     (FloatValue), float64 (DoubleValue), int32 (IntValue), or int64
//     (LongValue).
//
// Per-field coercion table:
//
//	DriverSeatBelt / PassengerSeatBelt (DB column: BOOLEAN)
//	  bool                                          -> bool (passthrough)
//	  "Latched"  | "BuckleStatusLatched"            -> true
//	  "Unlatched"| "BuckleStatusUnlatched"          -> false
//	  other string (e.g. "Faulted", "Unknown")      -> error → dropped
//	  any other type                                -> error → dropped
//
//	GpsState (DB column: TEXT)
//	  string                                        -> same string (passthrough)
//	  bool                                          -> strconv.FormatBool ("true"/"false")
//	  any other type                                -> error → dropped
//
//	RearSeatHeaters (DB column: TEXT)
//	  string                                        -> same string (passthrough)
//	  number (float32/float64/int32/int64/int)      -> canonical decimal string
//	  bool                                          -> strconv.FormatBool
//	  any other type                                -> error → dropped
//
//	CabinOverheatProtectionTemperatureLimit (DB column: TEXT post-000210)
//	  "Low" | "Medium" | "High"                     -> same string (passthrough)
//	  "ClimateOverheatProtectionTempLimit{Low|Medium|High}" -> trimmed bare label
//	  "Unknown" (any prefix)                        -> error → dropped
//	  number | bool                                 -> error → dropped
//
// Returns (canonicalValue, didCoerce, error). The boolean signals
// whether the metric counter should fire; passthrough (input already
// in storage-compatible form) returns false so the metric tracks
// drift, not normal traffic. Errors are NOT wrapped with ErrPayloadDrop
// here — the caller selects the appropriate error path: the JSON
// decoder wraps in ErrPayloadDrop so the message lands in the DLQ;
// the proto decoder increments invalidValuesTotal and skips the Datum
// (consistent with protomodel.ErrInvalid handling).
func canonicalizeFieldValue(field string, v any) (any, bool, error) {
	switch field {
	case "DriverSeatBelt", "PassengerSeatBelt":
		return coerceBuckleStatus(v)
	case "GpsState":
		return coerceGpsState(v)
	case "RearSeatHeaters":
		return coerceRearSeatHeaters(v)
	case "HvacAutoMode":
		return coerceHvacAutoMode(v)
	case "HvacPower":
		return coerceHvacPower(v)
	case "HvacFanStatus":
		return coerceHvacFanStatus(v)
	case "CabinOverheatProtectionTemperatureLimit":
		return coerceCabinOverheatProtectionTemperatureLimit(v)
	}
	return v, false, nil
}

// coerceBuckleStatus maps a wire value (bool from JSON or proto
// BooleanValue, OR string from proto BuckleStatusValue / a legacy
// JSON enum-string emitter) to a Go bool suitable for the BOOLEAN
// climate_snapshots.{driver,passenger}_seat_belt column.
//
// "BuckleStatus" prefix is tolerated because the proto-batch path's
// datum_decoder_gen.go applies strings.TrimPrefix before delivery,
// but a hand-built fixture or a future generator change might pass
// the prefixed form through; both shapes map to the same Go bool.
//
// Ambiguous BuckleStatus values ("Faulted", "Unknown", or any
// undocumented future variant) return an error rather than silently
// mapping to false. There is no boolean representation for "we don't
// know", and silently dropping to false would corrupt downstream
// "buckled-during-drive" safety analytics. The caller drops the
// datum + bumps a counter; the row simply does not get a column
// update for that timestamp.
func coerceBuckleStatus(v any) (any, bool, error) {
	switch t := v.(type) {
	case bool:
		return t, false, nil
	case string:
		s := strings.TrimPrefix(t, "BuckleStatus")
		switch s {
		case "Latched":
			return true, true, nil
		case "Unlatched":
			return false, true, nil
		}
		return nil, false, fmt.Errorf("seatbelt enum %q has no boolean mapping", t)
	}
	return nil, false, fmt.Errorf("seatbelt value type %T unsupported", v)
}

// coerceGpsState canonicalizes the GpsState wire shape into the TEXT
// column form. JSON wire is observed as bool on current Tesla firmware
// (true/false), legacy and proto-batch wire is string (e.g.
// "DR_GPS_NAV_LIMITED" or "GpsLocked"). Bool input maps to the literal
// strings "true" / "false" via strconv.FormatBool — deliberately NOT
// "GpsLocked" / "GpsUnknown", because there is insufficient evidence
// that Tesla's boolean actually maps to those semantic states, and
// inventing labels would be worse than raw truthy text for downstream
// analytics.
func coerceGpsState(v any) (any, bool, error) {
	switch t := v.(type) {
	case string:
		return t, false, nil
	case bool:
		return strconv.FormatBool(t), true, nil
	}
	return nil, false, fmt.Errorf("GpsState value type %T unsupported", v)
}

// coerceRearSeatHeaters canonicalizes the RearSeatHeaters wire shape
// into the TEXT column form. Tesla's emission has historically shifted
// (migration 000017 had VARCHAR, 000038 tried BOOLEAN then reverted
// via CASE WHEN TRUE THEN 'Present' ELSE 'None' END, 000183 settled
// on TEXT). Current JSON wire is string (e.g. "OFF", "Heating"); the
// declared classifyExplicit kind is Float, which causes the strict
// decoder to fail on every payload. Number/bool inputs are also
// tolerated so a future firmware flip doesn't re-introduce the drop.
//
// strconv.FormatFloat with -1 precision uses the shortest decimal
// representation that round-trips, so 2.0 → "2", 2.5 → "2.5", which
// gives stable, human-readable strings for the TEXT column without
// scientific notation.
func coerceRearSeatHeaters(v any) (any, bool, error) {
	switch t := v.(type) {
	case string:
		return t, false, nil
	case bool:
		return strconv.FormatBool(t), true, nil
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64), true, nil
	case float32:
		return strconv.FormatFloat(float64(t), 'f', -1, 32), true, nil
	case int32:
		return strconv.FormatInt(int64(t), 10), true, nil
	case int64:
		return strconv.FormatInt(t, 10), true, nil
	case int:
		return strconv.FormatInt(int64(t), 10), true, nil
	}
	return nil, false, fmt.Errorf("RearSeatHeaters value type %T unsupported", v)
}

// coerceHvacAutoMode maps the HvacAutoModeState proto enum
// {Unknown, On, Override} to the BOOLEAN hvac_auto_mode column.
//
// Semantic: the column answers "is HVAC auto-mode the active control
// mode RIGHT NOW?". `On` is yes; `Override` is no — the user has
// taken manual control over the auto-selected setpoint, so the
// auto-mode controller is no longer driving the cabin. `Unknown` has
// no boolean representation; silently downgrading to false would
// mis-record an actually-unknown state as confirmed "off".
func coerceHvacAutoMode(v any) (any, bool, error) {
	switch t := v.(type) {
	case bool:
		return t, false, nil
	case string:
		s := strings.TrimPrefix(t, "HvacAutoModeState")
		switch s {
		case "On":
			return true, true, nil
		case "Override":
			return false, true, nil
		}
		return nil, false, fmt.Errorf("HvacAutoMode enum %q has no boolean mapping", t)
	}
	return nil, false, fmt.Errorf("HvacAutoMode value type %T unsupported", v)
}

// coerceHvacPower maps the HvacPowerState proto enum
// {Unknown, Off, On, Precondition, OverheatProtect} to the BOOLEAN
// hvac_power column.
//
// Semantic: the column answers "is the HVAC subsystem POWERED /
// RUNNING right now?" (not "did the user request HVAC?"). All four
// active states (`On`, `Precondition`, `OverheatProtect`) draw power
// and move air; only `Off` is false. `Unknown` drops for the same
// reason as HvacAutoMode — we will not invent a boolean answer for
// a "we don't know" signal.
func coerceHvacPower(v any) (any, bool, error) {
	switch t := v.(type) {
	case bool:
		return t, false, nil
	case string:
		s := strings.TrimPrefix(t, "HvacPowerState")
		switch s {
		case "Off":
			return false, true, nil
		case "On", "Precondition", "OverheatProtect":
			return true, true, nil
		}
		return nil, false, fmt.Errorf("HvacPower enum %q has no boolean mapping", t)
	}
	return nil, false, fmt.Errorf("HvacPower value type %T unsupported", v)
}

// coerceHvacFanStatus normalises HvacFanStatus into the TEXT
// hvac_fan_status column. classifyExplicit declares this field as
// Float but the column is TEXT — same pattern as RearSeatHeaters,
// caught by tmp/audit_signal_types/main.go. Bool is intentionally
// NOT supported here: there is no observed
// Tesla wire shape that emits bool for HvacFanStatus, so adding a
// bool→string path would weaken the schema for no benefit.
func coerceHvacFanStatus(v any) (any, bool, error) {
	switch t := v.(type) {
	case string:
		return t, false, nil
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64), true, nil
	case float32:
		return strconv.FormatFloat(float64(t), 'f', -1, 32), true, nil
	case int32:
		return strconv.FormatInt(int64(t), 10), true, nil
	case int64:
		return strconv.FormatInt(t, 10), true, nil
	case int:
		return strconv.FormatInt(int64(t), 10), true, nil
	}
	return nil, false, fmt.Errorf("HvacFanStatus value type %T unsupported", v)
}

// coerceCabinOverheatProtectionTemperatureLimit maps the
// ClimateOverheatProtectionTempLimit proto enum {Unknown, High, Medium,
// Low} into the TEXT cabin_overheat_protection_temperature_limit column
// (renamed from `..._c DOUBLE PRECISION` by migration 000210).
//
// Mapping rules:
//
//   - string passthrough: trim the "ClimateOverheatProtectionTempLimit"
//     proto enum prefix so the stored value is the bare label
//     ("Low" / "Medium" / "High"). The proto-batch decoder already
//     applies this trim (datum_decoder_gen.go), but the JSON path may
//     deliver either shape so we accept both and normalise.
//
//   - "Unknown" (prefixed or bare) drops loudly. Same rule as
//     HvacAutoMode and HvacPower: "we don't know" is the absence of a
//     usable value, not a level — storing it would pollute "current
//     state" UIs forever.
//
//   - number wire (any int / float variant) drops. The pre-migration
//     codec model assumed Tesla emits a Celsius number; in practice it
//     never has on any observed firmware. If numbers ever appear in
//     production telemetry the operator will see them in the
//     jsonDecodeErrorsTotal counter and can revisit; do NOT stringify
//     them as "35", because the resulting TEXT column would then carry
//     two incompatible semantic domains (label vs unverified Celsius).
//
//   - bool drops. There is no observed Tesla wire shape.
//
// Storage contract after this coercer: TEXT column holds one of
// {"Low", "Medium", "High"}, or NULL when no payload ever landed.
func coerceCabinOverheatProtectionTemperatureLimit(v any) (any, bool, error) {
	switch t := v.(type) {
	case string:
		s := strings.TrimPrefix(t, "ClimateOverheatProtectionTempLimit")
		switch s {
		case "Low", "Medium", "High":
			// Coerced flag mirrors decode_json.go semantics: report
			// `coerced=true` only when the wire shape diverged from
			// the canonical storage form. The proto path emits the
			// trimmed bare label and we passthrough; the JSON path
			// may emit either, and we trim if needed.
			coerced := s != t
			return s, coerced, nil
		}
		return nil, false, fmt.Errorf("CabinOverheatProtectionTemperatureLimit enum %q has no storable mapping", t)
	}
	return nil, false, fmt.Errorf("CabinOverheatProtectionTemperatureLimit value type %T unsupported", v)
}

// decodeCanonicalJSONField is the JSON-path entry point for the four
// fields in canonicalizeFieldsJSON. It bypasses the strict ValueKind
// switch in DecodeJSONField and instead parses into a generic any so
// the wire body (bool OR string OR number) reaches canonicalizeFieldValue
// for per-field tolerant mapping.
//
// On parse failure: increments jsonDecodeErrorsTotal and wraps
// ErrPayloadDrop, matching the strict-path semantics so the DLQ
// routing in the MQTT subscriber treats malformed bodies uniformly.
//
// On unmappable canonical value (e.g. seatbelt "Faulted"): same.
// Coercion failures are real schema violations — the producer sent
// a value with no storage representation — and belong in the DLQ.
//
// On successful coercion: increments jsonCoercionTotal{field, from}
// so the operator can alert on sustained drift WITHOUT being woken
// up for transient single events.
//
// On successful passthrough (input shape already matches storage):
// no counter fires; this is the normal-traffic path.
func decodeCanonicalJSONField(field string, body []byte, ts time.Time, vin string) ([]Atomic, error) {
	var raw any
	if err := json.Unmarshal(body, &raw); err != nil {
		jsonDecodeErrorsTotal.WithLabelValues(field).Inc()
		return nil, fmt.Errorf("codec: field %q parse canonical: %v: %w", field, err, ErrPayloadDrop)
	}
	out, coerced, cerr := canonicalizeFieldValue(field, raw)
	if cerr != nil {
		jsonDecodeErrorsTotal.WithLabelValues(field).Inc()
		return nil, fmt.Errorf("codec: field %q canonicalize: %v: %w", field, cerr, ErrPayloadDrop)
	}
	if coerced {
		jsonCoercionTotal.WithLabelValues(field, coercionFromLabel(raw)).Inc()
	}
	return []Atomic{{Field: field, Value: out, EmittedAt: ts, VehicleID: vin}}, nil
}

// canonicalizeProtoFieldValue is the proto-batch path counterpart of
// decodeCanonicalJSONField. Invoked from decodePayload AFTER
// protomodel.DecodeDatum returns a value successfully. Returns the
// canonicalized value (always one of the storage-compatible types per
// the field's destination column) or an error if the proto wire-side
// value cannot be mapped — caller drops the Datum and bumps
// invalidValuesTotal (same channel as protomodel.ErrInvalid).
//
// Fields NOT in canonicalizeFieldsProto are passed through unchanged
// so this function is safe to invoke unconditionally.
func canonicalizeProtoFieldValue(field string, v any) (any, error) {
	if !canonicalizeFieldsProto[field] {
		return v, nil
	}
	out, coerced, err := canonicalizeFieldValue(field, v)
	if err != nil {
		return nil, err
	}
	if coerced {
		jsonCoercionTotal.WithLabelValues(field, coercionFromLabel(v)).Inc()
	}
	return out, nil
}

// coercionFromLabel maps a runtime Go value to a bounded label for the
// jsonCoercionTotal counter. The label set is deliberately tiny so a
// Prometheus alert on
//
//	sum by(field, from) (rate(teslasync_codec_json_coercion_total[5m])) > 0
//
// has stable cardinality regardless of the wire-shape variants Tesla
// emits over time.
func coercionFromLabel(v any) string {
	switch v.(type) {
	case bool:
		return "bool"
	case string:
		return "string"
	case float64, float32, int, int32, int64:
		return "number"
	}
	return "other"
}
