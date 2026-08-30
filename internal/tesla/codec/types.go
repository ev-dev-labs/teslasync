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

// IngestOrigin is the deliberately small vocabulary used to identify the
// transport boundary that accepted an Atomic. Keep this list aligned with the
// signal_log_ingest_origin_check constraint in migration 000234.
type IngestOrigin string

const (
	IngestOriginUnknown            IngestOrigin = "unknown"
	IngestOriginFleetTelemetryMQTT IngestOrigin = "fleet_telemetry_mqtt"
	IngestOriginFleetTelemetryHTTP IngestOrigin = "fleet_telemetry_http"
)

var validIngestOrigins = [...]IngestOrigin{
	IngestOriginUnknown,
	IngestOriginFleetTelemetryMQTT,
	IngestOriginFleetTelemetryHTTP,
}

// Valid reports whether origin is in the closed durable provenance
// vocabulary. Callers that have no boundary stamp must use unknown.
func (origin IngestOrigin) Valid() bool {
	for _, valid := range validIngestOrigins {
		if origin == valid {
			return true
		}
	}
	return false
}

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
// EmittedAt is the timestamp used for ordering and the signal_log primary
// key. It can be a producer timestamp or a transport-receipt fallback.
// SourceEmittedAt is the explicit evidence bit: it is non-nil only when
// EmittedAt came from a valid producer/source timestamp. A receipt fallback
// MUST leave SourceEmittedAt nil even though it becomes EmittedAt.
//
// VehicleID is the Payload-level Vin string (NOT the internal numeric
// vehicles.id). Callers that need the numeric id must look it up against
// the vehicles table; the codec layer is intentionally vendor-only.
type Atomic struct {
	Field           string
	Value           any
	EmittedAt       time.Time
	VehicleID       string
	IngestOrigin    IngestOrigin
	SourceEmittedAt *time.Time
	ReceivedAt      *time.Time
}

// StampTransport applies a transport-boundary attestation to final atomics.
// It preserves SourceEmittedAt, which is set only by the decoder when the
// wire payload contained a valid source timestamp. A zero receipt timestamp
// is represented as nil; this avoids inventing receipt evidence for callers
// that do not have a transport boundary.
//
// The caller owns atoms; stamping mutates that slice in place to avoid an
// allocation on every per-field MQTT message. Invalid or absent origins are
// made explicitly unknown.
func StampTransport(atoms []Atomic, origin IngestOrigin, receivedAt time.Time) []Atomic {
	if atoms == nil {
		return nil
	}
	if !origin.Valid() {
		origin = IngestOriginUnknown
	}
	var receipt *time.Time
	if !receivedAt.IsZero() {
		t := receivedAt.UTC().Round(0)
		receipt = &t
	}
	for i := range atoms {
		atoms[i].IngestOrigin = origin
		atoms[i].ReceivedAt = receipt
	}
	return atoms
}
