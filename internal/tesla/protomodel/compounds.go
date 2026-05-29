// Hand-written compound types for Tesla Fleet Telemetry Datum.Value variants
// and JSON-shaped string_value fields that the codec layer expands into
// these typed structs at the ingest boundary.
//
// This file is HAND-WRITTEN. The generated datum_decoder_gen.go references
// these types by name; the codec layer (internal/tesla/codec) flattens them
// into atomic per-child signals before the routing layer sees
// anything. Downstream consumers never observe nested map shapes (per ADR-004).
//
// Naming convention:
//   - Types backing a proto Value oneof message variant share a name with
//     the conceptual signal (Location, Doors, TireLocation, Time) rather
//     than the proto wire-name (LocationValue, etc.); the wire-name lives
//     only in the ftproto package.
//   - Types backing a JSON-encoded `string_value` field (DoorState,
//     ScheduledChargingStartTime, ScheduledDepartureTime) carry the field
//     name verbatim so the codec layer can dispatch on Datum.Key.
package protomodel

// Location is the typed compound for the location_value oneof variant
// (proto LocationValue, Field=Location). Latitude/Longitude are WGS84
// decimal degrees as emitted by the producer; no scaling is applied here.
// The codec layer flattens this into Latitude/Longitude atomic signals.
type Location struct {
	Latitude  float64
	Longitude float64
}

// Doors is the typed compound for the door_value oneof variant (proto Doors).
// Each field is true when that door is currently open. The codec layer
// flattens this into per-door boolean signals (DoorStateDriverFront, ...).
//
// Field set mirrors the proto Doors message exactly; the JSON-shaped
// DoorState field uses a slightly different naming (FrontTrunk vs TrunkFront)
// and is modelled by the separate DoorState type below.
type Doors struct {
	DriverFront    bool
	DriverRear     bool
	PassengerFront bool
	PassengerRear  bool
	TrunkFront     bool
	TrunkRear      bool
}

// TireLocation is the typed compound for the tire_location_value oneof
// variant (proto TireLocation). Each field is true when that wheel position
// is fitted/active for the current vehicle (cars use Front/Rear pairs;
// Semi tractors add the SemiMiddleAxle and SemiRearAxle pairs).
//
// The trailing "_2" suffix on SemiMiddleAxleLeft2/etc. matches the
// ftproto Get*_2 accessors which preserve the Tesla proto's underscore
// numbering; we drop the underscore for idiomatic Go field names.
type TireLocation struct {
	FrontLeft            bool
	FrontRight           bool
	RearLeft             bool
	RearRight            bool
	SemiMiddleAxleLeft2  bool
	SemiMiddleAxleRight2 bool
	SemiRearAxleLeft     bool
	SemiRearAxleRight    bool
	SemiRearAxleLeft2    bool
	SemiRearAxleRight2   bool
}

// Time is the typed compound for the time_value oneof variant (proto Time).
// Hour/Minute/Second carry the local-clock components from the vehicle. The
// codec layer flattens this to atomic int signals (Time_Hour, ...) when
// destined for routing or, for the Scheduled* fields, formats it as an
// "HH:MM:SS" string before persistence.
type Time struct {
	Hour   int32
	Minute int32
	Second int32
}

// DoorState is the typed compound for the JSON-shaped string_value emitted
// by the producer for the DoorState field (Field=58, Category=vehicle_state).
// Each field is true when that door is open. Note the field naming differs
// from the proto Doors message: DoorState uses FrontTrunk/RearTrunk while
// proto Doors uses TrunkFront/TrunkRear. This struct mirrors the wire JSON.
//
// Parsing of the JSON string into this struct happens in the codec package;
// this file only declares the contract.
type DoorState struct {
	DriverFront    bool
	DriverRear     bool
	PassengerFront bool
	PassengerRear  bool
	FrontTrunk     bool
	RearTrunk      bool
}

// ScheduledChargingStartTime is the typed compound for the JSON-shaped
// string_value emitted by the producer for the ScheduledChargingStartTime
// field (Field=44, Category=charging). Hour/Minute/Second is the local-clock
// time at which scheduled charging is set to begin; the codec layer formats
// it as "HH:MM:SS" before persistence.
type ScheduledChargingStartTime struct {
	Hour   int32
	Minute int32
	Second int32
}

// ScheduledDepartureTime is the typed compound for the JSON-shaped
// string_value emitted by the producer for the ScheduledDepartureTime field
// (Field=46, Category=charging). Hour/Minute/Second carry the same shape as
// ScheduledChargingStartTime — the codec layer treats both fields uniformly
// once parsed into the typed struct.
type ScheduledDepartureTime struct {
	Hour   int32
	Minute int32
	Second int32
}
