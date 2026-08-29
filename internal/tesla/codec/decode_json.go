package codec

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// registerCodecCounter registers a single CounterVec in the
// teslasync_codec_* namespace with a `field` label, matching the
// convention of the proto-batch counters in codec.go. Inlined so the
// per-field MQTT counters and proto-batch counters have identical
// label cardinality (downstream dashboards aggregate across both).
func registerCodecCounter(name, help string) *prometheus.CounterVec {
	return promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Subsystem: "codec",
		Name:      name,
		Help:      help,
	}, []string{"field"})
}

// ErrPayloadDrop wraps a per-field decode failure that the caller should
// route through the existing poison-pill / DLQ path. The MQTT subscriber
// matches with errors.Is(err, ErrPayloadDrop) so the legacy handling for
// malformed proto bytes (manual-ack to a quarantine topic) extends to the
// per-field JSON path uniformly: a single bad message MUST NOT block the
// subscription, but it also MUST NOT be silently dropped — it must show
// up in the DLQ with enough metadata to triage.
//
// Wrap with fmt.Errorf("...: %w", ErrPayloadDrop) so the caller can
// recover the descriptive context AND the sentinel.
var ErrPayloadDrop = errors.New("codec: payload drop")

// jsonFieldUnknownTotal counts per-field MQTT messages dropped because the
// topic-derived field name is not in protomodel.SignalsByName. A non-zero
// rate here means either the upstream proto bumped (regenerate
// protomodel/) or the producer is publishing to a key we never declared.
// Distinct from decodeErrorsTotal so dashboards can separate "schema
// drift" from "this Datum was malformed".
var jsonFieldUnknownTotal = registerCodecCounter(
	"json_field_unknown_total",
	"Per-field MQTT messages dropped because the topic field name is not in SignalsByName.",
)

// jsonInvalidValuesTotal mirrors invalidValuesTotal for the per-field MQTT
// path: a body of literal `null` carries the producer's "Value.invalid"
// signal (getDatumValue(Value_Invalid) returns nil, json.Marshal returns
// "null"). Per ADR-004 these are NOT errors, so we drop+count silently.
var jsonInvalidValuesTotal = registerCodecCounter(
	"json_invalid_values_total",
	"Per-field MQTT messages dropped because the body was literal null (producer flagged Value.invalid).",
)

// jsonDecodeErrorsTotal counts per-field MQTT messages that failed JSON
// parsing or kind-mismatched (e.g. a number where SignalMeta says bool).
// These are wrapped with ErrPayloadDrop so the caller routes them to the
// DLQ; the metric exists so an alert can fire on a sustained rate.
var jsonDecodeErrorsTotal = registerCodecCounter(
	"json_decode_errors_total",
	"Per-field MQTT messages that failed JSON decode or kind validation.",
)

// jsonFlattenErrorsTotal mirrors flattenErrorsTotal for the per-field MQTT
// path: a Compound body that parses as JSON but does not match the
// expected shape (e.g. a Location body missing latitude/longitude). Also
// wrapped with ErrPayloadDrop.
var jsonFlattenErrorsTotal = registerCodecCounter(
	"json_flatten_errors_total",
	"Per-field MQTT messages that parsed as JSON but failed compound flattening.",
)

