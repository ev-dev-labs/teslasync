package codec

import (
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	ftproto "github.com/teslamotors/fleet-telemetry/protos"
	"google.golang.org/protobuf/proto"
)

// invalidValuesTotal counts Datum entries dropped because the producer
// flagged Value.invalid=true (sensor unavailable, transient fault, etc).
// Per ADR-004 these are NOT errors — the producer is explicitly telling
// us the sample is untrustworthy — so we drop+count without logging.
// Label `field` is the canonical proto Field name; an empty label means
// the Datum's Key was absent or unknown.
var invalidValuesTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Subsystem: "codec",
	Name:      "invalid_values_total",
	Help:      "Datum entries dropped because Value.invalid was true.",
}, []string{"field"})

// unsetValuesTotal counts Datum entries dropped because the Value oneof
// had no populated variant. This is a producer bug per the proto schema;
// we count it here so an alert can fire if a specific field starts
// emitting unset values, but we do NOT propagate the error to MQTT.
var unsetValuesTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Subsystem: "codec",
	Name:      "unset_values_total",
	Help:      "Datum entries dropped because Value oneof was unset.",
}, []string{"field"})

// decodeErrorsTotal counts Datum entries dropped due to a decode error
// other than ErrInvalid/ErrUnsetValue (most commonly an unhandled oneof
// variant the protomodel codegen has not yet caught up to). A non-zero
// rate here means either upstream proto bumped without re-running
// `go generate ./internal/tesla/protomodel/...` or the producer is
// emitting a variant we don't know about.
var decodeErrorsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Subsystem: "codec",
	Name:      "decode_errors_total",
	Help:      "Datum entries dropped due to a decode error other than invalid/unset.",
}, []string{"field"})

// flattenErrorsTotal counts Datum entries dropped because the per-field
// flattener failed (most commonly a malformed JSON payload for one of
// the three string-shaped compound fields: DoorState,
// ScheduledChargingStartTime, ScheduledDepartureTime). Per ADR-004 these
// are NOT propagated to MQTT — only outer Payload Unmarshal failures
// trigger redelivery — so we drop+count and continue with the rest of
// the Payload.
var flattenErrorsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
	Namespace: "teslasync",
	Subsystem: "codec",
	Name:      "flatten_errors_total",
	Help:      "Datum entries dropped because the per-field flattener failed.",
}, []string{"field"})

// Decode unmarshals a single Tesla Fleet Telemetry Payload from raw
// protobuf bytes into a slice of typed Atomic rows. Compound message
// variants and JSON-shaped string compounds are flattened to atomic
// children at this boundary; downstream consumers NEVER observe a nested
// map shape (ADR-004 #4).
//
// Error semantics:
//   - Outer proto.Unmarshal failure: returned to the caller. The MQTT
//     handler may surface this for redelivery — these are the "malformed
//     bytes" the architecture document explicitly cites as the only
//     redelivery trigger.
//   - Per-Datum failures (ErrInvalid, ErrUnsetValue, JSON parse errors,
//     unhandled oneof variants): dropped silently with a per-field
//     counter increment. The remaining Datum entries continue through.
//     A producer bug on a single field MUST NOT cause the whole batch to
//     be redelivered — that would compound the bug.
//
// The returned slice is freshly allocated and owned by the caller; the
// codec retains no reference. Order matches the order of Data entries in
// the Payload, with each compound's children inserted in the order
// produced by the per-compound flattener.
func Decode(payload []byte) ([]Atomic, error) {
	var p ftproto.Payload
	if err := proto.Unmarshal(payload, &p); err != nil {
		return nil, fmt.Errorf("codec: unmarshal Payload: %w", err)
	}
	return decodePayload(&p), nil
}

