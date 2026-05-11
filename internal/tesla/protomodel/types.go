// Package protomodel hand-written type declarations.
//
// The hand-written contract this file owns is exactly three things:
// ValueKind, UnitKind, and SignalMeta. Everything else in the package
// — the Field enum constants, ParseField, the per-Field Signals slice,
// the SignalsByName / SignalsByEnum lookup maps, plus the future
// enum_parsers / datum_decoder _gen.go files — is produced by the
// codegen binary at cmd/protogen-tesla.
//
// The split exists so that the generator only has to emit data and
// the per-Field constants tied to the proto, never the structural
// types those data point at; that keeps the generator small and the
// generated diff easy to review when the vendored proto bumps.
package protomodel

// ValueKind classifies the underlying Go scalar / structural form of a
// telemetry signal's value. The codec uses ValueKind to decide which
// oneof variant to expect from a Tesla Fleet Telemetry Datum.Value, and
// the routing layer uses it to pick the correct typed writer
// (string/bool/int/float/double/enum/compound) without reflection.
//
// ValueKindUnknown is the zero value and exists only to make the
// uninitialised case explicit (i.e. an entry that the proto declared but
// the classifier left unannotated). Production SignalMeta entries MUST
// have a ValueKind != ValueKindUnknown.
//
// ValueKindCompound covers the nested message variants (LocationValue,
// Doors, TireLocation, Time). Compound values are always flattened to
// typed atomic children at the codec boundary per ADR-004; downstream
// consumers never observe a nested map shape.
//
// ValueKindInvalid mirrors the Tesla proto's `bool invalid = 10` oneof
// variant which the producer sets to mark a sample as not trustworthy.
// Decoders MUST drop ValueKindInvalid samples instead of substituting a
// default.
type ValueKind int

const (
	ValueKindUnknown ValueKind = iota
	ValueKindString
	ValueKindBool
	ValueKindInt32
	ValueKindInt64
	ValueKindFloat
	ValueKindDouble
	ValueKindEnum
	ValueKindCompound
	ValueKindTime
	ValueKindInvalid
)

// String returns the symbolic name of the ValueKind, e.g. "ValueKindFloat".
// Falls back to a numeric form for unknown values so logs are never
// silently truncated.
func (k ValueKind) String() string {
	switch k {
	case ValueKindUnknown:
		return "ValueKindUnknown"
	case ValueKindString:
		return "ValueKindString"
	case ValueKindBool:
		return "ValueKindBool"
	case ValueKindInt32:
		return "ValueKindInt32"
	case ValueKindInt64:
		return "ValueKindInt64"
	case ValueKindFloat:
		return "ValueKindFloat"
	case ValueKindDouble:
		return "ValueKindDouble"
	case ValueKindEnum:
		return "ValueKindEnum"
	case ValueKindCompound:
		return "ValueKindCompound"
	case ValueKindTime:
		return "ValueKindTime"
	case ValueKindInvalid:
		return "ValueKindInvalid"
	}
	return "ValueKind(unknown)"
}

// UnitKind classifies the physical quantity a signal carries, when it
// is expressed in user-facing units that depend on a Setting*Unit
// preference. Signals with UnitKindNone are either dimensionless (counts,
// ratios, raw counters) or are stored in a fixed canonical unit and never
// converted (e.g. internal voltage measurements).
//
// The unit-history layer (internal/tesla/unit_history) groups signals by
// UnitKind so a single SettingDistanceUnit/SettingTemperatureUnit/
// SettingTirePressureUnit/SettingChargeUnit transition can be applied to
// every signal of a given UnitKind in one pass at write time.
type UnitKind int

const (
	UnitKindNone UnitKind = iota
	UnitKindDistance
	UnitKindTemperature
	UnitKindPressure
	UnitKindCharge
)

// String returns the symbolic name of the UnitKind. Falls back to a
// numeric form for unknown values.
func (u UnitKind) String() string {
	switch u {
	case UnitKindNone:
		return "UnitKindNone"
	case UnitKindDistance:
		return "UnitKindDistance"
	case UnitKindTemperature:
		return "UnitKindTemperature"
	case UnitKindPressure:
		return "UnitKindPressure"
	case UnitKindCharge:
		return "UnitKindCharge"
	}
	return "UnitKind(unknown)"
}