// DecodeJSONField is the per-field MQTT entry point. The Tesla Fleet
// Telemetry MQTT producer publishes one signal per topic in the form
// `{topicBase}/{VIN}/v/{key}` with the raw json.Marshal of the producer's
// per-Value-variant Go value as the body (see upstream
// datastore/mqtt/mqtt_payload.go::processVehicleFields). This function
// reverses that encoding into the same []Atomic shape that Decode emits
// for the proto-batch path so downstream consumers (router,
// normalize.Pipeline, signal.Store) observe a uniform contract.
//
// Inputs:
//   - field      The canonical proto field name from topic segment 4
//     (e.g. "Soc", "Gear", "Location"). Used to look up the
//     ValueKind, CompoundKind, and EnumStringPrefix in
//     protomodel.SignalsByName so the body is decoded against
//     the SAME schema the proto-batch path uses.
//   - body       The raw MQTT message body. Either bare JSON
//     (production) or an envelope `{"value":...,"ts":...}`
//     (replay/test). Envelope detection is unambiguous: every
//     Tesla compound uses domain-specific top-level keys
//     (latitude/longitude, DriverFront/etc., FrontLeft/etc.)
//     and "value" is reserved for the envelope.
//   - vin        The VIN from topic segment 2. Threaded into every emitted
//     Atomic.VehicleID; the caller must validate it earlier so
//     a malformed topic can't poison signal_log.
//   - fallbackTs The wall-clock at which the subscriber received the
//     message. Used as Atomic.EmittedAt when the body is bare
//     (production) since Tesla's per-field publisher does NOT
//     include event-time. The envelope's "ts" overrides this
//     when present (replay path preserves producer time).
//
// Output:
//   - On success: ([]Atomic, nil). Atomics for an atomic ValueKind have
//     length 1. Compound atomics have length matching the flattener
//     (LocationLatitude/Longitude → 2; the 6 DoorState children → 6;
//     the 10 TireLocation children → 10; Time → 1).
//   - On Value.invalid (body == "null"): (nil, nil). Counter incremented.
//     The caller MUST treat (nil, nil) the same way it treats an empty
//     atomic slice: ack the message, do not DLQ.
//   - On unknown field: (nil, nil). Counter incremented. We do NOT DLQ
//     these because a producer publishing a key our codegen has not
//     caught up to is a known operational state, not a poison pill.
//   - On JSON parse / kind / shape failure: (nil, err) where
//     errors.Is(err, ErrPayloadDrop) returns true. Counter incremented.
//     The caller routes to the existing DLQ path.
//
// DecodeJSONField is the SINGLE per-field MQTT translation point in the
// pipeline; downstream code MUST consume []Atomic, never the raw body
// (canonical-string contract, Rule 11 in
// .github/instructions/tesla-pipeline.instructions.md).
//
// Pure-function variant retained for tests and any caller that doesn't
// have an OpenTelemetry context handy. Production hot path (mqtt
// PipelineSubscriber) uses DecodeJSONFieldCtx which threads the
// mqtt.consume parent ctx so the codec.decode_json_field span links
// into the broader trace tree.
func DecodeJSONField(field string, body []byte, vin string, fallbackTs time.Time) ([]Atomic, error) {
	return DecodeJSONFieldCtx(context.Background(), field, body, vin, fallbackTs)
}

// DecodeJSONFieldCtx is the context-aware variant of DecodeJSONField. It
// emits a codec.decode_json_field child span carrying field, body_size,
// atomics_emitted, and outcome attributes so the codec boundary is visible
// in the trace tree.
//
// The body slice MUST NOT be retained beyond the call (a bytes.NewReader
// is captured for one Unmarshal, then released to the caller's pool).
func DecodeJSONFieldCtx(ctx context.Context, field string, body []byte, vin string, fallbackTs time.Time) (atoms []Atomic, err error) {
	var sourceEmittedAt *time.Time
	_, span := otel.Tracer(codecTracerName).Start(
		ctx,
		"codec.decode_json_field",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(
			attribute.String("field", field),
			attribute.Int("body_size", len(body)),
		),
	)
	defer func() {
		// DecodeJSONField is transport-agnostic. The MQTT subscriber stamps
		// the final atomics at the actual receipt boundary; direct callers
		// remain explicitly unknown. This post-decode pass deliberately runs
		// after compound flattening so every child retains provenance.
		for i := range atoms {
			atoms[i].IngestOrigin = IngestOriginUnknown
			atoms[i].SourceEmittedAt = sourceEmittedAt
		}
		span.SetAttributes(attribute.Int("atomics_emitted", len(atoms)))
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "decode_json_field")
		}
		span.End()
	}()

	meta, ok := protomodel.SignalsByName[field]
	if !ok {
		jsonFieldUnknownTotal.WithLabelValues(field).Inc()
		span.SetAttributes(attribute.String("outcome", "unknown_field"))
		return nil, nil
	}

	body, ts, sourceEmittedAt, err := unwrapEnvelope(body, fallbackTs)
	if err != nil {
		jsonDecodeErrorsTotal.WithLabelValues(field).Inc()
		span.SetAttributes(attribute.String("outcome", "envelope_error"))
		return nil, fmt.Errorf("codec: field %q envelope: %v: %w", field, err, ErrPayloadDrop)
	}

	if isJSONNull(body) {
		jsonInvalidValuesTotal.WithLabelValues(field).Inc()
		span.SetAttributes(attribute.String("outcome", "invalid_null"))
		return nil, nil
	}
	span.SetAttributes(attribute.String("value_kind", meta.ValueKind.String()))

	if canonicalizeFieldsJSON[field] {
		atoms, err = decodeCanonicalJSONField(field, body, ts, vin)
		if err == nil {
			span.SetAttributes(attribute.String("outcome", "ok_canonical"))
		}
		return atoms, err
	}

	atoms, err = decodeJSONFieldStrict(meta, field, body, ts, vin)
	if err == nil {
		span.SetAttributes(attribute.String("outcome", "ok"))
	}
	return atoms, err
}