// decodePayload is split out from Decode so tests (and a future Decoder
// type with injected dependencies) can exercise the per-Datum loop
// without round-tripping through proto bytes. It is unexported because
// the public boundary is bytes-in / atomics-out per ADR-004.
func decodePayload(p *ftproto.Payload) []Atomic {
	if p == nil {
		return nil
	}
	sourceEmittedAt := payloadSourceEmittedAt(p)
	emittedAt := time.Time{}
	if sourceEmittedAt != nil {
		emittedAt = *sourceEmittedAt
	}
	vin := p.GetVin()
	data := p.GetData()
	out := make([]Atomic, 0, len(data)*2)
	for _, datum := range data {
		fieldName, value, err := protomodel.DecodeDatum(datum)
		if errors.Is(err, protomodel.ErrInvalid) {
			invalidValuesTotal.WithLabelValues(fieldName).Inc()
			continue
		}
		if errors.Is(err, protomodel.ErrUnsetValue) {
			unsetValuesTotal.WithLabelValues(fieldName).Inc()
			continue
		}
		if err != nil {
			decodeErrorsTotal.WithLabelValues(fieldName).Inc()
			continue
		}
		// Per-field tolerant canonicalisation for the same set of
		// fields the JSON path overrides (canonicalizeFieldsProto).
		// Maps proto BuckleStatusValue strings to bool for the
		// BOOLEAN seatbelt columns, etc. Errors here are real
		// schema violations (e.g. "BuckleStatusFaulted" has no
		// boolean mapping) — drop the Datum on the same channel
		// as protomodel.ErrInvalid so the dashboard's
		// invalid_values_total counter captures both classes.
		value, err = canonicalizeProtoFieldValue(fieldName, value)
		if err != nil {
			invalidValuesTotal.WithLabelValues(fieldName).Inc()
			continue
		}
		atoms, ferr := flattenIfCompound(fieldName, value, emittedAt, vin)
		if ferr != nil {
			flattenErrorsTotal.WithLabelValues(fieldName).Inc()
			continue
		}
		out = append(out, atoms...)
	}
	// Decode is transport-agnostic. A caller that owns a concrete transport
	// boundary must stamp it after decoding; otherwise provenance remains
	// explicitly unknown while a valid payload CreatedAt is retained as source
	// evidence for every flattened child.
	for i := range out {
		out[i].IngestOrigin = IngestOriginUnknown
		out[i].SourceEmittedAt = sourceEmittedAt
	}
	return out
}

// payloadSourceEmittedAt returns source-time evidence only for a present,
// protobuf-valid CreatedAt. A malformed or omitted timestamp is not replaced
// here: receipt fallback is a transport concern and is never source evidence.
func payloadSourceEmittedAt(p *ftproto.Payload) *time.Time {
	ts := p.GetCreatedAt()
	if ts == nil || ts.CheckValid() != nil {
		return nil
	}
	t := ts.AsTime().UTC()
	return &t
}

// flattenIfCompound dispatches on the Go runtime type of value, calling
// the appropriate per-compound flattener for the four typed message
// variants (Location, Doors, TireLocation, Time) and the three
// JSON-shaped string compounds (DoorState, ScheduledChargingStartTime,
// ScheduledDepartureTime). For every other (atomic) value the function
// returns a single-element slice carrying the value through unchanged —
// this is the no-op pass-through case that the bulk of telemetry
// signals (VehicleSpeed, BatteryLevel, etc.) take.
//
// Returning an error from this function indicates a per-Datum failure
// (most commonly a malformed JSON payload); the caller drops the Datum
// and bumps a counter. Returning ([]Atomic, nil) — including with an
// empty slice — is the success case.
func flattenIfCompound(fieldName string, value any, emittedAt time.Time, vin string) ([]Atomic, error) {
	switch v := value.(type) {
	case protomodel.Location:
		return flattenLocation(v, fieldName, emittedAt, vin), nil
	case protomodel.Doors:
		return flattenDoors(v, fieldName, emittedAt, vin), nil
	case protomodel.TireLocation:
		return flattenTireLocation(v, fieldName, emittedAt, vin), nil
	case protomodel.Time:
		return flattenTime(v, fieldName, emittedAt, vin), nil
	case string:
		switch fieldName {
		case "DoorState":
			return flattenDoorStateJSON(v, emittedAt, vin)
		case "ScheduledChargingStartTime":
			return flattenScheduledChargingStartTimeJSON(v, emittedAt, vin)
		case "ScheduledDepartureTime":
			return flattenScheduledDepartureTimeJSON(v, emittedAt, vin)
		}
	}
	return []Atomic{{Field: fieldName, Value: value, EmittedAt: emittedAt, VehicleID: vin}}, nil
}
