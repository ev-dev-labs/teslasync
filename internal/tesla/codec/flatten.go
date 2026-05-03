package codec

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

// flattenLocation expands a protomodel.Location compound into 2 atomics
// named {fieldName}Latitude / {fieldName}Longitude. Three SignalMeta
// entries (Location at 21, OriginLocation at 111, DestinationLocation at
// 112) all decode to a Location, and prefixing with the source field name
// is the only way to keep them distinguishable downstream — the bare
// "Latitude"/"Longitude" used by the legacy internal/telemetry/flatten.go
// would collide if all three were ever in the same payload.
func flattenLocation(loc protomodel.Location, fieldName string, emittedAt time.Time, vin string) []Atomic {
	return []Atomic{
		{Field: fieldName + "Latitude", Value: loc.Latitude, EmittedAt: emittedAt, VehicleID: vin},
		{Field: fieldName + "Longitude", Value: loc.Longitude, EmittedAt: emittedAt, VehicleID: vin},
	}
}

// flattenDoors expands a protomodel.Doors (proto Value_DoorValue variant)
// into 6 boolean atomics. NOTE: the protomodel.Doors struct uses the
// proto field names verbatim — {DriverFront, DriverRear, PassengerFront,
// PassengerRear, TrunkFront, TrunkRear} — which differ from the JSON
// shape (FrontTrunk/RearTrunk) used by flattenDoorStateJSON. We keep the
// proto names intact rather than aliasing them: the divergence is real,
// it is the upstream's design, and obscuring it in the codec would
// silently corrupt provenance for any downstream operator inspecting
// signal_log. As of vehicle_data.proto v0.9.0 NO Field key declares
// Value_DoorValue (the production DoorState field arrives as JSON), so
// this path is exercised only by tests today.
func flattenDoors(d protomodel.Doors, fieldName string, emittedAt time.Time, vin string) []Atomic {
	return []Atomic{
		{Field: fieldName + "DriverFront", Value: d.DriverFront, EmittedAt: emittedAt, VehicleID: vin},
		{Field: fieldName + "DriverRear", Value: d.DriverRear, EmittedAt: emittedAt, VehicleID: vin},
		{Field: fieldName + "PassengerFront", Value: d.PassengerFront, EmittedAt: emittedAt, VehicleID: vin},
		{Field: fieldName + "PassengerRear", Value: d.PassengerRear, EmittedAt: emittedAt, VehicleID: vin},
		{Field: fieldName + "TrunkFront", Value: d.TrunkFront, EmittedAt: emittedAt, VehicleID: vin},
		{Field: fieldName + "TrunkRear", Value: d.TrunkRear, EmittedAt: emittedAt, VehicleID: vin},
	}
}

// flattenTireLocation expands a protomodel.TireLocation (proto
// Value_TireLocationValue variant) into 10 boolean atomics covering the
// four passenger-car positions plus the six Semi-truck positions. The
// "_2" suffix on SemiMiddleAxleLeft2/SemiMiddleAxleRight2/etc. preserves
// the upstream proto's accessor naming (Get*_2) so a future operator
// cross-referencing signal_log against the Tesla schema can find the
// fields without renames. Two SignalMeta entries (TpmsHardWarnings,
// TpmsSoftWarnings) decode to a TireLocation today.
func flattenTireLocation(tl protomodel.TireLocation, fieldName string, emittedAt time.Time, vin string) []Atomic {
	return []Atomic{
		{Field: fieldName + "FrontLeft", Value: tl.FrontLeft, EmittedAt: emittedAt, VehicleID: vin},
		{Field: fieldName + "FrontRight", Value: tl.FrontRight, EmittedAt: emittedAt, VehicleID: vin},
		{Field: fieldName + "RearLeft", Value: tl.RearLeft, EmittedAt: emittedAt, VehicleID: vin},
		{Field: fieldName + "RearRight", Value: tl.RearRight, EmittedAt: emittedAt, VehicleID: vin},
		{Field: fieldName + "SemiMiddleAxleLeft2", Value: tl.SemiMiddleAxleLeft2, EmittedAt: emittedAt, VehicleID: vin},
		{Field: fieldName + "SemiMiddleAxleRight2", Value: tl.SemiMiddleAxleRight2, EmittedAt: emittedAt, VehicleID: vin},
		{Field: fieldName + "SemiRearAxleLeft", Value: tl.SemiRearAxleLeft, EmittedAt: emittedAt, VehicleID: vin},
		{Field: fieldName + "SemiRearAxleRight", Value: tl.SemiRearAxleRight, EmittedAt: emittedAt, VehicleID: vin},
		{Field: fieldName + "SemiRearAxleLeft2", Value: tl.SemiRearAxleLeft2, EmittedAt: emittedAt, VehicleID: vin},
		{Field: fieldName + "SemiRearAxleRight2", Value: tl.SemiRearAxleRight2, EmittedAt: emittedAt, VehicleID: vin},
	}
}

