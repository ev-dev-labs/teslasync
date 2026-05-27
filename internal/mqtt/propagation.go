// Package mqtt also provides W3C TraceContext propagation helpers for
// internal-topic publish/subscribe paths. Tesla Fleet Telemetry topics
// are NOT wrapped — Tesla owns the publisher and there is no surface to
// inject headers there; those spans start as roots on the consumer side
// (see internal/mqtt/mqtt.go PipelineSubscriber).
//
// Envelope shape (versioned via _v so the schema can evolve):
//
//	{
//	  "_v":     1,
//	  "_trace": {"traceparent":"00-…-01","tracestate":"…"},
//	  "payload": <original JSON document>
//	}
//
// Legacy passthrough: messages without a top-level _trace key are
// returned verbatim — guarantees backward compatibility with in-flight
// messages during a rolling deploy and with any operator-side
// MQTT tooling that publishes raw payloads.
package mqtt

import (
	"context"
	"encoding/json"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
)

// TraceEnvelopeVersion is the only value of `_v` currently produced. The
// extractor accepts any version >= 1 but ignores unknown extra keys.
const TraceEnvelopeVersion = 1

type traceEnvelope struct {
	Version int               `json:"_v"`
	Trace   map[string]string `json:"_trace,omitempty"`
	Payload json.RawMessage   `json:"payload"`
}

// InjectTraceContext wraps the given JSON payload bytes inside a trace
// envelope. The caller MUST pass JSON-shaped bytes — the envelope keeps
// the payload as json.RawMessage so the wire format stays valid JSON.
// If ctx carries no active span and the configured propagator emits no
// headers, the envelope is returned with an empty _trace map (consumer
// will still recognize the envelope shape and unwrap correctly).
func InjectTraceContext(ctx context.Context, payload []byte) ([]byte, error) {
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	env := traceEnvelope{
		Version: TraceEnvelopeVersion,
		Trace:   map[string]string(carrier),
		Payload: json.RawMessage(payload),
	}
	return json.Marshal(env)
}

// ExtractTraceContext is the consumer-side inverse. Returns a context
// carrying the extracted span context (parented to the upstream span)
// AND the unwrapped payload bytes.
//
// Legacy passthrough: if `data` does not start with a JSON object, or
// the unmarshal fails, or there is no `_v` key, the original bytes are
// returned with the input ctx — never errors. This is by design so a
// schema-mismatched or operator-published message keeps flowing
// instead of being dropped.
func ExtractTraceContext(ctx context.Context, data []byte) (context.Context, []byte) {
	// Cheap fast path: the envelope must start with `{` and contain
	// the `"_v"` token. Skipping unmarshal for non-envelope payloads
	// keeps the consumer hot path branch-predicted on cache hits.
	if len(data) == 0 || data[0] != '{' {
		return ctx, data
	}
	var env traceEnvelope
	if err := json.Unmarshal(data, &env); err != nil {
		return ctx, data
	}
	if env.Version < 1 || env.Payload == nil {
		return ctx, data
	}
	if len(env.Trace) > 0 {
		ctx = otel.GetTextMapPropagator().Extract(ctx, propagation.MapCarrier(env.Trace))
	}
	return ctx, []byte(env.Payload)
}