// CompoundKind discriminates which compound message variant a
// ValueKindCompound signal carries. It is populated only when
// ValueKind == ValueKindCompound and is the codec's per-field MQTT
// dispatcher key: given just the field name, the JSON-body decoder
// uses CompoundKind to pick the right shape parser (object-with-
// latitude/longitude, object-with-DriverFront/etc., or wrapped JSON
// string for the legacy string-encoded compounds DoorState /
// ScheduledChargingStartTime / ScheduledDepartureTime). Without this,
// the per-field MQTT layer would have to either re-derive the type
// from a hand-maintained switch (the shortcut Rule 11 forbids) or
// shape-sniff every body, neither of which is acceptable.
//
// Mapping from the classifier tag (cmd/protogen-tesla/emit.go classify):
//   - compound:LocationValue         -> CompoundKindLocation
//   - compound:Doors                 -> CompoundKindDoors
//   - compound:TireLocation          -> CompoundKindTireLocation
//   - compound:Time                  -> CompoundKindTime
//
// CompoundKindNone is the zero value and matches every non-compound
// signal. ValueKind == ValueKindCompound implies CompoundKind != None;
// the codegen guard test in cmd/protogen-tesla/main_test.go enforces
// the implication in both directions.
type CompoundKind int

const (
	CompoundKindNone CompoundKind = iota
	CompoundKindLocation
	CompoundKindDoors
	CompoundKindTireLocation
	CompoundKindTime
)

// String returns the symbolic name of the CompoundKind.
func (c CompoundKind) String() string {
	switch c {
	case CompoundKindNone:
		return "CompoundKindNone"
	case CompoundKindLocation:
		return "CompoundKindLocation"
	case CompoundKindDoors:
		return "CompoundKindDoors"
	case CompoundKindTireLocation:
		return "CompoundKindTireLocation"
	case CompoundKindTime:
		return "CompoundKindTime"
	}
	return "CompoundKind(unknown)"
}

// SignalMeta is the static, vendor-neutral description of a single Tesla
// telemetry signal. Every Field declared in the vendored vehicle_data.proto
// has exactly one SignalMeta entry in the generated Signals slice.
//
// Field is the canonical proto field name (e.g. "VehicleSpeed"). It is
// intentionally a Go string rather than the typed Field constant so that
// the routing.yaml lookup, signal_log column, and SSE topic are all keyed
// by the same human-readable identifier without an enum round-trip.
//
// ProtoEnumNum is the proto3 enum number from `enum Field { ... }` and is
// the canonical wire-format identifier when the producer omits the
// symbolic name from a Datum (rare, but supported by the proto schema).
//
// Category is the routing bucket: charging, driving, climate, location,
// powertrain, vehicle_state, safety_security, media, config, prefs,
// setting_unit, or metadata. routing.yaml MUST resolve every Category to
// a concrete writer; an unrouted Category is a deployment error.
//
// EnumTypeName is the name of the typed Go enum (defined alongside the
// Value oneof in enum_parsers_gen.go) that the producer will emit for
// this signal. It is populated only when ValueKind == ValueKindEnum and
// is consumed by the per-enum decoder dispatcher in the codec layer.
//
// EnumStringPrefix is the longest common prefix shared by every value of
// the typed Go enum, computed by the codegen from the vendored proto.
// It is the prefix that the codec strips from a raw proto-cased value
// (e.g. "ShiftStateD".String() -> "D") to produce the canonical short
// form persisted by the rest of the pipeline. It is populated only when
// ValueKind == ValueKindEnum.
//
// EnumStringPrefix is the canonical SINGLE source of truth for the
// per-enum trim prefix; the per-Value-variant TrimPrefix calls in
// datum_decoder_gen.go MUST be derived from the same proto-side
// computation that populates this field. Per the Phase-41 codec
// canonical-string contract (Rule 11 in
// .github/instructions/tesla-pipeline.instructions.md) downstream code
// MUST NOT re-derive the prefix; it MUST consume EnumStringPrefix when
// it needs to trim a JSON-shaped enum value (the per-field MQTT path)
// or compare against canonical short strings.
//
// IsCompound is true for ValueKind == ValueKindCompound and exists as a
// convenience boolean so hot-path code can avoid a switch on ValueKind
// when the only thing it needs to know is "should I run the flattener?".
//
// IsSettingUnit is true for the four SettingDistanceUnit /
// SettingTemperatureUnit / SettingTirePressureUnit / SettingChargeUnit
// signals. The unit-history layer subscribes to changes on these
// specifically and uses them to retroactively tag every other signal of
// the matching UnitKind with the unit that was in effect at write time.
type SignalMeta struct {
	Field            string
	ProtoEnumNum     int32
	Category         string
	ValueKind        ValueKind
	EnumTypeName     string
	EnumStringPrefix string
	IsCompound       bool
	CompoundKind     CompoundKind
	UnitKind         UnitKind
	IsSettingUnit    bool
}