// flattenTime expands a protomodel.Time (proto Value_TimeValue variant)
// into a single time.Time atomic anchored to the EmittedAt date in UTC.
// The producer's Time message carries a wall-clock time-of-day with no
// date component; we anchor to EmittedAt's calendar date so downstream
// charts that bucket by day get a stable timestamp. Hour/Minute/Second
// out-of-range values (e.g. Hour=25) are clamped at the time.Date
// normalization boundary — Go's time.Date wraps overflowing components
// rather than panicking, which is the desired "best effort" behaviour
// for telemetry that the downstream router will inspect anyway.
//
// As of vehicle_data.proto v0.9.0 NO Field key declares Value_TimeValue
// (ScheduledCharging/Departure times arrive as JSON), so this path is
// exercised only by tests today.
func flattenTime(t protomodel.Time, fieldName string, emittedAt time.Time, vin string) []Atomic {
	return []Atomic{
		{Field: fieldName, Value: clockTimeOnDate(t.Hour, t.Minute, t.Second, emittedAt), EmittedAt: emittedAt, VehicleID: vin},
	}
}

// flattenDoorStateJSON parses the JSON-shaped string_value emitted for
// the DoorState field (Field=58) and expands it into 6 boolean atomics.
// The JSON shape uses {DriverFront, DriverRear, PassengerFront,
// PassengerRear, FrontTrunk, RearTrunk} — note the FrontTrunk/RearTrunk
// ordering differs from the proto Doors message (TrunkFront/TrunkRear);
// see flattenDoors for the rationale we preserve the divergence.
//
// Returns an error on JSON parse failure; the caller (decodePayload)
// drops the failing Datum and bumps the per-field error counter rather
// than aborting the whole Payload. Per ADR-004, only the outer
// proto.Unmarshal failure of the Payload is propagated to MQTT.
func flattenDoorStateJSON(payload string, emittedAt time.Time, vin string) ([]Atomic, error) {
	var ds protomodel.DoorState
	if err := json.Unmarshal([]byte(payload), &ds); err != nil {
		return nil, fmt.Errorf("DoorState: parse JSON %q: %w", payload, err)
	}
	return []Atomic{
		{Field: "DoorStateDriverFront", Value: ds.DriverFront, EmittedAt: emittedAt, VehicleID: vin},
		{Field: "DoorStateDriverRear", Value: ds.DriverRear, EmittedAt: emittedAt, VehicleID: vin},
		{Field: "DoorStatePassengerFront", Value: ds.PassengerFront, EmittedAt: emittedAt, VehicleID: vin},
		{Field: "DoorStatePassengerRear", Value: ds.PassengerRear, EmittedAt: emittedAt, VehicleID: vin},
		{Field: "DoorStateFrontTrunk", Value: ds.FrontTrunk, EmittedAt: emittedAt, VehicleID: vin},
		{Field: "DoorStateRearTrunk", Value: ds.RearTrunk, EmittedAt: emittedAt, VehicleID: vin},
	}, nil
}

// flattenScheduledChargingStartTimeJSON parses the JSON-shaped
// string_value emitted for the ScheduledChargingStartTime field
// (Field=44) and emits a single time.Time atomic anchored to EmittedAt's
// UTC calendar date. The producer's payload carries only Hour/Minute/
// Second; the date anchor is a downstream rendering convenience and is
// NOT a claim about the actual scheduled execution date.
func flattenScheduledChargingStartTimeJSON(payload string, emittedAt time.Time, vin string) ([]Atomic, error) {
	var s protomodel.ScheduledChargingStartTime
	if err := json.Unmarshal([]byte(payload), &s); err != nil {
		return nil, fmt.Errorf("ScheduledChargingStartTime: parse JSON %q: %w", payload, err)
	}
	return []Atomic{
		{Field: "ScheduledChargingStartTime", Value: clockTimeOnDate(s.Hour, s.Minute, s.Second, emittedAt), EmittedAt: emittedAt, VehicleID: vin},
	}, nil
}

// flattenScheduledDepartureTimeJSON mirrors flattenScheduledChargingStartTimeJSON
// for the ScheduledDepartureTime field (Field=46). The two compounds share
// the same Hour/Minute/Second JSON shape but are distinct typed structs in
// protomodel/compounds.go to keep the codec dispatch unambiguous.
func flattenScheduledDepartureTimeJSON(payload string, emittedAt time.Time, vin string) ([]Atomic, error) {
	var s protomodel.ScheduledDepartureTime
	if err := json.Unmarshal([]byte(payload), &s); err != nil {
		return nil, fmt.Errorf("ScheduledDepartureTime: parse JSON %q: %w", payload, err)
	}
	return []Atomic{
		{Field: "ScheduledDepartureTime", Value: clockTimeOnDate(s.Hour, s.Minute, s.Second, emittedAt), EmittedAt: emittedAt, VehicleID: vin},
	}, nil
}

// clockTimeOnDate constructs a time.Time at h:m:s on the same UTC
// calendar date as anchor. If anchor is the zero Time we fall back to
// 0000-01-01T00:00:00Z so the returned time is always a valid sortable
// timestamp downstream. Out-of-range h/m/s (e.g. negative or >=24h) are
// normalized by time.Date — that yields the same wrap-around the rest of
// the Go time package uses, which is the correct conservative behaviour
// for telemetry we don't want to silently drop.
func clockTimeOnDate(h, m, s int32, anchor time.Time) time.Time {
	base := anchor
	if base.IsZero() {
		base = time.Date(1, time.January, 1, 0, 0, 0, 0, time.UTC)
	} else {
		base = base.UTC()
	}
	return time.Date(base.Year(), base.Month(), base.Day(), int(h), int(m), int(s), 0, time.UTC)
}
