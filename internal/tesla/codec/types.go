// Package codec is the wire-bytes <-> typed-Atomic boundary for the Tesla
// Fleet Telemetry pipeline. It owns proto.Unmarshal of Payload bytes,
// invokes protomodel.DecodeDatum on every entry, and FLATTENS the four
// compound message variants (Location, Doors, TireLocation, Time) plus
// the three JSON-shaped string_value compounds (DoorState,
// ScheduledChargingStartTime, ScheduledDepartureTime) into atomic
// per-child signals. Downstream consumers (router, normalize.Pipeline,
// signal.Store) NEVER observe a nested map shape — that contract is
// ADR-004 #4 and is enforced by the codec_test.go assertion that no
// Atomic.Value is one of the typed compound structs.
//
// The package surface is intentionally tiny: one type (Atomic) plus one
// function (Decode). Per-compound flatten helpers and the metric
// registrations are unexported. The codec is purely transformational —
// it never blocks on Redis, MQTT, or the database.
//
// Failure semantics (per ADR-004):
//   - proto.Unmarshal failure of the outer Payload: Decode returns the
//     error; the caller may surface it to MQTT for redelivery (the
//     "malformed bytes" case the architecture document explicitly cites).
//   - Per-Datum decode/flatten failures (ErrInvalid, ErrUnsetValue, JSON
//     parse errors, unhandled oneof variants): the offending Datum is
//     dropped and a labelled counter is bumped. The rest of the Payload
//     continues to flow. A producer bug on a single field MUST NOT cause
//     the whole batch to be redelivered — that would compound the bug.
package codec

import "time"

// Atomic is the codec's output row. Every entry has been flattened to a
// typed primitive by the time it leaves Decode; the Value field never
// contains a protomodel compound struct (Location, Doors, TireLocation,
// Time) or a typed compound (DoorState, ScheduledChargingStartTime,
// ScheduledDepartureTime). The reflective TestDecode_AtomicValuesAreFlat
// test in codec_test.go is the structural enforcement of that contract.
//
// Field is the canonical signal name used for routing.yaml lookups,
// signal_log writes, SSE topics, and signal.Store keys. For atomic
// (non-compound) fields it is the protomodel.SignalMeta.Field name (e.g.
// "VehicleSpeed"). For flattened compound fields it is the source field
// name with a child suffix appended (e.g. "Location" -> "LocationLatitude",
// "OriginLocation" -> "OriginLocationLatitude", "TpmsHardWarnings" ->
// "TpmsHardWarningsFrontLeft"). The flatten helpers are the only producers
// of these suffixed names; downstream code MUST treat them as opaque.
//
// Value holds one of: string, bool, int32, int64, float32, float64,
// time.Time, or a typed ftproto enum (e.g. ftproto.ShiftState). Callers
// are expected to type-switch on Value when they need the concrete type
// rather than reflecting at runtime.
//
// EmittedAt is the Payload-level CreatedAt timestamp converted to a Go
// time.Time via timestamppb.AsTime(); the codec deliberately does NOT
// substitute time.Now() so historical replays preserve the producer's
// clock. If the producer omitted CreatedAt, EmittedAt is the zero Time
// and the caller is responsible for either backfilling or dropping.
//
// VehicleID is the Payload-level Vin string (NOT the internal numeric
// vehicles.id). Callers that need the numeric id must look it up against
// the vehicles table; the codec layer is intentionally vendor-only.
type Atomic struct {
	Field     string
	Value     any
	EmittedAt time.Time
	VehicleID string
}