// codecTracerName is the OpenTelemetry tracer name for codec spans.
const codecTracerName = "codec"

// decodeJSONFieldStrict is the strict-typed dispatch branch extracted
// from the legacy DecodeJSONField so DecodeJSONFieldCtx can wrap the
// entry boundary in a single span without bracketing every case arm.
func decodeJSONFieldStrict(meta *protomodel.SignalMeta, field string, body []byte, ts time.Time, vin string) ([]Atomic, error) {
	switch meta.ValueKind {
	case protomodel.ValueKindString:
		var s string
		if err := json.Unmarshal(body, &s); err != nil {
			jsonDecodeErrorsTotal.WithLabelValues(field).Inc()
			return nil, fmt.Errorf("codec: field %q parse string: %v: %w", field, err, ErrPayloadDrop)
		}
		return []Atomic{{Field: field, Value: s, EmittedAt: ts, VehicleID: vin}}, nil

	case protomodel.ValueKindBool:
		var v bool
		if err := json.Unmarshal(body, &v); err != nil {
			jsonDecodeErrorsTotal.WithLabelValues(field).Inc()
			return nil, fmt.Errorf("codec: field %q parse bool: %v: %w", field, err, ErrPayloadDrop)
		}
		return []Atomic{{Field: field, Value: v, EmittedAt: ts, VehicleID: vin}}, nil

	case protomodel.ValueKindInt32:
		var v int32
		if err := json.Unmarshal(body, &v); err != nil {
			jsonDecodeErrorsTotal.WithLabelValues(field).Inc()
			return nil, fmt.Errorf("codec: field %q parse int32: %v: %w", field, err, ErrPayloadDrop)
		}
		return []Atomic{{Field: field, Value: v, EmittedAt: ts, VehicleID: vin}}, nil

	case protomodel.ValueKindInt64:
		var v int64
		if err := json.Unmarshal(body, &v); err != nil {
			jsonDecodeErrorsTotal.WithLabelValues(field).Inc()
			return nil, fmt.Errorf("codec: field %q parse int64: %v: %w", field, err, ErrPayloadDrop)
		}
		return []Atomic{{Field: field, Value: v, EmittedAt: ts, VehicleID: vin}}, nil

	case protomodel.ValueKindFloat:
		var v float32
		if err := json.Unmarshal(body, &v); err != nil {
			jsonDecodeErrorsTotal.WithLabelValues(field).Inc()
			return nil, fmt.Errorf("codec: field %q parse float32: %v: %w", field, err, ErrPayloadDrop)
		}
		return []Atomic{{Field: field, Value: v, EmittedAt: ts, VehicleID: vin}}, nil

	case protomodel.ValueKindDouble:
		var v float64
		if err := json.Unmarshal(body, &v); err != nil {
			jsonDecodeErrorsTotal.WithLabelValues(field).Inc()
			return nil, fmt.Errorf("codec: field %q parse float64: %v: %w", field, err, ErrPayloadDrop)
		}
		return []Atomic{{Field: field, Value: v, EmittedAt: ts, VehicleID: vin}}, nil

	case protomodel.ValueKindEnum:
		var s string
		if err := json.Unmarshal(body, &s); err != nil {
			jsonDecodeErrorsTotal.WithLabelValues(field).Inc()
			return nil, fmt.Errorf("codec: field %q parse enum: %v: %w", field, err, ErrPayloadDrop)
		}
		// Strip the proto-emitted EnumType prefix to produce the same
		// canonical short string the proto-batch path stores (e.g.
		// "ShiftStateD" -> "D", "ChargeStateCharging" -> "Charging").
		// EnumStringPrefix is codegen-populated; never re-derive it.
		s = strings.TrimPrefix(s, meta.EnumStringPrefix)
		return []Atomic{{Field: field, Value: s, EmittedAt: ts, VehicleID: vin}}, nil

	case protomodel.ValueKindCompound:
		atoms, err := decodeCompoundJSON(field, meta.CompoundKind, body, ts, vin)
		if err != nil {
			jsonFlattenErrorsTotal.WithLabelValues(field).Inc()
			return nil, fmt.Errorf("codec: field %q compound: %v: %w", field, err, ErrPayloadDrop)
		}
		return atoms, nil
	}

	jsonDecodeErrorsTotal.WithLabelValues(field).Inc()
	return nil, fmt.Errorf("codec: field %q has unsupported ValueKind %s: %w", field, meta.ValueKind, ErrPayloadDrop)
}

