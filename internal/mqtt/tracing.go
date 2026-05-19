package mqtt

import (
	"bytes"
	"context"
	"encoding/json"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
)

// W3C trace-context propagation through MQTT 3.1.1.
//
// Background
// ----------
// MQTT 5 supports per-message user properties, which is the natural carrier
// for W3C `traceparent`/`tracestate` headers (see the OpenTelemetry MQTT
// semantic conventions). The eclipse/paho.mqtt.golang client TeslaSync uses
// today (mqtt.go:16) is locked to MQTT 3.1.1, which has no header mechanism.
// Migrating to eclipse/paho.golang for MQTT 5 is a large, multi-day change
// that would touch every callsite in the API server, the four worker
// binaries, and the Phase-42 PipelineSubscriber. That migration is tracked
// separately.
//
// Until then, this file gives us *practical* W3C trace context propagation
// for the publishers TeslaSync owns end-to-end: the API server's HTTP-handled
// publish paths and the notification/export/automation workers. The encoder
// wraps the original JSON payload in a small `{"_tc": {...}, "payload": …}`
// envelope; the decoder unwraps it on the consumer side. Payloads that are
// not JSON, or JSON payloads that do not have an `_tc` envelope, are passed
// through unchanged so existing (pre-instrumented) producers keep working.
//
// Tesla Fleet Telemetry messages flow through paho's raw bytes path
// (`onPipelineMessage` → `handlePayload`) and are *not* envelope-wrapped,
// because Tesla controls the publisher and does not emit a `traceparent`.
// Those messages remain root spans, which is the correct semantic.

// traceContextEnvelopeKey is the JSON key under which the W3C trace-context
// carrier is stored when an outbound JSON payload is wrapped. The leading
// underscore avoids collision with payload fields that callers might
// legitimately call "tc" / "trace" / "context". Locked as a wire contract.
const traceContextEnvelopeKey = "_tc"

// traceContextPayloadKey is the JSON key under which the original payload
// lives inside a trace-wrapped envelope. Locked as a wire contract.
const traceContextPayloadKey = "payload"

// mapCarrier is a propagation.TextMapCarrier backed by a Go map. The OTel
// propagation package ships a built-in MapCarrier with the same shape, but
// re-declaring it locally keeps this file's surface tight and isolates it
// from upstream renames.
type mapCarrier map[string]string

// Get implements propagation.TextMapCarrier.
func (c mapCarrier) Get(key string) string { return c[key] }

// Set implements propagation.TextMapCarrier.
func (c mapCarrier) Set(key, value string) { c[key] = value }

// Keys implements propagation.TextMapCarrier.
func (c mapCarrier) Keys() []string {
	keys := make([]string, 0, len(c))
	for k := range c {
		keys = append(keys, k)
	}
	return keys
}

// injectTraceContext serialises the active span context from ctx into a fresh
// carrier map using the globally-registered TextMapPropagator. Returns nil
// when ctx carries no valid span context, so callers can cheaply skip the
// envelope-wrap step.
func injectTraceContext(ctx context.Context) map[string]string {
	if ctx == nil {
		return nil
	}
	if sc := trace.SpanContextFromContext(ctx); !sc.IsValid() {
		return nil
	}
	carrier := mapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	if len(carrier) == 0 {
		return nil
	}
	return map[string]string(carrier)
}

// extractTraceContext rehydrates a parent span context from a carrier
// previously produced by injectTraceContext, returning a context that
// downstream spans can use as their parent. The base ctx is returned
// unchanged when the carrier is empty.
func extractTraceContext(ctx context.Context, carrier map[string]string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if len(carrier) == 0 {
		return ctx
	}
	return otel.GetTextMapPropagator().Extract(ctx, mapCarrier(carrier))
}

// wrapJSONWithTraceContext wraps payloadJSON in a `{"_tc": {...}, "payload":
// <payloadJSON>}` envelope when ctx carries a valid span context. Returns
// payloadJSON unchanged when there is no span context to propagate, so the
// happy non-traced path adds zero bytes.
//
// payloadJSON MUST already be valid JSON; non-JSON payloads should bypass
// this helper because the envelope would corrupt them on the consumer side.
func wrapJSONWithTraceContext(ctx context.Context, payloadJSON []byte) []byte {
	carrier := injectTraceContext(ctx)
	if carrier == nil {
		return payloadJSON
	}
	// json.RawMessage preserves the caller's exact serialization (field
	// order, whitespace) inside the envelope — important for downstream
	// consumers that may have content-addressable caches keyed on the JSON
	// bytes.
	envelope := struct {
		TraceContext map[string]string `json:"_tc"`
		Payload      json.RawMessage   `json:"payload"`
	}{
		TraceContext: carrier,
		Payload:      payloadJSON,
	}
	wrapped, err := json.Marshal(envelope)
	if err != nil {
		// Marshalling a known-good payload and a string map should not
		// fail; if it does, fall back to the unwrapped bytes so we do
		// not silently drop the message.
		return payloadJSON
	}
	return wrapped
}

// unwrapJSONTraceContext is the consumer-side counterpart to
// wrapJSONWithTraceContext. Returns:
//   - the original (unwrapped) payload bytes, suitable for the existing
//     decode path,
//   - a context whose span context is the propagated parent (or the input
//     ctx unchanged when no envelope was present), and
//   - hadEnvelope=true iff the message was actually trace-wrapped.
//
// Payloads that are not JSON, or JSON objects without the envelope's
// signature keys, are returned unchanged with hadEnvelope=false. This makes
// the unwrapper safe to call unconditionally on every inbound payload.
func unwrapJSONTraceContext(ctx context.Context, payload []byte) ([]byte, context.Context, bool) {
	if !looksLikeJSONObject(payload) {
		return payload, ctx, false
	}
	var probe struct {
		TraceContext map[string]string `json:"_tc"`
		Payload      json.RawMessage   `json:"payload"`
	}
	if err := json.Unmarshal(payload, &probe); err != nil {
		return payload, ctx, false
	}
	// Both envelope keys must be present; otherwise this is a legitimate
	// JSON payload that happens to share the structure of one.
	if probe.TraceContext == nil || probe.Payload == nil {
		return payload, ctx, false
	}
	return []byte(probe.Payload), extractTraceContext(ctx, probe.TraceContext), true
}

// looksLikeJSONObject is a fast pre-check that avoids the json.Unmarshal cost
// for payloads that are obviously not objects (proto bytes, raw scalars,
// JSON arrays). Trims leading ASCII whitespace and checks the first
// non-whitespace byte.
func looksLikeJSONObject(payload []byte) bool {
	trimmed := bytes.TrimLeft(payload, " \t\r\n")
	return len(trimmed) > 0 && trimmed[0] == '{'
}