// unwrapEnvelope detects the optional `{"value": <bare>, "ts": "<RFC3339>"}`
// envelope used by the replay tooling (cmd/pub-test-signal). When the body
// is a JSON object whose top-level keys include "value", the inner value
// becomes the body to decode and the optional "ts" (RFC3339) overrides the
// caller-supplied fallback. When the body is anything else (bare JSON
// number/bool/string, JSON array, or a JSON object whose keys do NOT
// include "value"), the body is returned unchanged.
//
// Detection by top-level "value" key is unambiguous: every Tesla compound
// type uses domain-specific keys (latitude/longitude for Location;
// DriverFront/etc. for Doors; FrontLeft/etc. for TireLocation). The
// upstream proto NEVER places "value" as a Field name and getProtoValue's
// returnAsToplevel collapse hides intermediate wrapper objects, so
// "value" can only mean the envelope.
func unwrapEnvelope(body []byte, fallbackTs time.Time) ([]byte, time.Time, *time.Time, error) {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return body, fallbackTs, nil, nil
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(trimmed, &probe); err != nil {
		// Not a parseable object — let the per-kind decoder report the
		// real error against the original body for a clearer message.
		return body, fallbackTs, nil, nil
	}
	raw, ok := probe["value"]
	if !ok {
		return body, fallbackTs, nil, nil
	}
	ts := fallbackTs
	var sourceEmittedAt *time.Time
	if rawTs, hasTs := probe["ts"]; hasTs {
		var s string
		if err := json.Unmarshal(rawTs, &s); err != nil {
			return nil, time.Time{}, nil, fmt.Errorf("envelope ts: %v", err)
		}
		parsed, err := time.Parse(time.RFC3339Nano, s)
		if err != nil {
			return nil, time.Time{}, nil, fmt.Errorf("envelope ts %q: %v", s, err)
		}
		ts = parsed.UTC()
		sourceEmittedAt = &ts
	}
	return raw, ts, sourceEmittedAt, nil
}

// isJSONNull reports whether body is the literal JSON null token. Used to
// detect the producer's Value.invalid signal which marshals as `null`.
func isJSONNull(body []byte) bool {
	return bytes.Equal(bytes.TrimSpace(body), []byte("null"))
}

// decodeCompoundJSON dispatches on protomodel.CompoundKind to select the
// right shape parser. Three of the five compounds carried by the proto
// have their wire form on per-field MQTT diverge from the proto-bytes
// path:
//
//   - Location (LocationValue):
//     proto-bytes path returns protomodel.Location; per-field MQTT body
//     is a JSON object with LOWERCASE keys ({"latitude":x,"longitude":y})
//     because Tesla's getDatumValue marshals through map[string]float64.
//
//   - Doors (DoorValue):
//     proto-bytes path returns protomodel.Doors; per-field MQTT body is a
//     JSON object with capitalised proto-aligned keys
//     ({"DriverFront":true,...,"TrunkFront":true,"TrunkRear":true}).
//     NOTE: as of vehicle_data.proto v0.9.0 NO Field declares
//     Value_DoorValue — DoorState (Field=58) is a JSON-string compound
//     (handled below by the string-shape branch) — so this proto-typed
//     branch is only exercised by tests today.
//
//   - TireLocation (TireLocationValue):
//     proto-bytes path returns protomodel.TireLocation; per-field MQTT
//     body is a JSON object with capitalised proto-aligned keys.
//     Two Fields (TpmsHardWarnings, TpmsSoftWarnings) declare it.
//
//   - Time (TimeValue):
//     proto-bytes path returns protomodel.Time; per-field MQTT body is
//     the bare JSON-quoted string "HH:MM:SS" (no Field declares this
//     today, but the path is honoured for forward compatibility).
//
// The three string-shaped compounds (DoorState, ScheduledChargingStartTime,
// ScheduledDepartureTime) take the body-is-JSON-string path: per Tesla's
// getDatumValue the producer returns the raw string verbatim, and
// json.Marshal of that string produces a JSON-quoted, double-encoded
// payload. We detect this by body[0] == '"' and reuse the existing
// flatten*JSON helpers from flatten.go via flattenIfCompound.
func decodeCompoundJSON(field string, kind protomodel.CompoundKind, body []byte, ts time.Time, vin string) ([]Atomic, error) {
	if len(bytes.TrimSpace(body)) == 0 {
		return nil, errors.New("empty body")
	}
	// String-shape: any compound whose body is a JSON-quoted string is a
	// JSON-string compound (DoorState, Sched*, or a future Time-wire
	// case). Unmarshal once to peel the JSON quotes off, then route by
	// fieldName through the existing flatten dispatcher.
	if bytes.TrimSpace(body)[0] == '"' {
		var s string
		if err := json.Unmarshal(body, &s); err != nil {
			return nil, fmt.Errorf("string-shape parse: %v", err)
		}
		atoms, err := flattenIfCompound(field, s, ts, vin)
		if err != nil {
			return nil, err
		}
		return atoms, nil
	}
	switch kind {
	case protomodel.CompoundKindLocation:
		// Tesla's wire shape uses lowercase latitude/longitude (Tesla's
		// getDatumValue builds map[string]float64 with literal lowercase
		// keys). Use a struct with explicit json tags so we don't depend
		// on protomodel.Location's Go field naming.
		var w struct {
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
		}
		if err := json.Unmarshal(body, &w); err != nil {
			return nil, fmt.Errorf("location parse: %v", err)
		}
		return flattenLocation(protomodel.Location{Latitude: w.Latitude, Longitude: w.Longitude}, field, ts, vin), nil

	case protomodel.CompoundKindDoors:
		var d protomodel.Doors
		if err := json.Unmarshal(body, &d); err != nil {
			return nil, fmt.Errorf("doors parse: %v", err)
		}
		return flattenDoors(d, field, ts, vin), nil

	case protomodel.CompoundKindTireLocation:
		// Tesla's wire shape comes through the generic getProtoValue
		// fallback, which emits proto field names in lowercase
		// (front_left, etc.). protomodel.TireLocation uses Go-cased
		// names, so we accept both via a hand-written unmarshaller.
		var w tireLocationWire
		if err := json.Unmarshal(body, &w); err != nil {
			return nil, fmt.Errorf("tire-location parse: %v", err)
		}
		return flattenTireLocation(w.toProtoModel(), field, ts, vin), nil

	case protomodel.CompoundKindTime:
		// Bare-string Time is reserved for forward-compat. Today the two
		// real Time-classified Fields (Sched*) ride the JSON-string
		// branch above. If a future producer ever emits a non-string
		// Time body for an actual Time-wire field, surface as a parse
		// failure so the codegen guard catches it instead of silently
		// emitting the zero time.
		return nil, errors.New("time wire form must be JSON-quoted \"HH:MM:SS\"")
	}
	return nil, fmt.Errorf("unsupported CompoundKind %s", kind)
}

// tireLocationWire is the wire representation for TireLocation on the
// per-field MQTT path. Tesla's getProtoValue fallback emits the proto
// field names verbatim from the descriptor, which means lower_snake_case
// (front_left, semi_middle_axle_left_2, ...). We tag both forms (snake
// and Go-cased) so we accept either shape — the snake form is what the
// production producer emits today; the Go-cased form is what tests and
// any future first-class typed marshal would emit.
type tireLocationWire struct {
	FrontLeft            *bool `json:"front_left,omitempty"`
	FrontRight           *bool `json:"front_right,omitempty"`
	RearLeft             *bool `json:"rear_left,omitempty"`
	RearRight            *bool `json:"rear_right,omitempty"`
	SemiMiddleAxleLeft2  *bool `json:"semi_middle_axle_left_2,omitempty"`
	SemiMiddleAxleRight2 *bool `json:"semi_middle_axle_right_2,omitempty"`
	SemiRearAxleLeft     *bool `json:"semi_rear_axle_left,omitempty"`
	SemiRearAxleRight    *bool `json:"semi_rear_axle_right,omitempty"`
	SemiRearAxleLeft2    *bool `json:"semi_rear_axle_left_2,omitempty"`
	SemiRearAxleRight2   *bool `json:"semi_rear_axle_right_2,omitempty"`

	// Capitalised aliases consume the Go-cased shape that test fixtures
	// (and any first-class typed json.Marshal of protomodel.TireLocation)
	// would emit. UnmarshalJSON below merges both forms.
	FrontLeftAlt            *bool `json:"FrontLeft,omitempty"`
	FrontRightAlt           *bool `json:"FrontRight,omitempty"`
	RearLeftAlt             *bool `json:"RearLeft,omitempty"`
	RearRightAlt            *bool `json:"RearRight,omitempty"`
	SemiMiddleAxleLeft2Alt  *bool `json:"SemiMiddleAxleLeft2,omitempty"`
	SemiMiddleAxleRight2Alt *bool `json:"SemiMiddleAxleRight2,omitempty"`
	SemiRearAxleLeftAlt     *bool `json:"SemiRearAxleLeft,omitempty"`
	SemiRearAxleRightAlt    *bool `json:"SemiRearAxleRight,omitempty"`
	SemiRearAxleLeft2Alt    *bool `json:"SemiRearAxleLeft2,omitempty"`
	SemiRearAxleRight2Alt   *bool `json:"SemiRearAxleRight2,omitempty"`
}

func (w tireLocationWire) toProtoModel() protomodel.TireLocation {
	pick := func(snake, alt *bool) bool {
		if snake != nil {
			return *snake
		}
		if alt != nil {
			return *alt
		}
		return false
	}
	return protomodel.TireLocation{
		FrontLeft:            pick(w.FrontLeft, w.FrontLeftAlt),
		FrontRight:           pick(w.FrontRight, w.FrontRightAlt),
		RearLeft:             pick(w.RearLeft, w.RearLeftAlt),
		RearRight:            pick(w.RearRight, w.RearRightAlt),
		SemiMiddleAxleLeft2:  pick(w.SemiMiddleAxleLeft2, w.SemiMiddleAxleLeft2Alt),
		SemiMiddleAxleRight2: pick(w.SemiMiddleAxleRight2, w.SemiMiddleAxleRight2Alt),
		SemiRearAxleLeft:     pick(w.SemiRearAxleLeft, w.SemiRearAxleLeftAlt),
		SemiRearAxleRight:    pick(w.SemiRearAxleRight, w.SemiRearAxleRightAlt),
		SemiRearAxleLeft2:    pick(w.SemiRearAxleLeft2, w.SemiRearAxleLeft2Alt),
		SemiRearAxleRight2:   pick(w.SemiRearAxleRight2, w.SemiRearAxleRightAlt),
	}
}
